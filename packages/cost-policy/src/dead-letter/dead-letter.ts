/**
 * Dead-letter / retry handling (Work Order P14).
 *
 * TYPED dead-letter records with BOUNDED retry/backoff then ASK:
 *
 *   - never a SILENT DROP: a failed delivery/operation always lands in
 *     a typed dead-letter record carrying the task identity, the
 *     attempts and the last error (the §6 retries/recovery state);
 *   - never an INFINITE RETRY: the retry policy declares maxAttempts
 *     and a bounded exponential backoff (capped); a policy without
 *     bounds is a typed rejection;
 *   - then ASK: when retries are exhausted (or the error is
 *     non-retryable), the outcome is a typed ASK escalation — ASK is a
 *     first-class success state (the W10 discipline), never an
 *     exception and never a silent failure;
 *   - BODY CRASH / PROVIDER OUTAGE RECOVERY: the dead-letter state is
 *     durable data — a replacement body resumes from it (the §6 task
 *     durability rule: the task, evidence and state survive body
 *     replacement).
 *
 * The ASK escalation record is an INDEPENDENT typed vocabulary aligned
 * with the merged @sos-2/ask queue discipline (an ordered, deduplicated
 * ask carrying reason and provenance) — composition is wired at the
 * composition root, not imported (the lockfile identity rule).
 *
 * Determinism: pure functions over injected state + clock.
 */

import { RetryPolicyError } from '../errors.js';
import type { Timestamp } from '../types.js';

/** A bounded retry/backoff policy. */
export interface RetryBackoffPolicy {
  /** Max total attempts (>= 1, finite — infinite retry is unrepresentable). */
  readonly maxAttempts: number;
  /** Backoff base in ms (>= 1). */
  readonly backoffBaseMs: number;
  /** Backoff cap in ms (>= base — the bound). */
  readonly backoffMaxMs: number;
}

/** The typed dead-letter state (durable §6 recovery data). */
export interface DeadLetterState {
  readonly taskId: string;
  readonly missionId: string | null;
  readonly subject: string;
  readonly attempts: number;
  readonly lastErrorType: string | null;
  readonly lastFailedAt: Timestamp | null;
  readonly status: 'RETRYING' | 'DEAD_LETTERED' | 'ESCALATED_ASK';
}

/** The typed retry decision. */
export type RetryDecision =
  | {
      readonly kind: 'RETRY';
      readonly nextAttemptAt: Timestamp;
      readonly delayMs: number;
      readonly attempt: number;
    }
  | {
      readonly kind: 'ESCALATE_ASK';
      readonly reason: 'RETRIES_EXHAUSTED' | 'NON_RETRYABLE';
      readonly detail: string;
    };

/** The typed ASK escalation record (aligned with the W10 ask discipline). */
export interface AskEscalationRecord {
  readonly taskId: string;
  readonly reason: 'RETRIES_EXHAUSTED' | 'NON_RETRYABLE' | 'ABUSE_SUSPENSION' | 'BUDGET_EXHAUSTED';
  readonly detail: string;
  readonly raisedAt: Timestamp;
  readonly deduplicationKey: string;
  readonly provenance: readonly string[];
}

/** Validate a retry policy — unbounded policies are typed rejections. */
export function assertBoundedRetryPolicy(policy: RetryBackoffPolicy): void {
  const problems: string[] = [];
  if (typeof policy.maxAttempts !== 'number' || !Number.isInteger(policy.maxAttempts) || policy.maxAttempts < 1) {
    problems.push('maxAttempts (>= 1; infinite retry is unrepresentable)');
  }
  if (typeof policy.backoffBaseMs !== 'number' || !Number.isInteger(policy.backoffBaseMs) || policy.backoffBaseMs < 1) {
    problems.push('backoffBaseMs (>= 1)');
  }
  if (
    typeof policy.backoffMaxMs !== 'number' ||
    !Number.isInteger(policy.backoffMaxMs) ||
    policy.backoffMaxMs < policy.backoffBaseMs
  ) {
    problems.push('backoffMaxMs (>= backoffBaseMs; unbounded backoff is unrepresentable)');
  }
  if (problems.length > 0) {
    throw new RetryPolicyError(`malformed retry policy (fields: ${problems.join(', ')}) — bounded retry only`);
  }
}

/**
 * Deterministic exponential backoff with a cap:
 * delay(attempt) = min(base * 2^(attempt-1), max). Attempt numbers are
 * 1-based (the delay BEFORE the Nth attempt).
 */
export function nextBackoffDelayMs(attempt: number, policy: RetryBackoffPolicy): number {
  assertBoundedRetryPolicy(policy);
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new RetryPolicyError(`attempt must be a positive integer, received: ${String(attempt)}`);
  }
  const exponential = policy.backoffBaseMs * Math.pow(2, attempt - 1);
  return Math.min(exponential, policy.backoffMaxMs);
}

/**
 * Decide the next step for a failed operation:
 *   - attempts < maxAttempts AND the error is retryable -> RETRY with
 *     the bounded backoff delay from the injected `now`;
 *   - otherwise -> ESCALATE_ASK (RETRIES_EXHAUSTED or NON_RETRYABLE).
 * Never a silent drop: the caller records the dead-letter state either
 * way (§6).
 */
export function evaluateRetry(
  state: DeadLetterState,
  policy: RetryBackoffPolicy,
  errorRetryable: boolean,
  now: Timestamp,
): RetryDecision {
  assertBoundedRetryPolicy(policy);
  if (!errorRetryable) {
    return {
      kind: 'ESCALATE_ASK',
      reason: 'NON_RETRYABLE',
      detail: `operation "${state.subject}" of task ${state.taskId} failed with a non-retryable error (${state.lastErrorType ?? 'unknown'}) — escalated to ASK (never silently dropped)`,
    };
  }
  if (state.attempts >= policy.maxAttempts) {
    return {
      kind: 'ESCALATE_ASK',
      reason: 'RETRIES_EXHAUSTED',
      detail: `operation "${state.subject}" of task ${state.taskId} exhausted its bounded retries (${state.attempts}/${policy.maxAttempts}) — escalated to ASK (never an infinite loop)`,
    };
  }
  const nextAttempt = state.attempts + 1;
  const delayMs = nextBackoffDelayMs(nextAttempt, policy);
  return {
    kind: 'RETRY',
    nextAttemptAt: now + delayMs,
    delayMs,
    attempt: nextAttempt,
  };
}

/**
 * Record a failure into the typed dead-letter state (pure transition).
 * Never a silent drop: every failure advances the durable record.
 */
export function recordFailure(
  state: DeadLetterState,
  errorType: string,
  now: Timestamp,
): DeadLetterState {
  return {
    ...state,
    attempts: state.attempts + 1,
    lastErrorType: errorType,
    lastFailedAt: now,
    status: 'RETRYING',
  };
}

/**
 * The typed ASK escalation for a dead-lettered task: the escalation is
 * durable evidence with a deduplication key (same task + reason
 * escalates once — the W10 deduplication discipline).
 */
export function escalateToAsk(
  state: DeadLetterState,
  reason: AskEscalationRecord['reason'],
  detail: string,
  now: Timestamp,
): AskEscalationRecord {
  return {
    taskId: state.taskId,
    reason,
    detail,
    raisedAt: now,
    deduplicationKey: `dead-letter:${state.taskId}:${reason}`,
    provenance: ['sos-2/cost-policy:dead-letter', `task:${state.taskId}`, `subject:${state.subject}`],
  };
}

/** A fresh dead-letter state for a subject (0 attempts, RETRYING). */
export function initialDeadLetterState(
  taskId: string,
  missionId: string | null,
  subject: string,
): DeadLetterState {
  if (typeof taskId !== 'string' || taskId.length === 0) {
    throw new RetryPolicyError('taskId must be a non-empty string');
  }
  if (typeof subject !== 'string' || subject.length === 0) {
    throw new RetryPolicyError('subject must be a non-empty string');
  }
  return {
    taskId,
    missionId,
    subject,
    attempts: 0,
    lastErrorType: null,
    lastFailedAt: null,
    status: 'RETRYING',
  };
}
