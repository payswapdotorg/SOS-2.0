/**
 * @sos-2/infra-deployment — shared typed primitives (Work Order P3).
 *
 * The environment tiers of the free-tier validation topology
 * (docs/deployment/free-tier-plan.md) and the fail-closed error hierarchy.
 * This module is deliberately self-contained: it imports NOTHING from
 * packages/* — provider configuration and execution/body provider
 * contracts must remain adapters over configuration, never semantic
 * authorities, and never structurally coupled to the frozen core.
 */

/** The three environment tiers of the free-tier plan. Frozen vocabulary. */
export type EnvironmentTier = 'local' | 'preview' | 'production';

export const ENVIRONMENT_TIERS: readonly EnvironmentTier[] = ['local', 'preview', 'production'] as const;

export function isEnvironmentTier(value: unknown): value is EnvironmentTier {
  return typeof value === 'string' && (ENVIRONMENT_TIERS as readonly string[]).includes(value);
}

/** Infrastructure providers of the free-tier validation topology. */
export type InfraProviderId =
  | 'vercel'
  | 'neon'
  | 'upstash'
  | 'r2'
  | 'github'
  | 'execution-body-provider';

export const INFRA_PROVIDER_IDS: readonly InfraProviderId[] = [
  'vercel',
  'neon',
  'upstash',
  'r2',
  'github',
  'execution-body-provider',
] as const;

export function isInfraProviderId(value: unknown): value is InfraProviderId {
  return typeof value === 'string' && (INFRA_PROVIDER_IDS as readonly string[]).includes(value);
}

/**
 * Base error for every infra/deployment contract violation.
 * Fail-closed discipline: contract violations are typed and loud — never a
 * silent default, never a swallowed mismatch. Error messages carry NAMES
 * (variable names, provider ids, resource identities) — never secret
 * VALUES.
 */
export class InfraDeploymentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InfraDeploymentError';
  }
}

/** Environment schema validation failure (missing/invalid variable, named). */
export class EnvironmentValidationError extends InfraDeploymentError {
  constructor(message: string) {
    super(message);
    this.name = 'EnvironmentValidationError';
  }
}

/** Secret policy violation (secret-shaped value where it must not appear). */
export class SecretPolicyError extends InfraDeploymentError {
  constructor(message: string) {
    super(message);
    this.name = 'SecretPolicyError';
  }
}

/** Preview/production isolation violation (cross-tier resource reference). */
export class PreviewIsolationError extends InfraDeploymentError {
  constructor(message: string) {
    super(message);
    this.name = 'PreviewIsolationError';
  }
}

/** Deployment revision record contract violation. */
export class DeploymentRevisionError extends InfraDeploymentError {
  constructor(message: string) {
    super(message);
    this.name = 'DeploymentRevisionError';
  }
}

/** Provider health contract violation (e.g. a fabricated HEALTHY). */
export class ProviderHealthError extends InfraDeploymentError {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderHealthError';
  }
}

/** Execution/body provider configuration contract violation. */
export class BodyProviderConfigError extends InfraDeploymentError {
  constructor(message: string) {
    super(message);
    this.name = 'BodyProviderConfigError';
  }
}

/** Long-running work delegation boundary violation. */
export class DelegationBoundaryError extends InfraDeploymentError {
  constructor(message: string) {
    super(message);
    this.name = 'DelegationBoundaryError';
  }
}

/** A raw environment source: a plain string record, injectable by callers. */
export type RawEnvironmentSource = Readonly<Record<string, string>>;

/**
 * Validates that a raw source is shaped like a string record (fail-closed
 * against non-string values, which would otherwise silently coerce).
 */
export function assertRawSourceShape(source: RawEnvironmentSource, label: string): void {
  if (source === null || typeof source !== 'object' || Array.isArray(source)) {
    throw new EnvironmentValidationError(`${label}: environment source must be a plain object of string values`);
  }
  for (const [name, value] of Object.entries(source)) {
    if (typeof value !== 'string') {
      throw new EnvironmentValidationError(
        `${label}: environment variable ${name} must be a string (got ${typeof value}); values are never coerced`,
      );
    }
  }
}
