/**
 * Freshness / staleness evaluation (Work Order W3 acceptance: "stale evidence
 * detectable").
 *
 * `evaluateFreshness(evidence, { now, systemStateRevision })` classifies an
 * evidence record against an evaluation instant and (optionally) the current
 * revision of the subject — typically a System State revision, making stale
 * evidence w.r.t. the live system state directly detectable. Four DISTINCT
 * statuses, never conflated:
 *
 *   FRESH                      bound to the current subject revision (when one
 *                              was supplied) and its observation window has
 *                              not closed before `now`
 *   EXPIRED_TIME_WINDOW        the evidence's observation window closed
 *                              strictly before `now` (stale in time)
 *   SUPERSEDED_SUBJECT_REVISION the subject has moved on: the evidence
 *                              reflects an older subject revision than the
 *                              supplied system state revision (stale in state)
 *   UNKNOWN_PROVENANCE         the evidence is bound to neither time nor
 *                              subject revision, or it does not declare the
 *                              subject revision it reflects while a system
 *                              state revision was supplied — freshness cannot
 *                              be established (distinctly NOT fresh, and NOT
 *                              silently stale either)
 *
 * Deterministic, total, no hidden clocks: `now` is always caller-supplied
 * RFC3339. Precedence (documented choice): UNKNOWN_PROVENANCE >
 * SUPERSEDED_SUBJECT_REVISION > EXPIRED_TIME_WINDOW > FRESH — an unbound or
 * superseded record is never "rescued" by a recent window, and a superseded
 * record is reported as superseded even when its window has also expired.
 */

import { isRfc3339, rfc3339ToEpochMs } from '@sos-2/provenance';
import { assertValidEvidenceRecord } from './record.js';
import type { EvidenceRecordW3 } from './record.js';
import { EvidenceError } from './errors.js';

export const FRESHNESS_STATUSES = [
  'FRESH',
  'EXPIRED_TIME_WINDOW',
  'SUPERSEDED_SUBJECT_REVISION',
  'UNKNOWN_PROVENANCE',
] as const;

export type FreshnessStatus = (typeof FRESHNESS_STATUSES)[number];

const FRESHNESS_STATUS_SET: ReadonlySet<string> = new Set(FRESHNESS_STATUSES);

/** Structural check: is this one of the four freshness statuses? */
export function isFreshnessStatus(value: unknown): value is FreshnessStatus {
  return typeof value === 'string' && FRESHNESS_STATUS_SET.has(value);
}

export interface FreshnessInput {
  /** RFC3339 evaluation instant (caller-supplied; never a hidden clock). */
  now: string;
  /**
   * The CURRENT revision of the subject (typically the System State
   * revision), when known. Null/undefined: evaluate against time only.
   */
  systemStateRevision?: string | null;
}

export interface FreshnessEvaluation {
  status: FreshnessStatus;
  reason: string;
}

/** Validate the freshness input (throws EvidenceError). */
export function assertValidFreshnessInput(input: FreshnessInput): void {
  if (typeof input !== 'object' || input === null) {
    throw new EvidenceError('freshness input must be an object { now, systemStateRevision? }');
  }
  if (!isRfc3339(input.now)) {
    throw new EvidenceError(`freshness input now must be an RFC3339 timestamp, received: ${JSON.stringify(input.now)}`);
  }
  if (
    input.systemStateRevision !== undefined &&
    input.systemStateRevision !== null &&
    (typeof input.systemStateRevision !== 'string' || input.systemStateRevision.length === 0)
  ) {
    throw new EvidenceError(
      `systemStateRevision must be null or a non-empty string, received: ${JSON.stringify(input.systemStateRevision)}`,
    );
  }
}

/**
 * Evaluate the freshness of an evidence record. Deterministic and total for
 * every valid record and valid input: every truth state (including
 * UNAVAILABLE and UNSUPPORTED evidence) receives a freshness answer — the
 * states remain distinct and none of them is ever silently treated as
 * fresh or stale by virtue of its truth state alone.
 */
export function evaluateFreshness(evidence: EvidenceRecordW3, input: FreshnessInput): FreshnessEvaluation {
  assertValidEvidenceRecord(evidence);
  assertValidFreshnessInput(input);
  const systemStateRevision = input.systemStateRevision ?? null;

  // 1. Unbound evidence: neither time window nor subject revision.
  if (evidence.window === null && evidence.subject_revision === null) {
    return {
      status: 'UNKNOWN_PROVENANCE',
      reason:
        `evidence ${evidence.id} is bound to neither an observation window nor a subject revision — ` +
        'freshness cannot be established',
    };
  }
  // 2. A system state revision was supplied, but the evidence does not
  //    declare which subject revision it reflects.
  if (systemStateRevision !== null && evidence.subject_revision === null) {
    return {
      status: 'UNKNOWN_PROVENANCE',
      reason:
        `evidence ${evidence.id} does not declare the subject revision it reflects, so it cannot be ` +
        `compared against the supplied system state revision ${JSON.stringify(systemStateRevision)}`,
    };
  }
  // 3. Superseded: the subject has moved on.
  if (
    systemStateRevision !== null &&
    evidence.subject_revision !== null &&
    evidence.subject_revision !== systemStateRevision
  ) {
    return {
      status: 'SUPERSEDED_SUBJECT_REVISION',
      reason:
        `evidence ${evidence.id} reflects subject revision ${JSON.stringify(evidence.subject_revision)}, ` +
        `which is superseded by the current system state revision ${JSON.stringify(systemStateRevision)}`,
    };
  }
  // 4. Expired: the observation window closed strictly before `now`.
  if (evidence.window !== null && rfc3339ToEpochMs(input.now) > rfc3339ToEpochMs(evidence.window.end)) {
    return {
      status: 'EXPIRED_TIME_WINDOW',
      reason:
        `evidence ${evidence.id} covers the window ending ${evidence.window.end}, which closed before ${input.now}`,
    };
  }
  return {
    status: 'FRESH',
    reason:
      `evidence ${evidence.id} is bound to the current subject revision` +
      `${evidence.subject_revision === null ? '' : ` (${evidence.subject_revision})`} and its observation window has not closed`,
  };
}

/**
 * Convenience: is the evidence stale by ANY dimension (expired window or
 * superseded subject revision)? UNKNOWN_PROVENANCE is NOT stale — it is
 * unevaluable, a distinct answer (spec/architecture.md §18: distinct states
 * remain distinct).
 */
export function isStale(evaluation: FreshnessEvaluation): boolean {
  return evaluation.status === 'EXPIRED_TIME_WINDOW' || evaluation.status === 'SUPERSEDED_SUBJECT_REVISION';
}
