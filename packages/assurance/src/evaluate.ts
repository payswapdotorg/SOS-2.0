/**
 * Living assurance evaluation (Work Order W8 acceptance: "assurance validity
 * tracked"; docs/assurance-model.md "Assurance can become invalid when:
 * implementation changes, dependencies change, environment changes, evidence
 * expires, runtime monitors detect anomalies, assumptions are violated").
 *
 * `evaluate(case, input)` is deterministic and total on valid inputs. The
 * case content stays declarative; the VERDICT is always DERIVED from the
 * case plus the evaluation input (never stored — a stored verdict would go
 * stale silently; that is the point of living assurance).
 *
 * ---------------------------------------------------------------------------
 * VERDICTS (distinct, never conflated)
 * ---------------------------------------------------------------------------
 *   VALID        every validity condition holds, every assumption is checked
 *                and satisfied, every supporting evidence record is fresh
 *                and conclusive, no fresh contradicting evidence, and no
 *                unresolved objections
 *   OBJECTIONED  mechanically valid (as above) BUT unresolved objections
 *                stand against the case — objections are first-class and
 *                always surface in the verdict
 *   INVALID      at least one invalidation reason (below)
 *
 * INVALID dominates OBJECTIONED dominates VALID.
 *
 * ---------------------------------------------------------------------------
 * INVALIDATION REASONS (distinct, tracked — never collapsed into one flag)
 * ---------------------------------------------------------------------------
 *   IMPLEMENTATION_OUT_OF_BOUNDS / DEPENDENCY_OUT_OF_BOUNDS /
 *   ENVIRONMENT_OUT_OF_BOUNDS      the reported revision is not among the
 *                                  condition's recorded valid revisions
 *   IMPLEMENTATION_UNREPORTED / DEPENDENCY_UNREPORTED /
 *   ENVIRONMENT_UNREPORTED         the condition's subject was not reported
 *                                  at all — an unobserved bound never keeps
 *                                  a case VALID (fail-safe)
 *   EVIDENCE_MISSING               a referenced evidence record was not in
 *                                  the provided evidence pool
 *   EVIDENCE_EXPIRED               supporting evidence's observation window
 *                                  closed before `now` (W3 freshness:
 *                                  EXPIRED_TIME_WINDOW)
 *   EVIDENCE_SUPERSEDED            supporting evidence reflects a subject
 *                                  revision the system has moved past (W3
 *                                  freshness: SUPERSEDED_SUBJECT_REVISION)
 *   EVIDENCE_FRESHNESS_UNKNOWN     supporting evidence is bound to neither
 *                                  time nor subject revision — freshness
 *                                  cannot be established, which is NOT
 *                                  fresh (W3: UNKNOWN_PROVENANCE)
 *   CONTRADICTED_BY_EVIDENCE       a CONTRADICTS-linked evidence record is
 *                                  FRESH (a stale contradiction is not a
 *                                  current one; a fresh one is)
 *   SUPPORTING_EVIDENCE_FAILED     fresh supporting evidence whose truth
 *                                  state is FAILURE
 *   SUPPORTING_EVIDENCE_INCONCLUSIVE
 *                                  fresh supporting evidence in a
 *                                  non-conclusive truth state (UNKNOWN /
 *                                  UNAVAILABLE / UNSUPPORTED / PARTIAL) —
 *                                  inconclusive support is not support
 *   ASSUMPTION_VIOLATED            an assumption check returned false
 *   ASSUMPTION_UNCHECKED           an assumption received no check — an
 *                                  unchecked assumption never keeps a case
 *                                  VALID (fail-safe)
 *
 * Freshness evaluation is DELEGATED to the merged W3 authority
 * (@sos-2/evidence evaluateFreshness — never re-implemented here).
 */

import { RFC3339_PATTERN, isArtifactId } from '@sos-2/semantic-spine';
import { canonicalSerialize } from '@sos-2/semantic-spine';
import { assertValidEvidenceRecord, evaluateFreshness } from '@sos-2/evidence';
import type { EvidenceRecordW3, FreshnessStatus } from '@sos-2/evidence';
import { AssuranceError } from './errors.js';
import { AssuranceEvaluationError } from './errors.js';
import { assertValidAssuranceCase } from './case.js';
import type { AssuranceCaseArtifact, Objection } from './case.js';

// ---------------------------------------------------------------------------
// Public vocabulary
// ---------------------------------------------------------------------------

export const ASSURANCE_VERDICTS = ['VALID', 'OBJECTIONED', 'INVALID'] as const;

export type AssuranceVerdict = (typeof ASSURANCE_VERDICTS)[number];

export const INVALIDATION_REASONS = [
  'IMPLEMENTATION_OUT_OF_BOUNDS',
  'IMPLEMENTATION_UNREPORTED',
  'DEPENDENCY_OUT_OF_BOUNDS',
  'DEPENDENCY_UNREPORTED',
  'ENVIRONMENT_OUT_OF_BOUNDS',
  'ENVIRONMENT_UNREPORTED',
  'EVIDENCE_MISSING',
  'EVIDENCE_EXPIRED',
  'EVIDENCE_SUPERSEDED',
  'EVIDENCE_FRESHNESS_UNKNOWN',
  'CONTRADICTED_BY_EVIDENCE',
  'SUPPORTING_EVIDENCE_FAILED',
  'SUPPORTING_EVIDENCE_INCONCLUSIVE',
  'ASSUMPTION_VIOLATED',
  'ASSUMPTION_UNCHECKED',
] as const;

export type InvalidationReason = (typeof INVALIDATION_REASONS)[number];

const INVALIDATION_REASON_SET: ReadonlySet<string> = new Set(INVALIDATION_REASONS);

export function isInvalidationReason(value: unknown): value is InvalidationReason {
  return typeof value === 'string' && INVALIDATION_REASON_SET.has(value);
}

/** One tracked invalidation: the distinct reason, the subject, a deterministic message. */
export interface AssuranceInvalidation {
  reason: InvalidationReason;
  /** What invalidated (condition subject, evidence id, assumption id). */
  subject: string;
  /** Deterministic human-readable explanation. */
  message: string;
}

// ---------------------------------------------------------------------------
// Evaluation input
// ---------------------------------------------------------------------------

export interface AssuranceEvaluationInput {
  /** RFC3339 evaluation instant (caller-supplied; never a hidden clock). */
  now: string;
  /**
   * The CURRENT revision of the evidence subject (typically the SystemState
   * revision token), when known. Null/undefined: evaluate freshness against
   * time only.
   */
  systemStateRevision?: string | null;
  /** Current implementation revisions by validity-condition subject (artifact id -> revision). */
  implementation_revisions?: Record<string, string>;
  /** Current dependency revisions by validity-condition subject (dependency name -> revision). */
  dependency_revisions?: Record<string, string>;
  /** Current environment revisions by validity-condition subject (environment id -> revision). */
  environment_revisions?: Record<string, string>;
  /**
   * The available evidence pool. Referenced evidence missing from the pool is
   * an EVIDENCE_MISSING invalidation (fail-safe — never silently fresh).
   */
  evidence?: readonly EvidenceRecordW3[];
  /**
   * Assumption check results by assumption id (true = holds, false =
   * violated). Unknown keys are rejected loudly; declared assumptions
   * without a check are ASSUMPTION_UNCHECKED (fail-safe).
   */
  assumption_checks?: Record<string, boolean>;
}

export interface AssuranceEvaluation {
  /** The evaluated case's artifact id. */
  case_id: string;
  /** The evaluated case's envelope version. */
  case_version: number;
  /** Echo of the evaluation instant. */
  evaluated_at: string;
  /** VALID | OBJECTIONED | INVALID. */
  verdict: AssuranceVerdict;
  /** All tracked invalidations (sorted by reason, then subject). Empty iff verdict !== INVALID. */
  invalidations: AssuranceInvalidation[];
  /** Unresolved objections surfaced in the verdict (sorted by id). Empty iff verdict === VALID. */
  open_objections: Objection[];
}

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRevisionMap(value: unknown, what: string): value is Record<string, string> {
  if (value === undefined) {
    return true;
  }
  if (!isPlainObject(value)) {
    throw new AssuranceEvaluationError(`${what} must be an object mapping subjects to revision strings`);
  }
  for (const [key, revision] of Object.entries(value)) {
    if (typeof revision !== 'string' || revision.length === 0) {
      throw new AssuranceEvaluationError(
        `${what}[${JSON.stringify(key)}] must be a non-empty revision string, received: ${JSON.stringify(revision)}`,
      );
    }
  }
  return true;
}

function validateEvaluationInput(
  input: AssuranceEvaluationInput,
  caseArtifact: AssuranceCaseArtifact,
): void {
  if (!isPlainObject(input)) {
    throw new AssuranceEvaluationError('evaluation input must be an object');
  }
  if (typeof input.now !== 'string' || !RFC3339_PATTERN.test(input.now)) {
    throw new AssuranceEvaluationError(`evaluation input now must be an RFC3339 timestamp, received: ${JSON.stringify(input.now)}`);
  }
  if (
    input.systemStateRevision !== undefined &&
    input.systemStateRevision !== null &&
    (typeof input.systemStateRevision !== 'string' || input.systemStateRevision.length === 0)
  ) {
    throw new AssuranceEvaluationError(
      `systemStateRevision must be null or a non-empty string, received: ${JSON.stringify(input.systemStateRevision)}`,
    );
  }
  isRevisionMap(input.implementation_revisions, 'implementation_revisions');
  isRevisionMap(input.dependency_revisions, 'dependency_revisions');
  isRevisionMap(input.environment_revisions, 'environment_revisions');

  if (input.evidence !== undefined && !Array.isArray(input.evidence)) {
    throw new AssuranceEvaluationError('evidence must be an array of Evidence records');
  }
  const seenEvidence = new Map<string, string>();
  for (const record of input.evidence ?? []) {
    try {
      assertValidEvidenceRecord(record);
    } catch (cause) {
      throw new AssuranceEvaluationError(`evidence pool contains an invalid record: ${(cause as Error).message}`);
    }
    if (!isArtifactId(record.id) || record.id.length === 0) {
      throw new AssuranceEvaluationError(`evidence pool contains a record with a malformed id: ${JSON.stringify(record.id)}`);
    }
    const canonical = canonicalSerialize(record);
    const previous = seenEvidence.get(record.id);
    if (previous !== undefined && previous !== canonical) {
      throw new AssuranceEvaluationError(
        `evidence pool contains two DIFFERENT records under the same id ${record.id} (content-addressed collision)`,
      );
    }
    seenEvidence.set(record.id, canonical);
  }

  if (input.assumption_checks !== undefined) {
    if (!isPlainObject(input.assumption_checks)) {
      throw new AssuranceEvaluationError('assumption_checks must be an object mapping assumption ids to booleans');
    }
    const known = new Set(caseArtifact.content.assumptions.map((assumption) => assumption.id));
    for (const [id, check] of Object.entries(input.assumption_checks)) {
      if (!known.has(id)) {
        throw new AssuranceEvaluationError(
          `assumption_checks contains a check for unknown assumption ${JSON.stringify(id)} (declared: ${[...known].sort().join(', ') || 'none'})`,
        );
      }
      if (typeof check !== 'boolean') {
        throw new AssuranceEvaluationError(
          `assumption_checks[${JSON.stringify(id)}] must be a boolean, received: ${JSON.stringify(check)}`,
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

const CONDITION_REVISION_MAPS: Readonly<
  Record<'IMPLEMENTATION' | 'DEPENDENCY' | 'ENVIRONMENT', keyof AssuranceEvaluationInput>
> = {
  IMPLEMENTATION: 'implementation_revisions',
  DEPENDENCY: 'dependency_revisions',
  ENVIRONMENT: 'environment_revisions',
};

function invalidation(
  reason: InvalidationReason,
  subject: string,
  message: string,
): AssuranceInvalidation {
  return { reason, subject, message };
}

/** Freshness status -> supporting-evidence invalidation reason (distinct, tracked). */
function supportingFreshnessInvalidation(
  status: FreshnessStatus,
  evidenceId: string,
): AssuranceInvalidation | null {
  switch (status) {
    case 'FRESH':
      return null;
    case 'EXPIRED_TIME_WINDOW':
      return invalidation(
        'EVIDENCE_EXPIRED',
        evidenceId,
        `supporting evidence ${evidenceId} expired: its observation window closed before the evaluation instant`,
      );
    case 'SUPERSEDED_SUBJECT_REVISION':
      return invalidation(
        'EVIDENCE_SUPERSEDED',
        evidenceId,
        `supporting evidence ${evidenceId} is stale: the subject revision it reflects has been superseded`,
      );
    case 'UNKNOWN_PROVENANCE':
      return invalidation(
        'EVIDENCE_FRESHNESS_UNKNOWN',
        evidenceId,
        `supporting evidence ${evidenceId} is bound to neither an observation window nor a subject revision — freshness cannot be established, which is not fresh`,
      );
  }
}

/**
 * Evaluate an assurance case against the current world. Deterministic and
 * total on valid inputs: identical (case, input) pairs produce
 * byte-identical results, invalidations are sorted (reason, subject) and
 * open objections are sorted by id.
 *
 * The case envelope status must be DRAFT or ACTIVE — a SUPERSEDED or RETIRED
 * case never yields a verdict (loud failure, never a silent stale verdict).
 */
export function evaluateAssuranceCase(
  caseArtifact: AssuranceCaseArtifact,
  input: AssuranceEvaluationInput,
): AssuranceEvaluation {
  assertValidAssuranceCase(caseArtifact);
  if (caseArtifact.envelope.status === 'SUPERSEDED' || caseArtifact.envelope.status === 'RETIRED') {
    throw new AssuranceEvaluationError(
      `assurance case ${caseArtifact.envelope.id} is ${caseArtifact.envelope.status} — superseded and retired cases never yield verdicts (a stale verdict is never silently re-issued)`,
    );
  }
  validateEvaluationInput(input, caseArtifact);

  const invalidations: AssuranceInvalidation[] = [];
  const evidencePool = new Map<string, EvidenceRecordW3>();
  for (const record of input.evidence ?? []) {
    if (!evidencePool.has(record.id)) {
      evidencePool.set(record.id, record);
    }
  }

  // 1. Validity conditions (implementation / dependency / environment bounds).
  for (const condition of caseArtifact.content.validity_conditions) {
    const maps = input[CONDITION_REVISION_MAPS[condition.kind]] as Record<string, string> | undefined;
    const reported = maps?.[condition.subject];
    if (reported === undefined) {
      invalidations.push(
        invalidation(
          `${condition.kind}_UNREPORTED` as InvalidationReason,
          condition.subject,
          `validity condition on ${condition.kind.toLowerCase()} ${JSON.stringify(condition.subject)} could not be checked: no current revision was reported (an unobserved bound never keeps a case VALID)`,
        ),
      );
      continue;
    }
    if (!condition.valid_revisions.includes(reported)) {
      invalidations.push(
        invalidation(
          `${condition.kind}_OUT_OF_BOUNDS` as InvalidationReason,
          condition.subject,
          `${condition.kind.toLowerCase()} ${JSON.stringify(condition.subject)} is at revision ${JSON.stringify(reported)}, which is outside the recorded valid revisions [${condition.valid_revisions.join(', ')}]`,
        ),
      );
    }
  }

  // 2. Evidence references (freshness delegated to the merged W3 authority).
  const freshnessInput = {
    now: input.now,
    systemStateRevision: input.systemStateRevision ?? null,
  };
  const refs = [...caseArtifact.content.evidence].sort((a, b) =>
    a.evidence_id === b.evidence_id ? (a.claim_ref < b.claim_ref ? -1 : 1) : a.evidence_id < b.evidence_id ? -1 : 1,
  );
  for (const ref of refs) {
    const record = evidencePool.get(ref.evidence_id);
    if (record === undefined) {
      invalidations.push(
        invalidation(
          'EVIDENCE_MISSING',
          ref.evidence_id,
          `referenced evidence ${ref.evidence_id} (role ${ref.role}, claim ${JSON.stringify(ref.claim_ref)}) is not in the provided evidence pool`,
        ),
      );
      continue;
    }
    const freshness = evaluateFreshness(record, freshnessInput);
    if (ref.role === 'CONTRADICTS') {
      // Only a FRESH contradiction is a current contradiction; a stale one is
      // not silently treated as current (and never silently dropped either —
      // it stays referenced in the case content).
      if (freshness.status === 'FRESH') {
        invalidations.push(
          invalidation(
            'CONTRADICTED_BY_EVIDENCE',
            ref.evidence_id,
            `claim ${JSON.stringify(ref.claim_ref)} is contradicted by fresh evidence ${ref.evidence_id}`,
          ),
        );
      }
      continue;
    }
    // Supporting role (SUPPORTS / VERIFIES): freshness first, then truth state.
    const freshnessInvalidation = supportingFreshnessInvalidation(freshness.status, ref.evidence_id);
    if (freshnessInvalidation !== null) {
      invalidations.push(freshnessInvalidation);
      continue;
    }
    if (record.availability === 'FAILURE') {
      invalidations.push(
        invalidation(
          'SUPPORTING_EVIDENCE_FAILED',
          ref.evidence_id,
          `supporting evidence ${ref.evidence_id} (role ${ref.role}, claim ${JSON.stringify(ref.claim_ref)}) has truth state FAILURE — a failed support is not a support`,
        ),
      );
    } else if (record.availability !== 'SUCCESS') {
      invalidations.push(
        invalidation(
          'SUPPORTING_EVIDENCE_INCONCLUSIVE',
          ref.evidence_id,
          `supporting evidence ${ref.evidence_id} (role ${ref.role}, claim ${JSON.stringify(ref.claim_ref)}) is in the non-conclusive truth state ${record.availability} — inconclusive support is not support`,
        ),
      );
    }
  }

  // 3. Assumptions (checked and satisfied, or the case does not stay VALID).
  const assumptionChecks = input.assumption_checks ?? {};
  for (const assumption of caseArtifact.content.assumptions) {
    const check = assumptionChecks[assumption.id];
    if (check === undefined) {
      invalidations.push(
        invalidation(
          'ASSUMPTION_UNCHECKED',
          assumption.id,
          `assumption ${JSON.stringify(assumption.id)} received no check — an unchecked assumption never keeps a case VALID`,
        ),
      );
    } else if (check === false) {
      invalidations.push(
        invalidation(
          'ASSUMPTION_VIOLATED',
          assumption.id,
          `assumption ${JSON.stringify(assumption.id)} is violated: ${assumption.statement}`,
        ),
      );
    }
  }

  invalidations.sort((a, b) =>
    a.reason === b.reason ? (a.subject < b.subject ? -1 : a.subject > b.subject ? 1 : 0) : a.reason < b.reason ? -1 : 1,
  );
  const openObjections = caseArtifact.content.objections
    .filter((objection) => objection.status === 'OPEN')
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const verdict: AssuranceVerdict =
    invalidations.length > 0 ? 'INVALID' : openObjections.length > 0 ? 'OBJECTIONED' : 'VALID';

  return {
    case_id: caseArtifact.envelope.id,
    case_version: caseArtifact.envelope.version,
    evaluated_at: input.now,
    verdict,
    invalidations,
    open_objections: openObjections,
  };
}
