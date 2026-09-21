/**
 * The typed environment variable registry (Work Order P3).
 *
 * One declarative table describing EVERY environment variable of the
 * free-tier validation topology across the three tiers
 * (local / preview / production) and every provider (Vercel, Neon,
 * Upstash, R2, GitHub, execution/body providers, plus app scope), with:
 *
 *   - required vs optional per tier (fail-closed: a missing REQUIRED
 *     variable is a typed error naming the variable — never a silent
 *     default),
 *   - secret vs non-secret classification (secret values are never
 *     echoed, logged or serialized — see src/secrets/policy.ts),
 *   - documented fixture defaults for the LOCAL tier only (explicit
 *     fixture values for deterministic local runs — visibly marked, never
 *     a silent default, never available to preview/production),
 *   - shape validation (patterns) applied at load time.
 *
 * The registry is pure DATA plus pure query functions. No process.env
 * access lives anywhere in this package: callers inject the raw source
 * record (see src/environment/load.ts).
 */

import type { EnvironmentTier, InfraProviderId } from '../core/types.ts';

/** How a variable is provided for a given tier. */
export type VariableRequirement =
  | 'required' // missing => typed EnvironmentValidationError naming the variable
  | 'optional' // missing => absent (recorded as absent, never defaulted)
  | 'fixture-default'; // missing => documented LOCAL fixture default (local tier only)

/** Shape check ids applied to values at load time. */
export type ValueShape =
  | 'non-empty'
  | 'url'
  | 'postgres-url'
  | 'https-url'
  | 'token'
  | 'relative-path'
  | 'lowercase-identifier';

/** One registry entry. */
export interface EnvironmentVariableSpec {
  readonly name: string;
  readonly provider: InfraProviderId | 'app';
  readonly description: string;
  /** true => the VALUE is a secret: never echoed, logged or serialized. */
  readonly secret: boolean;
  readonly shape: ValueShape;
  /** Requirement per tier; a tier absent from the map means 'absent by contract'. */
  readonly requirement: Readonly<Partial<Record<EnvironmentTier, VariableRequirement>>>;
  /**
   * Documented fixture default for the LOCAL tier (only ever applied when
   * requirement.local === 'fixture-default'). Preview and production can
   * NEVER see these values — loadEnvironment enforces the tier gate.
   */
  readonly localFixtureDefault?: string;
}

/**
 * The environment variable registry of the free-tier validation topology.
 * Keys are stable variable names (the contract); order is provider, then name.
 */
export const ENVIRONMENT_VARIABLE_REGISTRY: readonly EnvironmentVariableSpec[] = [
  // ------------------------------------------------------------------ app
  {
    name: 'APP_BASE_URL',
    provider: 'app',
    description: 'Public origin of the deployed console/API surface for this tier.',
    secret: false,
    shape: 'https-url',
    requirement: { preview: 'required', production: 'required', local: 'fixture-default' },
    localFixtureDefault: 'http://localhost:3000',
  },
  // --------------------------------------------------------------- vercel
  {
    name: 'VERCEL_PROJECT_ID',
    provider: 'vercel',
    description: 'Vercel project id hosting apps/web (the production console target).',
    secret: false,
    shape: 'lowercase-identifier',
    requirement: { preview: 'required', production: 'required' },
  },
  {
    name: 'VERCEL_ORG_ID',
    provider: 'vercel',
    description: 'Vercel org/team scope id for the project (vercel.json orgId).',
    secret: false,
    shape: 'lowercase-identifier',
    requirement: { preview: 'required', production: 'required' },
  },
  {
    name: 'VERCEL_TOKEN',
    provider: 'vercel',
    description: 'Vercel deployment token used by CI (scoped, least privilege).',
    secret: true,
    shape: 'token',
    requirement: { preview: 'required', production: 'required' },
  },
  {
    name: 'VERCEL_APP_ROOT',
    provider: 'vercel',
    description: 'Monorepo app root deployed to Vercel (contract default: apps/web).',
    secret: false,
    shape: 'relative-path',
    requirement: { local: 'fixture-default', preview: 'required', production: 'required' },
    localFixtureDefault: 'apps/web',
  },
  // ----------------------------------------------------------------- neon
  {
    name: 'DATABASE_URL',
    provider: 'neon',
    description:
      'Neon PostgreSQL connection string (pooled) for the tier database. Carries credentials: SECRET. The LOCAL fixture default is credential-free by design.',
    secret: true,
    shape: 'postgres-url',
    requirement: { preview: 'required', production: 'required', local: 'fixture-default' },
    localFixtureDefault: 'postgres://localhost:5432/sos_local',
  },
  {
    name: 'NEON_DATABASE_NAME',
    provider: 'neon',
    description: 'Neon database name for the tier (production: sos, preview: sos_preview, local: sos_local).',
    secret: false,
    shape: 'lowercase-identifier',
    requirement: { preview: 'required', production: 'required', local: 'fixture-default' },
    localFixtureDefault: 'sos_local',
  },
  {
    name: 'NEON_BRANCH_NAME',
    provider: 'neon',
    description:
      'Neon branch for the tier (production: main; preview: preview/<slug> — isolated branch per free-tier-plan).',
    secret: false,
    shape: 'non-empty',
    requirement: { preview: 'required', production: 'required', local: 'fixture-default' },
    localFixtureDefault: 'main',
  },
  {
    name: 'NEON_API_KEY',
    provider: 'neon',
    description: 'Neon management API key for branch/migration administration from CI.',
    secret: true,
    shape: 'token',
    requirement: { preview: 'required', production: 'required' },
  },
  // -------------------------------------------------------------- upstash
  {
    name: 'UPSTASH_REDIS_REST_URL',
    provider: 'upstash',
    description: 'Upstash Redis REST endpoint for the tier database (cache/idempotency/leases namespaces).',
    secret: false,
    shape: 'https-url',
    requirement: { preview: 'required', production: 'required' },
  },
  {
    name: 'UPSTASH_REDIS_REST_TOKEN',
    provider: 'upstash',
    description: 'Upstash REST token. Redis is NEVER canonical (see UPSTASH_NEVER_CANONICAL_CONTRACT).',
    secret: true,
    shape: 'token',
    requirement: { preview: 'required', production: 'required' },
  },
  {
    name: 'UPSTASH_REDIS_CONNECTION_URL',
    provider: 'upstash',
    description:
      'Optional direct Redis connection URL (carries credentials: SECRET). REST is the preferred path.',
    secret: true,
    shape: 'url',
    requirement: { preview: 'optional', production: 'optional' },
  },
  // ------------------------------------------------------------------- r2
  {
    name: 'R2_ACCOUNT_ID',
    provider: 'r2',
    description: 'Cloudflare account id owning the R2 bucket.',
    secret: false,
    shape: 'lowercase-identifier',
    requirement: { preview: 'required', production: 'required' },
  },
  {
    name: 'R2_ACCESS_KEY_ID',
    provider: 'r2',
    description: 'R2 S3-compatible access key id for the tier-scoped token.',
    secret: true,
    shape: 'token',
    requirement: { preview: 'required', production: 'required' },
  },
  {
    name: 'R2_SECRET_ACCESS_KEY',
    provider: 'r2',
    description: 'R2 S3-compatible secret access key (write-once evidence/import/report objects).',
    secret: true,
    shape: 'token',
    requirement: { preview: 'required', production: 'required' },
  },
  {
    name: 'R2_BUCKET_NAME',
    provider: 'r2',
    description:
      'Single free-tier R2 bucket; tier isolation happens via prefixes (production/ and preview/<id>/).',
    secret: false,
    shape: 'lowercase-identifier',
    requirement: { preview: 'required', production: 'required', local: 'fixture-default' },
    localFixtureDefault: 'sos-artifacts-local',
  },
  // --------------------------------------------------------------- github
  {
    name: 'GITHUB_ACCESS_TOKEN',
    provider: 'github',
    description: 'GitHub token for the GitHub adapter (webhooks, PR API, observation ingestion).',
    secret: true,
    shape: 'token',
    requirement: { preview: 'required', production: 'required' },
  },
  {
    name: 'GITHUB_WEBHOOK_SECRET',
    provider: 'github',
    description: 'GitHub webhook signature secret for the Observation Plane endpoint.',
    secret: true,
    shape: 'token',
    requirement: { preview: 'required', production: 'required' },
  },
  // -------------------------------------------------- execution/body
  {
    name: 'BODY_PROVIDER_ID',
    provider: 'execution-body-provider',
    description:
      'Active execution/body provider adapter id (capability-based selection; see src/execution/body-providers.ts).',
    secret: false,
    shape: 'non-empty',
    requirement: { preview: 'optional', production: 'optional', local: 'optional' },
  },
  {
    name: 'BODY_PROVIDER_API_KEY',
    provider: 'execution-body-provider',
    description: 'Credential for the active execution/body provider adapter (provider-specific).',
    secret: true,
    shape: 'token',
    requirement: { preview: 'optional', production: 'optional' },
  },
] as const;

/** Registry lookup by exact variable name. */
export function variableSpec(name: string): EnvironmentVariableSpec | undefined {
  return ENVIRONMENT_VARIABLE_REGISTRY.find((spec) => spec.name === name);
}

/** All variables owned by one provider (or 'app'). */
export function variablesForProvider(provider: InfraProviderId | 'app'): readonly EnvironmentVariableSpec[] {
  return ENVIRONMENT_VARIABLE_REGISTRY.filter((spec) => spec.provider === provider);
}

/** Every variable REQUIRED for a tier (missing => typed failure, no default). */
export function requiredVariablesFor(tier: EnvironmentTier): readonly EnvironmentVariableSpec[] {
  return ENVIRONMENT_VARIABLE_REGISTRY.filter((spec) => spec.requirement[tier] === 'required');
}

/** Every SECRET-classified variable in the registry. */
export function secretVariables(): readonly EnvironmentVariableSpec[] {
  return ENVIRONMENT_VARIABLE_REGISTRY.filter((spec) => spec.secret);
}

/** Secret-classified variables that are REQUIRED for a tier (names only). */
export function requiredSecretNamesFor(tier: EnvironmentTier): readonly string[] {
  return requiredVariablesFor(tier)
    .filter((spec) => spec.secret)
    .map((spec) => spec.name);
}

/** Is this exact registry variable secret-classified? */
export function isSecretVariableName(name: string): boolean {
  const spec = variableSpec(name);
  return spec !== undefined ? spec.secret : looksSecretShapedByName(name);
}

/**
 * Conservative classification for UNREGISTERED variable names: anything
 * whose NAME looks secret-shaped is treated as a secret (fail-closed —
 * an unknown TOKEN/SECRET/KEY/PASSWORD/CREDENTIAL variable can never leak
 * into public logs by classification default).
 */
export function looksSecretShapedByName(name: string): boolean {
  return /(^|_)(TOKEN|SECRET|KEY|PASSWORD|PASSWD|CREDENTIAL|CREDENTIALS|API_KEY|ACCESS_KEY)(_|$)/.test(name);
}
