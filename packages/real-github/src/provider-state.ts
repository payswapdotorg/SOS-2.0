/**
 * The honest P17-B provider-state vocabulary of the real GitHub adapter.
 *
 * Work Order P17-B: "Honest provider states (CONNECTED / UNKNOWN /
 * UNAVAILABLE / DEGRADED)" — every state comes from a REAL probe, never
 * from configuration alone:
 *
 *   CONNECTED   a real authenticated probe succeeded on the backing
 *               provider (the PAT-backed handshake verified /user).
 *   UNKNOWN     the provider has not been probed yet — the honest
 *               unprobed state (never conflated with UNAVAILABLE).
 *   UNAVAILABLE the provider was probed and is not usable (network
 *               failure, 5xx, rejected credential).
 *   DEGRADED    the provider answered but is constrained — the primary
 *               case is a GitHub API rate limit with a REAL reset epoch
 *               (never a fake success, never a fake failure).
 *
 * This vocabulary is the P17 lane's adapter control-plane vocabulary (the
 * P4 precedent: adapter fields are the adapter's; frozen SOS semantics
 * are never redefined). The frozen @sos-2/github connection contract
 * (NOT_YET_CONNECTED / CONNECTED / EXPIRED / REVOKED / UNAVAILABLE /
 * UNKNOWN) remains the authoritative connection surface —
 * `mapProviderStateToConnectionNote` is the honest bridge between them.
 */

/** The P17-B honest provider states. */
export const REAL_GITHUB_PROVIDER_STATES = ['CONNECTED', 'UNKNOWN', 'UNAVAILABLE', 'DEGRADED'] as const;

export type RealGitHubProviderState = (typeof REAL_GITHUB_PROVIDER_STATES)[number];

const STATE_SET: ReadonlySet<string> = new Set(REAL_GITHUB_PROVIDER_STATES);

/** Is this a well-formed P17-B provider state? */
export function isRealGitHubProviderState(value: unknown): value is RealGitHubProviderState {
  return typeof value === 'string' && STATE_SET.has(value);
}

/** A REAL rate-limit snapshot (parsed from GitHub's response headers / body). */
export interface GitHubRateLimitSnapshot {
  /** The rate-limit bucket (e.g. 'core'). */
  readonly resource: string;
  /** The maximum requests per window. */
  readonly limit: number;
  /** Requests remaining in the window. */
  readonly remaining: number;
  /** Requests used in the window. */
  readonly used: number;
  /** The REAL reset epoch (unix seconds) reported by the provider. */
  readonly reset_epoch_s: number;
}

/** The honest provider-state report — every field is probe evidence or an honest null. */
export interface RealGitHubProviderStateReport {
  /** The P17-B provider state. */
  readonly state: RealGitHubProviderState;
  /** The backing provider id. */
  readonly provider_id: string;
  /** The probe instant, RFC3339 (caller-supplied clock — no hidden time). */
  readonly probed_at: string;
  /** The credential environment variable NAME (the value NEVER appears here). */
  readonly credential_env: string | null;
  /** The exact GitHub API revision the probe observed (e.g. '2022-11-28'), or null when unprobed. */
  readonly api_revision: string | null;
  /** The authenticated login the probe observed, or null. */
  readonly login: string | null;
  /** The REAL rate-limit snapshot at probe time, or null when not observed. */
  readonly rate_limit: GitHubRateLimitSnapshot | null;
  /** One honest sentence about this state. */
  readonly note: string;
}

const REPORT_FIELDS = ['state', 'provider_id', 'probed_at', 'credential_env', 'api_revision', 'login', 'rate_limit', 'note'] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Validate a provider-state report shape (throws on a fabricated/malformed report). */
export function assertValidRealGitHubProviderStateReport(value: unknown): asserts value is RealGitHubProviderStateReport {
  if (!isPlainObject(value)) {
    throw new Error(`a provider-state report must be an object, received: ${JSON.stringify(value)}`);
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  const expected = REPORT_FIELDS as readonly unknown[];
  if (keys.length !== expected.length || !expected.every((key) => keys.includes(key as string))) {
    throw new Error(`a provider-state report must have the exact field set { ${REPORT_FIELDS.join(', ')} }`);
  }
  if (!isRealGitHubProviderState(record['state'])) {
    throw new Error(`provider state must be one of ${REAL_GITHUB_PROVIDER_STATES.join(', ')} (a real probe outcome — never fabricated)`);
  }
  for (const field of ['provider_id', 'note'] as const) {
    if (typeof record[field] !== 'string' || (record[field] as string).length === 0) {
      throw new Error(`provider-state report ${field} must be a non-empty string`);
    }
  }
  if (typeof record['probed_at'] !== 'string' || record['probed_at'].length === 0) {
    throw new Error('provider-state report probed_at must be an RFC3339 instant (the caller-supplied probe clock)');
  }
  if (record['credential_env'] !== null && typeof record['credential_env'] !== 'string') {
    throw new Error('provider-state report credential_env must be an env variable NAME or null (the value never appears)');
  }
  for (const field of ['api_revision', 'login'] as const) {
    if (record[field] !== null && typeof record[field] !== 'string') {
      throw new Error(`provider-state report ${field} must be a string or null`);
    }
  }
  if (record['rate_limit'] !== null) {
    const rate = record['rate_limit'] as Record<string, unknown>;
    const rateFields = ['resource', 'limit', 'remaining', 'used', 'reset_epoch_s'] as const;
    const rateKeys = Object.keys(rate);
    if (
      !isPlainObject(rate) ||
      rateKeys.length !== rateFields.length ||
      !rateFields.every((key) => rateKeys.includes(key)) ||
      typeof rate['resource'] !== 'string' ||
      !rateFields.slice(1).every((key) => typeof rate[key] === 'number' && Number.isFinite(rate[key] as number))
    ) {
      throw new Error('provider-state report rate_limit must be { resource, limit, remaining, used, reset_epoch_s } (real probe data)');
    }
  }
}

/**
 * The honest unknown report — the state of an UNPROBED provider (never
 * conflated with UNAVAILABLE: an outage must be observed, not assumed).
 */
export function unprobedProviderStateReport(input: {
  provider_id: string;
  credential_env: string | null;
}): RealGitHubProviderStateReport {
  return {
    state: 'UNKNOWN',
    provider_id: input.provider_id,
    probed_at: '',
    credential_env: input.credential_env,
    api_revision: null,
    login: null,
    rate_limit: null,
    note: 'The real GitHub provider has not been probed yet — the honest unprobed state is UNKNOWN (never UNAVAILABLE: an outage must be observed).',
  };
}

/**
 * The honest bridge from the P17-B provider-state vocabulary onto the
 * frozen @sos-2/github connection vocabulary. DEGRADED (a rate limit
 * with real reset data) has NO frozen connection equivalent — the frozen
 * contract is not redefined; the DEGRADED detail stays on the
 * provider-state surface and the connection note carries the honest
 * limitation.
 */
export function mapProviderStateToConnectionNote(state: RealGitHubProviderState): string {
  switch (state) {
    case 'CONNECTED':
      return 'The real GitHub provider answered an authenticated probe (CONNECTED — real evidence, never fabricated).';
    case 'UNKNOWN':
      return 'The real GitHub provider is unprobed (UNKNOWN — the honest state until a real probe runs).';
    case 'UNAVAILABLE':
      return 'The real GitHub provider was probed and is not usable (UNAVAILABLE — the honest outage state).';
    case 'DEGRADED':
      return 'The real GitHub provider answered but is constrained (DEGRADED — e.g. a rate limit with a real reset time); operations may fail truthfully until the window resets.';
  }
}
