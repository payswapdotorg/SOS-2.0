// No vitest import: the borrowed toolchain runs with `globals: true`.
import {
  DeterministicRateLimiter,
  evaluateRateLimit,
  windowStartFor,
  assertValidRateLimitPolicy,
  RateLimitPolicyError,
  type RateLimitPolicy,
} from '../src/index.js';

const POLICY: RateLimitPolicy = { policyId: 'action-gateway:executor-invocations', windowMs: 1_000, maxOperations: 3 };

describe('rate limiting (typed limit policies, deterministic reference limiter)', () => {
  it('window anchoring is deterministic (floor boundaries)', () => {
    expect(windowStartFor(1_500, 1_000)).toBe(1_000);
    expect(windowStartFor(1_999, 1_000)).toBe(1_000);
    expect(windowStartFor(2_000, 1_000)).toBe(2_000);
    expect(windowStartFor(0, 1_000)).toBe(0);
  });

  it('allows operations up to the limit within one window', () => {
    const decision = evaluateRateLimit(POLICY, [1_000, 1_200], 1_600);
    expect(decision.kind).toBe('ALLOW');
    if (decision.kind === 'ALLOW') {
      expect(decision.remaining).toBe(0); // 2 used + this one = 3 of 3
    }
  });

  it('limits with a computed retry-after (typed outcome, never a silent drop)', () => {
    const decision = evaluateRateLimit(POLICY, [1_000, 1_200, 1_400], 1_800);
    expect(decision.kind).toBe('RATE_LIMITED');
    if (decision.kind === 'RATE_LIMITED') {
      expect(decision.retryAfterMs).toBe(200);
      expect(decision.windowEndsAt).toBe(2_000);
      expect(decision.detail).toContain('retry after 200ms');
    }
  });

  it('a new window resets the allowance (operations from prior windows do not count)', () => {
    const decision = evaluateRateLimit(POLICY, [900, 950, 999], 1_050);
    expect(decision.kind).toBe('ALLOW');
  });

  it('the reference limiter records only allowed operations (inject-clock driven)', () => {
    const limiter = new DeterministicRateLimiter(POLICY);
    expect(limiter.check(1_000).kind).toBe('ALLOW');
    expect(limiter.check(1_100).kind).toBe('ALLOW');
    expect(limiter.check(1_200).kind).toBe('ALLOW');
    const limited = limiter.check(1_300);
    expect(limited.kind).toBe('RATE_LIMITED');
    expect(limiter.recorded()).toEqual([1_000, 1_100, 1_200]); // limited call NOT recorded
    const next = limiter.check(2_050); // new window
    expect(next.kind).toBe('ALLOW');
  });

  it('malformed policies are typed rejections', () => {
    expect(() => assertValidRateLimitPolicy({ policyId: '', windowMs: 1_000, maxOperations: 1 })).toThrow(RateLimitPolicyError);
    expect(() => assertValidRateLimitPolicy({ policyId: 'p', windowMs: 0, maxOperations: 1 })).toThrow(RateLimitPolicyError);
    expect(() => assertValidRateLimitPolicy({ policyId: 'p', windowMs: 1_000, maxOperations: 0 })).toThrow(RateLimitPolicyError);
    expect(() => evaluateRateLimit({ policyId: 'p', windowMs: -1, maxOperations: 1 }, [], 0)).toThrow(RateLimitPolicyError);
  });
});
