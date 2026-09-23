/**
 * Shared composition helpers (Work Order P14 acceptance suite).
 *
 * Composes the P14 packages with the REAL merged P9 action gateway
 * (imported through the test-time alias — see vitest.config.ts for why
 * this is alias wiring rather than a declared dependency).
 */

import {
  ActionGateway,
  InMemoryAuthority,
  InMemoryEventLog,
  InMemoryEvidenceSink,
  InMemoryIdempotencyStore,
  ReferenceExecutor,
  ReferenceWorld,
  WORLD_BASE_SHA,
} from '@sos-2/action-gateway';
import type { ActionRequest, AuthorityQuery, AuthoritySnapshot, AuthorityPort, Clock } from '@sos-2/action-gateway';
import { evaluateCredentialScope } from '@sos-2/security';
import type { CredentialScopeRecord } from '@sos-2/security';
import type { Timestamp } from '@sos-2/cost-policy';

export { WORLD_BASE_SHA };

export class ManualClock implements Clock {
  private current: Timestamp;
  constructor(start: number = 1_000_000) {
    this.current = start;
  }
  now(): Timestamp {
    return this.current;
  }
  advance(milliseconds: number): void {
    this.current += milliseconds;
  }
}

/**
 * The P14->P9 authority adapter: the gateway's AuthorityPort re-
 * evaluated at action time, ANDed with the P14 credential-scope
 * evaluation. A credential that is expired or scoped away from the
 * requested family fails closed — the executor is never invoked.
 */
export class ScopedCredentialAuthority implements AuthorityPort {
  readonly evaluations: Array<{ readonly query: AuthorityQuery; readonly now: Timestamp; readonly snapshot: AuthoritySnapshot }> = [];

  constructor(
    public readonly base: InMemoryAuthority,
    private readonly credential: CredentialScopeRecord | null,
  ) {}

  evaluateCurrent(query: AuthorityQuery, now: Timestamp): AuthoritySnapshot {
    const gatewayGrant = this.base.evaluateCurrent(query, now);
    let snapshot: AuthoritySnapshot;
    if (!gatewayGrant.granted) {
      snapshot = gatewayGrant;
    } else {
      const scope = evaluateCredentialScope(this.credential, query.family, now);
      if (scope.kind === 'SCOPE_GRANTED') {
        snapshot = gatewayGrant;
      } else {
        const reason = scope.kind === 'CREDENTIAL_EXPIRED' ? 'GRANT_EXPIRED' : 'SCOPE_EXCEEDED';
        snapshot = {
          granted: false,
          reason,
          grantId: gatewayGrant.grantId,
          evaluatedAt: now,
          detail: scope.detail,
        };
      }
    }
    this.evaluations.push({ query, now, snapshot });
    return snapshot;
  }
}

export interface ComposedGateway {
  readonly gateway: ActionGateway;
  readonly world: ReferenceWorld;
  readonly executor: ReferenceExecutor;
  readonly authority: ScopedCredentialAuthority;
  readonly eventLog: InMemoryEventLog;
  readonly evidence: InMemoryEvidenceSink;
  readonly idempotency: InMemoryIdempotencyStore;
  readonly clock: ManualClock;
}

/** Build a real P9 gateway composed with the P14 credential scoping. */
export function composeGateway(credential: CredentialScopeRecord | null, clockStart: number = 1_000_000): ComposedGateway {
  const clock = new ManualClock(clockStart);
  const world = new ReferenceWorld();
  const executor = new ReferenceExecutor(world);
  const authority = new ScopedCredentialAuthority(new InMemoryAuthority(), credential);
  const eventLog = new InMemoryEventLog();
  const evidence = new InMemoryEvidenceSink();
  const idempotency = new InMemoryIdempotencyStore();
  const gateway = new ActionGateway({
    clock,
    authority,
    executors: [executor],
    idempotency,
    events: eventLog,
    evidence,
    rollbackVerifier: null,
  });
  return { gateway, world, executor, authority, eventLog, evidence, idempotency, clock };
}

/** A well-formed commit action request (P9 envelope). */
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

/** A well-formed push action request (a DIFFERENT action family). */
export function pushRequest(overrides: Partial<ActionRequest> = {}): ActionRequest {
  return {
    actionId: 'act-push-1',
    idempotencyKey: 'idem-push-1',
    family: 'push',
    actor: { kind: 'body', id: 'body-1' },
    requestedAt: 1_000_000,
    targetRevision: { kind: 'source', sha: WORLD_BASE_SHA },
    payload: {
      family: 'push',
      push: { remote: 'origin', ref: 'main', fromSha: WORLD_BASE_SHA },
    },
    ...overrides,
  };
}
