/**
 * CandidateComparisonVM — the candidate-comparison view model (Work Order
 * W11; spec/architecture.md §9: "Never use a single global architecture
 * score as the sole authority"; §11 diversity).
 *
 * A pure projection of @sos-2/experiments CandidateState fixtures onto a
 * side-by-side comparison. Each side carries the candidate's invariants,
 * predicted effects, causal-claim mark and its UNCERTAINTY (the imported
 * @sos-2/evidence Confidence contract — calibrated numeric only with a
 * calibration ref, qualitative otherwise; never a bare score), plus the
 * candidate's own EVIDENCE CONTEXT (distinct truth-state counts — never
 * folded, never zeroed).
 *
 * The comparison NEVER ranks candidates into a single winner: rows are
 * sorted by id (deterministic) and the view model records the base graph
 * all candidates evolve.
 */

import { isArtifactId } from '@sos-2/semantic-spine';
import type { EvidenceTruthState } from '@sos-2/semantic-spine';
import { isEvidenceTruthState } from '@sos-2/semantic-spine';
import type { Confidence, EvidenceRecordW3 } from '@sos-2/evidence';
import { assertValidCandidateState } from '@sos-2/experiments';
import type { CandidateStateFixture } from '@sos-2/experiments';
import { UIContractError } from './errors.js';
import { assertValidRationaleChain } from './rationale.js';
import type { RationaleChain } from './rationale.js';

/** All 6 frozen truth states (imported, for the never-folded counts). */
const TRUTH_STATES: readonly EvidenceTruthState[] = [
  'SUCCESS',
  'FAILURE',
  'UNKNOWN',
  'UNAVAILABLE',
  'UNSUPPORTED',
  'PARTIAL',
];

/** One side of the comparison. */
export interface CandidateSideVM {
  id: string;
  version: number;
  /** Invariants the candidate explicitly preserves. */
  invariants: string[];
  /** Predicted effects (testability surface). */
  predicted_effects: string[];
  /** Whether the candidate asserts causal effects. */
  causal_claim: boolean;
  /** The candidate's uncertainty mark — carried, displayed, never authorization. */
  confidence: Confidence | null;
  /** The System State revision the candidate is based on, or null. */
  base_subject_revision: string | null;
  /** The linked CausalHypothesis id, or null. */
  hypothesis_ref: string | null;
  /** The bounded-subgraph reference (graph id + version), or null. */
  bounded_subgraph_ref: { graph_id: string; version: number } | null;
  /** Evidence about THIS candidate: refs + distinct truth-state counts. */
  evidence: CandidateEvidenceContextVM;
}

/** The evidence context of one candidate (never a bare score). */
export interface CandidateEvidenceContextVM {
  /** Evidence refs about this candidate (subject_ref === candidate id). */
  refs: string[];
  /** ALL 6 truth-state keys present, zeros included (never folded). */
  counts_by_truth_state: Record<EvidenceTruthState, number>;
}

/** The comparison view model. */
export interface CandidateComparisonVM {
  /** The base graph id every candidate evolves. */
  base_graph_id: string;
  /** The base graph version. */
  base_graph_version: number;
  /** Sides sorted by id (deterministic; NO ranking — no single winner). */
  candidates: CandidateSideVM[];
  /** Upstream/downstream rationale + evidence (W11 acceptance). */
  rationale: RationaleChain;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

export interface ProjectCandidateComparisonInput {
  /** The candidates to compare (>= 1). */
  candidates: readonly CandidateStateFixture[];
  /** The base ArchitectureGraph id and version the candidates evolve. */
  base: { graph_id: string; version: number };
  /** The evidence pool (records about candidates are matched by subject_ref). */
  evidence?: readonly EvidenceRecordW3[];
  rationale: RationaleChain;
}

/** Project candidate states onto the side-by-side comparison view model. */
export function projectCandidateComparison(input: ProjectCandidateComparisonInput): CandidateComparisonVM {
  if (!Array.isArray(input.candidates) || input.candidates.length === 0) {
    throw new UIContractError('candidate comparison requires at least one candidate');
  }
  for (const candidate of input.candidates) {
    assertValidCandidateState(candidate);
  }
  if (!isArtifactId(input.base.graph_id)) {
    throw new UIContractError('candidate comparison base.graph_id must be a well-formed spine artifact id');
  }
  assertValidRationaleChain(input.rationale);

  const evidence = input.evidence ?? [];
  const candidates = [...input.candidates]
    .sort((a, b) => (a.envelope.id < b.envelope.id ? -1 : a.envelope.id > b.envelope.id ? 1 : 0))
    .map((candidate) => {
      const about = evidence
        .filter((record) => record.subject_ref === candidate.envelope.id)
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      const counts = Object.fromEntries(TRUTH_STATES.map((state) => [state, 0])) as Record<EvidenceTruthState, number>;
      for (const record of about) {
        counts[record.availability] += 1;
      }
      return {
        id: candidate.envelope.id,
        version: candidate.envelope.version,
        invariants: [...candidate.content.invariants],
        predicted_effects: [...candidate.content.predicted_effects],
        causal_claim: candidate.content.causal_claim,
        confidence: candidate.content.confidence === null ? null : structuredClone(candidate.content.confidence),
        base_subject_revision: candidate.content.base_subject_revision,
        hypothesis_ref: candidate.content.hypothesis_ref,
        bounded_subgraph_ref:
          candidate.content.bounded_subgraph_ref === null
            ? null
            : { ...candidate.content.bounded_subgraph_ref },
        evidence: {
          refs: about.map((record) => record.id),
          counts_by_truth_state: counts,
        },
      };
    });

  const vm: CandidateComparisonVM = {
    base_graph_id: input.base.graph_id,
    base_graph_version: input.base.version,
    candidates,
    rationale: input.rationale,
  };
  assertValidCandidateComparisonVM(vm);
  return vm;
}

/** Validate a CandidateComparisonVM (throws UIContractError). */
export function assertValidCandidateComparisonVM(value: unknown): asserts value is CandidateComparisonVM {
  if (!isPlainObject(value)) {
    throw new UIContractError(`candidate comparison view model must be an object, received: ${JSON.stringify(value)}`);
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  const expected = new Set(['base_graph_id', 'base_graph_version', 'candidates', 'rationale']);
  if (keys.length !== expected.size || !keys.every((key) => expected.has(key))) {
    throw new UIContractError('candidate comparison view model must have the exact W11 field set');
  }
  if (!isNonEmptyString(record['base_graph_id']) || !isArtifactId(record['base_graph_id'])) {
    throw new UIContractError('candidate comparison base_graph_id must be a well-formed spine artifact id');
  }
  if (typeof record['base_graph_version'] !== 'number' || !Number.isInteger(record['base_graph_version']) || record['base_graph_version'] < 1) {
    throw new UIContractError('candidate comparison base_graph_version must be an integer >= 1');
  }
  if (!Array.isArray(record['candidates']) || record['candidates'].length === 0) {
    throw new UIContractError('candidate comparison requires at least one candidate side');
  }
  for (const side of record['candidates']) {
    if (!isPlainObject(side)) {
      throw new UIContractError('candidate sides must be objects');
    }
    const sideRecord = side as Record<string, unknown>;
    const sideKeys = Object.keys(sideRecord);
    const sideExpected = new Set([
      'id',
      'version',
      'invariants',
      'predicted_effects',
      'causal_claim',
      'confidence',
      'base_subject_revision',
      'hypothesis_ref',
      'bounded_subgraph_ref',
      'evidence',
    ]);
    if (sideKeys.length !== sideExpected.size || !sideKeys.every((key) => sideExpected.has(key))) {
      throw new UIContractError('candidate sides must have the exact W11 field set (uncertainty included)');
    }
    if (!isNonEmptyString(sideRecord['id']) || !isArtifactId(sideRecord['id'])) {
      throw new UIContractError('candidate side id must be a well-formed spine artifact id');
    }
    if (typeof sideRecord['causal_claim'] !== 'boolean') {
      throw new UIContractError('candidate side causal_claim must be a boolean');
    }
    if (sideRecord['confidence'] !== null && !isPlainObject(sideRecord['confidence'])) {
      throw new UIContractError('candidate side confidence must be null or a valid Confidence mark');
    }
    const evidence = sideRecord['evidence'];
    if (!isPlainObject(evidence) || Object.keys(evidence).length !== 2) {
      throw new UIContractError('candidate side evidence must have the exact field set { refs, counts_by_truth_state }');
    }
    const counts = (evidence as Record<string, unknown>)['counts_by_truth_state'];
    if (!isPlainObject(counts)) {
      throw new UIContractError('candidate evidence counts_by_truth_state must be an object');
    }
    const countKeys = Object.keys(counts).sort();
    const expectedCountKeys = [...TRUTH_STATES].sort();
    if (countKeys.length !== expectedCountKeys.length || !countKeys.every((key, index) => key === expectedCountKeys[index])) {
      throw new UIContractError(
        'candidate evidence counts must carry ALL 6 frozen truth-state keys (zeros included — distinct states are never dropped or folded)',
      );
    }
  }
  try {
    assertValidRationaleChain(record['rationale']);
  } catch (cause) {
    throw new UIContractError(`candidate comparison rationale is invalid: ${(cause as Error).message}`);
  }
  if ((record['rationale'] as RationaleChain).evidence_refs.length === 0) {
    throw new UIContractError(
      'candidate comparison rationale must cite evidence (spec/architecture.md §18: evidence outranks assertion)',
    );
  }
}

/** Predicate form of assertValidCandidateComparisonVM. */
export function validateCandidateComparisonVM(value: unknown): value is CandidateComparisonVM {
  try {
    assertValidCandidateComparisonVM(value);
    return true;
  } catch {
    return false;
  }
}
