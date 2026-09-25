/**
 * LANE C, NEGATIVE CASE 15 — BUDGET EXHAUSTION (the P14 cost policy:
 * work degrades honestly — typed budget-exhaustion state, no
 * fabricated completion).
 *
 * The fault: a task's budget is exhausted (concurrency, cost units or
 * duration) — or the accounting itself is incomplete. The budget
 * policy DENIES with the typed BUDGET_EXCEEDED record (naming the
 * counter + limit — no 11th-hour fabrication); incomplete accounting
 * is the honest ACCOUNTING_UNKNOWN (never a silently guessed
 * allowance); the denial is RECORDED (audit trail) and the cost ledger
 * keeps its evidence-only discipline; and the exhausted task is NEVER
 * completed — its durable state stays truthful (no final verification,
 * no fabricated success). Never a silent pass, never a crash.
 */

import { describe, expect, test } from 'vitest';
import { evaluateBudget } from '@sos-2/cost-policy';
import type { TaskBudgetRecord } from '@sos-2/cost-policy';
import { InMemoryAuditTrail, auditDecision } from '@sos-2/security';
import { formatRfc3339 } from '@sos-2/live-store';
import { PolicyManualClock, RESILIENCE_FIRST_BODY, createResilienceWorld, seedResilienceWorld, startResilienceTask } from './helpers.js';

const NOW = 1_000_000;

function budget(overrides: Partial<TaskBudgetRecord> = {}): TaskBudgetRecord {
  return {
    taskId: 'task-p15c-15',
    missionId: 'mission-p15c-15',
    limits: { maxConcurrentTasks: 3, maxCostUnits: 100, maxDurationMs: 60_000 },
    consumed: { concurrentTasks: 1, costUnits: 10, startedAt: NOW - 5_000 },
    ...overrides,
  };
}

describe('P15 lane C negative case: budget exhaustion', () => {
  test('CONTAINED: an exhausted concurrency budget is a typed BUDGET_EXCEEDED denial (no 11th-hour fabrication)', () => {
    const decision = evaluateBudget(
      budget({ consumed: { concurrentTasks: 3, costUnits: 10, startedAt: NOW - 5_000 } }),
      NOW,
    );
    expect(decision.kind).toBe('BUDGET_EXCEEDED');
    if (decision.kind === 'BUDGET_EXCEEDED') {
      expect(decision.counter).toBe('concurrentTasks');
      expect(decision.limit).toBe(3);
      expect(decision.detail.length).toBeGreaterThan(0);
    }
  });

  test('CONTAINED: exhausted COST UNITS and DURATION are typed denials too (every counter fails closed)', () => {
    const costDecision = evaluateBudget(
      budget({ consumed: { concurrentTasks: 1, costUnits: 100, startedAt: NOW - 5_000 } }),
      NOW,
    );
    expect(costDecision.kind).toBe('BUDGET_EXCEEDED');
    if (costDecision.kind === 'BUDGET_EXCEEDED') {
      expect(costDecision.counter).toBe('costUnits');
    }
    const durationDecision = evaluateBudget(
      budget({
        limits: { maxConcurrentTasks: 3, maxCostUnits: 100, maxDurationMs: 10_000 },
        consumed: { concurrentTasks: 1, costUnits: 0, startedAt: NOW - 20_000 },
      }),
      NOW,
    );
    expect(durationDecision.kind).toBe('BUDGET_EXCEEDED');
    if (durationDecision.kind === 'BUDGET_EXCEEDED') {
      expect(durationDecision.counter).toBe('elapsedMs');
    }
  });

  test('HONEST: incomplete accounting is ACCOUNTING_UNKNOWN — never a silently guessed allowance', () => {
    const decision = evaluateBudget(
      budget({ consumed: { concurrentTasks: 1, costUnits: null, startedAt: NOW - 5_000 } }),
      NOW,
    );
    expect(decision.kind).toBe('ACCOUNTING_UNKNOWN');
    if (decision.kind === 'ACCOUNTING_UNKNOWN') {
      expect(decision.reason).toContain('incomplete');
      expect(decision.detail).toContain('never a guessed allowance');
    }
  });

  test('RECORDED: the exhaustion denial lands in the policy audit trail (the evidence of the stop)', () => {
    const decision = evaluateBudget(
      budget({ consumed: { concurrentTasks: 3, costUnits: 10, startedAt: NOW - 5_000 } }),
      NOW,
    );
    expect(decision.kind).toBe('BUDGET_EXCEEDED');
    const clock = new PolicyManualClock(NOW);
    const trail = new InMemoryAuditTrail(clock);
    const audited = auditDecision(
      trail,
      {
        decision: 'DENY',
        surface: 'budget',
        detail: decision.kind === 'BUDGET_EXCEEDED' ? decision.detail : 'budget exhausted',
        taskId: 'task-p15c-15',
        bodyId: null,
        providerId: null,
        evidenceDigest: null,
        context: { counter: 'concurrentTasks', limit: 3 },
      },
      clock,
    );
    expect(audited.kind).toBe('APPLIED');
    const first = trail.history()[0]!;
    expect((first.payload as Record<string, unknown>)['decision']).toBe('DENY');
    // The trail stays queryable and truthful.
    expect(first.source).toBe('security-audit:budget');
  });

  test('NO FABRICATED COMPLETION: the task a budget denial stops stays truthfully un-completed (durable state, cost evidence)', async () => {
    const world = createResilienceWorld();
    await seedResilienceWorld(world);
    const started = await startResilienceTask(world, 'task-p15c-15-exhausted');
    expect(started.status).toBe('STARTED');
    world.beats.beat(RESILIENCE_FIRST_BODY, world.clock.nowEpochMs());
    // The task runs PART way (a mid-run budget stop — interrupt models the
    // point the budget policy halts further work).
    const halted = await world.runtime.runProgram('task-p15c-15-exhausted', { interrupt: (index) => (index === 4 ? 'KILL' : 'CONTINUE') });
    expect(halted.stop_reason).toBe('INTERRUPTED');

    // The budget policy then DENIES further work for this task (typed).
    const decision = evaluateBudget(
      budget({
        taskId: 'task-p15c-15-exhausted',
        consumed: { concurrentTasks: 3, costUnits: 90, startedAt: NOW },
      }),
      NOW + 1_000,
    );
    expect(decision.kind).toBe('BUDGET_EXCEEDED');

    // The cost ledger keeps its EVIDENCE-ONLY discipline: episodes append,
    // they never gate silently and never vanish.
    const episode = await world.cost.append('task-p15c-15-exhausted', 'RETRY_SCHEDULED', {
      note: 'budget-exhaustion stop recorded as cost evidence',
      denied_by: 'budget-policy',
      at: formatRfc3339(world.clock.nowEpochMs()),
    });
    expect(episode.kind).toBe('RETRY_SCHEDULED');

    // The durable truth: the halted task is NOT completed — no final
    // verification exists, no fabricated success.
    const record = await world.store.tasks.get('task-p15c-15-exhausted');
    expect(record).toBeDefined();
    expect(record!.status).not.toBe('COMPLETED');
    expect(record!.final_verification).toBeNull();
  });

  test('the CONTROL: a task inside every limit is allowed (bounded execution works, not just denies)', () => {
    expect(evaluateBudget(budget(), NOW).kind).toBe('ALLOW');
  });
});
