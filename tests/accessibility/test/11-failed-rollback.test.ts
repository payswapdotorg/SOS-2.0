/**
 * LANE C, NEGATIVE CASE 11 — FAILED ROLLBACK (rollback failure is
 * surfaced honestly with the system left in a truthful state — never a
 * fake success).
 *
 * The fault: a rollback that cannot succeed — (a) rolling back a
 * deployment that was never deployed (or is already rolled back), (b) a
 * rollback whose executor FAILS at the action surface, (c) a rollback
 * whose rolled-back state cannot be observed. Every path surfaces a
 * TYPED, loud record: the deployment store refuses with the typed
 * lifecycle error and keeps its truthful state + transition history;
 * the action gateway records the FAILED receipt in the durable event
 * log with evidence; an unobservable rolled-back state is honestly
 * UNKNOWN, never fabricated VERIFIED. Never a silent pass, never a
 * crash.
 */

import { describe, expect, test } from 'vitest';
import { DeploymentLifecycleError, DeploymentStore, createDeployment } from '@sos-2/deployment';
import type { DeploymentRecord } from '@sos-2/deployment';
import { ActionGateway, InMemoryAuthority, InMemoryEventLog, InMemoryEvidenceSink, InMemoryIdempotencyStore, ReferenceExecutor, ReferenceRollbackVerifier, ReferenceWorld, WORLD_BASE_SHA } from '@sos-2/action-gateway';
import type { ActionRequest } from '@sos-2/action-gateway';
import { LANE_ANCHOR, LANE_PROVENANCE, PolicyManualClock, T0, T1, subjectId } from './helpers.js';

const ROLLBACK_AUTHORITY = subjectId('AuthorityGrant', 'p15c-11-rollback-authority');

function plannedDeployment(): DeploymentRecord {
  return createDeployment({
    content: {
      deployment_id: 'deploy:p15c-11-prod',
      environment: 'production',
      artifact_revision: { kind: 'git-sha', value: '31f2a9c07d9e5b864a2c0f7d3e8b1a6c95d4f0e2' },
      target_runtime: { runtime_id: 'runtime:prod-cluster', runtime_kind: 'container', runtime_version: '1.4.0' },
      configuration: { replicas: 3 },
      rollback: {
        mechanism: { kind: 'ROLLBACK_DEPLOYMENT', to_deployment_id: 'deploy:p15c-11-previous' },
        trigger: { kind: 'BUDGET', metric: 'payments.error_rate', threshold: '0.01', window_ms: 300000 },
        authority_ref: ROLLBACK_AUTHORITY,
        exception: null,
      },
    },
    provenance: [...LANE_PROVENANCE, 'p15c-11:planned-deployment'],
    created_at: T0,
    authority_ref: LANE_ANCHOR,
    status: 'DRAFT',
  });
}

function rollbackRequest(deploymentId: string, index: number): ActionRequest {
  return {
    actionId: `act-p15c-rollback-${index}`,
    idempotencyKey: `idem-p15c-rollback-${index}`,
    family: 'rollback',
    actor: { kind: 'body', id: 'body-1' },
    requestedAt: 1_000_000,
    targetRevision: { kind: 'source', sha: WORLD_BASE_SHA },
    payload: {
      family: 'rollback',
      rollback: {
        deploymentId,
        fromSourceSha: WORLD_BASE_SHA,
        toSourceSha: 'seed-previous-sha',
        reason: { code: 'FAILED_VERIFICATION', detail: 'deployment verification failed' },
      },
    },
  };
}

/** A gateway fixture with rollback authority granted. */
function gatewayFixture() {
  const clock = new PolicyManualClock(1_000_000);
  const world = new ReferenceWorld();
  const executor = new ReferenceExecutor(world);
  const authority = new InMemoryAuthority();
  authority.grant('body-1', 'rollback', '*');
  const eventLog = new InMemoryEventLog();
  const evidence = new InMemoryEvidenceSink();
  const gateway = new ActionGateway({
    clock,
    authority,
    executors: [executor],
    idempotency: new InMemoryIdempotencyStore(),
    events: eventLog,
    evidence,
    rollbackVerifier: new ReferenceRollbackVerifier(world),
  });
  return { gateway, world, executor, eventLog, evidence };
}

describe('P15 lane C negative case: failed rollback', () => {
  test('CONTAINED: rolling back a NEVER-DEPLOYED change is caught + escalated loudly (typed lifecycle error, never a silent no-op)', () => {
    const store = new DeploymentStore();
    const record = plannedDeployment();
    store.put(record);
    // The rollback FAILS: the change was never deployed.
    expect(() =>
      store.rollback(record.envelope.id, {
        at: T1,
        provenance: [...LANE_PROVENANCE, 'p15c-11:rollback-attempt'],
      }),
    ).toThrow(DeploymentLifecycleError);
    // The typed failure is loud and machine-checkable.
    try {
      store.rollback(record.envelope.id, { at: T1, provenance: [...LANE_PROVENANCE, 'p15c-11:rollback-attempt'] });
    } catch (error) {
      expect(error).toBeInstanceOf(DeploymentLifecycleError);
      expect((error as Error).message.length).toBeGreaterThan(0);
    }
  });

  test('TRUTHFUL: the failed rollback leaves the system in a truthful state (lifecycle kept, transitions queryable, no fabricated outcomes)', () => {
    const store = new DeploymentStore();
    const record = plannedDeployment();
    store.put(record);
    expect(() => store.rollback(record.envelope.id, { at: T1, provenance: ['p15c-11'] })).toThrow();
    // Nothing was mutated by the failed rollback.
    const stored = store.get(record.envelope.id)!;
    expect(stored.envelope.status).toBe('DRAFT');
    expect(store.transitions(record.envelope.id)).toEqual([]);
    // No outcomes were fabricated.
    expect(store.outcomesOf(record.envelope.id)).toEqual([]);
    expect(store.statusOf(record.envelope.id)).toBe('UNAVAILABLE');
  });

  test('CONTAINED: rolling back an ALREADY-ROLLED-BACK deployment is caught (terminal state) and the history stays queryable', () => {
    const store = new DeploymentStore();
    const record = plannedDeployment();
    store.put(record);
    store.deploy(record.envelope.id, { at: T0, provenance: [...LANE_PROVENANCE, 'p15c-11:deploy'] });
    store.rollback(record.envelope.id, { at: T1, provenance: [...LANE_PROVENANCE, 'p15c-11:rollback'] });
    expect(store.get(record.envelope.id)!.envelope.status).toBe('RETIRED');
    // The second rollback fails loudly (terminal lifecycle).
    expect(() =>
      store.rollback(record.envelope.id, { at: T1, provenance: [...LANE_PROVENANCE, 'p15c-11:double-rollback'] }),
    ).toThrow(DeploymentLifecycleError);
    // The transition history is retained + queryable.
    expect(store.transitions(record.envelope.id).map((transition) => `${transition.from}->${transition.to}`)).toEqual([
      'PLANNED->DEPLOYED',
      'DEPLOYED->ROLLED_BACK',
    ]);
  });

  test('CONTAINED (action surface): a rollback whose executor FAILS is a typed FAILED receipt in the durable event log (never a fake success)', () => {
    const fixture = gatewayFixture();
    // The fault: the rollback operation itself fails at the executor seam.
    fixture.world.script('rollback.apply', {
      status: 'error',
      errorType: 'ROLLBACK_TARGET_UNREACHABLE',
      message: 'the rollback target could not be reached (the previous deployment is gone)',
      retryable: false,
    });
    const outcome = fixture.gateway.execute(rollbackRequest('deployment:p15c-some-id', 1));
    expect(outcome.kind).toBe('executed');
    if (outcome.kind === 'executed') {
      expect(outcome.receipt.status).toBe('FAILED');
      expect(outcome.receipt.failure?.errorType).toBe('ROLLBACK_TARGET_UNREACHABLE');
      expect(outcome.receipt.failure?.retryable).toBe(false);
    }
    // The failure is DURABLE evidence (the observation discipline) — never silent.
    expect(fixture.eventLog.entries().length).toBe(1);
    expect(fixture.eventLog.entries()[0]!.type).toBe('action.failed');
    expect(fixture.evidence.all().length).toBeGreaterThan(0);
    for (const record of fixture.evidence.all()) {
      expect(JSON.stringify(record)).toContain('FAILED');
    }
  });

  test('TRUTHFUL (action surface): an unobservable rolled-back state is recorded honestly as UNKNOWN — never fabricated VERIFIED', () => {
    const fixture = gatewayFixture();
    // The rollback "succeeds" at the executor, but the target deployment
    // was never observed in the world (verification cannot see it).
    fixture.world.script('rollback.apply', {
      status: 'ok',
      output: { produced: { deploymentId: 'deployment:p15c-unobserved', sourceSha: 'seed-previous-sha' } },
    });
    const outcome = fixture.gateway.execute(rollbackRequest('deployment:p15c-some-id', 2));
    expect(outcome.kind).toBe('executed');
    if (outcome.kind === 'executed') {
      expect(outcome.receipt.status).toBe('SUCCEEDED'); // the executor reported success...
      expect(outcome.receipt.rollbackVerification?.verdict).toBe('UNKNOWN'); // ...but verification honestly says UNKNOWN
      expect(outcome.receipt.rollbackVerification?.limitation ?? '').toContain('not observed');
    }
    // The honest UNKNOWN verdict is typed evidence.
    const verifications = fixture.evidence.ofType('rollback.verification');
    expect(verifications.length).toBe(1);
    if (verifications[0]?.evidenceType === 'rollback.verification') {
      expect(verifications[0].verdict).toBe('UNKNOWN');
    }
  });
});
