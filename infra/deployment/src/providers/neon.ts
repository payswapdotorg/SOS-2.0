/**
 * Neon connection + database naming contract (Work Order P3).
 *
 * Neon Free is the CANONICAL durable PostgreSQL state store (mission,
 * System State projections, evidence metadata, task state, authority,
 * decisions, experiments, packages, history — per the free-tier plan).
 * This module fixes, per tier:
 *
 *   - the database naming convention (production: sos, preview: sos_preview,
 *     local: sos_local) — separate stores per environment tier, the root
 *     of preview isolation;
 *   - the branch naming convention (production: main; preview:
 *     preview/<slug> isolated branches);
 *   - the connection plan: connection happens through the injected
 *     DATABASE_URL variable (a SECRET — this contract carries the variable
 *     NAME, never a value);
 *   - the migration contract: migrations run in CI (GitHub Actions) against
 *     the target tier, in lexical filename order, and every applied run is
 *     recorded as a deployment revision record (see src/revisions/registrar.ts).
 *
 * Pure data + pure functions; no process.env, no network, no clock.
 */

import { EnvironmentValidationError, type EnvironmentTier } from '../core/types.ts';

/** Database name per tier — the durable-store isolation seam. */
export function neonDatabaseName(tier: EnvironmentTier): string {
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
export function neonBranchName(tier: EnvironmentTier): string {
  switch (tier) {
    case 'production':
      return 'main';
    case 'preview':
      return 'preview/default';
    case 'local':
      return 'main';
  }
}

/** The connection plan for a tier (variable NAMES only — never values). */
export interface NeonConnectionPlan {
  readonly provider: 'neon';
  readonly tier: EnvironmentTier;
  readonly databaseName: string;
  readonly branchName: string;
  readonly connectionStringVariable: 'DATABASE_URL';
  readonly apiKeyVariable: 'NEON_API_KEY';
  readonly databaseNameVariable: 'NEON_DATABASE_NAME';
  readonly branchNameVariable: 'NEON_BRANCH_NAME';
  /** Neon serverless driver / pooled connections are the product path. */
  readonly pooled: true;
  readonly canonical: true;
}

export function neonConnectionPlan(tier: EnvironmentTier): NeonConnectionPlan {
  return {
    provider: 'neon',
    tier,
    databaseName: neonDatabaseName(tier),
    branchName: neonBranchName(tier),
    connectionStringVariable: 'DATABASE_URL',
    apiKeyVariable: 'NEON_API_KEY',
    databaseNameVariable: 'NEON_DATABASE_NAME',
    branchNameVariable: 'NEON_BRANCH_NAME',
    pooled: true,
    canonical: true,
  };
}

/** The migrations contract (machine-checkable, documented). */
export const NEON_MIGRATION_CONTRACT = {
  provider: 'neon',
  runner: 'github-actions' as const,
  ordering: 'lexical-by-filename' as const,
  recording: 'deployment-revision-record' as const,
  rollback: 'forward-only-migrations-with-documented-restore-path' as const,
  previewRule: 'migrations run against the preview database FIRST; production only after preview evidence' as const,
} as const;

/** Validates a database name against the naming convention. */
export function assertValidNeonDatabaseName(name: string): void {
  if (!/^[a-z0-9_]+$/.test(name)) {
    throw new EnvironmentValidationError(
      `Neon database name '${name}' violates the naming convention (lowercase alphanumerics + underscore)`,
    );
  }
}

/** Validates a branch name against the branch convention. */
export function assertValidNeonBranchName(name: string): void {
  if (!/^(main|preview\/[a-z0-9][a-z0-9-]*)$/.test(name)) {
    throw new EnvironmentValidationError(
      `Neon branch name '${name}' violates the branch convention (main for production, preview/<slug> for isolated preview branches)`,
    );
  }
}

/**
 * Extracts the DATABASE NAME from a postgres connection URL — the ONLY
 * portion of a secret connection string this package ever reasons about.
 * The extracted database name is itself a public identity (declared by
 * NEON_DATABASE_NAME); credentials are never extracted, returned or
 * logged. Returns undefined for non-matching shapes (fail-closed callers
 * treat that as an isolation check failure, not as a pass).
 */
export function neonDatabaseNameFromConnectionUrl(url: string): string | undefined {
  const match = /^postgres(?:ql)?:\/\/[^\s]*\/([^/?\s]+)/.exec(url);
  return match?.[1];
}

/** Regions allowed for the Neon provider contract (documented subset). */
export const NEON_REGIONS = ['aws-us-east-1', 'aws-us-west-2', 'aws-eu-central-1', 'aws-ap-southeast-1'] as const;
export type NeonRegion = (typeof NEON_REGIONS)[number];
export const NEON_DEFAULT_REGION: NeonRegion = 'aws-us-east-1';
