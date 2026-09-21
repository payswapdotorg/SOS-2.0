/**
 * Configuration through @sos-2/infra-deployment's environment contract
 * (Work Order P4 task packet: "Configuration through
 * @sos-2/infra-deployment's environment contract (the GitHub-scope
 * variables from its registry)").
 *
 * @sos-2/infra-deployment declares ZERO dependencies and ZERO imports
 * from or into packages/* (its frozen P3 boundary), so it cannot be
 * imported as a bare specifier. The consumption here is therefore:
 *
 *   - the adapter NEVER reads ambient process.env (fail-closed,
 *     injectable-source discipline — the same rule loadEnvironment
 *     enforces); it receives an injected raw source record;
 *   - the GitHub-scope variable NAMES are pinned to the exact names in
 *     @sos-2/infra-deployment's environment registry
 *     (GITHUB_VARIABLES = { accessToken: 'GITHUB_ACCESS_TOKEN',
 *     webhookSecret: 'GITHUB_WEBHOOK_SECRET' }) — pinned BY TEST against
 *     the actual registry source, so a rename there fails this package's
 *     suite loudly instead of drifting silently;
 *   - the test also composes the REAL loadEnvironment with an injected
 *     source record and proves this adapter extracts exactly the values
 *     the environment contract exposes (getSecretValue), keeping the
 *     composition honest without a src-level import;
 *   - secret VALUES are never echoed: error messages and resolution
 *     records carry NAMES only (the P3 secret-policy discipline).
 *
 * Real credentials are NOT available in this Work Order: the real-system
 * connection state is honestly NOT_YET_CONNECTED (validation GitHub
 * account pending). Even when credentials are present, the state stays
 * NOT_YET_CONNECTED until a real handshake completes on the backing
 * provider — configured credentials are PREPARED, never CONNECTED.
 */

import type { GitHubConnectionState } from './connection.ts';
import { GITHUB_ONBOARDING_READ_SCOPES } from './connection.ts';

/**
 * The GitHub-scope environment variable names, pinned to
 * @sos-2/infra-deployment's environment registry (GITHUB_VARIABLES).
 * Values are secret-shaped: they are read from the injected source and
 * carried in the resolution, but NEVER logged or echoed.
 */
export const GITHUB_ENVIRONMENT_VARIABLES = {
  accessToken: 'GITHUB_ACCESS_TOKEN',
  webhookSecret: 'GITHUB_WEBHOOK_SECRET',
} as const;

/**
 * The environment tiers this adapter understands — the exact tier
 * vocabulary of @sos-2/infra-deployment (EnvironmentTier: 'local' |
 * 'preview' | 'production'), pinned by test. GitHub-scope variables are
 * required for preview and production and absent-by-contract for local.
 */
export const GITHUB_ENVIRONMENT_TIERS = ['local', 'preview', 'production'] as const;

export type GitHubEnvironmentTier = (typeof GITHUB_ENVIRONMENT_TIERS)[number];

/** The injected raw environment source record (never ambient process.env). */
export type GitHubRawEnvironmentSource = Readonly<Record<string, string>>;

/** The resolved GitHub-scope credentials (secret values, never echoed). */
export interface GitHubProviderCredentials {
  /** The least-privilege access token (GITHUB_ACCESS_TOKEN), or null when absent. */
  access_token: string | null;
  /** The webhook shared secret (GITHUB_WEBHOOK_SECRET), or null when absent. */
  webhook_secret: string | null;
}

/** The honest resolution of the GitHub environment slice. */
export interface GitHubEnvironmentResolution {
  credentials: GitHubProviderCredentials;
  /** The NAMES of the GitHub-scope variables absent from the source (values never appear). */
  missing: string[];
  /** One honest sentence about this resolution. */
  note: string;
}

/** Is this a well-formed environment tier? */
export function isGitHubEnvironmentTier(value: unknown): value is GitHubEnvironmentTier {
  return typeof value === 'string' && (GITHUB_ENVIRONMENT_TIERS as readonly string[]).includes(value);
}

/**
 * Resolve the GitHub-scope credentials from an injected raw source
 * record (fail-closed on shape, NAMES-only on missing, values never
 * echoed). An empty string is absent (the loadEnvironment rule).
 */
export function resolveGitHubEnvironment(source: GitHubRawEnvironmentSource): GitHubEnvironmentResolution {
  const token = source[GITHUB_ENVIRONMENT_VARIABLES.accessToken];
  const secret = source[GITHUB_ENVIRONMENT_VARIABLES.webhookSecret];
  const accessToken = typeof token === 'string' && token.length > 0 ? token : null;
  const webhookSecret = typeof secret === 'string' && secret.length > 0 ? secret : null;
  const missing: string[] = [];
  if (accessToken === null) {
    missing.push(GITHUB_ENVIRONMENT_VARIABLES.accessToken);
  }
  if (webhookSecret === null) {
    missing.push(GITHUB_ENVIRONMENT_VARIABLES.webhookSecret);
  }
  const note =
    missing.length === 0
      ? 'GitHub-scope variables are configured in the injected source (values are secret and never echoed); the connection itself still requires a real handshake.'
      : `GitHub-scope variables absent from the injected source (names only): ${missing.join(', ')}. No connection can be attempted; this stays honestly NOT_YET_CONNECTED.`;
  return { credentials: { access_token: accessToken, webhook_secret: webhookSecret }, missing, note };
}

/**
 * The real-provider connection state derived from the environment —
 * honestly NOT_YET_CONNECTED in every case this Work Order can produce:
 *
 *   - credentials absent -> NOT_YET_CONNECTED (nothing is configured);
 *   - credentials present but unverified -> still NOT_YET_CONNECTED
 *     (configured is PREPARED, never CONNECTED — a real handshake on
 *     the backing provider is required before CONNECTED is ever true).
 *
 * The note distinguishes the two honestly. The simulated reference
 * provider carries its own clearly-marked simulated state instead.
 */
export function realConnectionStateFromEnvironment(input: {
  provider_id: string;
  tier: GitHubEnvironmentTier;
  resolution: GitHubEnvironmentResolution;
}): GitHubConnectionState {
  const prepared = input.resolution.missing.length === 0;
  return {
    status: 'NOT_YET_CONNECTED',
    simulated: false,
    provider_id: input.provider_id,
    granted_scopes: [],
    connected_at: null,
    note: prepared
      ? `GitHub-scope variables are configured for the ${input.tier} environment, but no real handshake has completed (validation GitHub account pending) — the real connection stays honestly NOT_YET_CONNECTED and this adapter never fabricates connection evidence.`
      : `GitHub-scope variables are not configured for the ${input.tier} environment (names only: ${input.resolution.missing.join(', ')}) — the real connection is honestly NOT_YET_CONNECTED.`,
  };
}

/**
 * The least-privilege scopes the onboarding journey requests — re-exported
 * convenience over the connection vocabulary for environment consumers.
 */
export function onboardingReadScopes(): readonly string[] {
  return [...GITHUB_ONBOARDING_READ_SCOPES];
}
