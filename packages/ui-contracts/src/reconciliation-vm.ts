/**
 * ReconciliationVM — the architecture/reality reconciliation view model
 * (Work Order W11; spec/architecture.md §6, R23).
 *
 * A pure projection of a @sos-2/conformance ReconciliationResult onto the
 * human list: one row per finding with the DECLARED side, the OBSERVED
 * side, the frozen classification and the WHY (the classifier's reason) —
 * plus the typed trace link binding the observed model to the declared
 * graph, and the Evidence-shaped drift records for DRIFT/CONTRADICTION.
 *
 * The declared/observed descriptions are LOOKUPS over the two compared
 * domain records (declared ArchitectureGraph + observed Implementation
 * Model) — classification semantics stay with the merged W2/W0.5
 * authorities; this layer only displays both sides.
 */

import { isArtifactId, isTraceLink } from '@sos-2/semantic-spine';
import type {
  ConformanceClass,
  EvidenceTruthState,
  ImplementationModel,
  TraceLink,
} from '@sos-2/semantic-spine';
import { EVIDENCE_TRUTH_STATES, isEvidenceTruthState } from '@sos-2/semantic-spine';
import type { ArchitectureGraphArtifact } from '@sos-2/architecture';
import { assertValidArchitectureGraphArtifact } from '@sos-2/architecture';
import type { DriftEvidenceRecord, ReconciliationResult } from '@sos-2/conformance';
import { UIContractError } from './errors.js';
import { assertValidRationaleChain } from './rationale.js';
import type { RationaleChain } from './rationale.js';

/** The frozen classification vocabulary (imported, for counting). */
const CONFORMANCE_CLASSES: readonly ConformanceClass[] = [
  'IMPLEMENTATION_DETAIL',
  'EXPECTED_VARIATION',
  'PRESERVING_REFINEMENT',
  'INTENTIONAL_EVOLUTION',
  'DRIFT',
  'UNKNOWN',
  'CONTRADICTION',
];

/** One reconciliation row: declared vs observed vs classification + why. */
export interface ReconciliationRowVM {
  /** The finding classification (frozen 7-class vocabulary). */
  classification: ConformanceClass;
  /** Component id or edge key ("source->target"). */
  subject: string;
  /** What the declared architecture says about the subject ("absent" when undeclared). */
  declared: string;
  /** What the observed implementation shows ("absent" when unobserved). */
  observed: string;
  /** The classifier's reason (the WHY). */
  reason: string;
  /** The typed trace link binding observed model -> declared graph. */
  link: TraceLink;
}

/** The reconciliation view model. */
export interface ReconciliationVM {
  /** The observed ImplementationModel artifact id. */
  observed_model_id: string;
  /** The declared ArchitectureGraph artifact id. */
  declared_graph_id: string;
  /** Rows sorted by subject (deterministic; the spine's own finding order). */
  rows: ReconciliationRowVM[];
  /** Findings per frozen classification (ALL 7 keys, zeros included — distinct, never folded). */
  counts_by_classification: Record<ConformanceClass, number>;
  /** Evidence-shaped drift records (DRIFT and CONTRADICTION only). */
  drift_evidence: DriftEvidenceRecord[];
  /** Upstream/downstream rationale + evidence (W11 acceptance). */
  rationale: RationaleChain;
}

function declaredDescription(graph: ArchitectureGraphArtifact, subject: string): string {
  const node = graph.content.nodes.find((candidate) => candidate.id === subject);
  if (node !== undefined) {
    return `node "${node.id}" (kind ${node.kind}, criticality ${node.criticality})`;
  }
  if (subject.includes('->')) {
    const [source, target] = subject.split('->') as [string, string];
    const kinds = graph.content.edges
      .filter((edge) => edge.source === source && edge.target === target)
      .map((edge) => `${edge.kind} (criticality ${edge.criticality})`);
    if (kinds.length > 0) {
      return `edge ${source}->${target}: ${kinds.join(', ')}`;
    }
  }
  return 'absent from the declared architecture';
}

function observedDescription(model: ImplementationModel, subject: string): string {
  const component = model.components.find((candidate) => candidate.id === subject);
  if (component !== undefined) {
    const realizes =
      component.realizes.length > 0 ? `, realizes ${component.realizes.join(', ')}` : ', realizes nothing declared';
    return `component "${component.id}" (kind ${component.kind}${realizes})`;
  }
  if (subject.includes('->')) {
    const [source, target] = subject.split('->') as [string, string];
    const kinds = model.dependencies
      .filter((dependency) => dependency.source === source && dependency.target === target)
      .map((dependency) => dependency.kind);
    if (kinds.length > 0) {
      return `dependency ${source}->${target}: ${kinds.join(', ')}`;
    }
  }
  return 'absent from the observed implementation';
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Project a reconciliation result onto its view model. The rationale chain
 * subject must be the OBSERVED ImplementationModel id (the record the
 * reconciliation is about; its links bind observed -> declared).
 */
export function projectReconciliation(input: {
  result: ReconciliationResult;
  declared: ArchitectureGraphArtifact;
  observed: ImplementationModel;
  rationale: RationaleChain;
}): ReconciliationVM {
  const { result, declared, observed, rationale } = input;
  try {
    assertValidArchitectureGraphArtifact(declared);
  } catch (cause) {
    throw new UIContractError(`declared architecture graph is invalid: ${(cause as Error).message}`);
  }
  for (const record of result.records) {
    if (!isTraceLink(record.link)) {
      throw new UIContractError('reconciliation result records must carry typed spine trace links');
    }
  }
  if (rationale.subject_id !== observed.id) {
    throw new UIContractError(
      `rationale chain subject ${JSON.stringify(rationale.subject_id)} does not match the observed model id ${JSON.stringify(observed.id)}`,
    );
  }
  assertValidRationaleChain(rationale);

  const counts = Object.fromEntries(CONFORMANCE_CLASSES.map((c) => [c, 0])) as Record<ConformanceClass, number>;
  const rows: ReconciliationRowVM[] = result.records.map((record) => {
    counts[record.classification] += 1;
    return {
      classification: record.classification,
      subject: record.subject,
      declared: declaredDescription(declared, record.subject),
      observed: observedDescription(observed, record.subject),
      reason: record.reason,
      link: { ...record.link, provenance: [...(record.link.provenance ?? [])] },
    };
  });

  const vm: ReconciliationVM = {
    observed_model_id: observed.id,
    declared_graph_id: declared.envelope.id,
    rows,
    counts_by_classification: counts,
    drift_evidence: structuredClone(result.drift),
    rationale,
  };
  assertValidReconciliationVM(vm);
  return vm;
}

/** Validate a ReconciliationVM (throws UIContractError). */
export function assertValidReconciliationVM(value: unknown): asserts value is ReconciliationVM {
  if (!isPlainObject(value)) {
    throw new UIContractError(`reconciliation view model must be an object, received: ${JSON.stringify(value)}`);
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  const expected = new Set(['observed_model_id', 'declared_graph_id', 'rows', 'counts_by_classification', 'drift_evidence', 'rationale']);
  if (keys.length !== expected.size || !keys.every((key) => expected.has(key))) {
    throw new UIContractError('reconciliation view model must have the exact W11 field set');
  }
  if (!isNonEmptyString(record['observed_model_id']) || !isArtifactId(record['observed_model_id'])) {
    throw new UIContractError('reconciliation view model observed_model_id must be a well-formed spine artifact id');
  }
  if (!isNonEmptyString(record['declared_graph_id']) || !isArtifactId(record['declared_graph_id'])) {
    throw new UIContractError('reconciliation view model declared_graph_id must be a well-formed spine artifact id');
  }
  if (!Array.isArray(record['rows'])) {
    throw new UIContractError('reconciliation view model rows must be an array');
  }
  for (const row of record['rows']) {
    if (!isPlainObject(row)) {
      throw new UIContractError('reconciliation rows must be objects');
    }
    const rowRecord = row as Record<string, unknown>;
    const rowKeys = Object.keys(rowRecord);
    const rowExpected = new Set(['classification', 'subject', 'declared', 'observed', 'reason', 'link']);
    if (rowKeys.length !== rowExpected.size || !rowKeys.every((key) => rowExpected.has(key))) {
      throw new UIContractError('reconciliation rows must have the exact field set { classification, subject, declared, observed, reason, link }');
    }
    if (!CONFORMANCE_CLASSES.includes(rowRecord['classification'] as ConformanceClass)) {
      throw new UIContractError(
        `reconciliation row classification must be one of the 7 frozen conformance classes, received: ${JSON.stringify(rowRecord['classification'])}`,
      );
    }
    if (!isNonEmptyString(rowRecord['subject']) || !isNonEmptyString(rowRecord['reason'])) {
      throw new UIContractError('reconciliation row subject and reason must be non-empty strings (the WHY is mandatory)');
    }
    if (!isNonEmptyString(rowRecord['declared']) || !isNonEmptyString(rowRecord['observed'])) {
      throw new UIContractError('reconciliation row must state BOTH the declared and the observed side');
    }
    const link = rowRecord['link'];
    if (
      !isPlainObject(link) ||
      !isNonEmptyString((link as Record<string, unknown>)['source']) ||
      !isNonEmptyString((link as Record<string, unknown>)['target'])
    ) {
      throw new UIContractError('reconciliation row must carry the typed trace link binding observed -> declared');
    }
  }
  const counts = record['counts_by_classification'];
  if (!isPlainObject(counts)) {
    throw new UIContractError('reconciliation counts_by_classification must be an object');
  }
  const countKeys = Object.keys(counts).sort();
  const expectedCountKeys = [...CONFORMANCE_CLASSES].sort();
  if (countKeys.length !== expectedCountKeys.length || !countKeys.every((key, index) => key === expectedCountKeys[index])) {
    throw new UIContractError(
      'reconciliation counts_by_classification must carry ALL 7 frozen classification keys (zeros included — distinct classes are never folded)',
    );
  }
  for (const value of Object.values(counts)) {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
      throw new UIContractError('reconciliation classification counts must be non-negative integers');
    }
  }
  if (!Array.isArray(record['drift_evidence'])) {
    throw new UIContractError('reconciliation drift_evidence must be an array');
  }
  for (const drift of record['drift_evidence']) {
    if (!isPlainObject(drift)) {
      throw new UIContractError('drift evidence entries must be objects');
    }
    if (!isEvidenceTruthState((drift as Record<string, unknown>)['availability'])) {
      throw new UIContractError('drift evidence entries must carry a frozen truth state');
    }
  }
  try {
    assertValidRationaleChain(record['rationale']);
  } catch (cause) {
    throw new UIContractError(`reconciliation view model rationale is invalid: ${(cause as Error).message}`);
  }
  if ((record['rationale'] as RationaleChain).subject_id !== record['observed_model_id']) {
    throw new UIContractError('reconciliation view model rationale must bind the observed model id');
  }
}

/** Predicate form of assertValidReconciliationVM. */
export function validateReconciliationVM(value: unknown): value is ReconciliationVM {
  try {
    assertValidReconciliationVM(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * The truth states represented in drift evidence (display helper: distinct
 * states are never folded — spec/architecture.md §18).
 */
export function driftTruthStates(vm: ReconciliationVM): EvidenceTruthState[] {
  const states = new Set<EvidenceTruthState>();
  for (const drift of vm.drift_evidence) {
    states.add(drift.availability);
  }
  return EVIDENCE_TRUTH_STATES.filter((state) => states.has(state));
}
