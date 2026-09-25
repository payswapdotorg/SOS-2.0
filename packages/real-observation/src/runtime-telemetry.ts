/**
 * Runtime telemetry — real W3 TelemetrySource adapters (P17-C).
 *
 * The merged @sos-2/telemetry TelemetrySource contract is BUFFERED-SYNC:
 * `fetch(query)` returns validated RawObservations synchronously, with
 * production backends feeding an internal buffer from their async
 * transports. These real adapters follow exactly that: each exposes an
 * async `refresh()` that performs the REAL HTTP round-trip through the
 * injected FetchPort and buffers one RawObservation capture.
 *
 * FAILED PULLS follow the merged telemetry-runtime discipline exactly:
 * "A source whose pull THROWS records a typed POLL_FAILED outcome — the
 * runtime does NOT fabricate a gap observation for a failed pull (a gap
 * event asserts data absence; a failed pull asserts neither presence nor
 * absence — conflating them would be dishonest)." Therefore a failed
 * refresh makes the NEXT fetch() THROW with the real reason (the
 * TelemetryRuntime records the typed failure); it never queues a
 * fabricated gap capture. The failed round-trip is still recorded in the
 * connectivity tracker (honest-state machine) and the redacted
 * transcript.
 *
 * Real sources:
 *   - GitHubRateLimitTelemetrySource: GET /rate_limit — the real
 *     remaining/used/reset budget of the PAT (genuine runtime telemetry
 *     of the GitHub provider as observed by this system).
 *   - UpstashRedisTelemetrySource: POST /pipeline [["PING"],["DBSIZE"]]
 *     — the real Redis PONG + key count of the live Upstash instance.
 *   - HttpJsonTelemetrySource: any JSON metrics endpoint (the generic
 *     adapter for the deployed SOS runtime — its subject is configured).
 */

import type { Clock } from '@sos-2/live-store';
import type { RawObservation, TelemetrySource } from '@sos-2/telemetry';
import type { Producer } from '@sos-2/provenance';
import type { ConnectivityTracker } from './honest-state.js';
import type { TranscriptRecorder } from './transcript.js';
import type { FetchPort, HttpRequest } from './http.js';
import { parseJsonBody } from './http.js';

export interface RealTelemetrySourceAdapter extends TelemetrySource {
  /** Perform the real HTTP round-trip and buffer the capture. A failure records the reason for the next fetch() (typed POLL_FAILED). */
  refresh(): Promise<void>;
}

const PRODUCER: Producer = {
  tool: 'real-observation',
  tool_version: '0.1.0',
  model: null,
  model_version: null,
  command: null,
  environment: null,
};

/** Shared buffered behavior: one capture slot, drained by fetch(); a failed refresh surfaces as a typed fetch() throw. */
abstract class BufferedRealTelemetrySource implements RealTelemetrySourceAdapter {
  readonly id: string;
  readonly description: string | null;
  protected readonly clock: Clock;
  protected readonly tracker: ConnectivityTracker;
  protected readonly transcript: TranscriptRecorder;
  private buffer: RawObservation[] = [];
  private lastFailure: string | null = null;

  abstract refresh(): Promise<void>;

  constructor(init: { id: string; description: string; clock: Clock; tracker: ConnectivityTracker; transcript: TranscriptRecorder }) {
    this.id = init.id;
    this.description = init.description;
    this.clock = init.clock;
    this.tracker = init.tracker;
    this.transcript = init.transcript;
  }

  fetch(): RawObservation[] {
    if (this.lastFailure !== null) {
      const failure = this.lastFailure;
      throw new Error(`${this.id}: telemetry pull failed: ${failure}`);
    }
    return this.buffer.splice(0, this.buffer.length);
  }

  protected queue(observation: RawObservation): void {
    this.buffer.push(observation);
  }

  protected window(): { start: string; end: string } {
    const endMs = this.clock.nowEpochMs();
    return { start: new Date(endMs - 1_000).toISOString(), end: new Date(endMs).toISOString() };
  }

  /** Shared failure handling: record tracker + transcript, set the typed failure for the next fetch(). */
  protected noteFailure(sourceId: string, provider: string, endpoint: string, method: 'GET' | 'POST', at: string, request: HttpRequest, status: number | null, failure: string, apiRevision: string | null): void {
    if (status === null) {
      this.transcript.record({ at, source: sourceId, request, response: null, transportError: failure });
    }
    this.lastFailure = failure;
    this.tracker.record(sourceId, provider, { provider, endpoint, method, at, status, ok: false, failure, apiRevision });
  }

  /** Shared success handling: clear the failure, record the probe. */
  protected noteSuccess(sourceId: string, provider: string, endpoint: string, method: 'GET' | 'POST', at: string, request: HttpRequest, status: number, apiRevision: string | null): void {
    this.lastFailure = null;
    this.tracker.record(sourceId, provider, { provider, endpoint, method, at, status, ok: true, failure: null, apiRevision });
  }
}

/** Real GitHub rate-limit telemetry (GET /rate_limit, core resource). */
export class GitHubRateLimitTelemetrySource extends BufferedRealTelemetrySource {
  private readonly fetchPort: FetchPort;
  private readonly token: string;
  private readonly tokenEnvName: string;
  private readonly apiBase: string;
  private readonly sourceId: string;

  constructor(deps: {
    clock: Clock;
    fetch: FetchPort;
    token: string;
    tokenEnvName: string;
    apiBase?: string;
    tracker: ConnectivityTracker;
    transcript: TranscriptRecorder;
  }) {
    super({ id: 'telemetry:github-rate-limit', description: 'real GitHub REST rate-limit budget of the observation PAT (GET /rate_limit, core resource)', clock: deps.clock, tracker: deps.tracker, transcript: deps.transcript });
    this.fetchPort = deps.fetch;
    this.token = deps.token;
    this.tokenEnvName = deps.tokenEnvName;
    this.apiBase = deps.apiBase ?? 'https://api.github.com';
    this.sourceId = 'github:rate-limit';
  }

  async refresh(): Promise<void> {
    const request: HttpRequest = {
      method: 'GET',
      url: `${this.apiBase}/rate_limit`,
      headers: { authorization: `Bearer ${this.token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' },
      body: null,
    };
    const at = new Date(this.clock.nowEpochMs()).toISOString();
    let response;
    try {
      response = await this.fetchPort(request);
    } catch (error) {
      this.noteFailure(this.sourceId, 'github', '/rate_limit', 'GET', at, request, null, (error as Error).message, null);
      return;
    }
    this.transcript.record({ at, source: this.sourceId, request, response, transportError: null });
    const apiRevision = response.headers['x-github-media-type'] ?? 'github.v3';
    if (response.status !== 200) {
      this.noteFailure(this.sourceId, 'github', '/rate_limit', 'GET', at, request, response.status, `HTTP ${String(response.status)}: rate-limit endpoint unusable`, apiRevision);
      return;
    }
    let core: Record<string, unknown> | null = null;
    try {
      const body = parseJsonBody(response) as Record<string, unknown>;
      const resources = typeof body['resources'] === 'object' && body['resources'] !== null ? (body['resources'] as Record<string, unknown>) : null;
      const maybeCore = resources !== null && typeof resources['core'] === 'object' && resources['core'] !== null ? (resources['core'] as Record<string, unknown>) : null;
      core = maybeCore;
    } catch {
      core = null;
    }
    if (core === null) {
      this.noteFailure(this.sourceId, 'github', '/rate_limit', 'GET', at, request, response.status, 'rate-limit body did not carry the core resource', apiRevision);
      return;
    }
    this.noteSuccess(this.sourceId, 'github', '/rate_limit', 'GET', at, request, response.status, apiRevision);
    this.queue({
      subject_ref: 'telemetry:github:rate-limit:core',
      availability: 'SUCCESS',
      window: this.window(),
      observed: {
        limit: typeof core['limit'] === 'number' ? core['limit'] : null,
        used: typeof core['used'] === 'number' ? core['used'] : null,
        remaining: typeof core['remaining'] === 'number' ? core['remaining'] : null,
        reset: typeof core['reset'] === 'number' ? core['reset'] : null,
      },
      attributes: { provider: 'github', api_revision: apiRevision, token_env: this.tokenEnvName },
      producer: PRODUCER,
    });
  }
}

/** Real Upstash Redis runtime telemetry (POST /pipeline [["PING"],["DBSIZE"]]). */
export class UpstashRedisTelemetrySource extends BufferedRealTelemetrySource {
  private readonly fetchPort: FetchPort;
  private readonly token: string;
  private readonly tokenEnvName: string;
  private readonly restUrl: string;
  private readonly sourceId: string;

  constructor(deps: {
    clock: Clock;
    fetch: FetchPort;
    restUrl: string;
    token: string;
    tokenEnvName: string;
    tracker: ConnectivityTracker;
    transcript: TranscriptRecorder;
  }) {
    super({ id: 'telemetry:upstash-redis', description: `real Upstash Redis runtime probe (POST /pipeline PING+DBSIZE on ${deps.restUrl})`, clock: deps.clock, tracker: deps.tracker, transcript: deps.transcript });
    this.fetchPort = deps.fetch;
    this.restUrl = deps.restUrl;
    this.token = deps.token;
    this.tokenEnvName = deps.tokenEnvName;
    this.sourceId = 'upstash:redis';
  }

  async refresh(): Promise<void> {
    const request: HttpRequest = {
      method: 'POST',
      url: `${this.restUrl}/pipeline`,
      headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' },
      body: '[["PING"],["DBSIZE"]]',
    };
    const at = new Date(this.clock.nowEpochMs()).toISOString();
    let response;
    try {
      response = await this.fetchPort(request);
    } catch (error) {
      this.noteFailure(this.sourceId, 'upstash', '/pipeline', 'POST', at, request, null, (error as Error).message, null);
      return;
    }
    this.transcript.record({ at, source: this.sourceId, request, response, transportError: null });
    if (response.status !== 200) {
      this.noteFailure(this.sourceId, 'upstash', '/pipeline', 'POST', at, request, response.status, `HTTP ${String(response.status)}: pipeline endpoint unusable`, 'upstash-rest');
      return;
    }
    let ping: unknown = null;
    let dbsize: unknown = null;
    try {
      const body = parseJsonBody(response);
      if (Array.isArray(body) && body.length >= 2 && typeof body[0] === 'object' && body[0] !== null && 'result' in (body[0] as Record<string, unknown>)) {
        ping = (body[0] as Record<string, unknown>)['result'];
        dbsize = (body[1] as Record<string, unknown> | undefined)?.['result'] ?? null;
      }
    } catch {
      ping = null;
    }
    if (ping === null) {
      this.noteFailure(this.sourceId, 'upstash', '/pipeline', 'POST', at, request, response.status, 'pipeline body did not carry the PING result', 'upstash-rest');
      return;
    }
    this.noteSuccess(this.sourceId, 'upstash', '/pipeline', 'POST', at, request, response.status, 'upstash-rest');
    this.queue({
      subject_ref: 'telemetry:upstash:redis',
      availability: 'SUCCESS',
      window: this.window(),
      observed: { ping: typeof ping === 'string' ? ping : null, dbsize: typeof dbsize === 'number' ? dbsize : null },
      attributes: { provider: 'upstash', token_env: this.tokenEnvName },
      producer: PRODUCER,
    });
  }
}

/** Generic real JSON metrics endpoint adapter (for the deployed SOS runtime). */
export class HttpJsonTelemetrySource extends BufferedRealTelemetrySource {
  private readonly fetchPort: FetchPort;
  private readonly url: string;
  private readonly subjectRef: string;
  private readonly sourceId: string;

  constructor(deps: {
    clock: Clock;
    fetch: FetchPort;
    url: string;
    subjectRef: string;
    sourceId: string;
    description: string | null;
    tracker: ConnectivityTracker;
    transcript: TranscriptRecorder;
  }) {
    super({ id: `telemetry:http:${deps.sourceId}`, description: deps.description ?? `real JSON metrics endpoint ${deps.url}`, clock: deps.clock, tracker: deps.tracker, transcript: deps.transcript });
    this.fetchPort = deps.fetch;
    this.url = deps.url;
    this.subjectRef = deps.subjectRef;
    this.sourceId = deps.sourceId;
  }

  async refresh(): Promise<void> {
    const request: HttpRequest = { method: 'GET', url: this.url, headers: {}, body: null };
    const at = new Date(this.clock.nowEpochMs()).toISOString();
    let response;
    try {
      response = await this.fetchPort(request);
    } catch (error) {
      this.noteFailure(this.sourceId, 'http-metrics', new URL(this.url).pathname, 'GET', at, request, null, (error as Error).message, null);
      return;
    }
    this.transcript.record({ at, source: this.sourceId, request, response, transportError: null });
    if (response.status !== 200) {
      this.noteFailure(this.sourceId, 'http-metrics', new URL(this.url).pathname, 'GET', at, request, response.status, `HTTP ${String(response.status)}`, null);
      return;
    }
    let observed: unknown;
    try {
      observed = parseJsonBody(response);
    } catch (error) {
      this.noteFailure(this.sourceId, 'http-metrics', new URL(this.url).pathname, 'GET', at, request, response.status, `malformed JSON: ${(error as Error).message}`, null);
      return;
    }
    this.noteSuccess(this.sourceId, 'http-metrics', new URL(this.url).pathname, 'GET', at, request, response.status, null);
    this.queue({
      subject_ref: this.subjectRef,
      availability: 'SUCCESS',
      window: this.window(),
      observed: observed as import('@sos-2/semantic-spine').JsonValue,
      attributes: { provider: 'http-metrics', url: this.url },
      producer: PRODUCER,
    });
  }
}
