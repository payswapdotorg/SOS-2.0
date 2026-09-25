/**
 * GitHub repository events — the real source (P17-C).
 *
 * TWO delivery shapes behind ONE honest contract:
 *
 *   1. the WEBHOOK-SHAPED RECEIVER (./github-webhook.ts): GitHub
 *      delivers push/pull_request webhook payloads with an
 *      X-Hub-Signature-256 HMAC; the receiver validates and normalizes
 *      them into the SAME envelope shapes this module produces.
 *   2. the POLLING FALLBACK (this module): the public REST events API
 *      (`GET /repos/{owner}/{repo}/events`) read with the PAT — the
 *      production-real path for deployments without an inbound webhook
 *      endpoint (§4 harness-integration order: use the highest available
 *      control surface; polling is a first-class fallback, never a
 *      fabrication).
 *
 * MAPPING (webhook shape == REST shape — one contract):
 *   PushEvent           -> kind 'github.push',         payload {ref, before, after}
 *   PullRequestEvent    -> kind 'github.pull_request', payload {action, number, head, base}
 *   every other type    -> not mapped (skipped honestly; the §5 family is
 *                          repository events — watching/fork events carry no
 *                          revision information the plane projects)
 *
 * Replay protection: the external id is GitHub's OWN durable event id, so
 * redelivery (webhook retry or the next poll) is the same durable id and
 * deduplicates exactly through the merged P7 pipeline.
 *
 * Every poll is a REAL probe: the round-trip is recorded in the
 * connectivity tracker (honest CONNECTED/UNAVAILABLE/DEGRADED) and the
 * redacted transcript. A failed poll THROWS with the real reason — the
 * merged pipeline records a typed POLL_FAILED (never fabricated
 * success).
 */

import type { Clock } from '@sos-2/live-store';
import type { EventSourceDescription, EventSourcePort, ExternalEventEnvelope } from '@sos-2/event-ingestion';
import type { ConnectivityTracker } from './honest-state.js';
import type { TranscriptRecorder } from './transcript.js';
import type { FetchPort, HttpRequest, HttpResponse } from './http.js';
import { parseJsonBody } from './http.js';

export interface GitHubEventsConfig {
  readonly owner: string;
  readonly repo: string;
  /** The PAT VALUE (injected at the process boundary from the env name — never read here). */
  readonly token: string;
  /** The env NAME the token came from (transcript references only, never the value). */
  readonly tokenEnvName: string;
  readonly apiBase?: string;
  readonly perPage?: number;
}

export interface GitHubEventsSourceDeps {
  readonly config: GitHubEventsConfig;
  readonly fetch: FetchPort;
  readonly clock: Clock;
  readonly tracker: ConnectivityTracker;
  readonly transcript: TranscriptRecorder;
}

export const GITHUB_EVENTS_SOURCE_ID = 'github:rest-events';

/** One mapped GitHub REST event (public for tests + the webhook receiver parity). */
export interface MappedGitHubEvent {
  readonly externalId: string;
  readonly kind: 'github.push' | 'github.pull_request';
  readonly occurredAt: string;
  readonly payload: Record<string, unknown>;
}

/** Map a GitHub REST /events item to the plane's envelope shape (pure; unknown types -> null). */
export function mapRestEventItem(item: unknown): MappedGitHubEvent | null {
  if (typeof item !== 'object' || item === null) {
    return null;
  }
  const record = item as Record<string, unknown>;
  const id = typeof record['id'] === 'string' ? record['id'] : null;
  const type = typeof record['type'] === 'string' ? record['type'] : null;
  const createdAt = typeof record['created_at'] === 'string' ? record['created_at'] : null;
  const payload = typeof record['payload'] === 'object' && record['payload'] !== null ? (record['payload'] as Record<string, unknown>) : null;
  if (id === null || type === null || createdAt === null || payload === null) {
    return null;
  }
  if (type === 'PushEvent') {
    const ref = typeof payload['ref'] === 'string' ? payload['ref'] : null;
    const after = typeof payload['head'] === 'string' ? payload['head'] : null;
    const before = typeof payload['before'] === 'string' ? payload['before'] : null;
    if (ref === null || after === null || before === null) {
      return null;
    }
    return { externalId: id, kind: 'github.push', occurredAt: createdAt, payload: { ref, before, after } };
  }
  if (type === 'PullRequestEvent') {
    const action = typeof payload['action'] === 'string' ? payload['action'] : null;
    const number = typeof payload['number'] === 'number' ? payload['number'] : null;
    const pullRequest = typeof payload['pull_request'] === 'object' && payload['pull_request'] !== null ? (payload['pull_request'] as Record<string, unknown>) : null;
    const head = pullRequest !== null && typeof (pullRequest['head'] as Record<string, unknown> | undefined)?.['sha'] === 'string' ? (pullRequest['head'] as Record<string, unknown>)['sha'] as string : null;
    const baseRef = pullRequest !== null && typeof (pullRequest['base'] as Record<string, unknown> | undefined)?.['ref'] === 'string' ? (pullRequest['base'] as Record<string, unknown>)['ref'] as string : null;
    if (action === null || number === null || head === null || baseRef === null) {
      return null;
    }
    if (action !== 'opened' && action !== 'closed' && action !== 'reopened') {
      return null;
    }
    return { externalId: id, kind: 'github.pull_request', occurredAt: createdAt, payload: { action, number, head, base: baseRef } };
  }
  return null;
}

/** The real GitHub REST events polling source. */
export class GitHubEventsSource implements EventSourcePort {
  private readonly config: GitHubEventsConfig;
  private readonly fetch: FetchPort;
  private readonly clock: Clock;
  private readonly tracker: ConnectivityTracker;
  private readonly transcript: TranscriptRecorder;

  constructor(deps: GitHubEventsSourceDeps) {
    this.config = deps.config;
    this.fetch = deps.fetch;
    this.clock = deps.clock;
    this.tracker = deps.tracker;
    this.transcript = deps.transcript;
  }

  describe(): EventSourceDescription {
    return {
      source: this.sourceId(),
      family: 'github',
      connection: 'not-yet-connected',
      description: `real GitHub REST events polling for ${this.config.owner}/${this.config.repo} (PAT via env ${this.config.tokenEnvName}); connectivity tracked by real probes`,
    };
  }

  sourceId(): string {
    return `${GITHUB_EVENTS_SOURCE_ID}:${this.config.owner}/${this.config.repo}`;
  }

  async poll(): Promise<readonly ExternalEventEnvelope[]> {
    const endpoint = `/repos/${this.config.owner}/${this.config.repo}/events`;
    const url = `${this.config.apiBase ?? 'https://api.github.com'}${endpoint}?per_page=${String(this.config.perPage ?? 50)}`;
    const request: HttpRequest = {
      method: 'GET',
      url,
      headers: {
        authorization: `Bearer ${this.config.token}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
      },
      body: null,
    };
    const at = new Date(this.clock.nowEpochMs()).toISOString();
    let response: HttpResponse;
    try {
      response = await this.fetch(request);
    } catch (error) {
      const reason = (error as Error).message;
      this.transcript.record({ at, source: this.sourceId(), request, response: null, transportError: reason });
      this.tracker.record(this.sourceId(), 'github', {
        provider: 'github',
        endpoint,
        method: 'GET',
        at,
        status: null,
        ok: false,
        failure: reason,
        apiRevision: null,
      });
      throw error;
    }
    const apiRevision = response.headers['x-github-media-type'] ?? 'github.v3';
    this.transcript.record({ at, source: this.sourceId(), request, response, transportError: null });
    if (response.status === 200) {
      let body: unknown;
      try {
        body = parseJsonBody(response);
      } catch (error) {
        this.tracker.record(this.sourceId(), 'github', { provider: 'github', endpoint, method: 'GET', at, status: response.status, ok: false, failure: `malformed JSON body: ${(error as Error).message}`, apiRevision });
        throw new Error(`GITHUB_EVENTS_MALFORMED: ${this.sourceId()} returned a non-JSON body with HTTP ${String(response.status)}`);
      }
      if (!Array.isArray(body)) {
        this.tracker.record(this.sourceId(), 'github', { provider: 'github', endpoint, method: 'GET', at, status: response.status, ok: false, failure: 'expected a JSON array of events', apiRevision });
        throw new Error(`GITHUB_EVENTS_SHAPE: ${this.sourceId()} returned a non-array body with HTTP ${String(response.status)}`);
      }
      this.tracker.record(this.sourceId(), 'github', { provider: 'github', endpoint, method: 'GET', at, status: response.status, ok: true, failure: null, apiRevision });
      const envelopes: ExternalEventEnvelope[] = [];
      for (const item of body) {
        const mapped = mapRestEventItem(item);
        if (mapped === null) {
          continue;
        }
        envelopes.push({
          externalId: mapped.externalId,
          kind: mapped.kind,
          occurredAt: mapped.occurredAt,
          payload: mapped.payload,
          provenance: [`github-rest:events:${this.config.owner}/${this.config.repo}`, 'api:github.v3'],
        });
      }
      return envelopes;
    }
    const failure = `HTTP ${String(response.status)}: ${response.body.slice(0, 200)}`;
    this.tracker.record(this.sourceId(), 'github', { provider: 'github', endpoint, method: 'GET', at, status: response.status, ok: false, failure, apiRevision });
    throw new Error(`GITHUB_EVENTS_POLL_FAILED: ${this.sourceId()} answered HTTP ${String(response.status)} — ${response.status === 429 ? 'rate-limited' : response.status === 401 || response.status === 403 ? 'authentication failed' : 'provider error'}`);
  }
}
