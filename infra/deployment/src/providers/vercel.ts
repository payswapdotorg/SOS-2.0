/**
 * Vercel project-scope configuration contract (Work Order P3).
 *
 * Vercel Hobby hosts apps/web (the production Next.js console) and
 * lightweight API endpoints. The configuration contract fixes:
 *
 *   - the monorepo app root (apps/web) and the Next.js framework preset;
 *   - preview/production separation through the Vercel ENVIRONMENT
 *     dimension (production deployments vs preview deployments of the SAME
 *     project — isolation of stores comes from the per-tier environment
 *     variables, never from shared runtime state);
 *   - the local tier has NO Vercel deployment target by contract;
 *   - the request-lifetime budget hook: Vercel request lifetime must never
 *     own long-running autonomous work (see src/execution/delegation.ts —
 *     the boundary check consumes the budget exported here).
 *
 * Pure data + pure functions; no process.env, no network, no clock.
 */

import { EnvironmentValidationError, type EnvironmentTier } from '../core/types.ts';

/** Framework presets the contract knows (frozen vocabulary). */
export const VERCEL_FRAMEWORK_PRESETS = ['nextjs'] as const;
export type VercelFrameworkPreset = (typeof VERCEL_FRAMEWORK_PRESETS)[number];

/** The documented app root deployed to Vercel (monorepo, P1 target). */
export const VERCEL_APP_ROOT_DEFAULT = 'apps/web';

/**
 * The conservative request-lifetime budget for request-scoped work on the
 * Hobby tier. Long-running (> budget) autonomous work is typed-rejected
 * from the request runtime by assertDelegationBoundary. The absolute Hobby
 * hard cap is exported separately — budgets above it are invalid.
 */
export const VERCEL_HOBBY_REQUEST_BUDGET_MS = 10_000;
export const VERCEL_HOBBY_HARD_CAP_MS = 60_000;

/** Deployment environment dimension inside one Vercel project. */
export type VercelEnvironmentDimension = 'production' | 'preview';

/** The Vercel project scope for a tier. */
export interface VercelProjectScope {
  readonly provider: 'vercel';
  readonly tier: EnvironmentTier;
  readonly appRoot: string;
  readonly frameworkPreset: VercelFrameworkPreset;
  readonly projectIdVariable: 'VERCEL_PROJECT_ID';
  readonly orgIdVariable: 'VERCEL_ORG_ID';
  /** local => undefined by contract: no Vercel deployment target exists locally. */
  readonly environment: VercelEnvironmentDimension | undefined;
}

/**
 * The Vercel project scope contract per tier. Deterministic and total.
 * The local tier deliberately has NO deployment dimension (undefined).
 */
export function vercelProjectScope(tier: EnvironmentTier): VercelProjectScope {
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
    throw new EnvironmentValidationError(
      `Vercel app root must be '${VERCEL_APP_ROOT_DEFAULT}' (the P1 production target inside this monorepo); got a different root — the free-tier contract pins the deployed app`,
    );
  }
}

/**
 * Validates a request-lifetime budget against the Hobby contract.
 * Budgets above the Hobby hard cap are invalid even for request-scoped work.
 */
export function assertValidRequestLifetimeBudget(budgetMs: number): void {
  if (!Number.isFinite(budgetMs) || budgetMs <= 0) {
    throw new EnvironmentValidationError('request-lifetime budget must be a positive finite number of milliseconds');
  }
  if (budgetMs > VERCEL_HOBBY_HARD_CAP_MS) {
    throw new EnvironmentValidationError(
      `request-lifetime budget ${budgetMs}ms exceeds the Vercel Hobby hard cap (${VERCEL_HOBBY_HARD_CAP_MS}ms); long-running work must be delegated to an external worker/body provider`,
    );
  }
}
