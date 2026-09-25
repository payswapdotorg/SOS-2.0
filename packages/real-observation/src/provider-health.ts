/**
 * Provider health — real per-provider probes + the aggregate honest
 * state (P17-C).
 *
 * The ProviderHealthSource is a REAL organic source (family
 * 'provider-health'): every poll performs one bounded REAL round-trip
 * against EACH configured provider (github / vercel / upstash) through
 * the injected FetchPort and emits one 'provider-health.signal' event
 * per provider carrying the honest status the probe observed:
 *
 *   HEALTHY     the provider answered 2xx with the expected shape
 *   DEGRADED    the provider answered but is throttled (429)
 *   UNAVAILABLE the provider failed (network / auth / 5xx) — the real
 *               reason is recorded in the tracker
 *
 * The signal's external id embeds the observed status
 * (`health-{provider}-{status}`) so an UNCHANGED state redelivers as the
 * same durable id (typed DUPLICATE — the last-signal projection stays
 * true) while a state CHANGE is a new event.
 *
 * The aggregate (aggregateProviderHealth) folds the per-source
 * connectivity records into the per-provider four-state machine
 * (CONNECTED / UNKNOWN / UNAVAILABLE / DEGRADED — worst probed state
 * wins; a provider with no probes is UNKNOWN, never health).
 */

import type { Clock } from '@sos-2/live-store';
import type { EventSourceDescription, EventSourcePort, ExternalEventEnvelope } from '@sos-2/event-ingestion';
import type { ConnectivityTracker, HonestConnectivityState, SourceConnectivityRecord } from './honest-state.js';
import type { TranscriptRecorder } from './transcript.js';
import type { FetchPort, HttpRequest } from './http.js';

export const PROVIDER_HEALTH_SOURCE_ID = 'provider-health:real-probes';

/** One provider endpoint to probe each poll. */
export interface ProviderProbeSpec {
  readonly provider: string;
  readonly request: HttpRequest;
  /** Minimal body sanity predicate (null = status-only). */
  readonly expectBody?: (body: string) => boolean;
  readonly apiRevision: string;
}

/** Map an HTTP outcome to the honest signal status (pure). */
export function signalStatusFor(status: number, bodyOk: boolean): 'HEALTHY' | 'DEGRADED' | 'UNAVAILABLE' {
  if (status === 429) {
    return 'DEGRADED';
  }
  if (status >= 200 && status < 300 && bodyOk) {
    return 'HEALTHY';
  }
  return 'UNAVAILABLE';
}

export interface ProviderHealthSourceDeps {
  readonly probes: readonly ProviderProbeSpec[];
  readonly fetch: FetchPort;
  readonly clock: Clock;
  readonly tracker: ConnectivityTracker;
  readonly transcript: TranscriptRecorder;
}

export class ProviderHealthSource implements EventSourcePort {
  private readonly probes: readonly ProviderProbeSpec[];
  private readonly fetch: FetchPort;
  private readonly clock: Clock;
  private readonly tracker: ConnectivityTracker;
  private readonly transcript: TranscriptRecorder;

  constructor(deps: ProviderHealthSourceDeps) {
    this.probes = deps.probes;
    this.fetch = deps.fetch;
    this.clock = deps.clock;
    this.tracker = deps.tracker;
    this.transcript = deps.transcript;
  }

  describe(): EventSourceDescription {
    return {
      source: PROVIDER_HEALTH_SOURCE_ID,
      family: 'provider-health',
      connection: 'not-yet-connected',
      description: `real per-provider health probes (${this.probes.map((probe) => probe.provider).sort().join(', ')}); aggregate honest state from the connectivity tracker`,
    };
  }

  async poll(): Promise<readonly ExternalEventEnvelope[]> {
    const at = new Date(this.clock.nowEpochMs()).toISOString();
    const envelopes: ExternalEventEnvelope[] = [];
    for (const spec of this.probes) {
      const endpoint = new URL(spec.request.url).pathname;
      let status: number | null = null;
      let bodyOk = true;
      let failure: string | null = null;
      try {
        const response = await this.fetch(spec.request);
        this.transcript.record({ at, source: PROVIDER_HEALTH_SOURCE_ID, request: spec.request, response, transportError: null });
        status = response.status;
        if (spec.expectBody !== undefined && !spec.expectBody(response.body)) {
          bodyOk = false;
          failure = `HTTP ${String(response.status)} body failed the expected shape`;
        }
      } catch (error) {
        const reason = (error as Error).message;
        this.transcript.record({ at, source: PROVIDER_HEALTH_SOURCE_ID, request: spec.request, response: null, transportError: reason });
        failure = reason;
      }
      const signal = signalStatusFor(status ?? -1, bodyOk);
      this.tracker.record(PROVIDER_HEALTH_SOURCE_ID, spec.provider, {
        provider: spec.provider,
        endpoint,
        method: spec.request.method,
        at,
        status,
        ok: signal === 'HEALTHY',
        failure: signal === 'HEALTHY' ? null : (failure ?? `HTTP ${status === null ? 'transport-failed' : String(status)}`),
        apiRevision: spec.apiRevision,
      });
      envelopes.push({
        externalId: `health-${spec.provider}-${signal}`,
        kind: 'provider-health.signal',
        occurredAt: at,
        payload: { provider: spec.provider, status: signal },
        provenance: [`provider-health:real-probe:${spec.provider}`, `api:${spec.apiRevision}`],
      });
    }
    return envelopes;
  }
}

export interface ProviderHealthAggregateEntry {
  readonly provider: string;
  readonly state: HonestConnectivityState;
  readonly detail: string;
  readonly sources: readonly string[];
  /** The source-level records backing the aggregate (evidence binding). */
  readonly records: readonly SourceConnectivityRecord[];
}

/** The aggregate honest state across every probed source, per provider (pure over the tracker). */
export function aggregateProviderHealth(tracker: ConnectivityTracker): readonly ProviderHealthAggregateEntry[] {
  const providers = new Set<string>();
  for (const record of tracker.snapshot()) {
    providers.add(record.provider);
  }
  return [...providers].sort().map((provider) => {
    const aggregate = tracker.providerState(provider);
    return {
      provider,
      state: aggregate.state,
      detail: aggregate.detail,
      sources: aggregate.sources,
      records: tracker
        .snapshot()
        .filter((record) => record.provider === provider),
    };
  });
}
