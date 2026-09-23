// No vitest import: the borrowed toolchain runs with `globals: true`.
import {
  initialDeadLetterState,
  recordFailure,
  evaluateRetry,
  nextBackoffDelayMs,
  escalateToAsk,
  assertBoundedRetryPolicy,
  RetryPolicyError,
  type RetryBackoffPolicy,
} from '../src/index.js';

const POLICY: RetryBackoffPolicy = { maxAttempts: 3, backoffBaseMs: 100, backoffMaxMs: 1_000 };
const NOW = 1_000_000;

describe('dead-letter/retry handling (bounded retry then ASK; never silent drop)', () => {
  it('unbounded policies are unrepresentable (typed rejections)', () => {
    expect(() => assertBoundedRetryPolicy({ maxAttempts: 0, backoffBaseMs: 100, backoffMaxMs: 1_000 })).toThrow(RetryPolicyError);
    expect(() => assertBoundedRetryPolicy({ maxAttempts: 3, backoffBaseMs: 0, backoffMaxMs: 1_000 })).toThrow(RetryPolicyError);
    expect(() => assertBoundedRetryPolicy({ maxAttempts: 3, backoffBaseMs: 100, backoffMaxMs: 50 })).toThrow(RetryPolicyError);
  });

  it('backoff is exponential and CAPPED (deterministic schedule)', () => {
    expect(nextBackoffDelayMs(1, POLICY)).toBe(100);
    expect(nextBackoffDelayMs(2, POLICY)).toBe(200);
    expect(nextBackoffDelayMs(3, POLICY)).toBe(400);
    expect(nextBackoffDelayMs(4, POLICY)).toBe(800);
    expect(nextBackoffDelayMs(5, POLICY)).toBe(1_000); // capped: 1600 -> 1000
    expect(nextBackoffDelayMs(50, POLICY)).toBe(1_000);
  });

  it('PINNED: retryable failures retry with bounded backoff until attempts exhaust', () => {
    let state = initialDeadLetterState('task-1', 'mission-1', 'executor:invoke');
    state = recordFailure(state, 'BODY_CRASH', NOW);
    let decision = evaluateRetry(state, POLICY, true, NOW);
    expect(decision.kind).toBe('RETRY');
    if (decision.kind === 'RETRY') {
      expect(decision.attempt).toBe(2);
      expect(decision.delayMs).toBe(200);
      expect(decision.nextAttemptAt).toBe(NOW + 200);
    }
    state = recordFailure(state, 'PROVIDER_TIMEOUT', NOW + 200);
    decision = evaluateRetry(state, POLICY, true, NOW + 200);
    expect(decision.kind === 'RETRY' && decision.delayMs).toBe(400);
    state = recordFailure(state, 'PROVIDER_TIMEOUT', NOW + 600);
    decision = evaluateRetry(state, POLICY, true, NOW + 600);
    // attempts now == maxAttempts (3) -> escalate
    expect(decision.kind).toBe('ESCALATE_ASK');
    if (decision.kind === 'ESCALATE_ASK') {
      expect(decision.reason).toBe('RETRIES_EXHAUSTED');
      expect(decision.detail).toContain('never an infinite loop');
    }
  });

  it('PINNED: non-retryable errors escalate to ASK immediately (never retried, never silently dropped)', () => {
    const state = recordFailure(initialDeadLetterState('task-2', null, 'action:commit'), 'CONTRACT_VIOLATION', NOW);
    const decision = evaluateRetry(state, POLICY, false, NOW);
    expect(decision.kind).toBe('ESCALATE_ASK');
    if (decision.kind === 'ESCALATE_ASK') {
      expect(decision.reason).toBe('NON_RETRYABLE');
      expect(decision.detail).toContain('never silently dropped');
    }
  });

  it('every failure advances the durable dead-letter state (§6 recovery data survives body replacement)', () => {
    let state = initialDeadLetterState('task-3', 'mission-2', 'body:lease');
    expect(state.attempts).toBe(0);
    expect(state.status).toBe('RETRYING');
    state = recordFailure(state, 'BODY_CRASH', NOW);
    state = recordFailure(state, 'BODY_CRASH', NOW + 1_000);
    expect(state.attempts).toBe(2);
    expect(state.lastErrorType).toBe('BODY_CRASH');
    expect(state.lastFailedAt).toBe(NOW + 1_000);
    expect(state.taskId).toBe('task-3'); // identity survives
  });

  it('the ASK escalation is a first-class record with a deduplication key and provenance', () => {
    const state = recordFailure(initialDeadLetterState('task-4', null, 'executor:invoke'), 'RETRIES_EXHAUSTED', NOW);
    const escalation = escalateToAsk(state, 'RETRIES_EXHAUSTED', 'bounded retries exhausted', NOW);
    expect(escalation.taskId).toBe('task-4');
    expect(escalation.reason).toBe('RETRIES_EXHAUSTED');
    expect(escalation.raisedAt).toBe(NOW);
    expect(escalation.deduplicationKey).toBe('dead-letter:task-4:RETRIES_EXHAUSTED');
    expect(escalation.provenance.length).toBeGreaterThan(0);
    // The same task + reason escalates identically (dedup):
    const again = escalateToAsk(state, 'RETRIES_EXHAUSTED', 'bounded retries exhausted', NOW + 5_000);
    expect(again.deduplicationKey).toBe(escalation.deduplicationKey);
  });
});
