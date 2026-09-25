/**
 * PINNED: bounded execution cost — budget exceeded is a typed denial
 * (no 11th-hour fabrication); incomplete accounting is honest
 * ACCOUNTING_UNKNOWN (never silently guessed); rate limits are typed
 * with computed retry-after.
 */
import { describe, expect, it } from 'vitest';
import { evaluateBudget, DeterministicRateLimiter, type TaskBudgetRecord } from '@sos-2/cost-policy';
import { InMemoryAuditTrail, auditDecision } from '@sos-2/security';
import { ManualClock } from './helpers.js';

const NOW = 1_000_000;

function budget(overrides: Partial<TaskBudgetRecord> = {}): TaskBudgetRecord {
  return {
    taskId: 'task-1',
    missionId: 'mission-1',
    limits: { maxConcurrentTasks: 3, maxCostUnits: 100, maxDurationMs: 60_000 },
    consumed: { concurrentTasks: 1, costUnits: 10, startedAt: NOW - 5_000 },
    ...overrides,
  };
}

describe('acceptance: bounded execution cost', () => {
  it('PINNED: budget exceeded is a typed BUDGET_EXCEEDED denial — no 11th-hour fabrication', () => {
    const decision = evaluateBudget(
      budget({ consumed: { concurrentTasks: 3, costUnits: 10, startedAt: NOW - 5_000 } }),
      NOW,
    );
    expect(decision.kind).toBe('BUDGET_EXCEEDED');
    if (decision.kind === 'BUDGET_EXCEEDED') {
      expect(decision.counter).toBe('concurrentTasks');
      expect(decision.limit).toBe(3);
      // the denial is auditable:
      const trail = new InMemoryAuditTrail(new ManualClock(NOW));
      const audited = auditDecision(
        trail,
        {
          decision: 'DENY',
          surface: 'budget',
          detail: decision.detail,
          taskId: decision.taskId,
          bodyId: null,
          providerId: null,
          evidenceDigest: null,
          context: { counter: decision.counter, limit: decision.limit },
        },
        new ManualClock(NOW),
      );
      expect(audited.kind).toBe('APPLIED');
    }
  });

  it('PINNED: incomplete accounting is honest ACCOUNTING_UNKNOWN — never a guessed allowance', () => {
    const decision = evaluateBudget(budget({ consumed: { concurrentTasks: 1, costUnits: null, startedAt: NOW - 5_000 } }), NOW);
    expect(decision.kind).toBe('ACCOUNTING_UNKNOWN');
    if (decision.kind === 'ACCOUNTING_UNKNOWN') {
      expect(decision.reason).toContain('incomplete');
      expect(decision.detail).toContain('never a guessed allowance');
    }
  });

  it('a task inside every limit is allowed (bounded execution works, not just denies)', () => {
    expect(evaluateBudget(budget(), NOW).kind).toBe('ALLOW');
  });

  it('duration exhaustion forces a checkpoint-and-stop outcome', () => {
    const decision = evaluateBudget(
      budget({ limits: { maxConcurrentTasks: 3, maxCostUnits: 100, maxDurationMs: 10_000 }, consumed: { concurrentTasks: 1, costUnits: 0, startedAt: NOW - 20_000 } }),
      NOW,
    );
    expect(decision.kind).toBe('BUDGET_EXCEEDED');
    if (decision.kind === 'BUDGET_EXCEEDED') {
      expect(decision.counter).toBe('elapsedMs');
    }
  });

  it('rate limiting: typed LIMITED outcomes with computed retry-after; the limiter never silently drops', () => {
    const limiter = new DeterministicRateLimiter({ policyId: 'executor:invoke', windowMs: 1_000, maxOperations: 2 });
    expect(limiter.check(1_000).kind).toBe('ALLOW');
    expect(limiter.check(1_500).kind).toBe('ALLOW');
    const limited = limiter.check(1_800);
    expect(limited.kind).toBe('RATE_LIMITED');
    if (limited.kind === 'RATE_LIMITED') {
      expect(limited.retryAfterMs).toBe(200);
      expect(limited.windowEndsAt).toBe(2_000);
    }
    // after the window, the allowance returns:
    expect(limiter.check(2_100).kind).toBe('ALLOW');
  });
});
