/**
 * Honest provider states — the P17-A program-defining discipline (the
 * P17-B/P17-C vocabulary, continued for the persistence/deployment lane).
 *
 * Every provider (neon / upstash / r2) reports one of exactly four
 * states, derived ONLY from REAL probe records (an actual HTTP
 * round-trip through the injected FetchPort):
 *
 *   UNKNOWN      never probed (or no probe record for the provider) — the
 *                absence of information is NEVER reported as health
 *   CONNECTED    the last real probe answered successfully (2xx) with
 *                the expected data shape
 *   UNAVAILABLE  the last real probe failed (network/DNS error, 401/403
 *                authentication, 404, 5xx) — the REAL error is recorded
 *                verbatim (redacted through the lane corpus)
 *   DEGRADED     the probe answered but is throttled or partially
 *                usable (HTTP 429, or a 2xx whose body failed shape
 *                validation while the transport itself succeeded)
 *
 * Never fabricated: a provider that has never been probed is UNKNOWN,
 * not CONNECTED; a down provider is UNAVAILABLE with the real reason,
 * never silence.
 *
 * THE FROZEN PORT BRIDGE (documented, never a redefinition): the frozen
 * P2 live-store ProviderHealthRecord vocabulary is
 * AVAILABLE/UNAVAILABLE/UNKNOWN. A probed CONNECTED provider maps to
 * AVAILABLE; a probed UNAVAILABLE provider maps to UNAVAILABLE; an
 * unprobed provider maps to UNKNOWN; DEGRADED maps to AVAILABLE (the
 * provider DID answer its probe — the P2 AVAILABLE definition) with the
 * degradation recorded in the detail and carried in full on this
 * P17-A surface. No frozen state is ever upgraded without a probe.
 */

/** The four honest provider states (P17 lane vocabulary). */
export const REAL_PERSISTENCE_PROVIDER_STATES = ['CONNECTED', 'UNKNOWN', 'UNAVAILABLE', 'DEGRADED'] as const;

export type RealPersistenceProviderState = (typeof REAL_PERSISTENCE_PROVIDER_STATES)[number];

const STATE_SET: ReadonlySet<string> = new Set(REAL_PERSISTENCE_PROVIDER_STATES);

/** Is this a well-formed P17-A provider state? */
export function isRealPersistenceProviderState(value: unknown): value is RealPersistenceProviderState {
  return typeof value === 'string' && STATE_SET.has(value);
}

/** One REAL probe observation of a provider endpoint (the raw evidence). */
export interface PersistenceProbeRecord {
  /** Which provider was probed ('neon' | 'upstash' | 'r2'). */
  readonly provider: string;
  /** A short probe id (e.g. 'neon:sql-ping', 'upstash:ping', 'r2:head-bucket'). */
  readonly probeId: string;
  /** The exact endpoint probed (path + query; never the credential). */
  readonly endpoint: string;
  /** RFC3339 instant of the probe (from the injected clock). */
  readonly at: string;
  /** HTTP status when a response arrived, else null (network/DNS failure). */
  readonly status: number | null;
  /** True when the transport answered 2xx AND the body passed shape validation. */
  readonly ok: boolean;
  /** The real failure reason when !ok (redacted; null when ok). */
  readonly failure: string | null;
  /** API revision identifier when the response carried one (e.g. 'neon.http-sql.v2', 'upstash.rest.v1', 's3.2006-03-01'). */
  readonly apiRevision: string | null;
}

/** Classification of an HTTP probe outcome into the honest state machine. */
export function classifyPersistenceProbe(probe: PersistenceProbeRecord): RealPersistenceProviderState {
  if (probe.ok) {
    return 'CONNECTED';
  }
  if (probe.status === 429) {
    return 'DEGRADED';
  }
  return 'UNAVAILABLE';
}

/** The honest provider-state report — every field is probe evidence or an honest null. */
export interface RealPersistenceProviderStateReport {
  /** The P17-A provider state. */
  readonly state: RealPersistenceProviderState;
  /** The backing provider id ('neon' | 'upstash' | 'r2'). */
  readonly provider_id: string;
  /** The probe instant of the LATEST probe (RFC3339, injected clock), or null when unprobed. */
  readonly probed_at: string | null;
  /** The credential environment variable NAME (the value NEVER appears here), or null. */
  readonly credential_env: string | null;
  /** The exact API revision the probe observed, or null when unprobed/not reported. */
  readonly api_revision: string | null;
  /** The real failure reason for UNAVAILABLE/DEGRADED (redacted), or null. */
  readonly last_error: string | null;
  /** The probe history backing the state (latest last), or [] for UNKNOWN. */
  readonly probes: readonly PersistenceProbeRecord[];
  /** One honest sentence about this state. */
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
export function assertValidRealPersistenceProviderStateReport(
  value: unknown,
): asserts value is RealPersistenceProviderStateReport {
  if (!isPlainObject(value)) {
    throw new Error(`a persistence provider-state report must be an object, received: ${JSON.stringify(value)}`);
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  const expected = REPORT_FIELDS as readonly unknown[];
  if (keys.length !== expected.length || !expected.every((key) => keys.includes(key as string))) {
    throw new Error(`a persistence provider-state report must have the exact field set { ${REPORT_FIELDS.join(', ')} }`);
  }
  if (!isRealPersistenceProviderState(record['state'])) {
    throw new Error(
      `provider state must be one of ${REAL_PERSISTENCE_PROVIDER_STATES.join(', ')} (a real probe outcome — never fabricated)`,
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
  // The honesty contract, machine-checked: CONNECTED requires at least one
  // OK probe; UNKNOWN requires zero probes (or the latest UNKNOWN); a
  // fabricated CONNECTED with no probe evidence is a typed violation.
  if (record['state'] === 'CONNECTED') {
    const probes = record['probes'] as PersistenceProbeRecord[];
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
 * The probe ledger — records REAL probes per provider and derives the
 * honest state deterministically. Clock-injected (no ambient time);
 * adapters append a probe record on every real round-trip performed as
 * a probe (startup probes, health checks, failure paths).
 */
export class PersistenceProbeLedger {
  private readonly probes = new Map<string, PersistenceProbeRecord[]>();

  /** Record a probe for a provider. */
  record(probe: PersistenceProbeRecord): void {
    const existing = this.probes.get(probe.provider) ?? [];
    existing.push(probe);
    this.probes.set(probe.provider, existing);
  }

  /** The probe history of a provider (latest last), or []. */
  probesOf(provider: string): readonly PersistenceProbeRecord[] {
    return this.probes.get(provider) ?? [];
  }

  /** Build the honest report for a provider (UNKNOWN when never probed). */
  reportFor(provider: string, credentialEnv: string | null): RealPersistenceProviderStateReport {
    const probes = this.probesOf(provider);
    if (probes.length === 0) {
      return {
        state: 'UNKNOWN',
        provider_id: provider,
        probed_at: null,
        credential_env: credentialEnv,
        api_revision: null,
        last_error: null,
        probes: [],
        note: 'never probed — no real connection evidence exists (UNKNOWN is not health)',
      };
    }
    const latest = probes[probes.length - 1]!;
    const state = classifyPersistenceProbe(latest);
    return {
      state,
      provider_id: provider,
      probed_at: latest.at,
      credential_env: credentialEnv,
      api_revision: latest.apiRevision,
      last_error: latest.ok ? null : latest.failure,
      probes,
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

/**
 * The documented bridge from the P17-A provider-state vocabulary onto the
 * frozen P2 live-store health vocabulary (AVAILABLE / UNAVAILABLE /
 * UNKNOWN). A probed-and-answered provider (CONNECTED or DEGRADED — the
 * provider DID answer its probe) maps to AVAILABLE, with the degradation
 * detail carried on this surface; a probed-and-failed provider maps to
 * UNAVAILABLE; an unprobed provider maps to UNKNOWN. Never an upgrade
 * without evidence.
 */
export function mapProviderStateToPortAvailability(
  state: RealPersistenceProviderState,
): 'AVAILABLE' | 'UNAVAILABLE' | 'UNKNOWN' {
  switch (state) {
    case 'CONNECTED':
      return 'AVAILABLE';
    case 'DEGRADED':
      return 'AVAILABLE';
    case 'UNAVAILABLE':
      return 'UNAVAILABLE';
    case 'UNKNOWN':
      return 'UNKNOWN';
  }
}
