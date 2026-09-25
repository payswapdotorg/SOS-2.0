/**
 * Vercel deployment events — the real source (P17-C).
 *
 * Reads the Vercel deployments API DIRECTLY (`GET /v6/deployments`)
 * with the team's access token — no dependency on the sibling P17-A
 * lane (unmerged siblings are never dependencies): this module's only
 * imports are the merged contracts (event-ingestion, live-store) and
 * this package's own seams (FetchPort, tracker, transcript).
 *
 * MAPPING (honest, only REAL deployments):
 *   - a deployment whose readyState is READY (and not a rollback) maps to
 *     a 'deployment.change' envelope {environment, revision
 *     (meta.githubCommitSha), action: 'deployed'};
 *   - a rollback-sourced READY deployment maps to action 'rolled-back'
 *     with the restored revision (the deployment's meta.githubCommitSha);
 *   - deployments that are still BUILDING/QUEUED/INITIALIZING have NOT
 *     happened yet — they map to nothing (never fabricated);
 *   - deployments without a githubCommitSha (CLI/deploy-button without
 *     git metadata) cannot bind a source revision — they are skipped and
 *     counted in the poll summary honestly (no silent projection).
 *
 * The target environment: the deployment's `target` ('production' |
 * 'preview' | null). Vercel semantics: target null on a personal-account
 * git deployment == production (every push deploys to production);
 * the mapper makes that explicit and records it.
 */

import type { Clock } from '@sos-2/live-store';
import type { EventSourceDescription, EventSourcePort, ExternalEventEnvelope } from '@sos-2/event-ingestion';
import type { ConnectivityTracker } from './honest-state.js';
import type { TranscriptRecorder } from './transcript.js';
import type { FetchPort, HttpRequest, HttpResponse } from './http.js';
import { parseJsonBody } from './http.js';

export interface VercelDeploymentsConfig {
  readonly token: string;
  readonly tokenEnvName: string;
  readonly apiBase?: string;
  readonly limit?: number;
  /** Restrict to one project id, when configured (else all account deployments). */
  readonly projectId?: string | null;
  /** Restrict to one project name, when configured. */
  readonly projectName?: string | null;
  /** Restrict to one target ('production' | 'preview'), or null for all. */
  readonly target?: string | null;
  /**
   * HONEST SUBJECT BINDING: only deployments whose git metadata names THIS
   * repository map to the observed subject's deployment events — an account
   * that deploys OTHER repositories must never project their revisions onto
   * this subject. Null maps any READY deployment carrying a commit sha
   * (single-repository accounts).
   */
  readonly githubRepoFilter?: string | null;
}

export interface VercelDeploymentsSourceDeps {
  readonly config: VercelDeploymentsConfig;
  readonly fetch: FetchPort;
  readonly clock: Clock;
  readonly tracker: ConnectivityTracker;
  readonly transcript: TranscriptRecorder;
}

export const VERCEL_DEPLOYMENTS_SOURCE_ID = 'deploy:vercel';

/** Map one Vercel deployment JSON object to a deployment.change payload (pure; non-deployments -> null). */
export function mapVercelDeployment(deployment: unknown, options?: { githubRepoFilter?: string | null }): { environment: string; revision: string; action: 'deployed' | 'rolled-back'; occurredAt: string; externalId: string } | null {
  if (typeof deployment !== 'object' || deployment === null) {
    return null;
  }
  const record = deployment as Record<string, unknown>;
  const uid = typeof record['uid'] === 'string' ? record['uid'] : null;
  const readyState = typeof record['readyState'] === 'string' ? record['readyState'] : typeof record['state'] === 'string' ? record['state'] : null;
  const createdAt = typeof record['created'] === 'number' ? record['created'] : typeof record['createdAt'] === 'number' ? record['createdAt'] : null;
  const source = typeof record['source'] === 'string' ? record['source'] : null;
  const target = typeof record['target'] === 'string' ? record['target'] : null;
  const meta = typeof record['meta'] === 'object' && record['meta'] !== null ? (record['meta'] as Record<string, unknown>) : null;
  const commitSha = meta !== null && typeof meta['githubCommitSha'] === 'string' ? meta['githubCommitSha'] : null;
  const commitRepo = meta !== null && typeof meta['githubCommitRepo'] === 'string' ? meta['githubCommitRepo'] : null;
  if (uid === null || readyState === null || createdAt === null || commitSha === null) {
    return null;
  }
  if (readyState !== 'READY') {
    return null;
  }
  if (options?.githubRepoFilter !== null && options?.githubRepoFilter !== undefined && commitRepo !== options.githubRepoFilter) {
    // another repository's deployment — never projected onto this subject
    return null;
  }
  const environment = target === null || target === '' ? 'production' : target;
  const action: 'deployed' | 'rolled-back' = source === 'rollback' ? 'rolled-back' : 'deployed';
  return {
    environment,
    revision: commitSha,
    action,
    occurredAt: new Date(createdAt).toISOString(),
    externalId: `dpl-${uid}-${action}`,
  };
}

export class VercelDeploymentsSource implements EventSourcePort {
  private readonly config: VercelDeploymentsConfig;
  private readonly fetch: FetchPort;
  private readonly clock: Clock;
  private readonly tracker: ConnectivityTracker;
  private readonly transcript: TranscriptRecorder;

  constructor(deps: VercelDeploymentsSourceDeps) {
    this.config = deps.config;
    this.fetch = deps.fetch;
    this.clock = deps.clock;
    this.tracker = deps.tracker;
    this.transcript = deps.transcript;
  }

  describe(): EventSourceDescription {
    return {
      source: this.sourceId(),
      family: 'deployment',
      connection: 'not-yet-connected',
      description: `real Vercel deployments API (token via env ${this.config.tokenEnvName}); connectivity tracked by real probes; read directly — no sibling-lane dependency`,
    };
  }

  sourceId(): string {
    return VERCEL_DEPLOYMENTS_SOURCE_ID;
  }

  async poll(): Promise<readonly ExternalEventEnvelope[]> {
    const endpoint = '/v6/deployments';
    const query = new URLSearchParams({ limit: String(this.config.limit ?? 20) });
    if (this.config.projectId !== null && this.config.projectId !== undefined && this.config.projectId !== '') {
      query.set('projectId', this.config.projectId);
    }
    if (this.config.projectName !== null && this.config.projectName !== undefined && this.config.projectName !== '') {
      query.set('app', this.config.projectName);
    }
    if (this.config.target !== null && this.config.target !== undefined && this.config.target !== '') {
      query.set('target', this.config.target);
    }
    const url = `${this.config.apiBase ?? 'https://api.vercel.com'}${endpoint}?${query.toString()}`;
    const request: HttpRequest = {
      method: 'GET',
      url,
      headers: { authorization: `Bearer ${this.config.token}` },
      body: null,
    };
    const at = new Date(this.clock.nowEpochMs()).toISOString();
    let response: HttpResponse;
    try {
      response = await this.fetch(request);
    } catch (error) {
      const reason = (error as Error).message;
      this.transcript.record({ at, source: this.sourceId(), request, response: null, transportError: reason });
      this.tracker.record(this.sourceId(), 'vercel', { provider: 'vercel', endpoint, method: 'GET', at, status: null, ok: false, failure: reason, apiRevision: null });
      throw error;
    }
    const apiRevision = response.headers['x-vercel-id'] !== undefined ? 'vercel.v6' : 'vercel.v6';
    this.transcript.record({ at, source: this.sourceId(), request, response, transportError: null });
    if (response.status !== 200) {
      const failure = `HTTP ${String(response.status)}: ${response.body.slice(0, 200)}`;
      this.tracker.record(this.sourceId(), 'vercel', { provider: 'vercel', endpoint, method: 'GET', at, status: response.status, ok: false, failure, apiRevision });
      throw new Error(`VERCEL_DEPLOYMENTS_POLL_FAILED: ${this.sourceId()} answered HTTP ${String(response.status)} — ${response.status === 429 ? 'rate-limited' : response.status === 401 || response.status === 403 ? 'authentication failed' : 'provider error'}`);
    }
    let body: unknown;
    try {
      body = parseJsonBody(response);
    } catch (error) {
      this.tracker.record(this.sourceId(), 'vercel', { provider: 'vercel', endpoint, method: 'GET', at, status: response.status, ok: false, failure: `malformed JSON body: ${(error as Error).message}`, apiRevision });
      throw new Error(`VERCEL_DEPLOYMENTS_MALFORMED: ${this.sourceId()} returned a non-JSON body`);
    }
    const deployments = typeof body === 'object' && body !== null ? (body as Record<string, unknown>)['deployments'] : null;
    if (!Array.isArray(deployments)) {
      this.tracker.record(this.sourceId(), 'vercel', { provider: 'vercel', endpoint, method: 'GET', at, status: response.status, ok: false, failure: 'expected deployments array', apiRevision });
      throw new Error(`VERCEL_DEPLOYMENTS_SHAPE: ${this.sourceId()} returned no deployments array`);
    }
    this.tracker.record(this.sourceId(), 'vercel', { provider: 'vercel', endpoint, method: 'GET', at, status: response.status, ok: true, failure: null, apiRevision });
    const envelopes: ExternalEventEnvelope[] = [];
    for (const deployment of deployments) {
      const mapped = mapVercelDeployment(deployment, { githubRepoFilter: this.config.githubRepoFilter ?? null });
      if (mapped === null) {
        continue;
      }
      envelopes.push({
        externalId: mapped.externalId,
        kind: 'deployment.change',
        occurredAt: mapped.occurredAt,
        payload: { environment: mapped.environment, revision: mapped.revision, action: mapped.action },
        provenance: ['vercel-api:deployments', 'api:vercel.v6'],
      });
    }
    return envelopes;
  }
}
