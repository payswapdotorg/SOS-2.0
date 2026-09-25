/**
 * Honest provider states — the P17-A program-defining discipline (the
 * P17-B/P17-C/P17-A persistence vocabulary, continued for the
 * deployment lane). Every state comes from a REAL probe through the
 * injected FetchPort; a fabricated CONNECTED is a typed violation.
 */

/** The four honest provider states (P17 lane vocabulary). */
export const REAL_DEPLOYMENT_PROVIDER_STATES = ['CONNECTED', 'UNKNOWN', 'UNAVAILABLE', 'DEGRADED'] as const;

export type RealDeploymentProviderState = (typeof REAL_DEPLOYMENT_PROVIDER_STATES)[number];

const STATE_SET: ReadonlySet<string> = new Set(REAL_DEPLOYMENT_PROVIDER_STATES);

/** Is this a well-formed P17-A deployment provider state? */
export function isRealDeploymentProviderState(value: unknown): value is RealDeploymentProviderState {
  return typeof value === 'string' && STATE_SET.has(value);
}

/** One REAL probe observation of a provider endpoint (the raw evidence). */
export interface DeploymentProbeRecord {
  readonly provider: 'vercel';
  readonly probeId: string;
  /** The exact endpoint probed (path + query; never the token). */
  readonly endpoint: string;
  /** RFC3339 instant of the probe (from the injected clock). */
  readonly at: string;
  /** HTTP status when a response arrived, else null (network/DNS failure). */
  readonly status: number | null;
  /** True when the transport answered 2xx AND the body passed shape validation. */
  readonly ok: boolean;
  /** The real failure reason when !ok (redacted; null when ok). */
  readonly failure: string | null;
  /** API revision identifier when the response carried one (e.g. 'vercel.v13'). */
  readonly apiRevision: string | null;
}

/** Classification of an HTTP probe outcome into the honest state machine. */
export function classifyDeploymentProbe(probe: DeploymentProbeRecord): RealDeploymentProviderState {
  if (probe.ok) {
    return 'CONNECTED';
  }
  if (probe.status === 429) {
    return 'DEGRADED';
  }
  return 'UNAVAILABLE';
}

/** The honest provider-state report — every field is probe evidence or an honest null. */
export interface RealDeploymentProviderStateReport {
  readonly state: RealDeploymentProviderState;
  readonly provider_id: string;
  readonly probed_at: string | null;
  /** The credential environment variable NAME (the value NEVER appears here). */
  readonly credential_env: string | null;
  readonly api_revision: string | null;
  readonly last_error: string | null;
  readonly probes: readonly DeploymentProbeRecord[];
  readonly note: string;
}

const REPORT_FIELDS = [
  'state',
  'provider_id',
  'probed_at',
  'credential_env',
  'api_revision',
  'last_error',
  'probes',
  'note',
] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Validate a provider-state report shape (throws on a fabricated/malformed report). */
export function assertValidRealDeploymentProviderStateReport(
  value: unknown,
): asserts value is RealDeploymentProviderStateReport {
  if (!isPlainObject(value)) {
    throw new Error(`a deployment provider-state report must be an object, received: ${JSON.stringify(value)}`);
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  const expected = REPORT_FIELDS as readonly unknown[];
  if (keys.length !== expected.length || !expected.every((key) => keys.includes(key as string))) {
    throw new Error(`a deployment provider-state report must have the exact field set { ${REPORT_FIELDS.join(', ')} }`);
  }
  if (!isRealDeploymentProviderState(record['state'])) {
    throw new Error(
      `provider state must be one of ${REAL_DEPLOYMENT_PROVIDER_STATES.join(', ')} (a real probe outcome — never fabricated)`,
    );
  }
  if (typeof record['provider_id'] !== 'string' || record['provider_id'].length === 0) {
    throw new Error('provider-state report provider_id must be a non-empty string');
  }
  if (record['probed_at'] !== null && typeof record['probed_at'] !== 'string') {
    throw new Error('provider-state report probed_at must be an RFC3339 string or null');
  }
  if (record['credential_env'] !== null && typeof record['credential_env'] !== 'string') {
    throw new Error('provider-state report credential_env must be an env variable NAME or null (the value never appears)');
  }
  if (record['api_revision'] !== null && typeof record['api_revision'] !== 'string') {
    throw new Error('provider-state report api_revision must be a string or null');
  }
  if (record['last_error'] !== null && typeof record['last_error'] !== 'string') {
    throw new Error('provider-state report last_error must be a redacted string or null');
  }
  if (!Array.isArray(record['probes'])) {
    throw new Error('provider-state report probes must be an array of probe records (empty for UNKNOWN)');
  }
  if (typeof record['note'] !== 'string' || record['note'].length === 0) {
    throw new Error('provider-state report note must be a non-empty string');
  }
  if (record['state'] === 'CONNECTED') {
    const probes = record['probes'] as DeploymentProbeRecord[];
    if (probes.length === 0 || !probes.some((probe) => probe.ok)) {
      throw new Error(
        `fabricated CONNECTED for provider '${String(record['provider_id'])}': no successful probe exists — CONNECTED requires real probe evidence`,
      );
    }
  }
  if (record['state'] === 'UNKNOWN' && (record['probes'] as unknown[]).length > 0) {
    throw new Error(
      `inconsistent UNKNOWN for provider '${String(record['provider_id'])}': probe records exist — UNKNOWN is the unprobed state`,
    );
  }
}

/**
 * The probe ledger — records REAL probes and derives the honest state
 * deterministically (clock-injected; no ambient time).
 */
export class DeploymentProbeLedger {
  private readonly probes: DeploymentProbeRecord[] = [];

  /** Record a probe. */
  record(probe: DeploymentProbeRecord): void {
    this.probes.push(probe);
  }

  /** The probe history (latest last). */
  history(): readonly DeploymentProbeRecord[] {
    return [...this.probes];
  }

  /** Build the honest report (UNKNOWN when never probed). */
  report(credentialEnv: string | null): RealDeploymentProviderStateReport {
    if (this.probes.length === 0) {
      return {
        state: 'UNKNOWN',
        provider_id: 'vercel',
        probed_at: null,
        credential_env: credentialEnv,
        api_revision: null,
        last_error: null,
        probes: [],
        note: 'never probed — no real connection evidence exists (UNKNOWN is not health)',
      };
    }
    const latest = this.probes[this.probes.length - 1]!;
    const state = classifyDeploymentProbe(latest);
    return {
      state,
      provider_id: 'vercel',
      probed_at: latest.at,
      credential_env: credentialEnv,
      api_revision: latest.apiRevision,
      last_error: latest.ok ? null : latest.failure,
      probes: [...this.probes],
      note:
        state === 'CONNECTED'
          ? `last real probe at ${latest.at} answered ${String(latest.status)} on ${latest.endpoint}`
          : state === 'DEGRADED'
            ? `last real probe at ${latest.at} answered ${String(latest.status)} (throttled/partial) on ${latest.endpoint}`
            : `last real probe at ${latest.at} failed${
                latest.status === null ? ' at the transport level' : ` with HTTP ${String(latest.status)}`
              }: ${latest.failure ?? 'unspecified'}`,
    };
  }
}
