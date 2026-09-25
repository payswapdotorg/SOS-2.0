/**
 * The STRUCTURAL infra vocabulary of the deployment lane (Work Order
 * P17-A) — the P3 provider configuration contracts carried
 * structurally, following the frozen P8 body-runtimes precedent (the
 * P17-B github-vocabulary.ts and P17-A real-persistence
 * infra-vocabulary.ts precedents): `@sos-2/infra-deployment` is a frozen
 * ZERO-dependency, no-build package with no module entry point, so a
 * consuming package CANNOT import it as a module. The contract surface
 * this lane consumes is mirrored field-for-field here, and the
 * alignment with the REAL P3 sources is PINNED BY TEST in
 * tests/real-persistence (non-literal dynamic imports — vitest
 * transforms them; the tsc build never sees the specifier).
 */

// ---------------------------------------------------------------------------
// Vercel project scope (P3 providers/vercel.ts, structural mirror)
// ---------------------------------------------------------------------------

/** Framework presets the contract knows (frozen vocabulary). */
export const VERCEL_FRAMEWORK_PRESETS = ['nextjs'] as const;
export type VercelFrameworkPreset = (typeof VERCEL_FRAMEWORK_PRESETS)[number];

/** The documented app root deployed to Vercel (monorepo, P1 target). */
export const VERCEL_APP_ROOT_DEFAULT = 'apps/web';

/** Deployment environment dimension inside one Vercel project. */
export type VercelEnvironmentDimension = 'production' | 'preview';

/** The Vercel project scope for a tier. */
export interface VercelProjectScope {
  readonly provider: 'vercel';
  readonly tier: 'local' | 'preview' | 'production';
  readonly appRoot: string;
  readonly frameworkPreset: VercelFrameworkPreset;
  readonly projectIdVariable: 'VERCEL_PROJECT_ID';
  readonly orgIdVariable: 'VERCEL_ORG_ID';
  /** local => undefined by contract: no Vercel deployment target exists locally. */
  readonly environment: VercelEnvironmentDimension | undefined;
}

/** The Vercel project scope contract per tier (deterministic and total). */
export function vercelProjectScope(tier: 'local' | 'preview' | 'production'): VercelProjectScope {
  switch (tier) {
    case 'production':
      return {
        provider: 'vercel',
        tier,
        appRoot: VERCEL_APP_ROOT_DEFAULT,
        frameworkPreset: 'nextjs',
        projectIdVariable: 'VERCEL_PROJECT_ID',
        orgIdVariable: 'VERCEL_ORG_ID',
        environment: 'production',
      };
    case 'preview':
      return {
        provider: 'vercel',
        tier,
        appRoot: VERCEL_APP_ROOT_DEFAULT,
        frameworkPreset: 'nextjs',
        projectIdVariable: 'VERCEL_PROJECT_ID',
        orgIdVariable: 'VERCEL_ORG_ID',
        environment: 'preview',
      };
    case 'local':
      return {
        provider: 'vercel',
        tier,
        appRoot: VERCEL_APP_ROOT_DEFAULT,
        frameworkPreset: 'nextjs',
        projectIdVariable: 'VERCEL_PROJECT_ID',
        orgIdVariable: 'VERCEL_ORG_ID',
        environment: undefined,
      };
  }
}

/** Validates a caller-supplied app root against the monorepo contract. */
export function assertValidVercelAppRoot(appRoot: string): void {
  if (appRoot !== VERCEL_APP_ROOT_DEFAULT) {
    throw new Error(
      `Vercel app root must be '${VERCEL_APP_ROOT_DEFAULT}' (the P1 production target inside this monorepo); got a different root — the free-tier contract pins the deployed app`,
    );
  }
}

// ---------------------------------------------------------------------------
// Vercel regions (P3 revisions/registrar.ts, structural mirror)
// ---------------------------------------------------------------------------

/** Vercel regions (documented subset of the deployment contract). */
export const VERCEL_REGIONS = ['iad1', 'sfo1', 'fra1', 'cdg1', 'hnd1', 'syd1'] as const;
export type VercelRegion = (typeof VERCEL_REGIONS)[number];
export const VERCEL_DEFAULT_REGION: VercelRegion = 'iad1';

// ---------------------------------------------------------------------------
// Deployment revision records (P3 revisions/registrar.ts, structural mirror)
// ---------------------------------------------------------------------------

/**
 * The deployment revision record (machine-checkable). registered_at is
 * an injected clock value: RFC3339 UTC string (the caller owns time).
 */
export interface DeploymentRevisionRecord {
  readonly environment: 'local' | 'preview' | 'production';
  readonly provider: 'vercel' | 'neon' | 'upstash' | 'r2' | 'github' | 'execution-body-provider';
  readonly region: string;
  /** Exact source revision this deployment was built from (40-hex git sha). */
  readonly source_revision_sha: string;
  /** Provider-assigned deployment revision id (non-empty, opaque). */
  readonly deployment_revision_id: string;
  /** RFC3339 UTC instant, injected by the caller. */
  readonly registered_at: string;
  /** Previous deployment revision id for this environment+provider (null on first). */
  readonly rollback_pointer: { readonly previous_deployment_revision_id: string | null };
}

const RFC3339_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const SHA_40 = /^[0-9a-f]{40}$/;

const PROVIDER_REGION_CONTRACT: Readonly<Record<DeploymentRevisionRecord['provider'], { readonly regions: readonly string[]; readonly default: string }>> = {
  vercel: { regions: VERCEL_REGIONS, default: VERCEL_DEFAULT_REGION },
  neon: { regions: ['aws-us-east-1', 'aws-us-west-2', 'aws-eu-central-1', 'aws-ap-southeast-1'], default: 'aws-us-east-1' },
  upstash: { regions: ['global', 'us-east-1', 'us-west-1', 'eu-central-1'], default: 'global' },
  r2: { regions: ['auto', 'wnam', 'enam', 'weur', 'eeur', 'apac'], default: 'auto' },
  github: { regions: ['global'], default: 'global' },
  'execution-body-provider': { regions: ['provider-defined'], default: 'provider-defined' },
} as const;

/** Validates one deployment revision record against the P3 contract. */
export function validateDeploymentRevisionRecord(record: DeploymentRevisionRecord): void {
  const tiers = ['local', 'preview', 'production'];
  if (!tiers.includes(record.environment)) {
    throw new Error(
      `deployment revision record environment must be one of local|preview|production (got '${String(record.environment)}')`,
    );
  }
  const regionContract = PROVIDER_REGION_CONTRACT[record.provider];
  if (regionContract === undefined) {
    throw new Error(
      `deployment revision record provider must be a known infra provider id (got '${String(record.provider)}')`,
    );
  }
  if (!regionContract.regions.includes(record.region)) {
    throw new Error(
      `deployment revision record region '${record.region}' is not in the ${record.provider} region contract (${regionContract.regions.join(', ')})`,
    );
  }
  if (!SHA_40.test(record.source_revision_sha)) {
    throw new Error(
      'deployment revision record source_revision_sha must be a 40-char lowercase hex git sha (the exact-head rule)',
    );
  }
  if (typeof record.deployment_revision_id !== 'string' || record.deployment_revision_id.length === 0) {
    throw new Error('deployment revision record deployment_revision_id must be a non-empty string');
  }
  if (!RFC3339_UTC.test(record.registered_at)) {
    throw new Error(
      `deployment revision record registered_at must be an RFC3339 UTC instant (injected clock value); got '${record.registered_at}'`,
    );
  }
  if (record.rollback_pointer === null || typeof record.rollback_pointer !== 'object') {
    throw new Error(
      'deployment revision record rollback_pointer must be an object { previous_deployment_revision_id: string | null }',
    );
  }
  const previous = record.rollback_pointer.previous_deployment_revision_id;
  if (previous !== null && (typeof previous !== 'string' || previous.length === 0)) {
    throw new Error(
      'deployment revision record rollback_pointer.previous_deployment_revision_id must be a non-empty string or null',
    );
  }
}
