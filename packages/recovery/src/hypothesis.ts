/**
 * Brownfield architecture recovery — competing ArchitectureGraph hypotheses
 * from an observed ImplementationModel (Work Order W4; spec/architecture.md
 * §6 and §15, docs/code-to-architecture.md, R6/R23).
 *
 * Pipeline position (docs/code-to-architecture.md):
 *     Observed implementation -> normalized ImplementationModel
 *       -> COMPETING ARCHITECTURE HYPOTHESES   <-- this module
 *       -> compare with declared ArchitectureGraph (compare.ts)
 *       -> classify differences (delegated to @sos-2/conformance reconcile)
 *
 * AMBIGUITY MODEL (deterministic, evidence-driven — never forced into one
 * architecture):
 *   A. KIND AMBIGUITY — an observed component kind admits more than one
 *      candidate graph node kind. Candidates come from (in precedence
 *      order): explicit `config.componentKindMap` (single, unambiguous),
 *      explicit `config.kindAmbiguities`, the observed kind itself when it
 *      is already a registered node kind (unambiguous), the documented
 *      DEFAULT_KIND_AMBIGUITIES heuristic vocabulary, or the 'Component'
 *      fallback. Every kind with >1 candidate contributes one decision
 *      dimension; the hypothesis space is the cross product of the
 *      candidates (capped by `config.maxHypotheses`, default 16 — the
 *      truncation is RETAINED as a TRUNCATED_HYPOTHESIS_SPACE marker, never
 *      silently dropped).
 *   B. GROUPED REALIZATION — at least one observed component declares a
 *      `realizes` refinement of a declared node id. Two readings stay
 *      possible: DIRECT (every component is its own node; the declared node
 *      is realized by refinement components) and MERGED_REALIZATIONS
 *      (components that realize exactly one declared id collapse into that
 *      node — the "the shards are one component" reading).
 *
 * Both dimensions are enumerated TOGETHER (vector-major: every assignment
 * vector pairs with every applicable strategy, so strategy diversity
 * survives truncation). Unambiguous evidence yields EXACTLY ONE hypothesis;
 * ambiguous evidence yields SEVERAL — pinned by negative tests.
 *
 * Every hypothesis:
 *   - is a real ArchitectureGraphArtifact (a versioned DRAFT hypothesis over
 *     the caller-supplied exact SystemState revision) created through
 *     @sos-2/architecture — recovery never invents graph structure outside
 *     that authority, never activates anything (status is DRAFT by
 *     construction) and never mutates the input model;
 *   - carries a typed HypothesisDerivation (which inputs produced it: model
 *     id, exact revision, strategy, full kind assignment, input digest,
 *     counts, unresolved endpoints);
 *   - carries uncertainty/ambiguity markers (markers.ts) — every place
 *     where evidence was ambiguous or could not be placed is retained;
 *   - is linked to the source ImplementationModel id through spine trace
 *     links DERIVED_FROM and OBSERVES whose provenance records the exact
 *     source revision (`source-revision:<rev>` — W2 token convention);
 *   - exposes its `model_view`: the exact ImplementationModel interpretation
 *     it asserts (kind-assigned components, interface projection, merge
 *     remapping), which is the artifact @sos-2/conformance reconcile
 *     consumes in compare.ts.
 *
 * Interface projection (the W4 classification extension): observed
 * interfaces become Interface-kind pseudo-components with Provides/Consumes
 * dependency edges, so declared Interface nodes and Provides edges become
 * CLASSIFIABLE by the merged spine classifier (which classifies components
 * and dependency edges — W0.5 scope note). Classification logic itself is
 * never reimplemented here.
 *
 * Determinism: identical (model, input) pairs produce byte-identical
 * results — canonical serialization, sorted enumerations, content-addressed
 * hypothesis ids. Hypothesis artifact ids are asserted unique (two
 * enumeration branches producing the same id is a construction bug and
 * fails loudly).
 */

import {
  canonicalSerialize,
  contentHash,
  createTraceLink,
  isArtifactId,
  isImplementationModel,
  parseArtifactId,
  RFC3339_PATTERN,
} from '@sos-2/semantic-spine';
import type { ImplementationModel, JsonValue, TraceLink } from '@sos-2/semantic-spine';
import {
  assertValidSystemStateRevisionRef,
  createArchitectureGraph,
  isRegisteredEdgeKind,
  isRegisteredNodeKind,
} from '@sos-2/architecture';
import type { ArchitectureGraphArtifact } from '@sos-2/architecture';
import { normalizeImplementationModel } from '@sos-2/conformance';
import type { SystemStateRevisionRef } from '@sos-2/system-state';
import { RecoveryError } from './errors.js';
import {
  buildAmbiguityMarker,
  compareAmbiguityMarkers,
  isAmbiguityMarker,
} from './markers.js';
import type { AmbiguityMarker } from './markers.js';

// ---------------------------------------------------------------------------
// Public vocabulary
// ---------------------------------------------------------------------------

export const RECOVERY_STRATEGIES = ['DIRECT', 'MERGED_REALIZATIONS'] as const;
export type RecoveryStrategy = (typeof RECOVERY_STRATEGIES)[number];

/**
 * The documented heuristic kind-ambiguity vocabulary for common raw
 * implementation kinds (overridable via config.kindAmbiguities /
 * config.componentKindMap). Only multi-candidate entries create ambiguity;
 * this table is a RECOVERY HEURISTIC, never architectural truth — its whole
 * purpose is to make ambiguity EXPLICIT so multiple hypotheses are retained
 * instead of one analyzer's guess being canonized.
 */
export const DEFAULT_KIND_AMBIGUITIES: Readonly<Record<string, readonly string[]>> = {
  service: ['Component', 'Adapter'],
  datastore: ['DataStore', 'Component'],
  adapter: ['Adapter', 'Component'],
  library: ['Component'],
  framework: ['Component'],
  app: ['Component'],
  cli: ['Component'],
  job: ['Component', 'Adapter'],
  interface: ['Interface'],
  'external-service': ['Adapter', 'Component'],
};

/** Default hypothesis cap (documented; overridable, 2..MAX_HYPOTHESES_LIMIT — never 1: the cap bounds explosion, it cannot collapse ambiguity). */
export const DEFAULT_MAX_HYPOTHESES = 16;

/** Hard ceiling for the cap (guards against combinatorial explosion). */
export const MAX_HYPOTHESES_LIMIT = 1024;

/** The minimum hypothesis cap (ambiguity can never be collapsed to one architecture). */
export const MIN_HYPOTHESES_LIMIT = 2;

// ---------------------------------------------------------------------------
// Inputs and outputs
// ---------------------------------------------------------------------------

export interface RecoveryConfig {
  /** Unambiguous observed component kind -> node kind (highest precedence). */
  componentKindMap?: Record<string, string>;
  /** Observed dependency kind -> graph edge kind (delegated to @sos-2/conformance normalization). */
  dependencyKindMap?: Record<string, string>;
  /** Observed component kind -> competing candidate node kinds (>= 1 each). */
  kindAmbiguities?: Record<string, string[]>;
  /** Hypothesis cap (default 16; truncation retained as a marker). */
  maxHypotheses?: number;
  /** Authority reference stamped on hypothesis envelopes, or null (default). */
  authority_ref?: string | null;
  /** Envelope version for hypotheses (default 1). */
  version?: number;
}

export interface RecoveryInput {
  /** The observed, normalized ImplementationModel (spine contract). */
  model: ImplementationModel;
  /** The exact SystemState revision every hypothesis projects (W2 discipline). */
  projects_system_state: SystemStateRevisionRef;
  /** REQUIRED non-empty provenance entries (who ran the recovery — spine discipline). */
  provenance: string[];
  /** RFC3339 creation timestamp, caller-supplied (no hidden clocks). */
  created_at: string;
  config?: RecoveryConfig;
}

/** Which inputs produced a hypothesis (W4 acceptance: provenance retained). */
export interface HypothesisDerivation {
  /** The observed ImplementationModel artifact id this hypothesis derives from. */
  model_id: string;
  /** The EXACT source revision of the observed model. */
  model_revision: string;
  /** The competing strategy that produced this hypothesis. */
  strategy: RecoveryStrategy;
  /** Full observed-kind -> node-kind assignment asserted by this hypothesis (sorted keys). */
  kind_assignments: Record<string, string>;
  /** sha-256 over the canonical serialization of { model, recovery config } — the exact interpretation inputs. */
  input_digest: string;
  /** Observed component count (input model). */
  component_count: number;
  /** Observed dependency count (input model). */
  dependency_count: number;
  /** Observed interface count (input model). */
  interface_count: number;
  /** Dependency endpoint ids that referenced nothing observable (sorted, unique) — retained, never silently dropped. */
  unresolved_dependency_endpoints: string[];
}

export type HypothesisUncertainty = 'UNAMBIGUOUS' | 'AMBIGUOUS';

export interface RecoveryHypothesis {
  /** The competing architecture hypothesis (DRAFT ArchitectureGraphArtifact). */
  artifact: ArchitectureGraphArtifact;
  /** Which competing strategy produced it. */
  strategy: RecoveryStrategy;
  /** Which inputs produced it (provenance). */
  derivation: HypothesisDerivation;
  /** Whether this hypothesis is one of several competing readings. */
  uncertainty: HypothesisUncertainty;
  /** Strategy-local ambiguity/uncertainty markers (sorted). */
  ambiguities: AmbiguityMarker[];
  /** DERIVED_FROM and OBSERVES links to the source ImplementationModel id. */
  links: TraceLink[];
  /** The exact ImplementationModel interpretation this hypothesis asserts. */
  model_view: ImplementationModel;
}

export interface RecoveryResult {
  /** All retained hypotheses (deterministic enumeration order: assignment-vector-major, strategy within vector). */
  hypotheses: RecoveryHypothesis[];
  /** True iff any ambiguity source was detected (multiple readings retained). */
  ambiguity_detected: boolean;
  /** Input-level ambiguity markers (sorted). */
  ambiguities: AmbiguityMarker[];
  /** True iff the hypothesis space exceeded maxHypotheses and was truncated (retained as a marker). */
  truncated: boolean;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isNonEmptyStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every(isNonEmptyString);
}

/** Node ids must be usable as graph node ids (W2 NODE_ID_PATTERN discipline). */
const NODE_ID_LIKE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

function assertKindMap(value: unknown, field: string): void {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new RecoveryError(`${field} must be a plain object mapping kinds to kinds`);
  }
  for (const [key, entry] of Object.entries(value)) {
    if (!isNonEmptyString(key) || !isNonEmptyString(entry)) {
      throw new RecoveryError(`${field} keys and values must be non-empty strings`);
    }
    if (!isRegisteredNodeKind(entry)) {
      throw new RecoveryError(
        `${field}.${key} maps to "${entry}", which is not a registered architecture node kind (register extensions via @sos-2/architecture registerNodeKind first)`,
      );
    }
  }
}

function assertDependencyKindMap(value: unknown, field: string): void {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new RecoveryError(`${field} must be a plain object mapping kinds to kinds`);
  }
  for (const [key, entry] of Object.entries(value)) {
    if (!isNonEmptyString(key) || !isNonEmptyString(entry)) {
      throw new RecoveryError(`${field} keys and values must be non-empty strings`);
    }
    if (!isRegisteredEdgeKind(entry)) {
      throw new RecoveryError(
        `${field}.${key} maps to "${entry}", which is not a registered architecture edge kind (register extensions via @sos-2/architecture registerEdgeKind first)`,
      );
    }
  }
}

function assertKindAmbiguities(value: unknown, field: string): void {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new RecoveryError(`${field} must be a plain object mapping kinds to candidate node kinds`);
  }
  for (const [key, entry] of Object.entries(value)) {
    if (!isNonEmptyString(key)) {
      throw new RecoveryError(`${field} keys must be non-empty strings`);
    }
    if (!Array.isArray(entry) || entry.length === 0 || !entry.every(isNonEmptyString)) {
      throw new RecoveryError(
        `${field}.${key} must be a non-empty array of candidate node kinds, received: ${JSON.stringify(entry)}`,
      );
    }
    for (const candidate of entry) {
      if (!isRegisteredNodeKind(candidate)) {
        throw new RecoveryError(
          `${field}.${key} lists candidate "${candidate}", which is not a registered architecture node kind`,
        );
      }
    }
    if (new Set(entry).size !== entry.length) {
      throw new RecoveryError(`${field}.${key} lists duplicate candidates`);
    }
  }
}

interface ValidatedConfig {
  componentKindMap?: Record<string, string>;
  dependencyKindMap?: Record<string, string>;
  kindAmbiguities?: Record<string, string[]>;
  maxHypotheses: number;
  authority_ref: string | null;
  version: number;
}

function validateConfig(config: RecoveryConfig | undefined): ValidatedConfig {
  if (config === undefined) {
    return { maxHypotheses: DEFAULT_MAX_HYPOTHESES, authority_ref: null, version: 1 };
  }
  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    throw new RecoveryError('recovery config must be an object');
  }
  if (config.componentKindMap !== undefined) {
    assertKindMap(config.componentKindMap, 'config.componentKindMap');
  }
  if (config.dependencyKindMap !== undefined) {
    assertDependencyKindMap(config.dependencyKindMap, 'config.dependencyKindMap');
  }
  if (config.kindAmbiguities !== undefined) {
    assertKindAmbiguities(config.kindAmbiguities, 'config.kindAmbiguities');
  }
  const maxHypotheses = config.maxHypotheses ?? DEFAULT_MAX_HYPOTHESES;
  if (
    typeof maxHypotheses !== 'number' ||
    !Number.isInteger(maxHypotheses) ||
    maxHypotheses < 2 ||
    maxHypotheses > MAX_HYPOTHESES_LIMIT
  ) {
    throw new RecoveryError(
      `config.maxHypotheses must be an integer between 2 and ${MAX_HYPOTHESES_LIMIT} (the cap bounds explosion; it can never collapse ambiguity to a single hypothesis), received: ${String(maxHypotheses)}`,
    );
  }
  const authorityRef = config.authority_ref ?? null;
  if (authorityRef !== null && !isArtifactId(authorityRef)) {
    throw new RecoveryError(
      `config.authority_ref must be a well-formed artifact id or null, received: ${JSON.stringify(authorityRef)}`,
    );
  }
  const version = config.version ?? 1;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new RecoveryError(`config.version must be an integer >= 1, received: ${String(version)}`);
  }
  return {
    componentKindMap: config.componentKindMap,
    dependencyKindMap: config.dependencyKindMap,
    kindAmbiguities: config.kindAmbiguities,
    maxHypotheses,
    authority_ref: authorityRef,
    version,
  };
}

function validateModel(model: ImplementationModel): void {
  if (!isImplementationModel(model)) {
    throw new RecoveryError('model does not match the ImplementationModel contract (@sos-2/semantic-spine)');
  }
  if (!isArtifactId(model.id)) {
    throw new RecoveryError(`model.id must be a well-formed artifact id, received: ${JSON.stringify(model.id)}`);
  }
  const parsed = parseArtifactId(model.id);
  if (parsed.kind !== 'ImplementationModel') {
    throw new RecoveryError(
      `model.id must be a sos://ImplementationModel/ artifact id, received kind "${parsed.kind}"`,
    );
  }
  if (!isNonEmptyString(model.revision)) {
    throw new RecoveryError('model.revision must be a non-empty string (exact revisions only)');
  }
  const componentIds = new Set<string>();
  for (const component of model.components) {
    if (!NODE_ID_LIKE_PATTERN.test(component.id)) {
      throw new RecoveryError(
        `component id ${JSON.stringify(component.id)} cannot become a graph node id (expected shape like "auth-service"; W2 NODE_ID_PATTERN)`,
      );
    }
    if (componentIds.has(component.id)) {
      throw new RecoveryError(`duplicate observed component id: ${component.id}`);
    }
    componentIds.add(component.id);
  }
  const interfaceIds = new Set<string>();
  for (const iface of model.interfaces) {
    if (!NODE_ID_LIKE_PATTERN.test(iface.id)) {
      throw new RecoveryError(
        `interface id ${JSON.stringify(iface.id)} cannot become a graph node id (expected shape like "iface:auth-api"; W2 NODE_ID_PATTERN)`,
      );
    }
    if (interfaceIds.has(iface.id)) {
      throw new RecoveryError(`duplicate observed interface id: ${iface.id}`);
    }
    interfaceIds.add(iface.id);
  }
  for (const dependency of model.dependencies) {
    if (!NODE_ID_LIKE_PATTERN.test(dependency.source) || !NODE_ID_LIKE_PATTERN.test(dependency.target)) {
      throw new RecoveryError(
        `dependency endpoints must be graph-node-id shaped, received: ${JSON.stringify(dependency)}`,
      );
    }
  }
  for (const component of model.components) {
    for (const declaredId of component.realizes) {
      if (!NODE_ID_LIKE_PATTERN.test(declaredId)) {
        throw new RecoveryError(
          `realizes target ${JSON.stringify(declaredId)} on component ${component.id} cannot become a graph node id`,
        );
      }
    }
  }
}

function validateInput(input: RecoveryInput): ValidatedConfig {
  if (typeof input !== 'object' || input === null) {
    throw new RecoveryError('recovery input must be an object');
  }
  validateModel(input.model);
  try {
    assertValidSystemStateRevisionRef(input.projects_system_state);
  } catch (cause) {
    throw new RecoveryError(`projects_system_state is invalid: ${(cause as Error).message}`);
  }
  if (!isNonEmptyStringArray(input.provenance)) {
    throw new RecoveryError(
      'provenance must be a non-empty array of non-empty strings (no provenance-less recovery — spine discipline)',
    );
  }
  if (typeof input.created_at !== 'string' || !RFC3339_PATTERN.test(input.created_at)) {
    throw new RecoveryError(
      `created_at must be an RFC3339 timestamp, received: ${JSON.stringify(input.created_at)}`,
    );
  }
  return validateConfig(input.config);
}

// ---------------------------------------------------------------------------
// Kind candidates and assignment enumeration
// ---------------------------------------------------------------------------

/**
 * Candidate node kinds for an observed component kind (precedence:
 * componentKindMap > kindAmbiguities > registered pass-through >
 * DEFAULT_KIND_AMBIGUITIES > 'Component').
 */
export function candidateNodeKinds(kind: string, config: ValidatedConfig): string[] {
  const mapped = config.componentKindMap?.[kind];
  if (mapped !== undefined) {
    return [mapped];
  }
  const ambiguous = config.kindAmbiguities?.[kind];
  if (ambiguous !== undefined) {
    return [...ambiguous];
  }
  if (isRegisteredNodeKind(kind)) {
    return [kind];
  }
  const defaults = DEFAULT_KIND_AMBIGUITIES[kind];
  if (defaults !== undefined) {
    return [...defaults];
  }
  return ['Component'];
}

function sortedAssignments(
  observedKinds: readonly string[],
  candidatesByKind: ReadonlyMap<string, readonly string[]>,
): Array<Map<string, string>> {
  const ambiguousKinds = observedKinds
    .filter((kind) => (candidatesByKind.get(kind) ?? []).length > 1)
    .sort();
  let assignments: Array<Map<string, string>> = [new Map()];
  for (const kind of ambiguousKinds) {
    const candidates = candidatesByKind.get(kind)!;
    const next: Array<Map<string, string>> = [];
    for (const partial of assignments) {
      for (const candidate of candidates) {
        const extended = new Map(partial);
        extended.set(kind, candidate);
        next.push(extended);
      }
    }
    assignments = next;
  }
  // Fix the unambiguous kinds into every assignment.
  const unambiguous = new Map<string, string>();
  for (const kind of observedKinds) {
    const candidates = candidatesByKind.get(kind) ?? ['Component'];
    if (candidates.length === 1) {
      unambiguous.set(kind, candidates[0]!);
    }
  }
  return assignments.map((partial) => {
    const merged = new Map(unambiguous);
    for (const [kind, candidate] of partial) {
      merged.set(kind, candidate);
    }
    return merged;
  });
}

// ---------------------------------------------------------------------------
// Model view construction (per strategy + assignment)
// ---------------------------------------------------------------------------

interface ModelViewBuild {
  model_view: ImplementationModel;
  nodes: Array<{ id: string; kind: string; isInterface: boolean; realizes: string[]; sources: string[]; provider?: string; consumers?: string[] }>;
  edges: Array<{ source: string; target: string; kind: string }>;
  markers: AmbiguityMarker[];
  unresolvedEndpoints: Set<string>;
}

function dedupeMarkers(markers: AmbiguityMarker[]): AmbiguityMarker[] {
  const seen = new Set<string>();
  const result: AmbiguityMarker[] = [];
  for (const marker of markers) {
    const key = `${marker.kind}\u0000${marker.subject}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(marker);
  }
  return result.sort(compareAmbiguityMarkers);
}

function buildModelView(
  model: ImplementationModel,
  normalizedDependencies: ReadonlyArray<{ source: string; target: string; kind: string }>,
  strategy: RecoveryStrategy,
  assignment: ReadonlyMap<string, string>,
): ModelViewBuild {
  const markers: AmbiguityMarker[] = [];
  const unresolvedEndpoints = new Set<string>();
  const originalComponentIds = new Set(model.components.map((component) => component.id));
  const interfaceIds = new Set(model.interfaces.map((iface) => iface.id));
  const validDirectIds = new Set<string>([...originalComponentIds, ...interfaceIds]);

  // --- component merge plan (MERGED_REALIZATIONS only) ---
  const mergeMap = new Map<string, string>(); // component id -> merged node id
  let groups: Array<{ id: string; members: typeof model.components }> = [];
  if (strategy === 'MERGED_REALIZATIONS') {
    const byTarget = new Map<string, typeof model.components>();
    for (const component of model.components) {
      if (component.realizes.length === 1) {
        const target = component.realizes[0]!;
        const list = byTarget.get(target) ?? [];
        list.push(component);
        byTarget.set(target, list);
      }
    }
    const groupTargets = [...byTarget.keys()].sort();
    for (const target of groupTargets) {
      const members = [...byTarget.get(target)!].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      // Collision absorption: components that are NOT single-realizes members of
      // this group but whose id equals the merged node id must join the group
      // (otherwise the merged node id would collide with an unmerged component).
      for (const component of model.components) {
        if (component.id === target && component.realizes.length !== 1) {
          members.push(component);
          markers.push(
            buildAmbiguityMarker({
              kind: 'MERGE_ID_COLLISION',
              subject: component.id,
              detail: `unmerged component "${component.id}" shares its id with the merged realization node and was absorbed into the merge group (deterministic resolution, retained as ambiguity)`,
            }),
          );
        }
      }
      members.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      for (const member of members) {
        mergeMap.set(member.id, target);
      }
      const kinds = new Set(members.map((member) => member.kind));
      if (kinds.size > 1) {
        markers.push(
          buildAmbiguityMarker({
            kind: 'MIXED_KIND_GROUP',
            subject: target,
            detail: `merge group "${target}" mixes observed kinds [${[...kinds].sort().join(', ')}]; the alphabetically-first member's kind assignment decides the node kind`,
          }),
        );
      }
      groups.push({ id: target, members });
    }
    for (const component of model.components) {
      if (component.realizes.length > 1) {
        markers.push(
          buildAmbiguityMarker({
            kind: 'MULTI_REALIZES',
            subject: component.id,
            detail: `component "${component.id}" realizes [${component.realizes.join(', ')}] and cannot be merged into a single node; kept unmerged under this hypothesis`,
            alternatives: [...component.realizes],
          }),
        );
      }
    }
    groups = groups.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  const kindOf = (observedKind: string): string => assignment.get(observedKind) ?? 'Component';

  // Endpoint validity is strategy-aware: under MERGED_REALIZATIONS the merge
  // target ids are real node ids of the view, so dependencies and interface
  // references pointing at a realized declared node resolve to the merged
  // node; under DIRECT they are unresolved (only components and interfaces
  // exist in the direct reading).
  const mergedNodeIds = new Set<string>(groups.map((group) => group.id));
  const validEndpointIds =
    strategy === 'MERGED_REALIZATIONS'
      ? new Set<string>([...validDirectIds, ...mergedNodeIds])
      : validDirectIds;

  // --- components of the view ---
  interface ViewComponent {
    id: string;
    kind: string;
    realized_by: string[];
    realizes: string[];
    sources: string[];
  }
  const viewComponents: ViewComponent[] = [];
  if (strategy === 'DIRECT') {
    for (const component of model.components) {
      viewComponents.push({
        id: component.id,
        kind: kindOf(component.kind),
        realized_by: [...component.realized_by],
        realizes: [...component.realizes],
        sources: [component.id],
      });
    }
  } else {
    for (const group of groups) {
      const firstMember = group.members[0]!;
      viewComponents.push({
        id: group.id,
        kind: kindOf(firstMember.kind),
        realized_by: group.members.flatMap((member) => [...member.realized_by]),
        realizes: [group.id],
        sources: group.members.map((member) => member.id),
      });
    }
    for (const component of model.components) {
      if (mergeMap.has(component.id)) continue;
      viewComponents.push({
        id: component.id,
        kind: kindOf(component.kind),
        realized_by: [...component.realized_by],
        realizes: [...component.realizes],
        sources: [component.id],
      });
    }
  }

  // --- interface pseudo-components (the W4 classification extension) ---
  const viewComponentIds = new Set(viewComponents.map((component) => component.id));
  const interfaceEntries: Array<{
    id: string;
    kind: 'Interface';
    realized_by: string[];
    realizes: string[];
    provider: string;
    consumers: string[];
  }> = [];
  for (const iface of model.interfaces) {
    if (viewComponentIds.has(iface.id)) {
      markers.push(
        buildAmbiguityMarker({
          kind: 'MERGE_ID_COLLISION',
          subject: iface.id,
          detail: `interface id "${iface.id}" collides with a component id under this strategy; the component interpretation is retained and the interface edge targets it`,
        }),
      );
      continue;
    }
    viewComponentIds.add(iface.id);
    interfaceEntries.push({
      id: iface.id,
      kind: 'Interface',
      realized_by: [],
      realizes: [],
      provider: iface.provider,
      consumers: [...iface.consumers],
    });
  }

  // --- dependencies of the view ---
  const remap = (id: string): string => mergeMap.get(id) ?? id;
  const candidateDeps: Array<{ source: string; target: string; kind: string }> = [];
  for (const dependency of normalizedDependencies) {
    if (!validEndpointIds.has(dependency.source)) {
      unresolvedEndpoints.add(dependency.source);
      markers.push(
        buildAmbiguityMarker({
          kind: 'UNRESOLVED_DEPENDENCY_ENDPOINT',
          subject: dependency.source,
          detail: `dependency endpoint "${dependency.source}" references an id that is not an observed component or interface under the ${strategy} reading; the edge is retained here as unresolved, never silently dropped`,
        }),
      );
      continue;
    }
    if (!validEndpointIds.has(dependency.target)) {
      unresolvedEndpoints.add(dependency.target);
      markers.push(
        buildAmbiguityMarker({
          kind: 'UNRESOLVED_DEPENDENCY_ENDPOINT',
          subject: dependency.target,
          detail: `dependency endpoint "${dependency.target}" references an id that is not an observed component or interface under the ${strategy} reading; the edge is retained here as unresolved, never silently dropped`,
        }),
      );
      continue;
    }
    const source = remap(dependency.source);
    const target = remap(dependency.target);
    if (source === target) {
      markers.push(
        buildAmbiguityMarker({
          kind: 'INTERNAL_DEPENDENCY',
          subject: `${dependency.source}->${dependency.target}`,
          detail: `dependency ${dependency.source}->${dependency.target} became intra-node after merging and is not an architectural edge under this hypothesis`,
        }),
      );
      continue;
    }
    candidateDeps.push({ source, target, kind: dependency.kind });
  }
  for (const entry of interfaceEntries) {
    const provider = remap(entry.provider);
    if (validEndpointIds.has(entry.provider)) {
      candidateDeps.push({ source: provider, target: entry.id, kind: 'Provides' });
    } else {
      unresolvedEndpoints.add(entry.provider);
      markers.push(
        buildAmbiguityMarker({
          kind: 'UNRESOLVED_DEPENDENCY_ENDPOINT',
          subject: entry.provider,
          detail: `interface provider "${entry.provider}" is not an observed component under the ${strategy} reading; the Provides edge is retained here as unresolved`,
        }),
      );
    }
    for (const consumer of entry.consumers) {
      if (validEndpointIds.has(consumer)) {
        candidateDeps.push({ source: remap(consumer), target: entry.id, kind: 'Consumes' });
      } else {
        unresolvedEndpoints.add(consumer);
        markers.push(
          buildAmbiguityMarker({
            kind: 'UNRESOLVED_DEPENDENCY_ENDPOINT',
            subject: consumer,
            detail: `interface consumer "${consumer}" is not an observed component under the ${strategy} reading; the Consumes edge is retained here as unresolved`,
          }),
        );
      }
    }
  }

  // --- deduplicate (source, target) pairs (first occurrence wins, loudly) ---
  const seenPairs = new Set<string>();
  const finalDeps: Array<{ source: string; target: string; kind: string }> = [];
  for (const dependency of candidateDeps) {
    const key = `${dependency.source}->${dependency.target}`;
    if (seenPairs.has(key)) {
      markers.push(
        buildAmbiguityMarker({
          kind: 'DUPLICATE_DEPENDENCY_PAIR',
          subject: key,
          detail: `multiple observed dependencies collapse onto the pair ${key} under this hypothesis; the first (${dependency.kind} kept here) wins`,
        }),
      );
      continue;
    }
    seenPairs.add(key);
    finalDeps.push(dependency);
  }

  // --- assemble the model view ---
  const model_view: ImplementationModel = {
    id: model.id,
    revision: model.revision,
    components: [
      ...viewComponents.map((component) => ({
        id: component.id,
        kind: component.kind,
        realized_by: [...component.realized_by],
        realizes: [...component.realizes],
      })),
      ...interfaceEntries.map((entry) => ({
        id: entry.id,
        kind: entry.kind,
        realized_by: [],
        realizes: [],
      })),
    ],
    source_artifacts: model.source_artifacts.map((artifact) => ({ ...artifact })),
    interfaces: model.interfaces.map((iface) => ({
      id: iface.id,
      provider: remap(iface.provider),
      contract_ref: iface.contract_ref,
      consumers: iface.consumers.map((consumer) => remap(consumer)),
    })),
    dependencies: finalDeps.map((dependency) => ({ ...dependency })),
    tests: model.tests.map((test) => ({ ...test })),
    builds: model.builds.map((build) => ({ ...build })),
    deployments: model.deployments.map((deployment) => ({ ...deployment })),
    runtime_mappings: model.runtime_mappings.map((mapping) => ({ ...mapping })),
  };

  const nodes: ModelViewBuild['nodes'] = [
    ...viewComponents.map((component) => ({
      id: component.id,
      kind: component.kind,
      isInterface: false,
      realizes: [...component.realizes],
      sources: [...component.sources],
    })),
    ...interfaceEntries.map((entry) => ({
      id: entry.id,
      kind: entry.kind as string,
      isInterface: true,
      realizes: [] as string[],
      sources: [] as string[],
      provider: entry.provider,
      consumers: [...entry.consumers],
    })),
  ];

  return {
    model_view,
    nodes,
    edges: finalDeps.map((dependency) => ({ ...dependency })),
    markers: dedupeMarkers(markers),
    unresolvedEndpoints,
  };
}

// ---------------------------------------------------------------------------
// Recovery
// ---------------------------------------------------------------------------

/**
 * Recover competing architecture hypotheses from an observed
 * ImplementationModel. Deterministic and total on valid inputs: identical
 * inputs produce byte-identical results. Ambiguous evidence yields MULTIPLE
 * hypotheses; unambiguous evidence yields exactly one.
 */
export function recoverArchitectureHypotheses(input: RecoveryInput): RecoveryResult {
  const config = validateInput(input);
  const model = input.model;

  // Dependency kind projection is delegated to the W2 normalization authority
  // (registered edge kinds pass through, config map applies, else 'Dependency').
  // Only the normalized dependencies are consumed here; the component
  // projection is recovery's own ambiguity-aware assignment.
  const normalizedDependencies = normalizeImplementationModel(model, {
    ...(config.dependencyKindMap !== undefined ? { dependencyKindMap: config.dependencyKindMap } : {}),
  }).dependencies;

  const observedKinds = [...new Set(model.components.map((component) => component.kind))].sort();
  const candidatesByKind = new Map<string, string[]>(
    observedKinds.map((kind) => [kind, candidateNodeKinds(kind, config)]),
  );
  const ambiguousKinds = observedKinds.filter((kind) => (candidatesByKind.get(kind) ?? []).length > 1);

  // Grouped-realization ambiguity: any component with exactly one realizes target.
  const groupedTargets = new Set<string>();
  for (const component of model.components) {
    if (component.realizes.length === 1) {
      groupedTargets.add(component.realizes[0]!);
    }
  }
  const strategies: RecoveryStrategy[] =
    groupedTargets.size > 0 ? ['DIRECT', 'MERGED_REALIZATIONS'] : ['DIRECT'];

  // Input-level markers.
  const inputMarkers: AmbiguityMarker[] = [];
  for (const kind of ambiguousKinds) {
    inputMarkers.push(
      buildAmbiguityMarker({
        kind: 'KIND_AMBIGUITY',
        subject: kind,
        detail: `observed component kind "${kind}" admits multiple candidate node kinds; one hypothesis is retained per candidate`,
        alternatives: [...(candidatesByKind.get(kind) ?? [])],
      }),
    );
  }
  for (const target of [...groupedTargets].sort()) {
    inputMarkers.push(
      buildAmbiguityMarker({
        kind: 'GROUPED_REALIZATION',
        subject: target,
        detail: `observed components realize declared node "${target}"; both the direct (refinement components) and merged (single node) readings are retained`,
      }),
    );
  }

  const assignments = sortedAssignments(observedKinds, candidatesByKind);
  const enumeration: Array<{ assignment: Map<string, string>; strategy: RecoveryStrategy }> = [];
  for (const assignment of assignments) {
    for (const strategy of strategies) {
      enumeration.push({ assignment, strategy });
    }
  }
  const truncated = enumeration.length > config.maxHypotheses;
  if (truncated) {
    inputMarkers.push(
      buildAmbiguityMarker({
        kind: 'TRUNCATED_HYPOTHESIS_SPACE',
        subject: `${enumeration.length}`,
        detail: `the full hypothesis space has ${enumeration.length} competing readings; only the first ${config.maxHypotheses} (deterministic enumeration order: assignment-vector-major) were retained`,
      }),
    );
  }
  const retained = enumeration.slice(0, config.maxHypotheses);

  const inputDigest = contentHash({
    model,
    config: {
      componentKindMap: config.componentKindMap ?? null,
      dependencyKindMap: config.dependencyKindMap ?? null,
      kindAmbiguities: config.kindAmbiguities ?? null,
      maxHypotheses: config.maxHypotheses,
    },
  });

  const ambiguityDetected = ambiguousKinds.length > 0 || strategies.length > 1;
  const hypotheses: RecoveryHypothesis[] = [];
  const artifactIds = new Set<string>();
  for (const { assignment, strategy } of retained) {
    const build = buildModelView(model, normalizedDependencies, strategy, assignment);

    // The FULL kind assignment is part of the artifact's identity: when an
    // ambiguous-kind component is merged away under MERGED_REALIZATIONS its
    // assignment no longer surfaces in the graph content, so the assignment
    // is recorded in the creation provenance — two different interpretations
    // are always two distinct artifacts, never silently collapsed.
    const assignmentToken = [...assignment.keys()]
      .sort()
      .map((kind) => `${kind}=${assignment.get(kind)}`)
      .join(',');

    const nodes = build.nodes.map(
      (node): { id: string; kind: string; criticality: 'normal'; attributes: Record<string, JsonValue> } => ({
        id: node.id,
        kind: node.kind,
        criticality: 'normal',
        attributes: node.isInterface
          ? {
              'recovery.strategy': strategy,
              'recovery.provider': node.provider ?? '',
              'recovery.consumers': node.consumers ?? [],
            }
          : {
              'recovery.strategy': strategy,
              'recovery.realizes': node.realizes,
              'recovery.sources': node.sources,
            },
      }),
    );
    const edges = build.edges.map(
      (edge): { source: string; target: string; kind: string; criticality: 'normal'; attributes: Record<string, JsonValue> } => ({
        source: edge.source,
        target: edge.target,
        kind: edge.kind,
        criticality: 'normal',
        attributes: { 'recovery.strategy': strategy },
      }),
    );

    const artifact = createArchitectureGraph({
      projects_system_state: input.projects_system_state,
      nodes,
      edges,
      provenance: [
        ...input.provenance,
        `recovery:model:${model.id}`,
        `source-revision:${model.revision}`,
        `recovery:strategy:${strategy}`,
        `recovery:assignment:${assignmentToken}`,
      ],
      created_at: input.created_at,
      status: 'DRAFT',
      authority_ref: config.authority_ref,
      version: config.version,
    });

    if (artifactIds.has(artifact.envelope.id)) {
      throw new RecoveryError(
        `hypothesis artifact id collision: ${artifact.envelope.id} produced twice (enumeration branches must be structurally distinct)`,
      );
    }
    artifactIds.add(artifact.envelope.id);

    const linkProvenance = [
      `W4:recovery:${model.id}`,
      `source-revision:${model.revision}`,
      `recovery:strategy:${strategy}`,
      `recovery:assignment:${assignmentToken}`,
    ];
    const links: TraceLink[] = [
      createTraceLink({
        source: artifact.envelope.id,
        target: model.id,
        type: 'DERIVED_FROM',
        provenance: linkProvenance,
      }),
      createTraceLink({
        source: artifact.envelope.id,
        target: model.id,
        type: 'OBSERVES',
        provenance: linkProvenance,
      }),
    ];

    const kindAssignments: Record<string, string> = {};
    for (const kind of [...assignment.keys()].sort()) {
      kindAssignments[kind] = assignment.get(kind)!;
    }

    hypotheses.push({
      artifact,
      strategy,
      derivation: {
        model_id: model.id,
        model_revision: model.revision,
        strategy,
        kind_assignments: kindAssignments,
        input_digest: inputDigest,
        component_count: model.components.length,
        dependency_count: model.dependencies.length,
        interface_count: model.interfaces.length,
        unresolved_dependency_endpoints: [...build.unresolvedEndpoints].sort(),
      },
      uncertainty: ambiguityDetected ? 'AMBIGUOUS' : 'UNAMBIGUOUS',
      ambiguities: build.markers,
      links,
      model_view: build.model_view,
    });
  }

  return {
    hypotheses,
    ambiguity_detected: ambiguityDetected,
    ambiguities: dedupeMarkers(inputMarkers),
    truncated,
  };
}

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

/** Structural guard for consumers that want to check hypothesis records. */
export function isRecoveryHypothesis(value: unknown): value is RecoveryHypothesis {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== 7) return false;
  for (const key of ['artifact', 'strategy', 'derivation', 'uncertainty', 'ambiguities', 'links', 'model_view']) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) return false;
  }
  const artifact = record['artifact'];
  if (typeof artifact !== 'object' || artifact === null) return false;
  const envelope = (artifact as Record<string, unknown>)['envelope'];
  if (typeof envelope !== 'object' || envelope === null) return false;
  const envelopeRecord = envelope as Record<string, unknown>;
  if (!isArtifactId(envelopeRecord['id'])) return false;
  if (envelopeRecord['kind'] !== 'ArchitectureGraph') return false;
  if (envelopeRecord['status'] !== 'DRAFT') return false;
  if (!RECOVERY_STRATEGIES.includes(record['strategy'] as RecoveryStrategy)) return false;
  if (record['uncertainty'] !== 'UNAMBIGUOUS' && record['uncertainty'] !== 'AMBIGUOUS') return false;
  if (!Array.isArray(record['ambiguities']) || !record['ambiguities'].every(isAmbiguityMarker)) return false;
  if (!Array.isArray(record['links']) || record['links'].length !== 2) return false;
  if (!isImplementationModel(record['model_view'])) return false;
  const derivation = record['derivation'];
  if (typeof derivation !== 'object' || derivation === null) return false;
  const derivationRecord = derivation as Record<string, unknown>;
  if (!isArtifactId(derivationRecord['model_id'])) return false;
  if (typeof derivationRecord['model_revision'] !== 'string' || (derivationRecord['model_revision'] as string).length === 0) {
    return false;
  }
  if (derivationRecord['strategy'] !== record['strategy']) return false;
  if (typeof derivationRecord['input_digest'] !== 'string' || !/^[0-9a-f]{64}$/.test(derivationRecord['input_digest'] as string)) {
    return false;
  }
  if (!Array.isArray(derivationRecord['unresolved_dependency_endpoints'])) return false;
  return true;
}

/** Structural guard for recovery results. */
export function isRecoveryResult(value: unknown): value is RecoveryResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 4) return false;
  if (!['hypotheses', 'ambiguity_detected', 'ambiguities', 'truncated'].every((key) =>
    Object.prototype.hasOwnProperty.call(record, key),
  )) {
    return false;
  }
  if (!Array.isArray(record['hypotheses']) || !record['hypotheses'].every(isRecoveryHypothesis)) return false;
  if (typeof record['ambiguity_detected'] !== 'boolean') return false;
  if (typeof record['truncated'] !== 'boolean') return false;
  if (!Array.isArray(record['ambiguities']) || !record['ambiguities'].every(isAmbiguityMarker)) return false;
  if (record['ambiguity_detected'] === true && (record['hypotheses'] as unknown[]).length < 2) return false;
  return true;
}

/** Canonical serialization of a recovery result (deterministic round trips). */
export function canonicalRecoveryText(result: RecoveryResult): string {
  return canonicalSerialize(result);
}
