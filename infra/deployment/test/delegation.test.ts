/**
 * Long-running work delegation boundary tests (Work Order P3): the
 * documented rule, the deterministic policy, and the typed rejection of
 * any task configuration that makes the web request runtime own
 * long-running work.
 */

import {
  DelegationBoundaryError,
  LONG_RUNNING_DELEGATION_CONTRACT,
  LONG_RUNNING_DELEGATION_CONTRACT as CONTRACT,
  assertDelegationBoundary,
  delegationDecision,
} from '../src/execution/delegation.ts';
import {
  VERCEL_HOBBY_HARD_CAP_MS,
  VERCEL_HOBBY_REQUEST_BUDGET_MS,
} from '../src/providers/vercel.ts';

const BUDGET = VERCEL_HOBBY_REQUEST_BUDGET_MS;
const withinBudget = VERCEL_HOBBY_REQUEST_BUDGET_MS - 1;

describe('the delegation rule is encoded, not prose', () => {
  it('states the rule, the rationale and the enforcement mechanism', () => {
    expect(CONTRACT.rule).toBe('Vercel request lifetime must never own long-running autonomous work');
    expect(CONTRACT.rationale).toContain('replaceable external worker/body concern');
    expect(CONTRACT.enforcement).toContain('typed-rejected by assertDelegationBoundary');
    expect(CONTRACT.requestBudgetMs).toBe(VERCEL_HOBBY_REQUEST_BUDGET_MS);
    expect(CONTRACT.hobbyHardCapMs).toBe(VERCEL_HOBBY_HARD_CAP_MS);
  });

  it('documents the user-device rule (cloud work survives offline; local queues)', () => {
    expect(CONTRACT.userDevice).toContain("user computer is off");
    expect(CONTRACT.durableTasks).toContain('survive body replacement');
  });
});

describe('the boundary gate type-rejects request-lifetime long-running work', () => {
  it('TYPE-REJECTS durable-long-running work targeting the vercel-request runtime', () => {
    const violation = {
      taskId: 'task-long-autonomous-run',
      workloadClass: 'durable-long-running',
      targetRuntime: 'vercel-request',
      estimatedDurationMs: 45 * 60_000,
      bodyProviderRef: 'reference-cloud-body',
    };
    expect(() => assertDelegationBoundary(violation)).toThrow(DelegationBoundaryError);
    try {
      assertDelegationBoundary(violation);
      expect.unreachable('the boundary must reject');
    } catch (error) {
      expect((error as Error).message).toContain('task-long-autonomous-run');
      expect((error as Error).message).toContain('long-running delegation boundary');
    }
  });

  it('type-rejects ANY work above the request budget targeting the request runtime', () => {
    expect(() =>
      assertDelegationBoundary({
        taskId: 'task-heavy-request',
        workloadClass: 'request-scoped',
        targetRuntime: 'vercel-request',
        estimatedDurationMs: BUDGET + 1,
      }),
    ).toThrow(/above the request budget/);
  });

  it('type-rejects estimates beyond the Hobby hard cap against the request runtime', () => {
    expect(() =>
      assertDelegationBoundary({
        taskId: 'task-impossible',
        workloadClass: 'request-scoped',
        targetRuntime: 'vercel-request',
        estimatedDurationMs: VERCEL_HOBBY_HARD_CAP_MS + 1,
      }),
    ).toThrow(/Hobby hard cap/);
  });

  it('type-rejects delegated long-running work without a body provider reference', () => {
    expect(() =>
      assertDelegationBoundary({
        taskId: 'task-orphan-delegation',
        workloadClass: 'durable-long-running',
        targetRuntime: 'external-body-provider',
        estimatedDurationMs: 10 * 60_000,
      }),
    ).toThrow(/bodyProviderRef/);
  });

  it('type-rejects malformed plans (empty id, unknown class/runtime, bad estimates)', () => {
    expect(() =>
      assertDelegationBoundary({
        taskId: '',
        workloadClass: 'request-scoped',
        targetRuntime: 'vercel-request',
        estimatedDurationMs: 100,
      }),
    ).toThrow(/non-empty taskId/);
    expect(() =>
      assertDelegationBoundary({
        taskId: 't',
        workloadClass: 'forever' as never,
        targetRuntime: 'vercel-request',
        estimatedDurationMs: 100,
      }),
    ).toThrow(/workload class/);
    expect(() =>
      assertDelegationBoundary({
        taskId: 't',
        workloadClass: 'request-scoped',
        targetRuntime: 'mainframe' as never,
        estimatedDurationMs: 100,
      }),
    ).toThrow(/target runtime/);
    expect(() =>
      assertDelegationBoundary({
        taskId: 't',
        workloadClass: 'request-scoped',
        targetRuntime: 'vercel-request',
        estimatedDurationMs: -5,
      }),
    ).toThrow(/positive finite/);
  });

  it('accepts the honest configurations (inline within budget; delegated long-running)', () => {
    expect(() =>
      assertDelegationBoundary({
        taskId: 'task-light-api',
        workloadClass: 'request-scoped',
        targetRuntime: 'vercel-request',
        estimatedDurationMs: withinBudget,
      }),
    ).not.toThrow();
    expect(() =>
      assertDelegationBoundary({
        taskId: 'task-autonomous-build',
        workloadClass: 'durable-long-running',
        targetRuntime: 'external-body-provider',
        estimatedDurationMs: 45 * 60_000,
        bodyProviderRef: 'reference-cloud-body',
      }),
    ).not.toThrow();
  });
});

describe('deterministic delegation policy', () => {
  it('durable-long-running work always delegates to an external body provider', () => {
    const decision = delegationDecision({
      taskId: 'task-build',
      workloadClass: 'durable-long-running',
      targetRuntime: 'external-body-provider',
      estimatedDurationMs: 45 * 60_000,
      bodyProviderRef: 'reference-cloud-body',
    });
    expect(decision.decision).toBe('delegate');
    expect(decision.targetRuntime).toBe('external-body-provider');
    expect(decision.reason).toContain('external worker/body provider');
  });

  it('local-companion long-running work QUEUES until reconnect (never silently fails)', () => {
    const decision = delegationDecision({
      taskId: 'task-local',
      workloadClass: 'durable-long-running',
      targetRuntime: 'local-companion-body',
      estimatedDurationMs: 5 * 60_000,
      bodyProviderRef: 'local-companion',
    });
    expect(decision.decision).toBe('queue-until-reconnect');
    expect(decision.reason).toContain('queues until the local companion reconnects');
  });

  it('request-scoped work within budget may run inline in the request runtime', () => {
    const decision = delegationDecision({
      taskId: 'task-read',
      workloadClass: 'request-scoped',
      targetRuntime: 'vercel-request',
      estimatedDurationMs: withinBudget,
    });
    expect(decision.decision).toBe('inline');
    expect(decision.reason).toContain('within the budget');
  });

  it('request-scoped work above the budget delegates', () => {
    const decision = delegationDecision({
      taskId: 'task-medium',
      workloadClass: 'request-scoped',
      targetRuntime: 'vercel-request',
      estimatedDurationMs: BUDGET + 1,
    });
    expect(decision.decision).toBe('delegate');
  });

  it('the policy function REFUSES to even express the violation (durable + vercel-request throws)', () => {
    expect(() =>
      delegationDecision({
        taskId: 'task-violation',
        workloadClass: 'durable-long-running',
        targetRuntime: 'vercel-request',
        estimatedDurationMs: 45 * 60_000,
      }),
    ).toThrow(DelegationBoundaryError);
  });

  it('decisions are pure functions of the plan (deterministic re-evaluation)', () => {
    const plan = {
      taskId: 'task-stable',
      workloadClass: 'request-scoped',
      targetRuntime: 'vercel-request',
      estimatedDurationMs: 500,
    };
    expect(delegationDecision(plan)).toEqual(delegationDecision(plan));
    expect(LONG_RUNNING_DELEGATION_CONTRACT).toBe(CONTRACT);
  });
});
