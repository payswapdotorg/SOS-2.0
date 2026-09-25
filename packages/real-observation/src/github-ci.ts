/**
 * GitHub Actions CI results — the real source (P17-C).
 *
 * Polls `GET /repos/{owner}/{repo}/actions/runs` (the REST runs API,
 * read with the PAT) and maps every workflow run to the plane's
 * 'ci.run' envelope: {pipeline (workflow name), ref (the run's head
 * commit sha — CI results PER COMMIT), status (capture-level truth
 * carried verbatim), runId}.
 *
 * STATUS HONESTY: the mapped status is GitHub's own run state, uppercased:
 *   - a run still queued/in progress -> 'QUEUED' / 'IN_PROGRESS'
 *   - a completed run -> its conclusion uppercased
 *     ('SUCCESS' | 'FAILURE' | 'CANCELLED' | 'STARTUP_FAILURE' | ...)
 *   - a completed run with no conclusion -> 'UNKNOWN' (honest — the
 *     conclusion is unknown, never assumed success)
 * The merged projection carries the status string VERBATIM — nothing is
 * folded.
 *
 * REPLAY PROTECTION + STATUS TRANSITIONS: the external id embeds the
 * observed status (`run-{id}-{status}`) so a run whose status CHANGED
 * between polls is a NEW observation (a new durable event) while an
 * unchanged redelivery deduplicates exactly.
 */

import type { Clock } from '@sos-2/live-store';
import type { EventSourceDescription, EventSourcePort, ExternalEventEnvelope } from '@sos-2/event-ingestion';
import type { ConnectivityTracker } from './honest-state.js';
import type { TranscriptRecorder } from './transcript.js';
import type { FetchPort, HttpRequest, HttpResponse } from './http.js';
import { parseJsonBody } from './http.js';

export interface GitHubCiConfig {
  readonly owner: string;
  readonly repo: string;
  readonly token: string;
  readonly tokenEnvName: string;
  readonly apiBase?: string;
  readonly perPage?: number;
  /** Only runs for this branch (GitHub's branch= filter), or null for all branches. */
  readonly branch?: string | null;
}

export interface GitHubCiSourceDeps {
  readonly config: GitHubCiConfig;
  readonly fetch: FetchPort;
  readonly clock: Clock;
  readonly tracker: ConnectivityTracker;
  readonly transcript: TranscriptRecorder;
}

export const GITHUB_CI_SOURCE_ID = 'ci:github-actions';

/** Map one GitHub Actions workflow-run JSON object to the ci.run payload shape (pure). */
export function mapWorkflowRun(run: unknown): { runId: string; pipeline: string; ref: string; status: string; occurredAt: string } | null {
  if (typeof run !== 'object' || run === null) {
    return null;
  }
  const record = run as Record<string, unknown>;
  const id = typeof record['id'] === 'number' ? record['id'] : typeof record['id'] === 'string' ? record['id'] : null;
  const name = typeof record['name'] === 'string' ? record['name'] : null;
  const headSha = typeof record['head_sha'] === 'string' ? record['head_sha'] : null;
  const status = typeof record['status'] === 'string' ? record['status'] : null;
  const conclusion = typeof record['conclusion'] === 'string' ? record['conclusion'] : null;
  const createdAt = typeof record['created_at'] === 'string' ? record['created_at'] : null;
  const updatedAt = typeof record['updated_at'] === 'string' ? record['updated_at'] : null;
  if (id === null || name === null || headSha === null || status === null || createdAt === null || updatedAt === null) {
    return null;
  }
  const mappedStatus = status === 'completed' ? (conclusion !== null ? conclusion.toUpperCase() : 'UNKNOWN') : status.toUpperCase();
  const occurredAt = status === 'completed' ? updatedAt : createdAt;
  return { runId: String(id), pipeline: name, ref: headSha, status: mappedStatus, occurredAt };
}

export class GitHubCiSource implements EventSourcePort {
  private readonly config: GitHubCiConfig;
  private readonly fetch: FetchPort;
  private readonly clock: Clock;
  private readonly tracker: ConnectivityTracker;
  private readonly transcript: TranscriptRecorder;

  constructor(deps: GitHubCiSourceDeps) {
    this.config = deps.config;
    this.fetch = deps.fetch;
    this.clock = deps.clock;
    this.tracker = deps.tracker;
    this.transcript = deps.transcript;
  }

  describe(): EventSourceDescription {
    return {
      source: this.sourceId(),
      family: 'ci',
      connection: 'not-yet-connected',
      description: `real GitHub Actions runs polling for ${this.config.owner}/${this.config.repo} (PAT via env ${this.config.tokenEnvName}); connectivity tracked by real probes`,
    };
  }

  sourceId(): string {
    return `${GITHUB_CI_SOURCE_ID}:${this.config.owner}/${this.config.repo}`;
  }

  async poll(): Promise<readonly ExternalEventEnvelope[]> {
    const endpoint = `/repos/${this.config.owner}/${this.config.repo}/actions/runs`;
    const query = new URLSearchParams({ per_page: String(this.config.perPage ?? 20) });
    if (this.config.branch !== null && this.config.branch !== undefined && this.config.branch !== '') {
      query.set('branch', this.config.branch);
    }
    const url = `${this.config.apiBase ?? 'https://api.github.com'}${endpoint}?${query.toString()}`;
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
      this.tracker.record(this.sourceId(), 'github', { provider: 'github', endpoint, method: 'GET', at, status: null, ok: false, failure: reason, apiRevision: null });
      throw error;
    }
    const apiRevision = response.headers['x-github-media-type'] ?? 'github.v3';
    this.transcript.record({ at, source: this.sourceId(), request, response, transportError: null });
    if (response.status !== 200) {
      const failure = `HTTP ${String(response.status)}: ${response.body.slice(0, 200)}`;
      this.tracker.record(this.sourceId(), 'github', { provider: 'github', endpoint, method: 'GET', at, status: response.status, ok: false, failure, apiRevision });
      throw new Error(`GITHUB_CI_POLL_FAILED: ${this.sourceId()} answered HTTP ${String(response.status)} — ${response.status === 429 ? 'rate-limited' : response.status === 401 || response.status === 403 ? 'authentication failed' : response.status === 404 ? 'actions disabled or repository unknown' : 'provider error'}`);
    }
    let body: unknown;
    try {
      body = parseJsonBody(response);
    } catch (error) {
      this.tracker.record(this.sourceId(), 'github', { provider: 'github', endpoint, method: 'GET', at, status: response.status, ok: false, failure: `malformed JSON body: ${(error as Error).message}`, apiRevision });
      throw new Error(`GITHUB_CI_MALFORMED: ${this.sourceId()} returned a non-JSON body with HTTP ${String(response.status)}`);
    }
    const runs = typeof body === 'object' && body !== null ? (body as Record<string, unknown>)['workflow_runs'] : null;
    if (!Array.isArray(runs)) {
      this.tracker.record(this.sourceId(), 'github', { provider: 'github', endpoint, method: 'GET', at, status: response.status, ok: false, failure: 'expected workflow_runs array', apiRevision });
      throw new Error(`GITHUB_CI_SHAPE: ${this.sourceId()} returned no workflow_runs array`);
    }
    this.tracker.record(this.sourceId(), 'github', { provider: 'github', endpoint, method: 'GET', at, status: response.status, ok: true, failure: null, apiRevision });
    const envelopes: ExternalEventEnvelope[] = [];
    for (const run of runs) {
      const mapped = mapWorkflowRun(run);
      if (mapped === null) {
        continue;
      }
      envelopes.push({
        externalId: `run-${mapped.runId}-${mapped.status}`,
        kind: 'ci.run',
        occurredAt: mapped.occurredAt,
        payload: { pipeline: mapped.pipeline, ref: mapped.ref, status: mapped.status, runId: mapped.runId },
        provenance: [`github-rest:actions-runs:${this.config.owner}/${this.config.repo}`, 'api:github.v3'],
      });
    }
    return envelopes;
  }
}
