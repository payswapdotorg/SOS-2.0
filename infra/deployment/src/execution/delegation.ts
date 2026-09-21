/**
 * Long-running work delegation contract (Work Order P3).
 *
 * The encoded rule (docs/deployment/free-tier-plan.md):
 * Vercel request lifetime must NEVER own long-running autonomous work.
 * Durable tasks are delegated to an external worker/body provider; the
 * web/API tier only records task intent, reads state and reports progress.
 * Cloud/remote bodies keep working while the user's computer is off;
 * user-device bodies queue durably until the local companion reconnects.
 *
 * This module provides:
 *   - the documented rule as a machine-checkable contract record;
 *   - a deterministic policy function (delegationDecision) classifying
 *     workloads to a target runtime;
 *   - the boundary gate (assertDelegationBoundary) that TYPE-REJECTS a
 *     task configuration which targets the web request runtime for
 *     long-running execution.
 *
 * Pure functions; no process.env, no network, no clock, no imports from
 * packages/* (structural isolation pinned by tests).
 */

import { DelegationBoundaryError } from '../core/types.ts';
import {
  VERCEL_HOBBY_HARD_CAP_MS,
  VERCEL_HOBBY_REQUEST_BUDGET_MS,
  assertValidRequestLifetimeBudget,
} from '../providers/vercel.ts';

/** Workload classes. */
export type WorkloadClass = 'request-scoped' | 'durable-long-running';

/** Where work may run. */
export type DelegationTargetRuntime = 'vercel-request' | 'external-body-provider' | 'local-companion-body';

/** The delegation rule, encoded and documented. */
export const LONG_RUNNING_DELEGATION_CONTRACT = {
  rule: 'Vercel request lifetime must never own long-running autonomous work',
  rationale:
    'the control-plane web deployment hosts the console and lightweight request/response APIs only (free-tier plan); autonomous execution is a replaceable external worker/body concern',
  durableTasks:
    'durable tasks are delegated to an external worker/body provider; task state, checkpoints and evidence survive body replacement (Spirit/Body architecture)',
  userDevice:
    'cloud/remote bodies continue while the user computer is off; local-only work queues durably until the local companion reconnects',
  enforcement:
    'a task configuration that targets the vercel-request runtime for long-running execution (or any work exceeding the request budget) is typed-rejected by assertDelegationBoundary',
  requestBudgetMs: VERCEL_HOBBY_REQUEST_BUDGET_MS,
  hobbyHardCapMs: VERCEL_HOBBY_HARD_CAP_MS,
} as const;

/** A task delegation plan (what the boundary gate checks). */
export interface TaskDelegationPlan {
  readonly taskId: string;
  readonly workloadClass: WorkloadClass;
  readonly targetRuntime: DelegationTargetRuntime;
  /** Best-effort duration estimate in ms (bounded by the target's envelope). */
  readonly estimatedDurationMs: number;
  /** Body provider reference when delegating (required for external/local bodies). */
  readonly bodyProviderRef?: string;
}

/** The decision of the deterministic delegation policy. */
export interface DelegationDecision {
  readonly decision: 'inline' | 'delegate' | 'queue-until-reconnect';
  readonly targetRuntime: DelegationTargetRuntime;
  readonly reason: string;
}

/**
 * The deterministic delegation policy:
 *   - durable-long-running work NEVER runs inline — it delegates to an
 *     external body provider (cloud/remote by default; user-device bodies
 *     queue until reconnect instead of silently failing);
 *   - request-scoped work within the request budget may run inline in the
 *     request runtime; anything beyond the budget delegates.
 */
export function delegationDecision(plan: TaskDelegationPlan): DelegationDecision {
  assertPlanShape(plan);
  if (plan.workloadClass === 'durable-long-running') {
    if (plan.targetRuntime === 'vercel-request') {
      // The boundary gate gives the typed rejection; the policy states the
      // only correct alternative.
      throw new DelegationBoundaryError(
        `task '${plan.taskId}' is durable-long-running and targets the vercel-request runtime — long-running work must be delegated to an external worker/body provider (free-tier plan: the web deployment is never the hidden long-running worker)`,
      );
    }
    if (plan.targetRuntime === 'local-companion-body') {
      return {
        decision: 'queue-until-reconnect',
        targetRuntime: 'local-companion-body',
        reason:
          'local-only work remains durable and queues until the local companion reconnects (user device is optional for cloud work)',
      };
    }
    return {
      decision: 'delegate',
      targetRuntime: 'external-body-provider',
      reason:
        'durable tasks are delegated to an external worker/body provider; the request runtime only records intent and reports progress',
    };
  }
  // request-scoped
  if (plan.estimatedDurationMs > VERCEL_HOBBY_REQUEST_BUDGET_MS) {
    return {
      decision: 'delegate',
      targetRuntime: 'external-body-provider',
      reason: `request-scoped work estimated above the request budget (${VERCEL_HOBBY_REQUEST_BUDGET_MS}ms) delegates to an external body provider`,
    };
  }
  if (plan.targetRuntime === 'external-body-provider' || plan.targetRuntime === 'local-companion-body') {
    return {
      decision: 'delegate',
      targetRuntime: plan.targetRuntime,
      reason: 'request-scoped work MAY still delegate when the caller targets a body provider explicitly',
    };
  }
  return {
    decision: 'inline',
    targetRuntime: 'vercel-request',
    reason: `request-scoped work within the budget (${plan.estimatedDurationMs}ms <= ${VERCEL_HOBBY_REQUEST_BUDGET_MS}ms) may run in the request runtime`,
  };
}

/**
 * The boundary gate: TYPE-REJECTS any task configuration that would make
 * the web request runtime own long-running work. Rejection cases:
 *   - durable-long-running + vercel-request (the rule itself);
 *   - ANY work estimated above the Hobby hard cap targeting the request
 *     runtime (impossible by platform limits — rejected as configuration
 *     error, not delegated by silence).
 */
export function assertDelegationBoundary(plan: TaskDelegationPlan): void {
  assertPlanShape(plan);
  if (plan.workloadClass === 'durable-long-running' && plan.targetRuntime === 'vercel-request') {
    throw new DelegationBoundaryError(
      `task '${plan.taskId}' violates the long-running delegation boundary: durable-long-running work may NEVER target the vercel-request runtime (delegate to an external worker/body provider)`,
    );
  }
  if (plan.targetRuntime === 'vercel-request' && plan.estimatedDurationMs > VERCEL_HOBBY_HARD_CAP_MS) {
    throw new DelegationBoundaryError(
      `task '${plan.taskId}' estimates ${plan.estimatedDurationMs}ms against the Hobby hard cap ${VERCEL_HOBBY_HARD_CAP_MS}ms — the request runtime cannot own this work by platform limit`,
    );
  }
  if (plan.targetRuntime === 'vercel-request' && plan.estimatedDurationMs > VERCEL_HOBBY_REQUEST_BUDGET_MS) {
    throw new DelegationBoundaryError(
      `task '${plan.taskId}' targets the vercel-request runtime with an estimate of ${plan.estimatedDurationMs}ms above the request budget ${VERCEL_HOBBY_REQUEST_BUDGET_MS}ms — delegate to an external worker/body provider`,
    );
  }
  if (plan.workloadClass === 'durable-long-running' && plan.bodyProviderRef === undefined && plan.targetRuntime !== 'local-companion-body') {
    throw new DelegationBoundaryError(
      `task '${plan.taskId}' delegates long-running work without a bodyProviderRef — delegated work must name its body provider (capability-based selection happens at summon time)`,
    );
  }
}

/** Validates the plan shape itself (typed, fail-closed). */
function assertPlanShape(plan: TaskDelegationPlan): void {
  if (typeof plan.taskId !== 'string' || plan.taskId.length === 0) {
    throw new DelegationBoundaryError('task delegation plan requires a non-empty taskId');
  }
  if (plan.workloadClass !== 'request-scoped' && plan.workloadClass !== 'durable-long-running') {
    throw new DelegationBoundaryError(
      `task '${plan.taskId}' workload class must be 'request-scoped' or 'durable-long-running' (got '${String(plan.workloadClass)}')`,
    );
  }
  if (
    plan.targetRuntime !== 'vercel-request' &&
    plan.targetRuntime !== 'external-body-provider' &&
    plan.targetRuntime !== 'local-companion-body'
  ) {
    throw new DelegationBoundaryError(
      `task '${plan.taskId}' target runtime must be vercel-request | external-body-provider | local-companion-body (got '${String(plan.targetRuntime)}')`,
    );
  }
  if (!Number.isFinite(plan.estimatedDurationMs) || plan.estimatedDurationMs <= 0) {
    throw new DelegationBoundaryError(
      `task '${plan.taskId}' estimatedDurationMs must be a positive finite number of milliseconds`,
    );
  }
  assertValidRequestLifetimeBudget(VERCEL_HOBBY_REQUEST_BUDGET_MS); // contract self-check
}
