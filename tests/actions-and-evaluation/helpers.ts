import {
  ACTION_FAMILIES,
  ActionGateway,
  InMemoryAuthority,
  InMemoryEventLog,
  InMemoryEvidenceSink,
  InMemoryIdempotencyStore,
  ReferenceExecutor,
  ReferenceRollbackVerifier,
  ReferenceWorld,
  WORLD_BASE_SHA,
} from '@sos-2/action-gateway';
import type { ActionFamily, ActionReceipt, ActionRequest, Clock, GatewayOutcome } from '@sos-2/action-gateway';

export { ACTION_FAMILIES, WORLD_BASE_SHA };

export class ManualClock implements Clock {
  private current: number;
  constructor(start = 1_000_000) {
    this.current = start;
  }
  now(): number {
    return this.current;
  }
  advance(milliseconds: number): void {
    this.current += milliseconds;
  }
}

export function expectExecuted(outcome: GatewayOutcome): ActionReceipt {
  if (outcome.kind !== 'executed') throw new Error(`expected an executed receipt, got kind=${outcome.kind}`);
  return outcome.receipt;
}

export function commitRequest(overrides: Partial<ActionRequest> = {}): ActionRequest {
  return {
    actionId: 'act-commit-1',
    idempotencyKey: 'idem-commit-1',
    family: 'commit',
    actor: { kind: 'body', id: 'body-1' },
    requestedAt: 1_000_000,
    targetRevision: { kind: 'source', sha: WORLD_BASE_SHA },
    payload: {
      family: 'commit',
      commit: {
        message: 'apply change',
        changes: [{ path: 'src/a.ts', contents: 'export const a = 1;\n' }],
        expectedBaseSha: WORLD_BASE_SHA,
      },
    },
    ...overrides,
  };
}

export function requestForFamily(family: ActionFamily, index: number): ActionRequest {
  const base = {
    actionId: `act-${family}-${index}`,
    idempotencyKey: `idem-${family}-${index}`,
    family,
    actor: { kind: 'body', id: 'body-1' } as const,
    requestedAt: 1_000_000,
    targetRevision: { kind: 'source', sha: WORLD_BASE_SHA } as const,
  };
  switch (family) {
    case 'commit':
      return { ...base, payload: { family, commit: { message: 'm', changes: [{ path: 'f.ts', contents: 'x' }], expectedBaseSha: WORLD_BASE_SHA } } };
    case 'push':
      return { ...base, payload: { family, push: { remote: 'origin', ref: 'main', fromSha: WORLD_BASE_SHA } } };
    case 'pull-request':
      return { ...base, payload: { family, pullRequest: { title: 't', headBranch: 'feature/h', baseBranch: 'main', description: 'd' } } };
    case 'deployment':
      return { ...base, payload: { family, deployment: { environment: 'staging', sourceSha: WORLD_BASE_SHA } } };
    case 'configuration':
      return { ...base, payload: { family, configuration: { key: 'feature.flag', value: 'on' } } };
    case 'remediation':
      return { ...base, payload: { family, remediation: { findingId: 'F-1', strategy: 'reprovision', targetSha: WORLD_BASE_SHA } } };
    case 'promotion':
      return { ...base, payload: { family, promotion: { fromEnvironment: 'staging', toEnvironment: 'production', sourceSha: WORLD_BASE_SHA } } };
    case 'rollback':
      return {
        ...base,
        payload: {
          family,
          rollback: {
            deploymentId: 'deployment:unknown',
            fromSourceSha: WORLD_BASE_SHA,
            toSourceSha: 'seed-previous-sha',
            reason: { code: 'INCIDENT', detail: 'regression observed' },
          },
        },
      };
    case 'body-lifecycle':
      return { ...base, payload: { family, bodyLifecycle: { bodyId: 'body-9', operation: 'start' } } };
  }
}

export interface Fixture {
  gateway: ActionGateway;
  world: ReferenceWorld;
  authority: InMemoryAuthority;
  executor: ReferenceExecutor;
  idempotency: InMemoryIdempotencyStore;
  evidence: InMemoryEvidenceSink;
  events: InMemoryEventLog;
  clock: ManualClock;
}

export function buildFixture(clock: ManualClock = new ManualClock()): Fixture {
  const world = new ReferenceWorld();
  const authority = new InMemoryAuthority();
  const executor = new ReferenceExecutor(world);
  const idempotency = new InMemoryIdempotencyStore();
  const evidence = new InMemoryEvidenceSink();
  const events = new InMemoryEventLog();
  const gateway = new ActionGateway({
    clock,
    authority,
    executors: [executor],
    idempotency,
    events,
    evidence,
    rollbackVerifier: new ReferenceRollbackVerifier(world),
  });
  return { gateway, world, authority, executor, idempotency, evidence, events, clock };
}
