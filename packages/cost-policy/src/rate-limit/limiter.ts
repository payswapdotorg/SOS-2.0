/**
 * Rate limiting (Work Order P14): typed limit policies over action and
 * executor invocations, building on the P2 typed-outcome discipline
 * (typed decisions, injected clocks, deterministic retry hints — the
 * same timeout/backoff vocabulary the merged live API error envelopes
 * use: a LIMITED caller receives a computed retry-after, never a bare
 * denial).
 *
 * The deterministic reference limiter is a FIXED-WINDOW counter anchored
 * deterministically at window boundaries (floor(now/windowMs)) — no
 * hidden clocks, no drift, fully offline-testable. Real distributed
 * limiters (Upstash-backed, per the P3 tier-prefixed rate-limit
 * namespace convention) attach later as adapters behind the same typed
 * decision; they remain coordination mechanisms, never semantic
 * authorities (§13).
 *
 * Determinism: pure evaluation + injected clock; no ambient anything.
 */

import { RateLimitPolicyError } from '../errors.js';
import type { Timestamp } from '../types.js';

/** One typed rate-limit policy (per subject key). */
export interface RateLimitPolicy {
  /** The policy identity, e.g. "action-gateway:executor-invocations". */
  readonly policyId: string;
  /** Window length in milliseconds (positive integer). */
  readonly windowMs: number;
  /** Max operations per window (positive integer). */
  readonly maxOperations: number;
}

/** The typed decision. */
export type RateLimitDecision =
  | { readonly kind: 'ALLOW'; readonly remaining: number }
  | {
      readonly kind: 'RATE_LIMITED';
      readonly retryAfterMs: number;
      readonly windowEndsAt: Timestamp;
      readonly detail: string;
    };

/** Validate a rate-limit policy (typed rejection of malformed policies). */
export function assertValidRateLimitPolicy(policy: RateLimitPolicy): void {
  const problems: string[] = [];
  if (typeof policy.policyId !== 'string' || policy.policyId.length === 0) problems.push('policyId');
  if (typeof policy.windowMs !== 'number' || !Number.isInteger(policy.windowMs) || policy.windowMs <= 0) {
    problems.push('windowMs');
  }
  if (typeof policy.maxOperations !== 'number' || !Number.isInteger(policy.maxOperations) || policy.maxOperations <= 0) {
    problems.push('maxOperations');
  }
  if (problems.length > 0) {
    throw new RateLimitPolicyError(`malformed rate-limit policy (fields: ${problems.join(', ')})`);
  }
}

/** The deterministic window an instant falls into (window start). */
export function windowStartFor(now: Timestamp, windowMs: number): Timestamp {
  return Math.floor(now / windowMs) * windowMs;
}

/**
 * Pure evaluation: given the operation timestamps already recorded for
 * the CURRENT window and a policy, decide one more operation.
 */
export function evaluateRateLimit(
  policy: RateLimitPolicy,
  recordedInWindow: readonly Timestamp[],
  now: Timestamp,
): RateLimitDecision {
  assertValidRateLimitPolicy(policy);
  const windowStart = windowStartFor(now, policy.windowMs);
  const windowEnd = windowStart + policy.windowMs;
  const inWindow = recordedInWindow.filter((at) => at >= windowStart && at < windowEnd);
  if (inWindow.length + 1 <= policy.maxOperations) {
    return { kind: 'ALLOW', remaining: policy.maxOperations - inWindow.length - 1 };
  }
  return {
    kind: 'RATE_LIMITED',
    retryAfterMs: windowEnd - now,
    windowEndsAt: windowEnd,
    detail: `rate limit ${policy.policyId} reached: ${inWindow.length} operations in the current window, limit ${policy.maxOperations} — retry after ${windowEnd - now}ms (the limit is a typed outcome, never a silent drop)`,
  };
}

/**
 * The deterministic reference limiter: a fixed-window counter per
 * subject, stamped by the INJECTED clock. Stateful but deterministic;
 * used by tests and local development. Distributed deployments wire the
 * same contract onto the coordination store (never canonical).
 */
export class DeterministicRateLimiter {
  private readonly policy: RateLimitPolicy;
  private readonly operations: Timestamp[] = [];

  constructor(policy: RateLimitPolicy) {
    assertValidRateLimitPolicy(policy);
    this.policy = policy;
  }

  /** Decide (and, when allowed, record) one operation at `now`. */
  check(now: Timestamp): RateLimitDecision {
    const decision = evaluateRateLimit(this.policy, this.operations, now);
    if (decision.kind === 'ALLOW') {
      this.operations.push(now);
    }
    return decision;
  }

  /** Read-only view of the recorded operation instants. */
  recorded(): readonly Timestamp[] {
    return [...this.operations];
  }
}
