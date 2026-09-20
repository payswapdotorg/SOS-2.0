/**
 * EvidenceVM — the evidence-investigation view model (Work Order W11;
 * spec/requirements.md R22 evidence-based explainability; spec/
 * architecture.md §18 "Unknown, failed, unavailable and unsupported remain
 * distinct").
 *
 * A pure projection of @sos-2/evidence records onto queryable display rows.
 * The W11 projection contract (negative-tested):
 *
 *   - TRUTH STATES ARE NEVER DROPPED OR FOLDED: every row carries its exact
 *     availability from the 6 frozen states, and the set-level counts carry
 *     ALL 6 keys (zeros included). A view model that drops a truth state
 *     from a row, or omits a key from the counts, is REJECTED.
 *   - PROVENANCE IS NEVER DROPPED: every row carries the record's full
 *     provenance array, the producer (WHO/WHAT), the explicit truth-state
 *     assignment method and the LLM-output mark.
 *   - UNCERTAINTY IS NEVER DROPPED: every row carries the record's
 *     Confidence (calibrated numeric only with a calibration ref;
 *     qualitative otherwise) — imported from @sos-2/evidence.
 *
 * Freshness is evaluated through the W3 authority (evaluateFreshness,
 * CONSUMED — never re-implemented) at the caller-supplied presentation
 * instant; when no instant is supplied the freshness fields are null
 * (distinct from any status — missing is never silently fresh).
 */

import { isArtifactId, isEvidenceTruthState } from '@sos-2/semantic-spine';
import type { EvidenceTruthState } from '@sos-2/semantic-spine';
import type { EvidenceClass, EvidenceRecordW3, FreshnessStatus } from '@sos-2/evidence';
import { EVIDENCE_CLASSES, assertValidEvidenceRecord, evaluateFreshness, isConfidence } from '@sos-2/evidence';
import type { Confidence } from '@sos-2/evidence';
import type { Producer, TimeWindow } from '@sos-2/provenance';
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

/** One evidence row — truth state + provenance + uncertainty preserved. */
export interface EvidenceRowVM {
  id: string;
  kind: string;
  subject_ref: string;
  /** The EXACT truth state (one of the 6 frozen states — never folded). */
  availability: EvidenceTruthState;
  /** OBSERVATIONAL or INTERVENTIONAL (imported vocabulary). */
  evidence_class: EvidenceClass;
  /** The explicit truth-state assignment method provenance. */
  method: string;
  /** The record's provenance entries (never dropped). */
  provenance: string[];
  /** WHO/WHAT produced the evidence (imported Producer). */
  producer: Producer;
  /** Derived LLM-output mark (never authoritative — §18). */
  llm_output: boolean;
  /** The observation window, or null. */
  window: TimeWindow | null;
  /** Exact source revision, or null (preserved, never defaulted). */
  source_revision: string | null;
  /** Exact deployment revision, or null (preserved, never defaulted). */
  deployment_revision: string | null;
  /** The subject revision the evidence reflects, or null. */
  subject_revision: string | null;
  /** The record's uncertainty (imported Confidence — never dropped). */
  confidence: Confidence;
  /** Freshness at the presentation instant, or null when none was supplied. */
  freshness: { status: FreshnessStatus; reason: string } | null;
}

/** The active evidence query (what the human asked for). */
export interface EvidenceQueryVM {
  /** Subject filter, or null (all subjects). */
  subject: string | null;
  /** Truth-state filter (subset of the 6 frozen states), or null (all states). */
  truth_states: EvidenceTruthState[] | null;
}

/** The evidence investigation view model. */
export interface EvidenceVM {
  query: EvidenceQueryVM;
  /** Rows sorted by id (deterministic). */
  rows: EvidenceRowVM[];
  /** Rows per truth state — ALL 6 keys present, zeros included (never folded). */
  counts_by_truth_state: Record<EvidenceTruthState, number>;
  /** Upstream/downstream rationale + evidence (W11 acceptance). */
  rationale: RationaleChain;
}

export interface ProjectEvidenceInput {
  /** The full evidence pool (already-validated W3 records). */
  records: readonly EvidenceRecordW3[];
  /** Query filters (subject and/or truth states). */
  query?: { subject?: string | null; truth_states?: readonly EvidenceTruthState[] | null };
  /**
   * RFC3339 presentation instant for freshness evaluation, or null to skip
   * freshness (rows then carry freshness: null — distinct from any status).
   */
  now?: string | null;
  /** The current system-state revision for freshness, or null. */
  system_state_revision?: string | null;
  rationale: RationaleChain;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** Project the evidence pool under a query onto the investigation view model. */
export function projectEvidenceSet(input: ProjectEvidenceInput): EvidenceVM {
  const rationale = input.rationale;
  assertValidRationaleChain(rationale);
  const subject = input.query?.subject ?? null;
  const truthStates =
    input.query?.truth_states === undefined || input.query?.truth_states === null
      ? null
      : [...input.query.truth_states];
  if (truthStates !== null) {
    for (const state of truthStates) {
      if (!isEvidenceTruthState(state)) {
        throw new UIContractError(
          `evidence query truth_states must be frozen truth states, received: ${JSON.stringify(state)}`,
        );
      }
    }
  }

  const counts = Object.fromEntries(TRUTH_STATES.map((state) => [state, 0])) as Record<EvidenceTruthState, number>;
  const rows: EvidenceRowVM[] = [];
  const sorted = [...input.records].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const record of sorted) {
    try {
      assertValidEvidenceRecord(record);
    } catch (cause) {
      throw new UIContractError(`evidence pool contains an invalid record: ${(cause as Error).message}`);
    }
    counts[record.availability] += 1;
    if (subject !== null && record.subject_ref !== subject) {
      continue;
    }
    if (truthStates !== null && !truthStates.includes(record.availability)) {
      continue;
    }
    let freshness: { status: FreshnessStatus; reason: string } | null = null;
    if (input.now !== null && input.now !== undefined) {
      const evaluation = evaluateFreshness(record, {
        now: input.now,
        systemStateRevision: input.system_state_revision ?? null,
      });
      freshness = { status: evaluation.status, reason: evaluation.reason };
    }
    rows.push({
      id: record.id,
      kind: record.kind,
      subject_ref: record.subject_ref,
      availability: record.availability,
      evidence_class: record.evidence_class,
      method: record.method,
      provenance: [...record.provenance],
      producer: structuredClone(record.producer),
      llm_output: record.llm_output,
      window: record.window === null ? null : { ...record.window },
      source_revision: record.source_revision,
      deployment_revision: record.deployment_revision,
      subject_revision: record.subject_revision,
      confidence: structuredClone(record.confidence),
      freshness,
    });
  }

  const vm: EvidenceVM = {
    query: { subject, truth_states: truthStates === null ? null : [...truthStates] },
    rows,
    counts_by_truth_state: counts,
    rationale,
  };
  assertValidEvidenceVM(vm);
  return vm;
}

/** Validate an EvidenceVM (throws UIContractError). */
export function assertValidEvidenceVM(value: unknown): asserts value is EvidenceVM {
  if (!isPlainObject(value)) {
    throw new UIContractError(`evidence view model must be an object, received: ${JSON.stringify(value)}`);
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  const expected = new Set(['query', 'rows', 'counts_by_truth_state', 'rationale']);
  if (keys.length !== expected.size || !keys.every((key) => expected.has(key))) {
    throw new UIContractError('evidence view model must have the exact W11 field set { query, rows, counts_by_truth_state, rationale }');
  }
  const query = record['query'];
  if (!isPlainObject(query) || Object.keys(query).length !== 2 || !('subject' in query) || !('truth_states' in query)) {
    throw new UIContractError('evidence view model query must have the exact field set { subject, truth_states }');
  }
  const queryRecord = query as Record<string, unknown>;
  if (queryRecord['subject'] !== null && !isNonEmptyString(queryRecord['subject'])) {
    throw new UIContractError('evidence query subject must be null or a non-empty artifact id');
  }
  if (queryRecord['truth_states'] !== null) {
    if (!Array.isArray(queryRecord['truth_states'])) {
      throw new UIContractError('evidence query truth_states must be null or an array of frozen truth states');
    }
    for (const state of queryRecord['truth_states']) {
      if (!isEvidenceTruthState(state)) {
        throw new UIContractError(
          `evidence query truth_states must be frozen truth states, received: ${JSON.stringify(state)}`,
        );
      }
    }
  }
  if (!Array.isArray(record['rows'])) {
    throw new UIContractError('evidence view model rows must be an array');
  }
  for (const row of record['rows']) {
    if (!isPlainObject(row)) {
      throw new UIContractError('evidence rows must be objects');
    }
    const rowRecord = row as Record<string, unknown>;
    const rowKeys = Object.keys(rowRecord);
    const rowExpected = new Set([
      'id',
      'kind',
      'subject_ref',
      'availability',
      'evidence_class',
      'method',
      'provenance',
      'producer',
      'llm_output',
      'window',
      'source_revision',
      'deployment_revision',
      'subject_revision',
      'confidence',
      'freshness',
    ]);
    if (rowKeys.length !== rowExpected.size || !rowKeys.every((key) => rowExpected.has(key))) {
      throw new UIContractError('evidence rows must have the exact W11 field set (truth state + provenance + uncertainty included)');
    }
    if (!isNonEmptyString(rowRecord['id']) || !isArtifactId(rowRecord['id'])) {
      throw new UIContractError('evidence row id must be a well-formed spine artifact id');
    }
    if (!isEvidenceTruthState(rowRecord['availability'])) {
      throw new UIContractError(
        `evidence row availability must be one of the 6 distinct frozen truth states, received: ${JSON.stringify(rowRecord['availability'])} (truth states are never dropped or folded)`,
      );
    }
    if (!EVIDENCE_CLASSES.includes(rowRecord['evidence_class'] as EvidenceClass)) {
      throw new UIContractError('evidence row evidence_class must be OBSERVATIONAL or INTERVENTIONAL');
    }
    if (!isNonEmptyString(rowRecord['method'])) {
      throw new UIContractError('evidence row method must be a non-empty string (truth-state assignment provenance)');
    }
    if (
      !Array.isArray(rowRecord['provenance']) ||
      rowRecord['provenance'].length === 0 ||
      !rowRecord['provenance'].every(isNonEmptyString)
    ) {
      throw new UIContractError('evidence row provenance must be a non-empty array (provenance is never dropped)');
    }
    if (typeof rowRecord['llm_output'] !== 'boolean') {
      throw new UIContractError('evidence row llm_output must be a boolean');
    }
    if (!isConfidence(rowRecord['confidence'])) {
      throw new UIContractError(
        'evidence row confidence must be a valid Confidence (CALIBRATED with calibration_ref, or QUALITATIVE) — uncertainty is never dropped',
      );
    }
    if (rowRecord['freshness'] !== null) {
      const freshness = rowRecord['freshness'] as Record<string, unknown>;
      if (!isPlainObject(freshness) || Object.keys(freshness).length !== 2 || !isNonEmptyString(freshness['reason'])) {
        throw new UIContractError('evidence row freshness must be null or { status, reason }');
      }
    }
  }
  const counts = record['counts_by_truth_state'];
  if (!isPlainObject(counts)) {
    throw new UIContractError('evidence counts_by_truth_state must be an object');
  }
  const countKeys = Object.keys(counts).sort();
  const expectedCountKeys = [...TRUTH_STATES].sort();
  if (countKeys.length !== expectedCountKeys.length || !countKeys.every((key, index) => key === expectedCountKeys[index])) {
    throw new UIContractError(
      'evidence counts_by_truth_state must carry ALL 6 frozen truth-state keys (zeros included — distinct states are never dropped or folded)',
    );
  }
  for (const value of Object.values(counts)) {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
      throw new UIContractError('evidence truth-state counts must be non-negative integers');
    }
  }
  try {
    assertValidRationaleChain(record['rationale']);
  } catch (cause) {
    throw new UIContractError(`evidence view model rationale is invalid: ${(cause as Error).message}`);
  }
}

/** Predicate form of assertValidEvidenceVM. */
export function validateEvidenceVM(value: unknown): value is EvidenceVM {
  try {
    assertValidEvidenceVM(value);
    return true;
  } catch {
    return false;
  }
}
