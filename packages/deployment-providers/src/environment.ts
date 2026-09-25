/**
 * The P17-A environment resolution for the real Vercel deployment
 * provider — the env-only credential discipline (the P3 registry names):
 *
 *   VERCEL_TOKEN       the deployment token (SECRET)
 *   VERCEL_PROJECT_ID  the project id hosting apps/web (public identity)
 *   VERCEL_ORG_ID      the team/org scope id (public identity)
 *
 * This package NEVER reads the ambient environment; the caller injects
 * a raw source record at the composition boundary. VALUES never appear
 * in outcomes, notes, telemetry or evidence — NAMES only. Credentials
 * are PREPARED, never CONNECTED (a real authenticated probe must
 * complete before CONNECTED is ever claimed).
 */

/** The env variable names this provider understands (names only — never values; the P3 registry names). */
export const REAL_DEPLOYMENT_ENVIRONMENT_VARIABLES = {
  vercelToken: 'VERCEL_TOKEN',
  vercelProjectId: 'VERCEL_PROJECT_ID',
  vercelOrgId: 'VERCEL_ORG_ID',
} as const;

/** The injected raw environment source record (never the ambient environment). */
export type RealDeploymentRawEnvironmentSource = Readonly<Record<string, string>>;

/** The Vercel credential/identity slice. */
export interface VercelEnvironmentSlice {
  /** The token VALUE (flows onward into the REST client; never echoed). */
  readonly token: string | null;
  /** The env NAME the token came from, or null. */
  readonly tokenEnv: string | null;
  /** The project id (public identity), or null. */
  readonly projectId: string | null;
  /** The org/team id (public identity), or null. */
  readonly orgId: string | null;
}

/** The honest resolution of the deployment-provider environment slice. */
export interface RealDeploymentEnvironmentResolution {
  readonly vercel: VercelEnvironmentSlice;
  /** One honest sentence about this resolution. */
  readonly note: string;
}

function optional(source: RealDeploymentRawEnvironmentSource, name: string): string | null {
  const value = source[name];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Resolve the Vercel environment slice from an injected source record (names only in the output notes). */
export function resolveRealDeploymentEnvironment(source: RealDeploymentRawEnvironmentSource): RealDeploymentEnvironmentResolution {
  const token = optional(source, REAL_DEPLOYMENT_ENVIRONMENT_VARIABLES.vercelToken);
  const projectId = optional(source, REAL_DEPLOYMENT_ENVIRONMENT_VARIABLES.vercelProjectId);
  const orgId = optional(source, REAL_DEPLOYMENT_ENVIRONMENT_VARIABLES.vercelOrgId);
  return {
    vercel: {
      token,
      tokenEnv: token === null ? null : REAL_DEPLOYMENT_ENVIRONMENT_VARIABLES.vercelToken,
      projectId,
      orgId,
    },
    note:
      'The Vercel credential and identities are resolved from the injected source by NAME (P3 registry names); values are never echoed. ' +
      'A resolved credential is PREPARED, never CONNECTED — connection requires the real authenticated probe.',
  };
}
