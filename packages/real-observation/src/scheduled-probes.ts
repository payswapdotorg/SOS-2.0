/**
 * Scheduled probes — the REAL fallback of the observation plane (P17-C).
 *
 * The merged P7 rule: "Use scheduled probes only where event/telemetry
 * coverage is insufficient." Each ProbePort below declares WHY it exists
 * (the coverage gap it fills) in its ProbeDefinition; the merged
 * ProbeScheduler runs it only while the CoverageLedger reports that gap
 * open (SKIPPED_COVERED the moment organic coverage returns — probes
 * stand down). Probe-produced events are always distinguishable from
 * organic coverage by their 'scheduled-probe:*' source id.
 *
 * Real probes (each performs ONE bounded real HTTP round-trip through
 * the injected FetchPort, recording the probe in the honest-state
 * tracker + transcript):
 *
 *   - RepoHeadProbe:    GET /repos/{owner}/{repo}/branches/{branch} — the
 *                       REAL branch head sha (kind 'scheduled-probe.result',
 *                       payload {branch, head, subject_ref} — fills branch
 *                       heads where no organic push has arrived).
 *   - CiLatestProbe:   GET /repos/{owner}/{repo}/actions/runs?per_page=1 —
 *                       the REAL latest CI run (kind 'ci.run').
 *   - DeploymentProbe: GET /v6/deployments?limit=1 — the REAL latest
 *                       deployment (kind 'deployment.change').
 *
 * A probe that fails THROWS with the real reason — the merged scheduler
 * records a typed FAILED outcome (never fabricated).
 */

import type { Clock } from '@sos-2/live-store';
import type { ExternalEventEnvelope, ProbeDefinition, ProbePort } from '@sos-2/event-ingestion';
import type { ConnectivityTracker } from './honest-state.js';
import type { TranscriptRecorder } from './transcript.js';
import type { FetchPort, HttpRequest, HttpResponse } from './http.js';
import { parseJsonBody } from './http.js';
import { mapWorkflowRun } from './github-ci.js';
import { mapVercelDeployment } from './vercel-deployments.js';

export interface RealProbeDeps {
  readonly fetch: FetchPort;
  readonly clock: Clock;
  readonly tracker: ConnectivityTracker;
  readonly transcript: TranscriptRecorder;
}

/** The probe's own source id under the merged scheduler (probe events land there). */
export function probeSourceIdOf(probeId: string): string {
  return `scheduled-probe:${probeId}`;
}

abstract class RealProbe implements ProbePort {
  readonly definition: ProbeDefinition;
  protected readonly deps: RealProbeDeps;

  constructor(definition: ProbeDefinition, deps: RealProbeDeps) {
    this.definition = definition;
    this.deps = deps;
  }

  protected now(): string {
    return new Date(this.deps.clock.nowEpochMs()).toISOString();
  }

  protected async roundTrip(request: HttpRequest, provider: string, apiRevision: string): Promise<HttpResponse> {
    const at = this.now();
    try {
      const response = await this.deps.fetch(request);
      this.deps.transcript.record({ at, source: probeSourceIdOf(this.definition.probeId), request, response, transportError: null });
      if (response.status === 200) {
        this.deps.tracker.record(probeSourceIdOf(this.definition.probeId), provider, { provider, endpoint: new URL(request.url).pathname, method: 'GET', at, status: response.status, ok: true, failure: null, apiRevision });
      } else {
        const failure = `HTTP ${String(response.status)}: ${response.body.slice(0, 200)}`;
        this.deps.tracker.record(probeSourceIdOf(this.definition.probeId), provider, { provider, endpoint: new URL(request.url).pathname, method: 'GET', at, status: response.status, ok: false, failure, apiRevision });
        throw new Error(`PROBE_FAILED: ${this.definition.probeId} answered HTTP ${String(response.status)} — the real reason is recorded`);
      }
      return response;
    } catch (error) {
      if ((error as Error).message.startsWith('PROBE_FAILED:')) {
        throw error;
      }
      const reason = (error as Error).message;
      this.deps.transcript.record({ at, source: probeSourceIdOf(this.definition.probeId), request, response: null, transportError: reason });
      this.deps.tracker.record(probeSourceIdOf(this.definition.probeId), provider, { provider, endpoint: new URL(request.url).pathname, method: 'GET', at, status: null, ok: false, failure: reason, apiRevision: null });
      throw error;
    }
  }

  abstract run(): Promise<ExternalEventEnvelope | null>;
}

/** Probe the REAL branch head of the observed repository. */
export class RepoHeadProbe extends RealProbe {
  private readonly owner: string;
  private readonly repo: string;
  private readonly branch: string;
  private readonly subject: string;
  private readonly token: string;
  private readonly apiBase: string;

  constructor(deps: RealProbeDeps & { owner: string; repo: string; branch: string; subject: string; token: string; apiBase?: string; minIntervalSec?: number }) {
    const { owner, repo, branch, subject, token, apiBase, minIntervalSec, ...probeDeps } = deps;
    super(
      {
        probeId: `probe-repo-head:${owner}/${repo}@${branch}`,
        subject,
        fillsFamily: 'github',
        minIntervalSec: minIntervalSec ?? 120,
        purpose: `fills the github repository-head coverage gap for ${subject} while no organic push/webhook delivery has arrived (the REST polling fallback also feeds this, but the probe is the independent verification path)`,
      },
      probeDeps,
    );
    this.owner = owner;
    this.repo = repo;
    this.branch = branch;
    this.subject = subject;
    this.token = token;
    this.apiBase = apiBase ?? 'https://api.github.com';
  }

  async run(): Promise<ExternalEventEnvelope | null> {
    const endpoint = `/repos/${this.owner}/${this.repo}/branches/${this.branch}`;
    const response = await this.roundTrip(
      { method: 'GET', url: `${this.apiBase}${endpoint}`, headers: { authorization: `Bearer ${this.token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' }, body: null },
      'github',
      'github.v3',
    );
    const body = parseJsonBody(response) as Record<string, unknown>;
    const commit = typeof body['commit'] === 'object' && body['commit'] !== null ? (body['commit'] as Record<string, unknown>) : null;
    const sha = commit !== null && typeof commit['sha'] === 'string' ? commit['sha'] : null;
    if (sha === null) {
      throw new Error(`PROBE_SHAPE: no commit sha on ${endpoint}`);
    }
    return {
      externalId: `branch-head-${this.branch}-${sha}`,
      kind: 'scheduled-probe.result',
      occurredAt: this.now(),
      payload: { branch: this.branch, head: sha, subject_ref: this.subject },
      provenance: [`github-rest:branches:${this.owner}/${this.repo}`, 'probe:repo-head', 'api:github.v3'],
    };
  }
}

/** Probe the REAL latest CI run for the observed repository. */
export class CiLatestProbe extends RealProbe {
  private readonly owner: string;
  private readonly repo: string;
  private readonly subject: string;
  private readonly token: string;
  private readonly apiBase: string;

  constructor(deps: RealProbeDeps & { owner: string; repo: string; subject: string; token: string; apiBase?: string; minIntervalSec?: number }) {
    const { owner, repo, subject, token, apiBase, minIntervalSec, ...probeDeps } = deps;
    super(
      {
        probeId: `probe-ci-latest:${owner}/${repo}`,
        subject,
        fillsFamily: 'ci',
        minIntervalSec: minIntervalSec ?? 180,
        purpose: `fills the CI coverage gap for ${subject} while no organic CI event bus is wired (GitHub Actions is poll-only for outside webhooks)`,
      },
      probeDeps,
    );
    this.owner = owner;
    this.repo = repo;
    this.subject = subject;
    this.token = token;
    this.apiBase = apiBase ?? 'https://api.github.com';
  }

  async run(): Promise<ExternalEventEnvelope | null> {
    const endpoint = `/repos/${this.owner}/${this.repo}/actions/runs`;
    const response = await this.roundTrip(
      { method: 'GET', url: `${this.apiBase}${endpoint}?per_page=1`, headers: { authorization: `Bearer ${this.token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' }, body: null },
      'github',
      'github.v3',
    );
    const body = parseJsonBody(response) as Record<string, unknown>;
    const runs = body['workflow_runs'];
    if (!Array.isArray(runs) || runs.length === 0) {
      return null;
    }
    const mapped = mapWorkflowRun(runs[0]);
    if (mapped === null) {
      return null;
    }
    return {
      externalId: `probe-ci-latest-${mapped.runId}-${mapped.status}`,
      kind: 'ci.run',
      occurredAt: this.now(),
      payload: { pipeline: mapped.pipeline, ref: mapped.ref, status: mapped.status, runId: mapped.runId },
      provenance: [`github-rest:actions-runs:${this.owner}/${this.repo}`, 'probe:ci-latest', 'api:github.v3'],
    };
  }
}

/** Probe the REAL latest Vercel deployment (only THIS repository's deployments — honest subject binding). */
export class DeploymentLatestProbe extends RealProbe {
  private readonly subject: string;
  private readonly token: string;
  private readonly apiBase: string;
  private readonly projectId: string | null;
  private readonly githubRepoFilter: string | null;

  constructor(deps: RealProbeDeps & { subject: string; token: string; apiBase?: string; projectId?: string | null; githubRepoFilter?: string | null; minIntervalSec?: number }) {
    const { subject, token, apiBase, projectId, githubRepoFilter, minIntervalSec, ...probeDeps } = deps;
    super(
      {
        probeId: `probe-deployment-latest`,
        subject,
        fillsFamily: 'deployment',
        minIntervalSec: minIntervalSec ?? 300,
        purpose: `fills the deployment coverage gap for ${subject} while the Vercel deployment webhook is not wired (the deployments API is pull-only for this account)`,
      },
      probeDeps,
    );
    this.subject = subject;
    this.token = token;
    this.apiBase = apiBase ?? 'https://api.vercel.com';
    this.projectId = projectId ?? null;
    this.githubRepoFilter = githubRepoFilter ?? null;
  }

  async run(): Promise<ExternalEventEnvelope | null> {
    const query = new URLSearchParams({ limit: '1' });
    if (this.projectId !== null && this.projectId !== '') {
      query.set('projectId', this.projectId);
    }
    const response = await this.roundTrip(
      { method: 'GET', url: `${this.apiBase}/v6/deployments?${query.toString()}`, headers: { authorization: `Bearer ${this.token}` }, body: null },
      'vercel',
      'vercel.v6',
    );
    const body = parseJsonBody(response) as Record<string, unknown>;
    const deployments = body['deployments'];
    if (!Array.isArray(deployments) || deployments.length === 0) {
      return null;
    }
    const mapped = mapVercelDeployment(deployments[0], { githubRepoFilter: this.githubRepoFilter });
    if (mapped === null) {
      return null;
    }
    return {
      externalId: `probe-deployment-latest-${mapped.externalId}`,
      kind: 'deployment.change',
      occurredAt: this.now(),
      payload: { environment: mapped.environment, revision: mapped.revision, action: mapped.action },
      provenance: ['vercel-api:deployments', 'probe:deployment-latest', 'api:vercel.v6'],
    };
  }
}
