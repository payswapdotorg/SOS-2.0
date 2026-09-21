/**
 * Provider configuration contract tests (Work Order P3): Vercel project
 * scope, Neon naming/migrations, Upstash never-canonical namespaces, R2
 * immutable layout, GitHub CI topology.
 */

import {
  VERCEL_APP_ROOT_DEFAULT,
  VERCEL_HOBBY_HARD_CAP_MS,
  VERCEL_HOBBY_REQUEST_BUDGET_MS,
  assertValidRequestLifetimeBudget,
  assertValidVercelAppRoot,
  vercelProjectScope,
} from '../src/providers/vercel.ts';
import {
  NEON_MIGRATION_CONTRACT,
  NEON_REGIONS,
  neonBranchName,
  neonConnectionPlan,
  neonDatabaseName,
  neonDatabaseNameFromConnectionUrl,
  assertValidNeonBranchName,
  assertValidNeonDatabaseName,
} from '../src/providers/neon.ts';
import {
  UPSTASH_NEVER_CANONICAL_CONTRACT,
  UPSTASH_NAMESPACE_PURPOSES,
  UPSTASH_TTL_POLICY_MS,
  assertNeverCanonical,
  tierOfNamespace,
  upstashKeyPrefix,
  upstashNamespace,
  upstashNamespacesForTier,
} from '../src/providers/upstash.ts';
import {
  R2_IMMUTABILITY_CONTRACT,
  r2ObjectKey,
  r2TierPrefix,
  assertPlainObjectName,
  assertR2KeyBelongsToTier,
  assertR2ObjectOperation,
} from '../src/providers/r2.ts';
import {
  GITHUB_CI_TOPOLOGY_CONTRACT,
  GITHUB_FROZEN_WORKFLOWS,
  assertValidWorkflowPath,
} from '../src/providers/github.ts';
import { EnvironmentValidationError, InfraDeploymentError } from '../src/core/types.ts';

describe('vercel configuration contract', () => {
  it('pins the monorepo app root and framework preset per tier', () => {
    for (const tier of ['production', 'preview'] as const) {
      const scope = vercelProjectScope(tier);
      expect(scope.appRoot).toBe(VERCEL_APP_ROOT_DEFAULT);
      expect(scope.frameworkPreset).toBe('nextjs');
      expect(scope.environment).toBe(tier === 'production' ? 'production' : 'preview');
    }
  });

  it('local tier has NO deployment dimension by contract', () => {
    expect(vercelProjectScope('local').environment).toBeUndefined();
  });

  it('rejects a different app root (the free-tier contract pins apps/web)', () => {
    expect(() => assertValidVercelAppRoot('apps/other')).toThrow(EnvironmentValidationError);
    expect(() => assertValidVercelAppRoot('apps/web')).not.toThrow();
  });

  it('validates request-lifetime budgets against the Hobby hard cap', () => {
    expect(() => assertValidRequestLifetimeBudget(1)).not.toThrow();
    expect(() => assertValidRequestLifetimeBudget(VERCEL_HOBBY_HARD_CAP_MS)).not.toThrow();
    expect(() => assertValidRequestLifetimeBudget(VERCEL_HOBBY_HARD_CAP_MS + 1)).toThrow(/hard cap/);
    expect(() => assertValidRequestLifetimeBudget(0)).toThrow(/positive finite/);
    expect(VERCEL_HOBBY_REQUEST_BUDGET_MS).toBeLessThanOrEqual(VERCEL_HOBBY_HARD_CAP_MS);
  });
});

describe('neon configuration contract', () => {
  it('names databases and branches per tier (separate stores)', () => {
    expect(neonDatabaseName('production')).toBe('sos');
    expect(neonDatabaseName('preview')).toBe('sos_preview');
    expect(neonDatabaseName('local')).toBe('sos_local');
    expect(neonBranchName('production')).toBe('main');
    expect(neonBranchName('preview')).toMatch(/^preview\//);
  });

  it('the connection plan carries VARIABLE NAMES, never values', () => {
    const plan = neonConnectionPlan('preview');
    expect(plan.connectionStringVariable).toBe('DATABASE_URL');
    expect(plan.databaseName).toBe('sos_preview');
    expect(plan.pooled).toBe(true);
    expect(plan.canonical).toBe(true);
    expect(JSON.stringify(plan)).not.toContain('postgres://');
  });

  it('extracts ONLY the public database-name segment from connection URLs', () => {
    expect(neonDatabaseNameFromConnectionUrl('postgres://u:p@ep-1.neon.tech/sos_preview?sslmode=require')).toBe(
      'sos_preview',
    );
    expect(neonDatabaseNameFromConnectionUrl('postgres://u:p@ep-1.neon.tech/')).toBeUndefined();
    expect(neonDatabaseNameFromConnectionUrl('garbage')).toBeUndefined();
  });

  it('validates database and branch names against the conventions', () => {
    expect(() => assertValidNeonDatabaseName('sos_preview')).not.toThrow();
    expect(() => assertValidNeonDatabaseName('Bad Name')).toThrow(/naming convention/);
    expect(() => assertValidNeonBranchName('main')).not.toThrow();
    expect(() => assertValidNeonBranchName('preview/my-slug')).not.toThrow();
    expect(() => assertValidNeonBranchName('preview/')).toThrow(/branch convention/);
    expect(() => assertValidNeonBranchName('weird/branch')).toThrow(/branch convention/);
  });

  it('the migration contract is machine-checkable (runner, ordering, recording)', () => {
    expect(NEON_MIGRATION_CONTRACT.runner).toBe('github-actions');
    expect(NEON_MIGRATION_CONTRACT.ordering).toBe('lexical-by-filename');
    expect(NEON_MIGRATION_CONTRACT.recording).toBe('deployment-revision-record');
    expect(NEON_MIGRATION_CONTRACT.previewRule).toContain('preview database FIRST');
    expect(NEON_REGIONS.length).toBeGreaterThan(0);
  });
});

describe('upstash configuration contract (Redis is NEVER canonical)', () => {
  it('namespaces are tier-prefixed and cover the coordination purposes', () => {
    expect(upstashNamespace('production', 'cache')).toBe('sos:production:cache');
    expect(upstashNamespace('preview', 'leases')).toBe('sos:preview:leases');
    expect(upstashKeyPrefix('preview', 'idempotency')).toBe('sos:preview:idempotency:');
    expect(UPSTASH_NAMESPACE_PURPOSES).toEqual(['cache', 'idempotency', 'rate-limit', 'leases', 'queue']);
  });

  it('every namespace declaration carries canonical: false and a bounded TTL', () => {
    for (const declaration of upstashNamespacesForTier('preview')) {
      expect(declaration.canonical).toBe(false);
      expect(declaration.ttlMs).toBe(UPSTASH_TTL_POLICY_MS[declaration.purpose]);
      expect(declaration.ttlMs).toBeGreaterThan(0);
      expect(() => assertNeverCanonical(declaration)).not.toThrow();
    }
  });

  it('TYPE-REJECTS a namespace declaration that claims canonicity', () => {
    const heretical = {
      provider: 'upstash' as const,
      namespace: 'sos:preview:cache',
      purpose: 'cache' as const,
      canonical: true,
      ttlMs: UPSTASH_TTL_POLICY_MS.cache,
    };
    expect(() => assertNeverCanonical(heretical as never)).toThrow(InfraDeploymentError);
    expect(() => assertNeverCanonical(heretical as never)).toThrow(/NEVER canonical/);
  });

  it('type-rejects unbounded TTLs and off-convention namespaces', () => {
    expect(() =>
      assertNeverCanonical({
        provider: 'upstash',
        namespace: 'sos:preview:cache',
        purpose: 'cache',
        canonical: false,
        ttlMs: 0,
      }),
    ).toThrow(/positive finite TTL/);
    expect(() =>
      assertNeverCanonical({
        provider: 'upstash',
        namespace: 'some-other:cache',
        purpose: 'cache',
        canonical: false,
        ttlMs: 1000,
      }),
    ).toThrow(/not tier-prefixed|tier-prefixed naming convention/);
  });

  it('parses tier segments deterministically', () => {
    expect(tierOfNamespace('sos:local:queue')).toBe('local');
    expect(tierOfNamespace('sos:production:leases')).toBe('production');
    expect(() => tierOfNamespace('nope:cache')).toThrow(/tier-prefixed/);
  });

  it('documents the never-canonical rule as an encoded contract', () => {
    expect(UPSTASH_NEVER_CANONICAL_CONTRACT.rule).toContain('never canonical');
    expect(UPSTASH_NEVER_CANONICAL_CONTRACT.durableWrites).toContain('Neon');
    expect(UPSTASH_NEVER_CANONICAL_CONTRACT.recovery).toContain('never lose semantic state');
  });
});

describe('r2 configuration contract (immutable objects, prefix isolation)', () => {
  it('builds tier-prefixed object keys per purpose', () => {
    expect(r2ObjectKey('production', 'evidence', 'report-abc123')).toBe('production/evidence/report-abc123');
    expect(r2ObjectKey('preview', 'imports', 'seed-abc123')).toBe('preview/default/imports/seed-abc123');
    expect(r2ObjectKey('local', 'reports', 'run-abc123')).toBe('local/reports/run-abc123');
    expect(r2TierPrefix('production')).toBe('production');
  });

  it('type-rejects overwrite-mode operations (write-once immutable objects)', () => {
    expect(() =>
      assertR2ObjectOperation({
        provider: 'r2',
        tier: 'production',
        purpose: 'evidence',
        key: 'production/evidence/report-abc123',
        mode: 'overwrite',
        contentAnchor: 'deadbeef',
      }),
    ).toThrow(/write-once immutable/);
  });

  it('type-rejects operations outside the tier prefix (cross-tier references)', () => {
    expect(() =>
      assertR2ObjectOperation({
        provider: 'r2',
        tier: 'preview',
        purpose: 'evidence',
        key: 'production/evidence/report-abc123',
        mode: 'create',
        contentAnchor: 'deadbeef',
      }),
    ).toThrow(/tier prefix isolation/);
  });

  it('type-rejects operations without a content anchor (immutability is content-anchored)', () => {
    expect(() =>
      assertR2ObjectOperation({
        provider: 'r2',
        tier: 'preview',
        purpose: 'evidence',
        key: 'preview/default/evidence/x',
        mode: 'create',
        contentAnchor: 'short',
      }),
    ).toThrow(/content anchor/);
  });

  it('rejects malformed object names (traversal, emptiness, bad charset)', () => {
    expect(() => assertPlainObjectName('../escape')).toThrow(/malformed|traversal/);
    expect(() => assertPlainObjectName('')).toThrow(/non-empty/);
    expect(() => assertPlainObjectName('a b/c')).toThrow(/naming convention/);
    expect(() => assertR2KeyBelongsToTier('production/evidence/x', 'preview')).toThrow(/cross-tier/);
    expect(() => assertR2KeyBelongsToTier('preview/default/evidence/x', 'preview')).not.toThrow();
  });

  it('documents the immutability contract', () => {
    expect(R2_IMMUTABILITY_CONTRACT.writeMode).toContain('create-only');
    expect(R2_IMMUTABILITY_CONTRACT.metadata).toContain('durable semantic layer');
  });
});

describe('github configuration contract', () => {
  it('pins the CI topology rules (thin callers, frozen verify.yml, offline)', () => {
    expect(GITHUB_CI_TOPOLOGY_CONTRACT.autoDiscovery).toContain('only at .github/workflows/*.yml');
    expect(GITHUB_CI_TOPOLOGY_CONTRACT.thinCallerRule).toContain('THIN callers');
    expect(GITHUB_CI_TOPOLOGY_CONTRACT.offlineRule).toContain('no credentials');
    expect(GITHUB_FROZEN_WORKFLOWS).toContain('.github/workflows/verify.yml');
  });

  it('validates workflow paths: thin callers or deployment definitions, never frozen targets', () => {
    expect(() => assertValidWorkflowPath('.github/workflows/deploy-contract.yml')).not.toThrow();
    expect(() => assertValidWorkflowPath('.github/workflows/deployment/contract-verify.yml')).not.toThrow();
    expect(() => assertValidWorkflowPath('.github/workflows/verify.yml')).toThrow(/frozen/);
    expect(() => assertValidWorkflowPath('scripts/evil.mjs')).toThrow(/top-level thin caller/);
    expect(() => assertValidWorkflowPath('docs/deployment/runtime/x.md')).toThrow(/top-level thin caller/);
  });
});
