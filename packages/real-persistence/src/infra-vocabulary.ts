/**
 * The STRUCTURAL infra vocabulary of the real persistence lane (Work
 * Order P17-A) — the P3 provider configuration contracts carried
 * structurally, following the frozen P8 body-runtimes precedent
 * (the P17-B github-vocabulary.ts precedent, continued):
 * `@sos-2/infra-deployment` is a frozen ZERO-dependency, no-build
 * package with no module entry point, so a consuming package CANNOT
 * import it as a module. The contract surface this lane consumes is
 * therefore mirrored field-for-field here, and the alignment with the
 * REAL P3 sources is PINNED BY TEST (tests/real-persistence imports the
 * real sources through non-literal dynamic imports — vitest transforms
 * them; the tsc build never sees the specifier).
 *
 * Nothing here redefines frozen semantics: the naming conventions,
 * vocabulary constants and validators are the P3 contract's own,
 * mirrored verbatim; the pinning tests fail loudly on any drift in
 * EITHER direction.
 */

// ---------------------------------------------------------------------------
// Neon naming (P3 providers/neon.ts, structural mirror)
// ---------------------------------------------------------------------------

/** Database name per tier — the durable-store isolation seam. */
export function neonDatabaseName(tier: 'local' | 'preview' | 'production'): string {
  switch (tier) {
    case 'production':
      return 'sos';
    case 'preview':
      return 'sos_preview';
    case 'local':
      return 'sos_local';
  }
}

/** Branch name per tier — preview runs on isolated preview/<slug> branches. */
export function neonBranchName(tier: 'local' | 'preview' | 'production'): string {
  switch (tier) {
    case 'production':
      return 'main';
    case 'preview':
      return 'preview/default';
    case 'local':
      return 'main';
  }
}

/**
 * Extracts the DATABASE NAME from a postgres connection URL — the ONLY
 * portion of a secret connection string the P3 contract reasons about.
 * Credentials are never extracted, returned or logged. Returns undefined
 * for non-matching shapes (fail-closed callers treat that as an
 * isolation check failure, not a pass).
 */
export function neonDatabaseNameFromConnectionUrl(url: string): string | undefined {
  const match = /^postgres(?:ql)?:\/\/[^\s]*\/([^/?\s]+)/.exec(url);
  return match?.[1];
}

/** Regions allowed for the Neon provider contract (documented subset). */
export const NEON_REGIONS = ['aws-us-east-1', 'aws-us-west-2', 'aws-eu-central-1', 'aws-ap-southeast-1'] as const;
export type NeonRegion = (typeof NEON_REGIONS)[number];
export const NEON_DEFAULT_REGION: NeonRegion = 'aws-us-east-1';

// ---------------------------------------------------------------------------
// Upstash namespaces (P3 providers/upstash.ts, structural mirror)
// ---------------------------------------------------------------------------

/** Coordination purposes of the free-tier plan (frozen vocabulary). */
export type UpstashNamespacePurpose = 'cache' | 'idempotency' | 'rate-limit' | 'leases' | 'queue';

export const UPSTASH_NAMESPACE_PURPOSES: readonly UpstashNamespacePurpose[] = [
  'cache',
  'idempotency',
  'rate-limit',
  'leases',
  'queue',
] as const;

/** TTL policy per purpose (bounded — Redis data is short-lived by contract). */
export const UPSTASH_TTL_POLICY_MS: Readonly<Record<UpstashNamespacePurpose, number>> = {
  cache: 5 * 60_000,
  idempotency: 24 * 60 * 60_000,
  'rate-limit': 60_000,
  leases: 60_000,
  queue: 60 * 60_000,
};

/** Tier prefix for every namespace (the isolation seam). */
export function upstashTierPrefix(tier: 'local' | 'preview' | 'production'): string {
  return `sos:${tier}`;
}

/** Fully-qualified namespace for a purpose in a tier. */
export function upstashNamespace(tier: 'local' | 'preview' | 'production', purpose: UpstashNamespacePurpose): string {
  return `${upstashTierPrefix(tier)}:${purpose}`;
}

// ---------------------------------------------------------------------------
// R2 object keys (P3 providers/r2.ts, structural mirror)
// ---------------------------------------------------------------------------

/** Object purposes (frozen vocabulary). */
export type R2ObjectPurpose = 'evidence' | 'imports' | 'reports';

export const R2_OBJECT_PURPOSES: readonly R2ObjectPurpose[] = ['evidence', 'imports', 'reports'] as const;

/** Tier prefix roots (the isolation seam). */
export function r2TierPrefix(tier: 'local' | 'preview' | 'production'): string {
  switch (tier) {
    case 'production':
      return 'production';
    case 'preview':
      return 'preview/default';
    case 'local':
      return 'local';
  }
}

/** Rejects malformed object names (path traversal, emptiness, control chars). */
export function assertPlainObjectName(name: string): void {
  if (name.length === 0) {
    throw new Error('R2 object name must be non-empty');
  }
  if (name.includes('..') || name.includes('//') || name.startsWith('/') || name.endsWith('/')) {
    throw new Error(
      `R2 object name '${name}' is malformed (path traversal or empty segments are rejected)`,
    );
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) {
    throw new Error(
      `R2 object name '${name}' violates the naming convention (alphanumerics, dot, underscore, dash)`,
    );
  }
}

/** Builds the canonical object key for a tier/purpose/name. */
export function r2ObjectKey(tier: 'local' | 'preview' | 'production', purpose: R2ObjectPurpose, name: string): string {
  assertPlainObjectName(name);
  return `${r2TierPrefix(tier)}/${purpose}/${name}`;
}

// ---------------------------------------------------------------------------
// Vercel project scope (P3 providers/vercel.ts, structural mirror — the
// deployment-providers lane consumes the same mirror; duplicated there
// because sibling lanes are self-contained per the unmerged-siblings rule)
// ---------------------------------------------------------------------------

/** The documented app root deployed to Vercel (monorepo, P1 target). */
export const VERCEL_APP_ROOT_DEFAULT = 'apps/web';

// ---------------------------------------------------------------------------
// Deployment revision records (P3 revisions/registrar.ts, structural mirror)
// ---------------------------------------------------------------------------

/** Vercel regions (documented subset of the deployment contract). */
export const VERCEL_REGIONS = ['iad1', 'sfo1', 'fra1', 'cdg1', 'hnd1', 'syd1'] as const;
export type VercelRegion = (typeof VERCEL_REGIONS)[number];
export const VERCEL_DEFAULT_REGION: VercelRegion = 'iad1';

/**
 * The deployment revision record (machine-checkable). registered_at is an
 * injected clock value: RFC3339 UTC string (the caller owns time; library
 * code never reads a clock).
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
  neon: { regions: NEON_REGIONS, default: NEON_DEFAULT_REGION },
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

// ---------------------------------------------------------------------------
// Region contract lookups for the providers this lane records
// ---------------------------------------------------------------------------

/** The region contract for a provider (regions + default), P3 mirror. */
export function providerRegionContract(provider: DeploymentRevisionRecord['provider']): {
  readonly regions: readonly string[];
  readonly default: string;
} {
  return PROVIDER_REGION_CONTRACT[provider];
}
