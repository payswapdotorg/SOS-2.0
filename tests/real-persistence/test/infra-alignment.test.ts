/**
 * The structural alignment suite (Work Order P17-A) — the P17-B
 * pinning precedent: the infra-vocabulary mirrors in
 * @sos-2/real-persistence and @sos-2/deployment-providers must be
 * field-for-field ALIGNED with the REAL frozen P3 infra/deployment
 * sources. The frozen package is a zero-dependency no-build package
 * with no module entry point, so its sources are imported here through
 * NON-LITERAL dynamic imports (vitest transforms them; the tsc build
 * never sees the specifier — the exact P17-B github-vocabulary pinning
 * discipline).
 *
 * Any drift in EITHER direction fails loudly here.
 */

import { describe, expect, it } from 'vitest';
import {
  NEON_REGIONS,
  UPSTASH_TTL_POLICY_MS,
  neonDatabaseName,
  neonBranchName,
  neonDatabaseNameFromConnectionUrl,
  upstashTierPrefix,
  upstashNamespace,
  r2TierPrefix,
  r2ObjectKey,
  assertPlainObjectName,
  VERCEL_REGIONS,
  validateDeploymentRevisionRecord,
} from '@sos-2/real-persistence';
import { VERCEL_APP_ROOT_DEFAULT, vercelProjectScope, assertValidVercelAppRoot } from '@sos-2/deployment-providers';

/** Non-literal specifier builder (the tsc build never sees the frozen-source path). */
function frozenSource(file: string): string {
  const base = ['..', '..', '..', 'infra', 'deployment', 'src'];
  return [...base, ...file.split('/')].join('/');
}

describe('the P3 neon contract mirror is field-for-field aligned with the frozen source', () => {
  it('database/branch naming per tier matches', async () => {
    const real = await import(/* frozen */ frozenSource('providers/neon.ts'));
    const realNeon = real as unknown as {
      neonDatabaseName: (tier: 'local' | 'preview' | 'production') => string;
      neonBranchName: (tier: 'local' | 'preview' | 'production') => string;
      neonDatabaseNameFromConnectionUrl: (url: string) => string | undefined;
      NEON_REGIONS: readonly string[];
      NEON_DEFAULT_REGION: string;
    };
    for (const tier of ['local', 'preview', 'production'] as const) {
      expect(neonDatabaseName(tier)).toBe(realNeon.neonDatabaseName(tier));
      expect(neonBranchName(tier)).toBe(realNeon.neonBranchName(tier));
    }
    expect(NEON_REGIONS).toEqual(realNeon.NEON_REGIONS);
    expect(neonDatabaseNameFromConnectionUrl('postgres://u:p@host/sos?sslmode=require')).toBe(
      realNeon.neonDatabaseNameFromConnectionUrl('postgres://u:p@host/sos?sslmode=require'),
    );
  });
});

describe('the P3 upstash contract mirror is field-for-field aligned with the frozen source', () => {
  it('namespaces, TTL policy and the tier prefix match verbatim', async () => {
    const real = await import(frozenSource('providers/upstash.ts'));
    const realUpstash = real as unknown as {
      UPSTASH_TTL_POLICY_MS: Record<string, number>;
      upstashTierPrefix: (tier: 'local' | 'preview' | 'production') => string;
      upstashNamespace: (tier: 'local' | 'preview' | 'production', purpose: string) => string;
      UPSTASH_NAMESPACE_PURPOSES: readonly string[];
      assertNeverCanonical: (declaration: unknown) => void;
    };
    expect(UPSTASH_TTL_POLICY_MS).toEqual(realUpstash.UPSTASH_TTL_POLICY_MS);
    for (const tier of ['local', 'preview', 'production'] as const) {
      expect(upstashTierPrefix(tier)).toBe(realUpstash.upstashTierPrefix(tier));
      for (const purpose of ['cache', 'idempotency', 'rate-limit', 'leases', 'queue'] as const) {
        expect(upstashNamespace(tier, purpose)).toBe(realUpstash.upstashNamespace(tier, purpose));
      }
    }
    expect(['cache', 'idempotency', 'rate-limit', 'leases', 'queue']).toEqual([...realUpstash.UPSTASH_NAMESPACE_PURPOSES]);
  });
});

describe('the P3 r2 contract mirror is field-for-field aligned with the frozen source', () => {
  it('tier prefixes, object keys and the name validator match verbatim (rejections included)', async () => {
    const real = await import(frozenSource('providers/r2.ts'));
    const realR2 = real as unknown as {
      r2TierPrefix: (tier: 'local' | 'preview' | 'production') => string;
      r2ObjectKey: (tier: 'local' | 'preview' | 'production', purpose: 'evidence' | 'imports' | 'reports', name: string) => string;
      assertPlainObjectName: (name: string) => void;
    };
    for (const tier of ['local', 'preview', 'production'] as const) {
      expect(r2TierPrefix(tier)).toBe(realR2.r2TierPrefix(tier));
      for (const purpose of ['evidence', 'imports', 'reports'] as const) {
        expect(r2ObjectKey(tier, purpose, 'deadbeef42')).toBe(realR2.r2ObjectKey(tier, purpose, 'deadbeef42'));
      }
    }
    for (const bad of ['', '..', 'a/b', '../x', '/abs']) {
      expect(() => assertPlainObjectName(bad)).toThrow();
      expect(() => realR2.assertPlainObjectName(bad)).toThrow();
    }
    expect(() => assertPlainObjectName('valid-name.1')).not.toThrow();
  });
});

describe('the P3 vercel + revision contracts mirror is field-for-field aligned with the frozen sources', () => {
  it('the project scope per tier, the app-root contract and the region list match verbatim', async () => {
    const real = await import(frozenSource('providers/vercel.ts'));
    const realVercel = real as unknown as {
      vercelProjectScope: (tier: 'local' | 'preview' | 'production') => Record<string, unknown>;
      VERCEL_APP_ROOT_DEFAULT: string;
      assertValidVercelAppRoot: (appRoot: string) => void;
    };
    expect(VERCEL_APP_ROOT_DEFAULT).toBe(realVercel.VERCEL_APP_ROOT_DEFAULT);
    for (const tier of ['local', 'preview', 'production'] as const) {
      expect(vercelProjectScope(tier)).toEqual(realVercel.vercelProjectScope(tier));
    }
    expect(() => assertValidVercelAppRoot('apps/web')).not.toThrow();
    expect(() => realVercel.assertValidVercelAppRoot('apps/web')).not.toThrow();
    expect(() => assertValidVercelAppRoot('apps/other')).toThrow();
    expect(() => realVercel.assertValidVercelAppRoot('apps/other')).toThrow();
    const registrar = await import(frozenSource('revisions/registrar.ts'));
    const realRegions = (registrar as unknown as { VERCEL_REGIONS: readonly string[] }).VERCEL_REGIONS;
    expect(VERCEL_REGIONS).toEqual(realRegions);
  });

  it('the deployment revision record validation agrees on valid AND invalid records', async () => {
    const registrar = await import(frozenSource('revisions/registrar.ts'));
    const realValidate = (registrar as unknown as { validateDeploymentRevisionRecord: (record: unknown) => void })
      .validateDeploymentRevisionRecord;
    const base = {
      environment: 'production',
      provider: 'vercel',
      region: 'iad1',
      source_revision_sha: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0',
      deployment_revision_id: 'dpl_1',
      registered_at: '2026-04-16T12:00:00.000Z',
      rollback_pointer: { previous_deployment_revision_id: null },
    } as const;
    expect(() => validateDeploymentRevisionRecord(base)).not.toThrow();
    expect(() => realValidate(base)).not.toThrow();
    const invalidRecords = [
      { ...base, environment: 'staging' },
      { ...base, region: 'not-a-region' },
      { ...base, source_revision_sha: 'xyz' },
      { ...base, registered_at: '2026-04-16 12:00:00' },
      { ...base, rollback_pointer: null },
    ] as unknown as Parameters<typeof validateDeploymentRevisionRecord>[0][];
    for (const invalid of invalidRecords) {
      expect(() => validateDeploymentRevisionRecord(invalid)).toThrow();
      expect(() => realValidate(invalid)).toThrow();
    }
  });
});

describe('the P3 environment registry names are carried exactly (the composition consumes the registry names)', () => {
  it('the P17-A env names are exactly the P3 registry names for this lane', async () => {
    const schema = await import(frozenSource('environment/schema.ts'));
    const registry = (schema as unknown as { ENVIRONMENT_VARIABLE_REGISTRY: readonly { name: string }[] }).ENVIRONMENT_VARIABLE_REGISTRY;
    const names = new Set(registry.map((spec) => spec.name));
    const { REAL_PERSISTENCE_ENVIRONMENT_VARIABLES } = await import('@sos-2/real-persistence');
    const { REAL_DEPLOYMENT_ENVIRONMENT_VARIABLES } = await import('@sos-2/deployment-providers');
    // The documented lane alternates — intentionally not registry names:
    // NEON_API_KEY_SECONDARY (the dispatch's fail-over key) and R2_S3_ENDPOINT
    // (derivable from R2_ACCOUNT_ID: https://<account>.r2.cloudflarestorage.com;
    // accepted only as an optional override).
    const laneAlternates = new Set(['NEON_API_KEY_SECONDARY', 'R2_S3_ENDPOINT']);
    for (const name of Object.values(REAL_PERSISTENCE_ENVIRONMENT_VARIABLES)) {
      if (laneAlternates.has(name)) {
        continue;
      }
      expect(names.has(name), `P17-A persistence env name '${name}' must exist in the P3 registry`).toBe(true);
    }
    for (const name of Object.values(REAL_DEPLOYMENT_ENVIRONMENT_VARIABLES)) {
      expect(names.has(name), `P17-A deployment env name '${name}' must exist in the P3 registry`).toBe(true);
    }
    // NEON_API_KEY_SECONDARY is the documented lane alternate (the
    // dispatch's fail-over key) — intentionally NOT a registry name.
    expect(names.has('NEON_API_KEY_SECONDARY')).toBe(false);
  });
});
