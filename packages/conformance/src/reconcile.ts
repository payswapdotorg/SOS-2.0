/**
 * Code-to-architecture reconciliation (spec/architecture.md §6, R23,
 * docs/code-to-architecture.md).
 *
 * Pipeline: observed ImplementationModel -> normalized ImplementationModel
 * -> compare with the declared ArchitectureGraph artifact via the MERGED
 * W0.5 conformance classifier (@sos-2/semantic-spine classifyDifferences)
 * -> typed reconciliation records LINKED to semantic ids.
 *
 * Every record carries a trace link over the 17 frozen types:
 *   source = the observed ImplementationModel artifact id
 *   target = the declared ArchitectureGraph artifact id
 *   type   = OBSERVES         (IMPLEMENTATION_DETAIL, EXPECTED_VARIATION)
 *            REFINES          (PRESERVING_REFINEMENT)
 *            DERIVED_FROM     (INTENTIONAL_EVOLUTION, UNKNOWN)
 *            CONTRADICTS      (DRIFT, CONTRADICTION)
 *
 * Normalization (this layer; the classifier and ImplementationModel contract
 * are frozen): implementation component kinds are projected onto graph node
 * kinds (componentKindMap, default: registered node kinds pass through,
 * anything else maps to "Component"); implementation dependency kinds are
 * projected onto graph edge kinds (dependencyKindMap, default: registered
 * edge kinds pass through, anything else maps to "Dependency").
 *
 * DRIFT and CONTRADICTION findings additionally produce Evidence-record-
 * shaped drift records (see drift.ts — minimal by design; the full Evidence
 * Graph is W3's scope).
 */

import {
  classifyDifferences,
  createTraceLink,
  isArtifactId,
  parseArtifactId,
} from '@sos-2/semantic-spine';
import type {
  ArchitectureGraphEdge,
  ClassificationConfig,
  ConformanceClass,
  ConformanceFinding,
  ImplementationModel,
  TraceLink,
  TraceLinkType,
} from '@sos-2/semantic-spine';
import { isImplementationModel } from '@sos-2/semantic-spine';
import { assertValidArchitectureGraphArtifact, isRegisteredEdgeKind, isRegisteredNodeKind } from '@sos-2/architecture';
import type { ArchitectureGraphArtifact } from '@sos-2/architecture';
import { ReconciliationError } from './errors.js';
import { buildDriftEvidenceRecord } from './drift.js';
import type { DriftClassification, DriftEvidenceRecord } from './drift.js';

/** The frozen classification -> trace-link-type mapping (documented above). */
export const CONFORMANCE_LINK_TYPES: Readonly<Record<ConformanceClass, TraceLinkType>> = {
  IMPLEMENTATION_DETAIL: 'OBSERVES',
  EXPECTED_VARIATION: 'OBSERVES',
  PRESERVING_REFINEMENT: 'REFINES',
  INTENTIONAL_EVOLUTION: 'DERIVED_FROM',
  DRIFT: 'CONTRADICTS',
  UNKNOWN: 'DERIVED_FROM',
  CONTRADICTION: 'CONTRADICTS',
};

export interface ReconciliationConfig {
  /** Implementation component kind -> graph node kind. */
  componentKindMap?: Record<string, string>;
  /** Implementation dependency kind -> graph edge kind. */
  dependencyKindMap?: Record<string, string>;
  /** Spine classifier configuration (undeclaredPolicy, expectedVariations, intentionalEvolutions). */
  classifier?: ClassificationConfig;
}

/** A typed reconciliation record: { classification, subject, reason } linked to semantic ids. */
export interface ReconciliationRecord {
  classification: ConformanceClass;
  /** Component id or edge key ("source->target"). */
  subject: string;
  reason: string;
  /** The trace link binding the observed model to the declared graph. */
  link: TraceLink;
}

export interface ReconciliationResult {
  /** All findings as typed records (spine order: nodes then edges, subjects ascending). */
  records: ReconciliationRecord[];
  /** Deduplicated trace links (one per distinct (source, target, type)). */
  links: TraceLink[];
  /** Minimal Evidence-shaped drift records (DRIFT and CONTRADICTION only). */
  drift: DriftEvidenceRecord[];
  /** The normalized ImplementationModel actually compared (auditability). */
  normalizedModel: ImplementationModel;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function assertKindMap(value: unknown, field: string): void {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ReconciliationError(`${field} must be a plain object mapping kinds to kinds`);
  }
  for (const [key, entry] of Object.entries(value)) {
    if (!isNonEmptyString(key) || !isNonEmptyString(entry)) {
      throw new ReconciliationError(`${field} keys and values must be non-empty strings`);
    }
  }
}

function mapKind(kind: string, map: Record<string, string> | undefined, isRegistered: (kind: string) => boolean, fallback: string): string {
  const mapped = map?.[kind];
  if (mapped !== undefined) {
    return mapped;
  }
  return isRegistered(kind) ? kind : fallback;
}

/**
 * Normalize an ImplementationModel for comparison with an ArchitectureGraph:
 * project component kinds onto node kinds and dependency kinds onto edge
 * kinds. Returns a deep copy; the input model is never mutated.
 */
export function normalizeImplementationModel(
  model: ImplementationModel,
  config: ReconciliationConfig = {},
): ImplementationModel {
  if (!isImplementationModel(model)) {
    throw new ReconciliationError('observed value does not match the ImplementationModel contract');
  }
  if (config.componentKindMap !== undefined) {
    assertKindMap(config.componentKindMap, 'config.componentKindMap');
  }
  if (config.dependencyKindMap !== undefined) {
    assertKindMap(config.dependencyKindMap, 'config.dependencyKindMap');
  }
  return {
    ...model,
    components: model.components.map((component) => ({
      ...component,
      kind: mapKind(component.kind, config.componentKindMap, isRegisteredNodeKind, 'Component'),
    })),
    dependencies: model.dependencies.map((dependency) => ({
      ...dependency,
      kind: mapKind(dependency.kind, config.dependencyKindMap, isRegisteredEdgeKind, 'Dependency'),
    })),
  };
}

function isDriftFinding(
  finding: ConformanceFinding,
): finding is ConformanceFinding & { classification: DriftClassification } {
  return finding.classification === 'DRIFT' || finding.classification === 'CONTRADICTION';
}

/**
 * Project the declared graph's edges into the spine classifier's declared
 * contract: AT MOST ONE declared edge per (source, target) pair (the
 * classifier keys declared edges by pair, while the Architecture Graph keys
 * edges by the (source, target, kind) triple and may legitimately carry
 * several typed edges per pair).
 *
 * The representative edge per pair is chosen DETERMINISTICALLY:
 *   - when the normalized observed model has a dependency for the pair, the
 *     declared edge with the observed kind when present (a genuine kind
 *     match), else the alphabetically-first declared edge (a deterministic
 *     conflict representative for the UNKNOWN rule);
 *   - otherwise the alphabetically-first declared edge.
 * The choice is a pure function of (declared graph, normalized model), so
 * reconcile stays deterministic and total on all valid inputs.
 */
function buildPairUniqueDeclaredEdges(
  declared: ArchitectureGraphArtifact,
  normalized: ImplementationModel,
): ArchitectureGraphEdge[] {
  const byPair = new Map<string, ArchitectureGraphEdge[]>();
  for (const edge of declared.content.edges) {
    const key = `${edge.source}->${edge.target}`;
    const list = byPair.get(key) ?? [];
    list.push(edge);
    byPair.set(key, list);
  }
  const observedByPair = new Map(
    normalized.dependencies.map((dependency) => [`${dependency.source}->${dependency.target}`, dependency]),
  );
  const result: ArchitectureGraphEdge[] = [];
  for (const edges of byPair.values()) {
    const sortedEdges = [...edges].sort((a, b) => (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0));
    const observed = observedByPair.get(`${sortedEdges[0]!.source}->${sortedEdges[0]!.target}`);
    const representative =
      (observed !== undefined ? sortedEdges.find((edge) => edge.kind === observed.kind) : undefined) ??
      sortedEdges[0]!;
    result.push({
      source: representative.source,
      target: representative.target,
      kind: representative.kind,
      ...(representative.criticality !== 'normal' ? { criticality: representative.criticality } : {}),
    });
  }
  return result;
}

/**
 * Reconcile the observed implementation with the declared architecture.
 * Deterministic and total on valid inputs; every finding is a typed record
 * linked to the two compared semantic ids.
 */
export function reconcile(
  observed: ImplementationModel,
  declared: ArchitectureGraphArtifact,
  config: ReconciliationConfig = {},
): ReconciliationResult {
  if (!isImplementationModel(observed)) {
    throw new ReconciliationError('observed value does not match the ImplementationModel contract');
  }
  if (!isArtifactId(observed.id)) {
    throw new ReconciliationError(
      `observed.id must be a well-formed artifact id, received: ${JSON.stringify(observed.id)}`,
    );
  }
  const parsedModelId = parseArtifactId(observed.id);
  if (parsedModelId.kind !== 'ImplementationModel') {
    throw new ReconciliationError(
      `observed.id must be a sos://ImplementationModel/ artifact id, received kind "${parsedModelId.kind}"`,
    );
  }
  try {
    assertValidArchitectureGraphArtifact(declared);
  } catch (error) {
    throw new ReconciliationError(`declared architecture graph is invalid: ${(error as Error).message}`);
  }

  const normalized = normalizeImplementationModel(observed, config);
  const declaredRef = {
    nodes: declared.content.nodes.map((node) => ({
      id: node.id,
      kind: node.kind,
      ...(node.criticality !== 'normal' ? { criticality: node.criticality } : {}),
    })),
    edges: buildPairUniqueDeclaredEdges(declared, normalized),
  };

  const findings: ConformanceFinding[] = classifyDifferences(normalized, declaredRef, config.classifier ?? {});

  const linkProvenance = [`W2:reconcile:${observed.id}->${declared.envelope.id}`];
  const records: ReconciliationRecord[] = findings.map((finding) => ({
    classification: finding.classification,
    subject: finding.subject,
    reason: finding.reason,
    link: createTraceLink({
      source: observed.id,
      target: declared.envelope.id,
      type: CONFORMANCE_LINK_TYPES[finding.classification],
      provenance: linkProvenance,
    }),
  }));

  const links: TraceLink[] = [];
  const linkKeys = new Set<string>();
  for (const record of records) {
    const key = `${record.link.source}\u0000${record.link.target}\u0000${record.link.type}`;
    if (!linkKeys.has(key)) {
      linkKeys.add(key);
      links.push(record.link);
    }
  }

  const drift: DriftEvidenceRecord[] = findings
    .filter(isDriftFinding)
    .map((finding) =>
      buildDriftEvidenceRecord({
        classification: finding.classification,
        subject: finding.subject,
        subject_ref: declared.envelope.id,
        reason: finding.reason,
        model_id: observed.id,
        source_revision: observed.revision,
      }),
    );

  return { records, links, drift, normalizedModel: normalized };
}
