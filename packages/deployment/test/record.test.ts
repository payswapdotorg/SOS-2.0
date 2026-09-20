/**
 * Deployment record + lifecycle tests: typed records, the
 * recovery-control-mirrored rollback declarations and the validated
 * PLANNED -> DEPLOYED -> ROLLED_BACK lifecycle.
 */

import { describe, expect, it } from 'vitest';
import { isRegisteredArtifactKind } from '@sos-2/semantic-spine';
import {
  ALLOWED_DEPLOYMENT_TRANSITIONS,
  DEPLOYMENT_RECORD_KIND,
  DeploymentRecordError,
  DeploymentStore,
  canTransitionDeploymentLifecycle,
  createDeployment,
  deploymentLifecycle,
  deploymentRecordId,
  transitionDeploymentLifecycle,
  validateDeployment,
} from '../src/index.js';
import { BOUNDED_MECHANISM, ROLLBACK_AUTHORITY, T0, T1, T2, deploymentContent, makeDeployment } from './helpers.js';

describe('deployment records', () => {
  it('creates spine-envelope deployment records (registered extension kind, deterministic id)', () => {
    const record = makeDeployment();
    expect(isRegisteredArtifactKind(DEPLOYMENT_RECORD_KIND)).toBe(true);
    expect(record.envelope.kind).toBe(DEPLOYMENT_RECORD_KIND);
    expect(record.envelope.id).toMatch(/^sos:\/\/DeploymentRecord\/[0-9a-f]{32}$/);
    expect(record.envelope.status).toBe('DRAFT'); // PLANNED
    expect(record.content.deployment_id).toBe('deploy-prod-2025-06-01');
    // Deterministic identity: same input -> same id.
    expect(deploymentRecordId({ content: deploymentContent(), provenance: ['w12:deployment-test:record'], created_at: T0 })).toBe(
      record.envelope.id,
    );
  });

  it('validates and round-trips (predicate + assert forms)', () => {
    const record = makeDeployment();
    expect(validateDeployment(record)).toBe(true);
    expect(
      validateDeployment({ envelope: { ...record.envelope, kind: 'Decision' }, content: record.content }),
    ).toBe(false);
  });

  it('requires exact artifact revisions of kind git-sha or config-version', () => {
    expect(() =>
      makeDeployment({ artifact_revision: { kind: 'deployment-id', value: 'x' } }),
    ).toThrow(/git-sha.*config-version/);
    expect(() =>
      makeDeployment({ artifact_revision: { kind: 'git-sha', value: '' } }),
    ).toThrow();
    expect(() => makeDeployment({ artifact_revision: { kind: 'config-version', value: 'v42' } })).not.toThrow();
  });

  it('validates the target runtime reference and configuration', () => {
    expect(() => makeDeployment({ target_runtime: { runtime_id: '', runtime_kind: 'container', runtime_version: '1' } })).toThrow();
    expect(() => makeDeployment({ configuration: { bad: () => 1 } as never })).toThrow();
    expect(() => makeDeployment({ deployment_id: '' })).toThrow();
    expect(() => makeDeployment({ environment: '' })).toThrow();
  });

  it('rejects UNSPECIFIED rollback without a governed exception (the W8 policy, consumed)', () => {
    expect(() =>
      makeDeployment({
        rollback: {
          mechanism: { kind: 'UNSPECIFIED' },
          trigger: { kind: 'DEADLINE', within_ms: 60000 },
          authority_ref: ROLLBACK_AUTHORITY,
          exception: null,
        },
      }),
    ).toThrow(/UNBOUNDED RECOVERY REJECTED|unbounded/);
    // ...but accepts it WITH a governed exception (the only path).
    expect(() =>
      makeDeployment({
        rollback: {
          mechanism: { kind: 'UNSPECIFIED' },
          trigger: { kind: 'DEADLINE', within_ms: 60000 },
          authority_ref: ROLLBACK_AUTHORITY,
          exception: {
            authority_ref: ROLLBACK_AUTHORITY,
            containment: 'Out-of-band kill switch operated by the on-call authority.',
            provenance: ['w12:deployment-test:exception'],
          },
        },
      }),
    ).not.toThrow();
  });

  it('rejects rollback declarations missing mechanism, trigger or authority', () => {
    expect(() =>
      makeDeployment({
        rollback: {
          mechanism: BOUNDED_MECHANISM,
          trigger: { kind: 'DEADLINE', within_ms: 0 },
          authority_ref: ROLLBACK_AUTHORITY,
          exception: null,
        },
      }),
    ).toThrow();
    expect(() =>
      makeDeployment({
        rollback: {
          mechanism: BOUNDED_MECHANISM,
          trigger: { kind: 'MANUAL', authority_ref: 'not-a-spine-id' },
          authority_ref: ROLLBACK_AUTHORITY,
          exception: null,
        },
      }),
    ).toThrow();
  });

  it('cannot be created in terminal envelope statuses', () => {
    expect(() =>
      createDeployment({ content: deploymentContent(), provenance: ['x'], created_at: T0, status: 'RETIRED' }),
    ).toThrow();
  });
});

describe('deployment lifecycle (PLANNED -> DEPLOYED -> ROLLED_BACK)', () => {
  it('allows exactly the validated transitions', () => {
    expect(canTransitionDeploymentLifecycle('PLANNED', 'DEPLOYED')).toBe(true);
    expect(canTransitionDeploymentLifecycle('DEPLOYED', 'ROLLED_BACK')).toBe(true);
    expect(canTransitionDeploymentLifecycle('PLANNED', 'ROLLED_BACK')).toBe(false);
    expect(canTransitionDeploymentLifecycle('DEPLOYED', 'DEPLOYED')).toBe(false);
    expect(canTransitionDeploymentLifecycle('ROLLED_BACK', 'DEPLOYED')).toBe(false);
    expect(canTransitionDeploymentLifecycle('ROLLED_BACK', 'ROLLED_BACK')).toBe(false);
    expect(ALLOWED_DEPLOYMENT_TRANSITIONS.ROLLED_BACK).toEqual([]);
    expect(() => transitionDeploymentLifecycle('PLANNED', 'ROLLED_BACK')).toThrow(/never deployed/);
  });

  it('deploy then rollback, with the audit trail (identity preserved)', () => {
    const store = new DeploymentStore();
    const record = store.put(makeDeployment());
    expect(deploymentLifecycle(record)).toBe('PLANNED');
    const deployed = store.deploy(record.envelope.id, { at: T1, provenance: ['w12:deploy'] });
    expect(deploymentLifecycle(deployed)).toBe('DEPLOYED');
    expect(deployed.envelope.status).toBe('ACTIVE');
    expect(deployed.envelope.id).toBe(record.envelope.id);
    const rolledBack = store.rollback(record.envelope.id, { at: T2, provenance: ['w12:rollback'] });
    expect(deploymentLifecycle(rolledBack)).toBe('ROLLED_BACK');
    expect(rolledBack.envelope.status).toBe('RETIRED');
    expect(store.get(record.envelope.id)!.envelope.status).toBe('RETIRED');
    expect(store.transitions(record.envelope.id).map((t) => `${t.from}->${t.to}`)).toEqual([
      'PLANNED->DEPLOYED',
      'DEPLOYED->ROLLED_BACK',
    ]);
    expect(store.transitions(record.envelope.id)[0]!.provenance).toEqual(['w12:deploy']);
  });

  it('rejects invalid transitions loudly (PLANNED -> ROLLED_BACK forbidden; terminal states)', () => {
    const store = new DeploymentStore();
    const record = store.put(makeDeployment());
    expect(() => store.rollback(record.envelope.id, { at: T1, provenance: ['w12:early'] })).toThrow(/never deployed/);
    store.deploy(record.envelope.id, { at: T1, provenance: ['w12:deploy'] });
    store.rollback(record.envelope.id, { at: T2, provenance: ['w12:rollback'] });
    expect(() => store.deploy(record.envelope.id, { at: T2, provenance: ['w12:redeploy'] })).toThrow();
    expect(() => store.rollback(record.envelope.id, { at: T2, provenance: ['w12:again'] })).toThrow();
  });

  it('rejects malformed transition inputs and unknown deployments', () => {
    const store = new DeploymentStore();
    const record = store.put(makeDeployment());
    expect(() => store.deploy(record.envelope.id, { at: '', provenance: ['x'] })).toThrow();
    expect(() => store.deploy(record.envelope.id, { at: T1, provenance: [] })).toThrow();
    expect(() => store.deploy('sos://DeploymentRecord/' + '0'.repeat(32), { at: T1, provenance: ['x'] })).toThrow(
      /unknown deployment/,
    );
  });

  it('enforces unique deployment records and deployment_ids in a store', () => {
    const store = new DeploymentStore();
    const record = makeDeployment();
    store.put(record);
    expect(() => store.put(record)).toThrow(/already registered/);
    expect(() =>
      store.put(
        makeDeployment({
          // Same deployment_id, distinct content (distinct deterministic id).
          configuration: { replicas: 4 },
        }),
      ),
    ).toThrow(/deployment_id already registered/);
    expect(store.getByDeploymentId('deploy-prod-2025-06-01')!.envelope.id).toBe(record.envelope.id);
    expect(store.list()).toHaveLength(1);
  });
});
