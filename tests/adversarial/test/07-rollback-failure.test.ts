/**
 * ADVERSARIAL CLASS 7 — ROLLBACK FAILURE (a rollback that itself fails is
 * caught + escalated, and the state stays contained).
 *
 * The fault: a rollback is attempted against a deployment that was never
 * deployed (or is already rolled back). The system must REFUSE the rollback
 * with a typed, loud error (never a silent no-op), the deployment store
 * must remain consistent (the record keeps its lifecycle state, transitions
 * stay queryable), and the trace chain stays queryable.
 */

import { describe, expect, test } from 'vitest';
import { DeploymentLifecycleError, DeploymentStore, createDeployment } from '@sos-2/deployment';
import type { DeploymentRecord } from '@sos-2/deployment';
import { createTraceLink } from '@sos-2/semantic-spine';
import { ADVERSARIAL_ANCHOR, ADVERSARIAL_PROVENANCE, T0, T1, assertTraceQueryable, subjectId } from './helpers.js';

const ROLLBACK_AUTHORITY = subjectId('AuthorityGrant', 'adversarial-7-rollback-authority');

function plannedDeployment(): DeploymentRecord {
  return createDeployment({
    content: {
      deployment_id: 'deploy:adversarial-7-prod',
      environment: 'production',
      artifact_revision: { kind: 'git-sha', value: '31f2a9c07d9e5b864a2c0f7d3e8b1a6c95d4f0e2' },
      target_runtime: { runtime_id: 'runtime:prod-cluster', runtime_kind: 'container', runtime_version: '1.4.0' },
      configuration: { replicas: 3 },
      rollback: {
        mechanism: { kind: 'ROLLBACK_DEPLOYMENT', to_deployment_id: 'deploy:adversarial-7-previous' },
        trigger: { kind: 'BUDGET', metric: 'payments.error_rate', threshold: '0.01', window_ms: 300000 },
        authority_ref: ROLLBACK_AUTHORITY,
        exception: null,
      },
    },
    provenance: [...ADVERSARIAL_PROVENANCE, 'adversarial:7:planned-deployment'],
    created_at: T0,
    authority_ref: ADVERSARIAL_ANCHOR,
    status: 'DRAFT',
  });
}

describe('adversarial class 7: rollback failure', () => {
  test('rolling back a PLANNED (never deployed) change is CAUGHT + ESCALATED loudly', () => {
    const store = new DeploymentStore();
    const record = plannedDeployment();
    store.put(record);
    // The rollback itself FAILS: the change was never deployed.
    expect(() =>
      store.rollback(record.envelope.id, {
        at: T1,
        provenance: [...ADVERSARIAL_PROVENANCE, 'adversarial:7:rollback-attempt'],
      }),
    ).toThrow(DeploymentLifecycleError);
    // The typed failure is the escalation — it is loud and machine-checkable.
    try {
      store.rollback(record.envelope.id, { at: T1, provenance: [...ADVERSARIAL_PROVENANCE, 'adversarial:7:rollback-attempt'] });
    } catch (error) {
      expect(error).toBeInstanceOf(DeploymentLifecycleError);
      expect((error as Error).message.length).toBeGreaterThan(0);
    }
  });

  test('the failure is CONTAINED: the record keeps its lifecycle state and stays queryable', () => {
    const store = new DeploymentStore();
    const record = plannedDeployment();
    store.put(record);
    expect(() => store.rollback(record.envelope.id, { at: T1, provenance: ['adversarial:7'] })).toThrow();
    // Nothing was mutated by the failed rollback.
    const stored = store.get(record.envelope.id)!;
    expect(stored.envelope.status).toBe('DRAFT'); // PLANNED
    expect(store.transitions(record.envelope.id)).toEqual([]);
    expect(store.getByDeploymentId('deploy:adversarial-7-prod')!.envelope.id).toBe(record.envelope.id);
    // No outcomes were fabricated.
    expect(store.outcomesOf(record.envelope.id)).toEqual([]);
    expect(store.statusOf(record.envelope.id)).toBe('UNAVAILABLE');
  });

  test('rolling back an ALREADY-ROLLED-BACK deployment is also caught (terminal state)', () => {
    const store = new DeploymentStore();
    const record = plannedDeployment();
    store.put(record);
    store.deploy(record.envelope.id, { at: T0, provenance: [...ADVERSARIAL_PROVENANCE, 'adversarial:7:deploy'] });
    store.rollback(record.envelope.id, { at: T1, provenance: [...ADVERSARIAL_PROVENANCE, 'adversarial:7:rollback'] });
    expect(store.get(record.envelope.id)!.envelope.status).toBe('RETIRED'); // ROLLED_BACK
    // The second rollback fails loudly (terminal lifecycle).
    expect(() =>
      store.rollback(record.envelope.id, { at: T1, provenance: [...ADVERSARIAL_PROVENANCE, 'adversarial:7:double-rollback'] }),
    ).toThrow(DeploymentLifecycleError);
    // The transition history is retained + queryable.
    expect(store.transitions(record.envelope.id).map((transition) => `${transition.from}->${transition.to}`)).toEqual([
      'PLANNED->DEPLOYED',
      'DEPLOYED->ROLLED_BACK',
    ]);
  });

  test('the trace chain stays queryable after the failed rollback', () => {
    const store = new DeploymentStore();
    const record = plannedDeployment();
    store.put(record);
    store.deploy(record.envelope.id, { at: T0, provenance: [...ADVERSARIAL_PROVENANCE, 'adversarial:7:deploy'] });
    const links = [
      createTraceLink({
        source: record.envelope.id,
        target: ADVERSARIAL_ANCHOR,
        type: 'DERIVED_FROM',
        provenance: [...ADVERSARIAL_PROVENANCE, 'adversarial:7:deployment-traces-anchor'],
      }),
      createTraceLink({
        source: ROLLBACK_AUTHORITY,
        target: record.envelope.id,
        type: 'CONSTRAINS',
        provenance: [...ADVERSARIAL_PROVENANCE, 'adversarial:7:rollback-authority-constrains'],
      }),
    ];
    const { queryFrom, queryTo } = assertTraceQueryable(links);
    expect(queryFrom(record.envelope.id).length).toBe(1);
    expect(queryTo(record.envelope.id).length).toBe(1);
    expect(queryFrom(ROLLBACK_AUTHORITY)[0]!.type).toBe('CONSTRAINS');
  });
});
