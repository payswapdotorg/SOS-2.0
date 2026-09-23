/**
 * Abuse containment (Work Order P14).
 *
 * A task exhibiting abuse signatures is SUSPENDED PENDING ASK — the
 * suspension is OBSERVED EVIDENCE (a typed, durable record through the
 * audit discipline), never a silent termination:
 *
 *   - the task is NOT terminated: it is suspended (recoverable,
 *     §6 — task state and evidence survive);
 *   - the suspension record carries the matched signatures (the
 *     evidence), the instant, and an ASK escalation reference;
 *   - a human decision (the ASK) resumes or terminates the task —
 *     autonomous containment never makes the final call.
 *
 * Determinism: pure functions over injected signatures + clock.
 */

import { AbusePolicyError } from '../errors.js';
import type { Timestamp } from '../types.js';

/** The severity vocabulary (aligned with the W10 ask risk severities). */
export const ABUSE_SEVERITIES = ['LOW', 'MODERATE', 'HIGH', 'SEVERE'] as const;
export type AbuseSeverity = (typeof ABUSE_SEVERITIES)[number];

/** One abuse signature (a typed observation, evidence-bound). */
export interface AbuseSignature {
  readonly signatureId: string;
  readonly severity: AbuseSeverity;
  readonly detail: string;
}

/**
 * The typed containment decision:
 *   CONTINUE            no signature matched — work proceeds;
 *   SUSPEND_PENDING_ASK at least one configured signature matched — the
 *                       task is suspended pending a human ASK.
 */
export type ContainmentDecision =
  | { readonly kind: 'CONTINUE'; readonly detail: string }
  | {
      readonly kind: 'SUSPEND_PENDING_ASK';
      readonly matchedSignatureIds: readonly string[];
      readonly detail: string;
    };

/** The containment policy: which signatures trigger suspension. */
export interface ContainmentPolicy {
  readonly policyId: string;
  /** The signature ids that trigger suspension (non-empty). */
  readonly suspendedSignatureIds: readonly string[];
  readonly enforcement: 'SUSPEND_PENDING_ASK';
}

/** The typed task suspension record — observed evidence, never silent. */
export interface TaskSuspensionRecord {
  readonly taskId: string;
  readonly missionId: string | null;
  readonly bodyId: string | null;
  readonly reason: 'ABUSE_SIGNATURES';
  readonly matchedSignatureIds: readonly string[];
  readonly suspendedAt: Timestamp;
  readonly pendingAsk: true;
  readonly askDeduplicationKey: string;
  readonly detail: string;
}

/** Validate a containment policy. */
export function assertValidContainmentPolicy(policy: ContainmentPolicy): void {
  const problems: string[] = [];
  if (typeof policy.policyId !== 'string' || policy.policyId.length === 0) problems.push('policyId');
  if (policy.enforcement !== 'SUSPEND_PENDING_ASK') problems.push('enforcement');
  if (!Array.isArray(policy.suspendedSignatureIds) || policy.suspendedSignatureIds.length === 0) {
    problems.push('suspendedSignatureIds (non-empty)');
  } else if (new Set(policy.suspendedSignatureIds).size !== policy.suspendedSignatureIds.length) {
    problems.push('suspendedSignatureIds (duplicate-free)');
  }
  if (problems.length > 0) {
    throw new AbusePolicyError(`malformed containment policy (fields: ${problems.join(', ')})`);
  }
}

/** Validate an abuse signature. */
export function assertValidAbuseSignature(signature: AbuseSignature): void {
  const problems: string[] = [];
  if (typeof signature.signatureId !== 'string' || signature.signatureId.length === 0) problems.push('signatureId');
  if (!(ABUSE_SEVERITIES as readonly string[]).includes(signature.severity)) problems.push('severity');
  if (typeof signature.detail !== 'string') problems.push('detail');
  if (problems.length > 0) {
    throw new AbusePolicyError(`malformed abuse signature (fields: ${problems.join(', ')})`);
  }
}

/**
 * Evaluate containment for a task given its observed signatures:
 * SUSPEND_PENDING_ASK when any signature matches the policy (suspension
 * pending a human ASK — never silent termination); CONTINUE otherwise.
 */
export function evaluateContainment(
  policy: ContainmentPolicy,
  observed: readonly AbuseSignature[],
): ContainmentDecision {
  assertValidContainmentPolicy(policy);
  for (const signature of observed) {
    assertValidAbuseSignature(signature);
  }
  const matched = observed
    .filter((signature) => policy.suspendedSignatureIds.includes(signature.signatureId))
    .map((signature) => signature.signatureId);
  if (matched.length === 0) {
    return { kind: 'CONTINUE', detail: 'no abuse signature matched the containment policy — work proceeds' };
  }
  return {
    kind: 'SUSPEND_PENDING_ASK',
    matchedSignatureIds: matched,
    detail: `abuse signatures matched (${matched.join(', ')}) — the task is suspended pending ASK (observed evidence, never silent termination)`,
  };
}

/**
 * Record the suspension: a typed, durable, OBSERVED record with the
 * matched signatures and the ASK deduplication key. The task state
 * survives (recoverable); the human ASK decides resume vs terminate.
 */
export function suspendTask(
  taskId: string,
  missionId: string | null,
  bodyId: string | null,
  decision: ContainmentDecision,
  now: Timestamp,
): TaskSuspensionRecord {
  if (decision.kind !== 'SUSPEND_PENDING_ASK') {
    throw new AbusePolicyError('suspendTask records a SUSPEND_PENDING_ASK decision (a CONTINUE decision suspends nothing)');
  }
  if (typeof taskId !== 'string' || taskId.length === 0) {
    throw new AbusePolicyError('taskId must be a non-empty string');
  }
  return {
    taskId,
    missionId,
    bodyId,
    reason: 'ABUSE_SIGNATURES',
    matchedSignatureIds: decision.matchedSignatureIds,
    suspendedAt: now,
    pendingAsk: true,
    askDeduplicationKey: `abuse-containment:${taskId}`,
    detail: decision.detail,
  };
}
