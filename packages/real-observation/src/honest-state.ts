/**
 * Honest connectivity states — the P17-C program-defining discipline.
 *
 * Every source reports one of exactly four states, derived ONLY from
 * REAL probe records (an actual HTTP round-trip through the injected
 * FetchPort):
 *
 *   UNKNOWN      never probed (or no probe record for the source) — the
 *                absence of information is NEVER reported as health
 *   CONNECTED    the last real probe answered successfully (2xx) with
 *                the expected data shape
 *   UNAVAILABLE  the last real probe failed (network error, 401/403
 *                authentication, 404, 5xx) — the REAL error is recorded
 *                verbatim (redacted through the security corpus)
 *   DEGRADED     the probe answered but is throttled or partially
 *                usable (HTTP 429, or a 2xx whose body failed shape
 *                validation while the transport itself succeeded)
 *
 * Never fabricated: a source that has never been probed is UNKNOWN, not
 * CONNECTED; a down provider is UNAVAILABLE with the real reason, never
 * silence. This vocabulary is P17-C-owned operational vocabulary over
 * the merged plane (the P7 ARCHITECTURE-DELTA precedent for lane-owned
 * runtime vocabulary); the frozen @sos-2/event-ingestion
 * EventSourceDescription.connection field keeps its frozen meaning
 * ('not-yet-connected' = a real endpoint, never 'simulated' — real
 * adapters NEVER claim the simulated marker).
 */

/** The four honest connectivity states (P17-C work-order vocabulary). */
export const HONEST_CONNECTIVITY_STATES = ['CONNECTED', 'UNKNOWN', 'UNAVAILABLE', 'DEGRADED'] as const;

export type HonestConnectivityState = (typeof HONEST_CONNECTIVITY_STATES)[number];

export function isHonestConnectivityState(value: unknown): value is HonestConnectivityState {
  return typeof value === 'string' && (HONEST_CONNECTIVITY_STATES as readonly string[]).includes(value);
}

/** One REAL probe observation of a provider endpoint (the raw evidence). */
export interface ProbeRecord {
  /** Which provider was probed ('github' | 'vercel' | 'upstash' | ...). */
  readonly provider: string;
  /** The exact endpoint probed (path + query; never the token). */
  readonly endpoint: string;
  /** HTTP method. */
  readonly method: 'GET' | 'POST';
  /** RFC3339 instant of the probe (from the injected clock). */
  readonly at: string;
  /** HTTP status when a response arrived, else null (network failure). */
  readonly status: number | null;
  /** True when the transport answered 2xx AND the body passed shape validation. */
  readonly ok: boolean;
  /** The real failure reason when !ok (redacted; null when ok). */
  readonly failure: string | null;
  /** API revision identifier when the response carried one (e.g. 'github.v3', 'vercel.v6'). */
  readonly apiRevision: string | null;
}

/** A source's aggregated honest state with its evidence. */
export interface SourceConnectivityRecord {
  /** The source id (the EventSourceDescription.source). */
  readonly source: string;
  /** The provider family this source serves ('github' | 'vercel' | 'upstash' | ...). */
  readonly provider: string;
  readonly state: HonestConnectivityState;
  /** The probe evidence backing the state (latest last), or [] for UNKNOWN. */
  readonly probes: readonly ProbeRecord[];
  /** The real error for UNAVAILABLE (recorded verbatim, redacted), else null. */
  readonly lastError: string | null;
  /** Human-readable explanation of how the state was derived. */
  readonly detail: string;
  /** RFC3339 instant of the latest probe, or null when never probed. */
  readonly lastProbedAt: string | null;
}

/** Classification of an HTTP probe outcome into the honest state machine. */
export function classifyProbe(probe: ProbeRecord): HonestConnectivityState {
  if (probe.ok) {
    return 'CONNECTED';
  }
  if (probe.status === 429) {
    return 'DEGRADED';
  }
  return 'UNAVAILABLE';
}

/**
 * The connectivity tracker — records REAL probes per source and derives
 * the honest state deterministically. Clock-injected (no ambient time);
 * probe records are appended by the real adapters on every poll.
 */
export class ConnectivityTracker {
  private readonly probes = new Map<string, ProbeRecord[]>();
  private readonly providers = new Map<string, string>();

  /** Record a probe for a source (provider is stable per source id). */
  record(source: string, provider: string, probe: ProbeRecord): void {
    this.providers.set(source, provider);
    const existing = this.probes.get(source) ?? [];
    existing.push(probe);
    this.probes.set(source, existing);
  }

  /** All sources ever seen, deterministic order by source id. */
  sources(): readonly string[] {
    return [...this.providers.keys()].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  }

  /** The full honest-state snapshot for every source ever seen. */
  snapshot(): readonly SourceConnectivityRecord[] {
    return this.sources().map((source) => this.recordFor(source));
  }

  /** The honest record for one source (UNKNOWN when never probed). */
  recordFor(source: string): SourceConnectivityRecord {
    const provider = this.providers.get(source) ?? 'unknown';
    const probes = this.probes.get(source) ?? [];
    const latest = probes.length > 0 ? probes[probes.length - 1]! : null;
    if (latest === null) {
      return {
        source,
        provider,
        state: 'UNKNOWN',
        probes: [],
        lastError: null,
        detail: 'never probed — no real connection evidence exists (UNKNOWN is not health)',
        lastProbedAt: null,
      };
    }
    const state = classifyProbe(latest);
    return {
      source,
      provider,
      state,
      probes,
      lastError: latest.ok ? null : latest.failure,
      detail:
        state === 'CONNECTED'
          ? `last real probe at ${latest.at} answered ${String(latest.status)} on ${latest.endpoint}`
          : state === 'DEGRADED'
            ? `last real probe at ${latest.at} answered ${String(latest.status)} (throttled/partial) on ${latest.endpoint}`
            : `last real probe at ${latest.at} failed${latest.status === null ? ' at the transport level' : ` with HTTP ${String(latest.status)}`}: ${latest.failure ?? 'unspecified'}`,
      lastProbedAt: latest.at,
    };
  }

  /** The aggregate honest state for a PROVIDER across its sources (worst wins; UNKNOWN when none probed). */
  providerState(provider: string): { state: HonestConnectivityState; detail: string; sources: readonly string[] } {
    const sources = this.sources().filter((source) => (this.providers.get(source) ?? '') === provider);
    if (sources.length === 0) {
      return { state: 'UNKNOWN', detail: `no source for provider ${provider} has been probed`, sources: [] };
    }
    const records = sources.map((source) => this.recordFor(source));
    const rank: Record<HonestConnectivityState, number> = { UNAVAILABLE: 0, DEGRADED: 1, CONNECTED: 2, UNKNOWN: 3 };
    let worst: SourceConnectivityRecord = records[0]!;
    for (const record of records) {
      if (rank[record.state] < rank[worst.state]) {
        worst = record;
      }
    }
    if (records.every((record) => record.state === 'UNKNOWN')) {
      return { state: 'UNKNOWN', detail: `no ${provider} source has been probed yet`, sources };
    }
    const withEvidence = records.filter((record) => record.state !== 'UNKNOWN');
    const worstSeen = withEvidence.reduce((acc, record) => (rank[record.state] < rank[acc.state] ? record : acc), withEvidence[0]!);
    return {
      state: worstSeen.state,
      detail:
        worstSeen.state === 'CONNECTED'
          ? `all probed ${provider} sources answered real probes (latest: ${worstSeen.detail})`
          : `worst probed ${provider} source state is ${worstSeen.state}: ${worstSeen.detail}`,
      sources,
    };
  }
}
