/**
 * Deterministic test fixtures for the P3 contract suites.
 *
 * Every value is a fixed literal: no clocks (fixed instants/shas), no
 * entropy, no network. Secret-shaped fixture values are SYNTHETIC (used
 * to prove the detection corpus works); they are not credentials, and
 * they live ONLY under test/ — the CI secret scan scope excludes this
 * directory for exactly that reason, documented in the scanner.
 */

import type { BodyProviderConfig } from '../src/execution/body-providers.ts';
import type { DeploymentRevisionRecord } from '../src/revisions/registrar.ts';
import type { RawEnvironmentSource } from '../src/core/types.ts';

/** Fixed injected clock instants (RFC3339 UTC + epoch ms). */
export const CLOCK_T0_RFC3339 = '2026-01-05T09:00:00Z';
export const CLOCK_T1_RFC3339 = '2026-01-05T09:05:00Z';
export const CLOCK_T2_RFC3339 = '2026-01-05T09:10:00Z';
export const CLOCK_T0_MS = 1767603600000;
export const CLOCK_T1_MS = 1767603900000;
export const CLOCK_T2_MS = 1767604200000;

/** Fixed 40-hex source revision shas (the exact-head rule shape). */
export const SHA_HEAD_1 = 'c924e617650a243df9df7580e60d0e021fac1059';
export const SHA_HEAD_2 = 'aa19c0ffee000000000000000000000000000001';
export const SHA_BAD = 'not-a-sha';

/** SYNTHETIC secret-shaped fixture values (detection corpus proofs). */
export const SYNTHETIC_GITHUB_TOKEN = 'ghp_' + 'A0b0'.repeat(9); // ghp_ + 36 alnum chars (real token shape, synthetic content)
export const SYNTHETIC_AWS_KEY = 'AKIA' + 'ABCDEFGHIJKLMNOP'; // AKIA + 16 chars
export const SYNTHETIC_POSTGRES_URL = 'postgres://user:sup3rs3cretpw@ep-cool-name-123456.us-east-1.aws.neon.tech/sos_preview?sslmode=require';

/** A complete, shape-valid PREVIEW source (synthetic values). */
export function fullPreviewSource(): RawEnvironmentSource {
  return {
    APP_BASE_URL: 'https://preview-sos.example.app',
    VERCEL_PROJECT_ID: 'prj_preview_0123456789',
    VERCEL_ORG_ID: 'team_sos_0123456789',
    VERCEL_TOKEN: 'vt-synthetic-preview-token-0000000001',
    VERCEL_APP_ROOT: 'apps/web',
    DATABASE_URL: `postgres://sos:previewpw@ep-preview-branch-01.aws.neon.tech/sos_preview?sslmode=require`,
    NEON_DATABASE_NAME: 'sos_preview',
    NEON_BRANCH_NAME: 'preview/default',
    NEON_API_KEY: 'neon-api-synthetic-preview-000000000001',
    UPSTASH_REDIS_REST_URL: 'https://preview-cache-00001.upstash.io',
    UPSTASH_REDIS_REST_TOKEN: 'AV-synthetic-preview-upstash-000000000001',
    R2_ACCOUNT_ID: 'sos-preview-account-0000000000000001',
    R2_ACCESS_KEY_ID: 'r2-synthetic-preview-access-key-00000001',
    R2_SECRET_ACCESS_KEY: 'r2-synthetic-preview-secret-key-0000000001',
    R2_BUCKET_NAME: 'sos-artifacts',
    GITHUB_ACCESS_TOKEN: SYNTHETIC_GITHUB_TOKEN,
    GITHUB_WEBHOOK_SECRET: 'whsec-synthetic-preview-webhook-00000001',
  };
}

/** A complete, shape-valid PRODUCTION source (synthetic values). */
export function fullProductionSource(): RawEnvironmentSource {
  return {
    APP_BASE_URL: 'https://sos.example.org',
    VERCEL_PROJECT_ID: 'prj_prod_0123456789',
    VERCEL_ORG_ID: 'team_sos_0123456789',
    VERCEL_TOKEN: 'vt-synthetic-prod-token-00000000001',
    VERCEL_APP_ROOT: 'apps/web',
    DATABASE_URL: `postgres://sos:prodpw@ep-prod-main-01.aws.neon.tech/sos?sslmode=require`,
    NEON_DATABASE_NAME: 'sos',
    NEON_BRANCH_NAME: 'main',
    NEON_API_KEY: 'neon-api-synthetic-prod-000000000001',
    UPSTASH_REDIS_REST_URL: 'https://prod-cache-00001.upstash.io',
    UPSTASH_REDIS_REST_TOKEN: 'AV-synthetic-prod-upstash-000000000001',
    R2_ACCOUNT_ID: 'sos-prod-account-0000000000000001',
    R2_ACCESS_KEY_ID: 'r2-synthetic-prod-access-key-0000000001',
    R2_SECRET_ACCESS_KEY: 'r2-synthetic-prod-secret-key-000000000001',
    R2_BUCKET_NAME: 'sos-artifacts',
    GITHUB_ACCESS_TOKEN: SYNTHETIC_GITHUB_TOKEN,
    GITHUB_WEBHOOK_SECRET: 'whsec-synthetic-prod-webhook-00000001',
  };
}

/** The LOCAL source: empty by design — documented fixture defaults apply. */
export function localSource(): RawEnvironmentSource {
  return {};
}

/** A valid body provider configuration (cloud sandbox reference body). */
export function referenceCloudBodyConfig(): BodyProviderConfig {
  return {
    providerId: 'reference-cloud-body',
    capabilities: ['terminal', 'filesystem', 'repository-operations'],
    isolationLevel: 'container',
    networkPolicy: { egress: 'allowlist', allowedHosts: ['github.com', 'api.github.com'] },
    filesystem: { mode: 'workspace', workspaceRoot: '/workspace/task' },
    costEnvelope: { maxDurationMs: 30 * 60_000, maxMemoryMb: 2048, maxCostUsdPerTask: 0.5 },
    taskLifecycle: { supportsCreate: true, supportsResume: true, supportsPause: false, supportsCancel: true, supportsCheckpoints: true },
    placement: 'cloud',
  };
}

/** A valid deployment revision record (first deployment: null rollback). */
export function firstRevision(environment: 'preview' | 'production'): DeploymentRevisionRecord {
  return {
    environment,
    provider: 'vercel',
    region: 'iad1',
    source_revision_sha: SHA_HEAD_1,
    deployment_revision_id: `dpl-${environment}-0001`,
    registered_at: CLOCK_T0_RFC3339,
    rollback_pointer: { previous_deployment_revision_id: null },
  };
}

/** A valid follow-up revision (rollback pointer to the previous id). */
export function secondRevision(environment: 'preview' | 'production'): DeploymentRevisionRecord {
  return {
    environment,
    provider: 'vercel',
    region: 'iad1',
    source_revision_sha: SHA_HEAD_2,
    deployment_revision_id: `dpl-${environment}-0002`,
    registered_at: CLOCK_T1_RFC3339,
    rollback_pointer: { previous_deployment_revision_id: `dpl-${environment}-0001` },
  };
}
