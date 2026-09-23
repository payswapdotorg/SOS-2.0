/**
 * Task concurrency/cost budgets (Work Order P14).
 *
 * Typed budget records per task/mission; enforcement decisions are
 * TYPED and honest:
 *
 *   ALLOW              the request fits inside every declared limit;
 *   BUDGET_EXCEEDED    a hard, typed denial naming the counter and the
 *                      limit — there is no 11th-hour fabrication, no
 *                      grace budget, no silent continuation;
 *   ACCOUNTING_UNKNOWN the accounting for at least one bounded counter
 *                      is INCOMPLETE — the decision is UNKNOWN, never
 *                      a guessed ALLOW (§13: never silently guessed).
 *
 * Incomplete accounting is REPRESENTABLE (null consumption entries) and
 * answered honestly; MALFORMED records (wrong types, negative usage,
 * non-positive limits) are typed rejections — never granted, never
 * guessed.
 *
 * The consumed ledger is INJECTED DATA (deterministic accounting); real
 * cost feeds (provider billing, metered usage) attach later as
 * adapters behind the same typed decision.
 *
 * Determinism: pure functions over injected records + clock; no ambient
 * anything.
 */

import { BudgetPolicyError } from '../errors.js';
import type { Timestamp } from '../types.js';

/** The budget counters (concurrency, cumulative cost, elapsed time). */
export const BUDGET_COUNTERS = ['concurrentTasks', 'costUnits', 'elapsedMs'] as const;
export type BudgetCounter = (typeof BUDGET_COUNTERS)[number];

/** Declared limits (positive integers; duration may be null = unbounded). */
export interface BudgetLimits {
  /** Max simultaneously running tasks for the mission. */
  readonly maxConcurrentTasks: number;
  /** Max cumulative cost units (the injected cost accounting unit). */
  readonly maxCostUnits: number;
  /** Max wall-clock duration per task, or null when unbounded. */
  readonly maxDurationMs: number | null;
}

/**
 * What has been consumed so far — INJECTED accounting data. A null entry
 * means the accounting for that counter is INCOMPLETE (the decision
 * will be ACCOUNTING_UNKNOWN — never a guess).
 */
export interface BudgetConsumption {
  readonly concurrentTasks: number | null;
  readonly costUnits: number | null;
  /** Task start (injected-clock comparable); required to evaluate duration. */
  readonly startedAt: Timestamp | null;
}

/** One task/mission budget record (typed, durable — §6 cost records). */
export interface TaskBudgetRecord {
  readonly taskId: string;
  readonly missionId: string | null;
  readonly limits: BudgetLimits;
  readonly consumed: BudgetConsumption;
}

/** The typed enforcement decision. */
export type BudgetDecision =
  | {
      readonly kind: 'ALLOW';
      readonly taskId: string;
      readonly detail: string;
    }
  | {
      readonly kind: 'BUDGET_EXCEEDED';
      readonly taskId: string;
      readonly counter: BudgetCounter;
      readonly limit: number;
      readonly consumed: number;
      readonly detail: string;
    }
  | {
      readonly kind: 'ACCOUNTING_UNKNOWN';
      readonly taskId: string;
      readonly reason: string;
      readonly detail: string;
    };

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isNonNegativeFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/** Validate a budget record's SHAPE (typed rejection of malformed records). */
export function assertValidTaskBudgetRecord(value: TaskBudgetRecord): void {
  const problems: string[] = [];
  if (typeof value.taskId !== 'string' || value.taskId.length === 0) problems.push('taskId');
  if (value.missionId !== null && (typeof value.missionId !== 'string' || value.missionId.length === 0)) {
    problems.push('missionId');
  }
  const { limits, consumed } = value;
  if (!isPositiveInteger(limits.maxConcurrentTasks)) problems.push('limits.maxConcurrentTasks');
  if (!isPositiveInteger(limits.maxCostUnits)) problems.push('limits.maxCostUnits');
  if (limits.maxDurationMs !== null && !isPositiveInteger(limits.maxDurationMs)) problems.push('limits.maxDurationMs');
  if (consumed.concurrentTasks !== null && !isNonNegativeFinite(consumed.concurrentTasks)) {
    problems.push('consumed.concurrentTasks');
  }
  if (consumed.costUnits !== null && !isNonNegativeFinite(consumed.costUnits)) {
    problems.push('consumed.costUnits');
  }
  if (consumed.startedAt !== null && (typeof consumed.startedAt !== 'number' || !Number.isFinite(consumed.startedAt))) {
    problems.push('consumed.startedAt');
  }
  if (problems.length > 0) {
    throw new BudgetPolicyError(`malformed task budget record (fields: ${problems.join(', ')}) — malformed is never granted`);
  }
}

/**
 * Evaluate a task budget at the injected instant.
 *
 * The concurrency check answers: may ONE MORE task run under these
 * limits (consumed + 1 <= max)? The cost check answers: may the
 * requested units be consumed? Incomplete accounting on any bounded
 * counter is ACCOUNTING_UNKNOWN — never guessed, never silently
 * allowed.
 */
export function evaluateBudget(record: TaskBudgetRecord, now: Timestamp, requestedCostUnits: number = 1): BudgetDecision {
  assertValidTaskBudgetRecord(record);
  if (typeof requestedCostUnits !== 'number' || !Number.isFinite(requestedCostUnits) || requestedCostUnits <= 0) {
    throw new BudgetPolicyError(`requested cost units must be a positive finite number, received: ${String(requestedCostUnits)}`);
  }

  if (record.consumed.concurrentTasks === null) {
    return unknownDecision(record, 'concurrency accounting is incomplete');
  }
  if (record.consumed.costUnits === null) {
    return unknownDecision(record, 'cost accounting is incomplete');
  }
  if (record.limits.maxDurationMs !== null && record.consumed.startedAt === null) {
    return unknownDecision(record, 'duration is bounded but the task start instant is unknown');
  }

  if (record.consumed.concurrentTasks + 1 > record.limits.maxConcurrentTasks) {
    return {
      kind: 'BUDGET_EXCEEDED',
      taskId: record.taskId,
      counter: 'concurrentTasks',
      limit: record.limits.maxConcurrentTasks,
      consumed: record.consumed.concurrentTasks,
      detail: `mission concurrency cap reached: ${record.consumed.concurrentTasks} running, limit ${record.limits.maxConcurrentTasks} — the request is denied (no 11th-hour fabrication)`,
    };
  }
  if (record.consumed.costUnits + requestedCostUnits > record.limits.maxCostUnits) {
    return {
      kind: 'BUDGET_EXCEEDED',
      taskId: record.taskId,
      counter: 'costUnits',
      limit: record.limits.maxCostUnits,
      consumed: record.consumed.costUnits,
      detail: `task ${record.taskId} would exceed the cost budget: consumed ${record.consumed.costUnits}, requesting ${requestedCostUnits}, limit ${record.limits.maxCostUnits} — the request is denied`,
    };
  }
  if (record.limits.maxDurationMs !== null && record.consumed.startedAt !== null) {
    const elapsed = now - record.consumed.startedAt;
    if (elapsed > record.limits.maxDurationMs) {
      return {
        kind: 'BUDGET_EXCEEDED',
        taskId: record.taskId,
        counter: 'elapsedMs',
        limit: record.limits.maxDurationMs,
        consumed: elapsed,
        detail: `task ${record.taskId} exceeded its duration budget: ${elapsed}ms elapsed, limit ${record.limits.maxDurationMs}ms — the task must checkpoint and stop`,
      };
    }
  }
  return {
    kind: 'ALLOW',
    taskId: record.taskId,
    detail: `within budget (concurrency ${record.consumed.concurrentTasks + 1}/${record.limits.maxConcurrentTasks}, cost ${record.consumed.costUnits + requestedCostUnits}/${record.limits.maxCostUnits})`,
  };
}

function unknownDecision(record: TaskBudgetRecord, reason: string): BudgetDecision {
  return {
    kind: 'ACCOUNTING_UNKNOWN',
    taskId: record.taskId,
    reason,
    detail: `budget accounting for task ${record.taskId} is incomplete (${reason}) — the decision is honestly UNKNOWN, never a guessed allowance`,
  };
}
