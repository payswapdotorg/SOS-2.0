/**
 * Deployment revision registration tests (Work Order P3): record contract
 * validation, serialization round-trip, and the append-only reference
 * registrar with rollback pointers.
 */

import {
  DeploymentRevisionError,
  InMemoryDeploymentRevisionRegistrar,
  PROVIDER_REGION_CONTRACT,
  parseDeploymentRevisionRecord,
  serializeDeploymentRevisionRecord,
  validateDeploymentRevisionRecord,
} from '../src/revisions/registrar.ts';
import {
  CLOCK_T0_RFC3339,
  CLOCK_T1_RFC3339,
  CLOCK_T2_RFC3339,
  SHA_BAD,
  SHA_HEAD_1,
  SHA_HEAD_2,
  firstRevision,
  secondRevision,
} from './fixtures.ts';

describe('deployment revision record contract', () => {
  it('accepts a valid record (exact sha, region, injected instant, rollback pointer)', () => {
    expect(() => validateDeploymentRevisionRecord(firstRevision('preview'))).not.toThrow();
    expect(() => validateDeploymentRevisionRecord(secondRevision('production'))).not.toThrow();
  });

  it('requires a 40-char lowercase hex source revision sha (the exact-head rule)', () => {
    const record = { ...firstRevision('preview'), source_revision_sha: SHA_BAD };
    expect(() => validateDeploymentRevisionRecord(record)).toThrow(/40-char lowercase hex/);
    const upper = { ...firstRevision('preview'), source_revision_sha: SHA_HEAD_1.toUpperCase() };
    expect(() => validateDeploymentRevisionRecord(upper)).toThrow(/40-char lowercase hex/);
  });

  it('requires a region from the provider region contract', () => {
    expect(() => validateDeploymentRevisionRecord({ ...firstRevision('preview'), region: 'mars-1' })).toThrow(
      /region contract/,
    );
    expect(PROVIDER_REGION_CONTRACT.vercel.regions).toContain('iad1');
    expect(PROVIDER_REGION_CONTRACT.neon.regions).toContain('aws-us-east-1');
    expect(PROVIDER_REGION_CONTRACT.r2.default).toBe('auto');
    expect(PROVIDER_REGION_CONTRACT['execution-body-provider'].default).toBe('provider-defined');
  });

  it('requires an RFC3339 UTC injected instant and a well-formed rollback pointer', () => {
    expect(() =>
      validateDeploymentRevisionRecord({ ...firstRevision('preview'), registered_at: 'yesterday' }),
    ).toThrow(/RFC3339/);
    expect(() =>
      validateDeploymentRevisionRecord({
        ...firstRevision('preview'),
        rollback_pointer: { previous_deployment_revision_id: '' },
      }),
    ).toThrow(/non-empty string or null/);
    expect(() =>
      validateDeploymentRevisionRecord({ ...firstRevision('preview'), deployment_revision_id: '' }),
    ).toThrow(/deployment_revision_id/);
  });

  it('round-trips serialization with validation on both ends', () => {
    const record = secondRevision('production');
    const serialized = serializeDeploymentRevisionRecord(record);
    expect(serialized).toContain(SHA_HEAD_2);
    const parsed = parseDeploymentRevisionRecord(serialized);
    expect(parsed).toEqual(record);
    expect(() => parseDeploymentRevisionRecord('{not json')).toThrow(DeploymentRevisionError);
    expect(() => parseDeploymentRevisionRecord('{"environment":"nope"}')).toThrow(/local\|preview\|production/);
  });
});

describe('in-memory reference registrar (append-only, rollback chain)', () => {
  it('registers, lists (oldest first), and resolves the latest revision', () => {
    const registrar = new InMemoryDeploymentRevisionRegistrar();
    registrar.register(firstRevision('preview'));
    registrar.register(secondRevision('preview'));
    expect(registrar.list('preview', 'vercel').length).toBe(2);
    expect(registrar.list('preview', 'vercel')[0]?.deployment_revision_id).toBe('dpl-preview-0001');
    expect(registrar.latest('preview', 'vercel')?.deployment_revision_id).toBe('dpl-preview-0002');
  });

  it('keeps environments and providers separate (no cross-contamination)', () => {
    const registrar = new InMemoryDeploymentRevisionRegistrar();
    registrar.register(firstRevision('preview'));
    expect(registrar.latest('production', 'vercel')).toBeUndefined();
    expect(registrar.latest('preview', 'neon')).toBeUndefined();
    expect(registrar.rollbackTarget('production', 'vercel')).toBeNull();
  });

  it('resolves the rollback target from the chain (previous revision id)', () => {
    const registrar = new InMemoryDeploymentRevisionRegistrar();
    registrar.register(firstRevision('production'));
    expect(registrar.rollbackTarget('production', 'vercel')).toBeNull(); // first deployment: nothing to roll back to
    registrar.register(secondRevision('production'));
    expect(registrar.rollbackTarget('production', 'vercel')).toBe('dpl-production-0001');
  });

  it('type-rejects re-registration of the same revision id (append-only)', () => {
    const registrar = new InMemoryDeploymentRevisionRegistrar();
    registrar.register(firstRevision('preview'));
    expect(() => registrar.register(firstRevision('preview'))).toThrow(/append-only/);
  });

  it('type-rejects a broken rollback chain', () => {
    const registrar = new InMemoryDeploymentRevisionRegistrar();
    registrar.register(firstRevision('preview'));
    const orphan = {
      ...secondRevision('preview'),
      rollback_pointer: { previous_deployment_revision_id: 'dpl-preview-9999' },
    };
    expect(() => registrar.register(orphan)).toThrow(/rollback pointer must reference the current revision/);
    const falseFirst = {
      ...firstRevision('production'),
      deployment_revision_id: 'dpl-production-0001-x',
      rollback_pointer: { previous_deployment_revision_id: 'dpl-production-0000' },
    };
    expect(() => registrar.register(falseFirst)).toThrow(/null rollback pointer/);
  });

  it('registers records across providers with independent chains and injected instants', () => {
    const registrar = new InMemoryDeploymentRevisionRegistrar();
    registrar.register(firstRevision('production')); // vercel, T0
    registrar.register({
      environment: 'production',
      provider: 'neon',
      region: 'aws-us-east-1',
      source_revision_sha: SHA_HEAD_1,
      deployment_revision_id: 'neon-dpl-0001',
      registered_at: CLOCK_T2_RFC3339,
      rollback_pointer: { previous_deployment_revision_id: null },
    });
    const vercelLatest = registrar.latest('production', 'vercel');
    const neonLatest = registrar.latest('production', 'neon');
    expect(vercelLatest?.registered_at).toBe(CLOCK_T0_RFC3339);
    expect(neonLatest?.registered_at).toBe(CLOCK_T2_RFC3339);
    // A second vercel deployment at T1 keeps the vercel chain intact.
    registrar.register(secondRevision('production'));
    expect(registrar.latest('production', 'vercel')?.registered_at).toBe(CLOCK_T1_RFC3339);
  });
});
