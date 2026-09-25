/**
 * The P17-B environment resolution for the real GitHub adapter — the
 * env-only credential discipline of @sos-2/security applied exactly the
 * way @sos-2/github's environment module defined it:
 *
 *   - this package NEVER reads the ambient environment (fail-closed,
 *     injectable-source discipline); the caller injects a raw source
 *     record at the composition boundary;
 *   - the P17-B operational credential name is PAYSWAP_GITHUB_TOKEN (the
 *     program's PAT — the brief's env name), with the P4 registry names
 *     (GITHUB_ACCESS_TOKEN) accepted as alternates for composition with
 *     the existing environment contract;
 *   - VALUES never appear in outcomes, notes, telemetry or evidence —
 *     NAMES only;
 *   - credentials are PREPARED, never CONNECTED (a real authenticated
 *     probe must complete before CONNECTED is ever claimed).
 */

/** The env variable names this adapter understands (names only — never values). */
export const REAL_GITHUB_ENVIRONMENT_VARIABLES = {
  /** The P17-B operational credential (the program PAT). */
  operationalToken: 'PAYSWAP_GITHUB_TOKEN',
  /** The P4 registry name (alternate composition). */
  registryToken: 'GITHUB_ACCESS_TOKEN',
} as const;

/** The injected raw environment source record (never the ambient environment). */
export type RealGitHubRawEnvironmentSource = Readonly<Record<string, string>>;

/** The honest resolution of the real-provider environment slice. */
export interface RealGitHubEnvironmentResolution {
  /** The credential VALUE (injected onward into the transport; never echoed). */
  readonly token: string | null;
  /** The NAME of the env variable the credential came from, or null when absent. */
  readonly credential_env: string | null;
  /** One honest sentence about this resolution. */
  readonly note: string;
}

/** Resolve the real-provider credential from an injected source record (names only in the output). */
export function resolveRealGitHubEnvironment(source: RealGitHubRawEnvironmentSource): RealGitHubEnvironmentResolution {
  const operational = source[REAL_GITHUB_ENVIRONMENT_VARIABLES.operationalToken];
  const registry = source[REAL_GITHUB_ENVIRONMENT_VARIABLES.registryToken];
  if (typeof operational === 'string' && operational.length > 0) {
    return {
      token: operational,
      credential_env: REAL_GITHUB_ENVIRONMENT_VARIABLES.operationalToken,
      note: `The credential ${REAL_GITHUB_ENVIRONMENT_VARIABLES.operationalToken} is configured in the injected source (the value is secret and never echoed); the connection itself still requires the real authenticated probe (PREPARED, never CONNECTED).`,
    };
  }
  if (typeof registry === 'string' && registry.length > 0) {
    return {
      token: registry,
      credential_env: REAL_GITHUB_ENVIRONMENT_VARIABLES.registryToken,
      note: `The credential ${REAL_GITHUB_ENVIRONMENT_VARIABLES.registryToken} is configured in the injected source (the value is secret and never echoed); the connection itself still requires the real authenticated probe (PREPARED, never CONNECTED).`,
    };
  }
  return {
    token: null,
    credential_env: null,
    note: `No credential is configured (names checked: ${REAL_GITHUB_ENVIRONMENT_VARIABLES.operationalToken}, ${REAL_GITHUB_ENVIRONMENT_VARIABLES.registryToken}) — the real provider stays honestly NOT_YET_CONNECTED and unprobed (UNKNOWN).`,
  };
}
