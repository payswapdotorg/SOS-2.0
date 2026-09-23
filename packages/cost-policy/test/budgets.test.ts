// No vitest import: the borrowed toolchain runs with `globals: true`.
import {
  evaluateBudget,
  assertValidTaskBudgetRecord,
  BudgetPolicyError,
  type TaskBudgetRecord,
} from '../src/index.js';

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

describe('task budgets (pinned: bounded execution cost)', () => {
  it('allows a request within every limit', () => {
    const decision = evaluateBudget(budget(), NOW);
    expect(decision.kind).toBe('ALLOW');
    if (decision.kind === 'ALLOW') {
      expect(decision.detail).toContain('within budget');
    }
  });

  it('PINNED: budget exceeded is a typed denial naming counter and limit (no 11th-hour fabrication)', () => {
    const decision = evaluateBudget(budget({ consumed: { concurrentTasks: 3, costUnits: 10, startedAt: NOW - 5_000 } }), NOW);
    expect(decision.kind).toBe('BUDGET_EXCEEDED');
    if (decision.kind === 'BUDGET_EXCEEDED') {
      expect(decision.counter).toBe('concurrentTasks');
      expect(decision.limit).toBe(3);
      expect(decision.consumed).toBe(3);
      expect(decision.detail).toContain('denied');
    }
  });

  it('cost exhaustion is a typed denial with exact numbers', () => {
    const decision = evaluateBudget(budget({ consumed: { concurrentTasks: 0, costUnits: 99, startedAt: NOW - 5_000 } }), NOW, 2);
    expect(decision.kind).toBe('BUDGET_EXCEEDED');
    if (decision.kind === 'BUDGET_EXCEEDED') {
      expect(decision.counter).toBe('costUnits');
      expect(decision.consumed).toBe(99);
      expect(decision.limit).toBe(100);
    }
  });

  it('duration exhaustion is a typed denial (task must checkpoint and stop)', () => {
    const decision = evaluateBudget(
      budget({ limits: { maxConcurrentTasks: 3, maxCostUnits: 100, maxDurationMs: 10_000 }, consumed: { concurrentTasks: 1, costUnits: 0, startedAt: NOW - 20_000 } }),
      NOW,
    );
    expect(decision.kind).toBe('BUDGET_EXCEEDED');
    if (decision.kind === 'BUDGET_EXCEEDED') {
      expect(decision.counter).toBe('elapsedMs');
      expect(decision.detail).toContain('checkpoint');
    }
  });

  it('PINNED: incomplete accounting is honest ACCOUNTING_UNKNOWN — never a guessed allowance', () => {
    const unknownCost = evaluateBudget(
      budget({ consumed: { concurrentTasks: 1, costUnits: null, startedAt: NOW - 5_000 } }),
      NOW,
    );
    expect(unknownCost.kind).toBe('ACCOUNTING_UNKNOWN');
    if (unknownCost.kind === 'ACCOUNTING_UNKNOWN') {
      expect(unknownCost.reason).toContain('cost accounting is incomplete');
      expect(unknownCost.detail).toContain('never a guessed allowance');
    }

    const unknownStart = evaluateBudget(
      budget({ consumed: { concurrentTasks: 1, costUnits: 10, startedAt: null } }),
      NOW,
    );
    expect(unknownStart.kind).toBe('ACCOUNTING_UNKNOWN');
    if (unknownStart.kind === 'ACCOUNTING_UNKNOWN') {
      expect(unknownStart.reason).toContain('start instant is unknown');
    }

    const unknownConcurrency = evaluateBudget(
      budget({ consumed: { concurrentTasks: null, costUnits: 10, startedAt: NOW - 5_000 } }),
      NOW,
    );
    expect(unknownConcurrency.kind).toBe('ACCOUNTING_UNKNOWN');
  });

  it('unbounded duration with unknown start remains decidable (no duration check)', () => {
    const decision = evaluateBudget(
      budget({ limits: { maxConcurrentTasks: 3, maxCostUnits: 100, maxDurationMs: null }, consumed: { concurrentTasks: 1, costUnits: 10, startedAt: null } }),
      NOW,
    );
    expect(decision.kind).toBe('ALLOW');
  });

  it('malformed records are typed rejections (never granted)', () => {
    expect(() => assertValidTaskBudgetRecord(budget({ limits: { maxConcurrentTasks: 0, maxCostUnits: 100, maxDurationMs: null } }))).toThrow(BudgetPolicyError);
    expect(() => assertValidTaskBudgetRecord(budget({ taskId: '' }))).toThrow(BudgetPolicyError);
    expect(() =>
      evaluateBudget(budget({ consumed: { concurrentTasks: -1, costUnits: 10, startedAt: null } }), NOW),
    ).toThrow(BudgetPolicyError);
    expect(() => evaluateBudget(budget(), NOW, 0)).toThrow(BudgetPolicyError);
  });
});
