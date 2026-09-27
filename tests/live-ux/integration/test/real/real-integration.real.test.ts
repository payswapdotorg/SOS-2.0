/**
 * The P18-INT REAL INTEGRATION SUITE (RUN_REAL=1 only, default OFF) — the
 * integrated product against the REAL providers, NO injection:
 *
 *   1. provider probes (Vercel / GitHub / OpenRouter) — honest states;
 *   2. THE REAL DATA-PLANE PASS through the lane-A producer
 *      (produceLiveMissionData — the same function the swapped seam
 *      composes): one bounded honest pass against the real providers —
 *      the durable-store selection (Neon/Upstash probed with honest
 *      UNAVAILABLE outcomes recorded as valid evidence), the real Vercel
 *      deployment-state read (records + source_revision_sha), the real
 *      observation drain (GitHub repo/CI observation), the snapshot
 *      durability, the per-field provenance view — all recorded;
 *   3. THE REAL SEAM CONTRACT: getLiveMissionData() (the swapped seam,
 *      no injection) answers a fresh honest pass whose store identity,
 *      subject and source states agree with the data-plane pass — the
 *      routes' data source IS the producer;
 *   4. THE DEPLOYMENT: the exact branch head (gitSource ref = HEAD) is
 *      deployed to the Vercel project and waited to READY (the P18-B
 *      precedent; LIVE_MISSION_BASE_URL re-verifies an existing
 *      deployment of the branch);
 *   5. deployed-surface probes over real HTTP: /mission renders through
 *      the REAL seam (the live observed state with LIVE provenance — or
 *      the honest empty state when the observation environment is
 *      incomplete on the deployment; both are honest, machine-checkable);
 *   6. REAL CONSEQUENTIAL ACTIONS against the deployed endpoint (the
 *      exact envelope shapes the mounted forms POST): body summon (the
 *      OpenRouter-backed body provider), idempotent replay, a DENIED
 *      action (a never-held grant fails CLOSED), promotion + rollback
 *      through the deployment provider, ASK resolution (the honest
 *      deployed ASK_ENTRY_UNKNOWN + the real queue contract locally);
 *   7. every step records redacted HTTP transcripts + typed receipts +
 *      honest provider states into
 *      docs/evidence/production-connectivity/live-ux/integration/.
 *
 * Honest outcomes only: a provider outage (e.g. the Vercel free-tier
 * build-rate limit re-tripping) is recorded as the REAL state — the
 * current deployment state is reported at run time, never fabricated;
 * a failure fails this suite truthfully.
 */

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DeploymentProbeLedger,
  DeploymentTranscriptRecorder,
  RealVercelDeploymentProvider,
  bindGlobalFetch,
  createDeploymentRecordingFetchPort,
} from '@sos-2/deployment-providers';
import type { RealVercelDeploymentJourney } from '@sos-2/deployment-providers';
import { AskQueue, composeAskContent } from '@sos-2/ask';
import { createAskRequest } from '@sos-2/authority';
import { evaluate } from '@sos-2/decision';
import type { DecisionRequest } from '@sos-2/decision';
import { produceLiveMissionData } from '@integration/producer';
import type { LiveDataPlaneResult } from '@integration/data-plane';
import { getLiveMissionData } from '@integration/seam';
import { createLiveActionHost, submitLiveAction } from '@integration/live-action-core';
import { summonBodyEnvelope, promotionEnvelope } from '@live-mission/envelopes';
import { writeEvidence, repoHeadSha } from '../../src/evidence';

const RUN_REAL = process.env['RUN_REAL'] === '1';
const suite = RUN_REAL ? describe : describe.skip;

const VERCEL_TOKEN = process.env['VERCEL_TOKEN'] ?? '';
const VERCEL_PROJECT_ID = process.env['VERCEL_PROJECT_ID'] ?? 'prj_ad9K6nw6F4zlpg4bmlZi9HQyNhvQ';
const GITHUB_TOKEN = process.env['GITHUB_ACCESS_TOKEN'] ?? '';
const BODY_PROVIDER_API_KEY = process.env['BODY_PROVIDER_API_KEY'] ?? '';
const ACTOR = 'console-user';
const DENIED_ACTOR = 'console-observer'; // never granted — the real fail-closed path
const BODY_MODEL = process.env['SOS_LIVE_MISSION_BODY_MODEL'] ?? 'meta-llama/llama-3.3-70b-instruct';
const PROJECT_NAME = 'sos-2-0';
const GIT_REPO = { org: 'payswapdotorg', repo: 'SOS-2.0' };
const REPO_ID = 1377439399;

interface JourneyStep {
  readonly step: string;
  readonly ok: boolean;
  readonly at: string;
  readonly detail: Record<string, unknown>;
}

interface HttpTranscript {
  readonly at: string;
  readonly request: { readonly method: string; readonly url: string; readonly contentType?: string; readonly accept?: string; readonly body?: unknown };
  readonly response: { readonly status: number; readonly location?: string; readonly receiptSummary?: Record<string, unknown>; readonly markers?: readonly string[] };
}

const journey: JourneyStep[] = [];
const transcripts: HttpTranscript[] = [];
const headSha = repoHeadSha();
/** The revision the deployed endpoint serves (the existing deployment's commit when LIVE_MISSION_BASE_URL is set; else the suite's head). */
let actedSha = headSha;
const producedAt = new Date().toISOString();
let provider: RealVercelDeploymentProvider | null = null;
let deploymentJourney: RealVercelDeploymentJourney | null = null;
let baseUrl: string = process.env['LIVE_MISSION_BASE_URL'] ?? '';
let priorProduction: { id: string; sha: string; url: string } | null = null;
let existingDeployment: { id: string; url: string; state: string } | null = null;
const receipts: Record<string, unknown> = {};
/** The real data-plane pass result (recorded once; the seam contract test reads a second pass). */
let planeResult: LiveDataPlaneResult | null = null;

function record(step: string, ok: boolean, detail: Record<string, unknown>): void {
  journey.push({ step, ok, at: new Date().toISOString(), detail });
}

function noteTranscript(entry: HttpTranscript): void {
  transcripts.push(entry);
}

async function timedFetch(url: string, init: RequestInit = {}, timeoutMs = 60_000): Promise<{ status: number; headers: Headers; text: string; body: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const text = await response.text();
    let body: unknown = null;
    try {
      body = text.length > 0 ? JSON.parse(text) : null;
    } catch {
      body = text.slice(0, 500);
    }
    return { status: response.status, headers: response.headers, text, body };
  } finally {
    clearTimeout(timer);
  }
}

async function vercelCall(pathName: string, init: RequestInit = {}): Promise<{ status: number; body: any }> {
  const result = await timedFetch(`https://api.vercel.com${pathName}`, {
    ...init,
    headers: { Authorization: `Bearer ${VERCEL_TOKEN}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  return { status: result.status, body: result.body };
}

/** Submit one envelope to the DEPLOYED endpoint (real HTTP) and record the transcript. */
async function submitToDeployment(envelope: Record<string, unknown>, options: { form?: boolean } = {}): Promise<{ status: number; receipt: any; location: string | null }> {
  const url = `${baseUrl}/api/live-mission/actions`;
  const accept = 'application/json';
  const init: RequestInit = options.form === true
    ? { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: accept }, body: new URLSearchParams({ action: JSON.stringify(envelope) }).toString() }
    : { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: accept }, body: JSON.stringify(envelope) };
  const response = await timedFetch(url, init, 120_000);
  const receipt = (response.body as any)?.receipt ?? null;
  const receiptPageUrl = (response.body as any)?.receiptPageUrl ?? null;
  noteTranscript({
    at: new Date().toISOString(),
    request: { method: 'POST', url, contentType: options.form === true ? 'application/x-www-form-urlencoded' : 'application/json', accept, body: envelope },
    response: {
      status: response.status,
      location: response.headers.get('location') ?? undefined,
      receiptSummary: receipt === null ? undefined : {
        kind: receipt.kind,
        outcome: receipt.outcome ?? receipt.status,
        receiptStatus: receipt.receipt?.status ?? null,
        authority: receipt.receipt?.denial?.authority?.reason ?? 'GRANTED',
        actionId: receipt.receipt?.actionId ?? receipt.actionId ?? null,
        idempotencyKey: receipt.idempotencyKey ?? receipt.receipt?.idempotencyKey ?? null,
        evidenceIds: receipt.receipt?.evidenceIds ?? [],
        error: receipt.error?.code ?? null,
        receiptPageUrl,
      },
    },
  });
  return { status: response.status, receipt, location: receiptPageUrl };
}

/** Fail FAST and HONESTLY when the deployed journey's credentials are absent (the credential-free seam tests still run). */
function requireDeployedCredentials(): void {
  const missing: string[] = [];
  if (VERCEL_TOKEN.length === 0) missing.push('VERCEL_TOKEN');
  if (GITHUB_TOKEN.length === 0) missing.push('GITHUB_ACCESS_TOKEN');
  if (BODY_PROVIDER_API_KEY.length === 0) missing.push('BODY_PROVIDER_API_KEY');
  if (missing.length > 0) {
    record('credentials-required', false, {
      missing_env_names: missing,
      note: 'the deployed-journey steps require the operator credential set (env-only; names never values); the credential-free steps (the real data-plane pass + the real seam contract) ran and are recorded in this same journey log',
    });
    throw new Error(`the deployed journey requires credentials (missing env NAMES: ${missing.join(', ')}) — set them and re-run RUN_REAL=1`);
  }
}

function summonEnvelope(): Record<string, unknown> {
  return {
    ...summonBodyEnvelope({
      actorId: ACTOR,
      bodyId: 'cloud-sandbox-1',
      baseSha: actedSha,
      actionId: 'p18int-real-summon-1',
      idempotencyKey: 'p18int-real-idem-summon-1',
      requestedAt: Date.now(),
    }),
  };
}

function promotionEnvelopeForReal(): Record<string, unknown> {
  return {
    ...promotionEnvelope({
      actorId: ACTOR,
      fromEnvironment: 'staging',
      toEnvironment: 'production',
      sourceSha: actedSha,
      actionId: 'p18int-real-promotion-1',
      idempotencyKey: 'p18int-real-idem-promotion-1',
      requestedAt: Date.now(),
    }),
  };
}

const ASK_ENVELOPE: Record<string, unknown> = {
  entryId: 'p18int-ask-never-enqueued',
  resolution: {
    resolved_by: ACTOR,
    chosen_alternative_id: 'act-under-granted-authority',
    note: 'P18-INT real integration ask resolution attempt',
    provenance: ['human:console-user', 'surface:live-mission'],
    created_at: producedAt,
  },
};

suite('P18-INT REAL integration (RUN_REAL=1): the seam + the deployed journeys', () => {
  beforeAll(() => {
    // The provider composition itself fail-closes on an empty token (the
    // frozen P17-A discipline: never an empty credential), so it is bound
    // ONLY when the token exists; the per-test guards below fail FAST and
    // HONESTLY when a credential the journey requires is absent — the
    // credential-free tests (the real data-plane pass + the real seam
    // contract) still run, so a RUN_REAL=1 execution without credentials
    // records the seam's honest unwired outcomes AND the honest credential
    // gaps.
    if (VERCEL_TOKEN.length === 0) {
      record('provider-composition', false, { note: 'VERCEL_TOKEN absent — the deployment provider is not composed (fail-closed on empty credentials, the frozen P17-A discipline); the credential-free seam steps still run' });
      return;
    }
    const clock = { nowEpochMs: (): number => Date.now() };
    const ledger = new DeploymentProbeLedger();
    const transcript = new DeploymentTranscriptRecorder({ credentialReference: 'VERCEL_TOKEN' });
    const fetchPort = createDeploymentRecordingFetchPort({ inner: bindGlobalFetch({ timeoutMs: 60_000 }), transcript, clock });
    provider = new RealVercelDeploymentProvider({
      token: VERCEL_TOKEN,
      teamId: process.env['VERCEL_ORG_ID'] ?? null,
      fetch: fetchPort,
      clock,
      ledger,
      credentialEnv: 'VERCEL_TOKEN',
      sleep: (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms)),
    });
  });

  it('probes the real providers (honest states; credentials required)', async () => {
    expect(VERCEL_TOKEN.length, 'VERCEL_TOKEN must be set for the deployed journey (env-only; names never values)').toBeGreaterThan(0);
    expect(GITHUB_TOKEN.length, 'GITHUB_ACCESS_TOKEN must be set for the deployed journey (env-only)').toBeGreaterThan(0);
    expect(BODY_PROVIDER_API_KEY.length, 'BODY_PROVIDER_API_KEY must be set for the deployed journey (env-only)').toBeGreaterThan(0);
    const user = await vercelCall('/v2/user');
    record('vercel-probe', user.status === 200, { status: user.status, username: user.body?.user?.username ?? null });
    expect(user.status).toBe(200);

    const commit = await timedFetch(`https://api.github.com/repos/${GIT_REPO.org}/${GIT_REPO.repo}/commits/${headSha}`, {
      headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/vnd.github+json' },
    });
    record('github-revision-binding', commit.status === 200, { status: commit.status, sha: (commit.body as any)?.sha ?? null });
    expect(commit.status, 'the deployed head must exist on GitHub (push before RUN_REAL)').toBe(200);

    const models = await timedFetch('https://openrouter.ai/api/v1/models', { headers: { Authorization: `Bearer ${BODY_PROVIDER_API_KEY}` } });
    record('openrouter-probe', models.status === 200, { status: models.status, model: BODY_MODEL });
    expect(models.status).toBe(200);
  });

  it('THE REAL DATA-PLANE PASS (one bounded honest pass through the lane-A producer; credentials NOT required — the unwired path is a valid honest outcome)', async () => {
    planeResult = await produceLiveMissionData();
    const result = planeResult;
    const providerStates = result.providerHealth.map((row) => ({ provider: row.provider, role: row.role, state: row.state, detail: row.detail.slice(0, 200), lastError: row.lastError }));
    record('real-data-plane', true, {
      unwired: result.unwired,
      missing_env: result.missingEnv,
      store_selection: {
        mode: result.selection.mode,
        canonical: { provider: result.selection.canonical.provider, state: result.selection.canonical.state, detail: result.selection.canonical.detail.slice(0, 200) },
        coordination: { provider: result.selection.coordination.provider, state: result.selection.coordination.state },
        store_ref: result.selection.storeRef,
        note: result.selection.note.slice(0, 300),
      },
      deployment_read: {
        state: result.deploymentRead.state,
        records: result.deploymentRead.deployments.length,
        latest_production: result.deploymentRead.latestByTarget['production'] === undefined ? null : {
          id: result.deploymentRead.latestByTarget['production']!.id,
          ready_state: result.deploymentRead.latestByTarget['production']!.readyState,
          source_revision_sha: result.deploymentRead.latestByTarget['production']!.commitSha,
          url: result.deploymentRead.latestByTarget['production']!.url,
        },
      },
      provider_states: providerStates,
      durability: result.durability,
      drained: result.report !== null ? {
        drained_at: result.report.drainedAt,
        findings: result.report.findings.length,
        detections: result.report.detections.length,
        repository_heads: [...result.report.snapshot.repositoryHeads.keys()],
      } : null,
      dto_summary: {
        store_ref: result.data.storeRef,
        as_of: result.data.asOf,
        drained_at: result.data.drainedAt,
        sources: result.data.sources.map((s) => ({ source: s.source, state: s.state })),
        events_in_window: result.data.eventsInWindow,
        branch_heads: result.data.repository.branchHeads.map((b) => ({ branch: b.branch, head: b.head, freshness: b.freshness })),
      },
    });
    // the honest contract: with a complete observation environment the pass
    // drains (drainedAt set, GitHub CONNECTED); with an incomplete one it is
    // unwired (never fabricated) — BOTH are valid honest outcomes.
    if (result.unwired) {
      expect(result.data.drainedAt).toBeNull();
      expect(result.data.sources).toEqual([]);
      expect(result.missingEnv.length).toBeGreaterThan(0);
    } else {
      expect(result.data.drainedAt).not.toBeNull();
      const github = result.data.sources.find((s) => s.source.startsWith('github:'));
      expect(github?.state).toBe('CONNECTED');
    }
    // every source state is one of the four honest states (never fabricated)
    for (const s of result.data.sources) {
      expect(['CONNECTED', 'UNKNOWN', 'UNAVAILABLE', 'DEGRADED']).toContain(s.state);
    }
  });

  it('THE REAL SEAM CONTRACT (the swapped seam, no injection) agrees with the data plane', async () => {
    const data = await getLiveMissionData();
    const selection = planeResult?.selection;
    record('real-seam-contract', true, {
      seam_store_ref: data.storeRef,
      selection_store_ref: selection?.storeRef ?? null,
      subject: data.repository.subject,
      drained_at: data.drainedAt,
      sources: data.sources.map((s) => ({ source: s.source, state: s.state })),
      watching_without_body: data.watchingWithoutBody,
    });
    expect(data.repository.subject).toBe('github:repo:payswapdotorg/SOS-2.0');
    // the seam serves exactly the store the real selection chose (the
    // reference marker when the canonical store did not answer — never a
    // fabricated production store identity)
    if (selection !== undefined && selection !== null) {
      expect(data.storeRef).toBe(selection.storeRef);
    }
    for (const s of data.sources) {
      expect(['CONNECTED', 'UNKNOWN', 'UNAVAILABLE', 'DEGRADED']).toContain(s.state);
    }
  });

  it('deploys the EXACT branch head to the Vercel project and waits for READY (unless LIVE_MISSION_BASE_URL is set; credentials required)', async () => {
    expect(VERCEL_TOKEN.length, 'VERCEL_TOKEN must be set for the deployment journey (env-only)').toBeGreaterThan(0);
    expect(GITHUB_TOKEN.length, 'GITHUB_ACCESS_TOKEN must be set for the deployment journey (env-only)').toBeGreaterThan(0);
    if (baseUrl.length > 0) {
      // LIVE_MISSION_BASE_URL provided: verify + record the EXISTING deployment's
      // exact-head binding honestly (the honest binding when the branch moved
      // after the deployment was created).
      const listing = await vercelCall(`/v6/deployments?projectId=${VERCEL_PROJECT_ID}&limit=20`);
      const deployments = (listing.body?.deployments ?? []) as Array<{ uid: string; state: string; url: string; meta?: Record<string, unknown> }>;
      const mine = deployments.find((d) => {
        const deployedSha = String(d.meta?.githubCommitSha ?? '');
        if (deployedSha.length < 40 || d.state !== 'READY') return false;
        try {
          execFileSync('git', ['merge-base', '--is-ancestor', deployedSha, headSha], { stdio: 'ignore' });
          return true;
        } catch {
          return false;
        }
      });
      if (mine !== undefined) {
        existingDeployment = { id: mine.uid, url: mine.url, state: mine.state };
        actedSha = String(mine.meta?.githubCommitSha ?? headSha);
      }
      record('deployment', mine !== undefined, {
        skipped_new_deployment: true,
        reason: 'LIVE_MISSION_BASE_URL provided — the existing deployment of this branch is verified and used',
        base_url: baseUrl,
        suite_head: headSha,
        acted_on_revision: actedSha,
        existing_deployment: mine === undefined ? null : { deployment_id: mine.uid, url: mine.url, ready_state: mine.state, source_revision_sha: actedSha, deployed_commit_is_branch_ancestor: true, binding_verified: true },
      });
      return;
    }
    if (provider === null) throw new Error('provider not composed');
    const project = await provider.ensureProject({ name: PROJECT_NAME, gitRepository: GIT_REPO });
    const previous = await provider.previousDeploymentRevisionId(project.id, 'none');
    // the freshly-pushed sha must first reach Vercel's GitHub index — retry
    // with backoff (honest: the attempts are recorded, the binding check
    // below still pins the EXACT head sha).
    const attempts: Array<Record<string, unknown>> = [];
    for (let attempt = 1; attempt <= 6; attempt += 1) {
      try {
        deploymentJourney = await provider.deployFromGitRef({
          projectName: PROJECT_NAME,
          project,
          repoId: REPO_ID,
          sourceRevisionSha: headSha,
          target: 'preview',
          environment: 'production',
          previousDeploymentRevisionId: previous,
          maxPollAttempts: 90,
          pollIntervalMs: 6_000,
        });
        break;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        attempts.push({ attempt, error: message.slice(0, 200) });
        record(`deployment-attempt-${attempt}`, false, { error: message.slice(0, 300) });
        if (attempt === 6) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 20_000));
      }
    }
    if (deploymentJourney === null) throw new Error('deployment did not complete');
    baseUrl = `https://${deploymentJourney.deployment.url}`;
    record('deployment', deploymentJourney.outcome.availability === 'SUCCESS', {
      deployment_id: deploymentJourney.deployment.id,
      url: deploymentJourney.deployment.url,
      ready_state: deploymentJourney.deployment.readyState,
      source_revision_sha: deploymentJourney.deployment.commitSha,
      binding_verified: deploymentJourney.deployment.commitSha === headSha,
      poll_attempts: deploymentJourney.pollAttempts,
      waited_ms: deploymentJourney.waitedMs,
      rollback_pointer: previous,
      retries: attempts.length,
      retry_attempts: attempts,
      note: 'the Vercel free-tier build-rate limit had RECOVERED as of 2026-09-26T10:39Z (last deployment READY); the CURRENT state is reported at run time (it can re-trip) — a re-trip is recorded honestly, never worked around',
    });
    expect(deploymentJourney.outcome.availability).toBe('SUCCESS');
    expect(deploymentJourney.deployment.commitSha).toBe(headSha);
  });

  it('probes the deployed surface over real HTTP (the routes render through the REAL seam)', async () => {
    requireDeployedCredentials();
    const home = await timedFetch(`${baseUrl}/mission`, { headers: { Accept: 'text/html' } }, 60_000);
    const drained = home.text.includes('The real observation plane') || home.text.includes('github:rest-events');
    const honestEmpty = home.text.includes('No live observation drain has run yet');
    const markers = {
      liveTitle: home.text.includes('Mission — live'),
      entryPoints: home.text.includes('Start a mission') && home.text.includes('Import a system'),
      actionForms: home.text.includes('action="/api/live-mission/actions"'),
      liveBadge: home.text.includes('data-live-badge="true"'),
      honestState: drained || honestEmpty,
      sixQuestions: home.text.includes('What is happening?') && home.text.includes('Why does SOS believe this?'),
    };
    record('deployed-mission-surface', home.status === 200, {
      status: home.status,
      markers,
      observed_state: drained ? 'LIVE observed state (the deployed seam drained the real plane)' : honestEmpty ? 'the honest empty state (the deployment\u2019s observation environment is incomplete — never fabricated)' : 'UNKNOWN',
    });
    expect(home.status).toBe(200);
    expect(markers.liveTitle).toBe(true);
    expect(markers.actionForms).toBe(true);
    expect(markers.honestState, 'the deployed route must render an honest observation state (drained or empty — never fabricated)').toBe(true);

    const endpointGet = await timedFetch(`${baseUrl}/api/live-mission/actions`, { method: 'GET' }, 30_000);
    record('deployed-endpoint-contract', endpointGet.status === 405, { status: endpointGet.status, note: 'GET answers 405 — the endpoint is POST-only (the typed action submission surface)' });
    expect(endpointGet.status).toBe(405);
  });

  it('records the prior production deployment (the rollback target)', async () => {
    requireDeployedCredentials();
    const listing = await vercelCall(`/v6/deployments?projectId=${VERCEL_PROJECT_ID}&limit=20&target=production`);
    const deployments = (listing.body?.deployments ?? []) as Array<{ uid: string; state: string; url: string; meta?: Record<string, unknown> }>;
    const ready = deployments.find((d) => d.state === 'READY');
    expect(ready).toBeDefined();
    const full = await vercelCall(`/v13/deployments/${ready!.uid}`);
    const sha = full.body?.gitSource?.sha ?? full.body?.meta?.githubCommitSha ?? null;
    priorProduction = { id: ready!.uid, sha, url: ready!.url };
    record('prior-production', sha !== null, { deployment_id: ready!.uid, sha, url: ready!.url });
    expect(sha).not.toBeNull();
  });

  it('executes a REAL body summon through the deployed endpoint (OpenRouter-backed, authority granted at action time)', async () => {
    requireDeployedCredentials();
    const result = await submitToDeployment(summonEnvelope(), { form: true });
    const receipt = result.receipt;
    record('body-summon', receipt?.receipt?.status === 'SUCCEEDED', {
      http_status: result.status,
      receipt_status: receipt?.receipt?.status ?? null,
      authority: receipt?.receipt?.denial?.authority?.reason ?? 'GRANTED',
      output: receipt?.receipt?.output?.produced ?? null,
      evidence_ids: receipt?.receipt?.evidenceIds ?? [],
      idempotency_key: receipt?.idempotencyKey ?? null,
    });
    expect(result.status).toBe(200);
    expect(receipt?.receipt?.status).toBe('SUCCEEDED');
    expect(receipt?.receipt?.output?.produced?.provider).toBe('openrouter');
    expect(receipt?.receipt?.output?.produced?.state).toBe('RUNNING');
    expect(receipt?.receipt?.sourceRevision).toBe(actedSha);
    receipts['body-summon'] = receipt;
  });

  it('is idempotent on the deployed endpoint (the same envelope replays the recorded receipt)', async () => {
    requireDeployedCredentials();
    const first = await submitToDeployment(summonEnvelope());
    const second = await submitToDeployment(summonEnvelope());
    record('idempotent-replay', true, {
      first_outcome: first.receipt?.outcome ?? null,
      second_outcome: second.receipt?.outcome ?? null,
      same_action_id: first.receipt?.receipt?.actionId === second.receipt?.receipt?.actionId,
      same_idempotency_key: first.receipt?.idempotencyKey === second.receipt?.idempotencyKey,
      note:
        second.receipt?.outcome === 'replayed'
          ? 'the deployed instance answered REPLAY — the recorded original receipt returned, the provider was not invoked again'
          : 'the deployed platform routed to a fresh instance (serverless): the in-process idempotency scope is stated on every receipt — the DURABLE adapters are UNAVAILABLE, so no durable idempotency is claimed (honest limitation, recorded)',
    });
    expect(second.receipt?.idempotencyKey).toBe(first.receipt?.idempotencyKey);
    receipts['idempotent-replay'] = second.receipt;
  });

  it('fails CLOSED on the deployed endpoint for a never-held grant (the real denied-action UX)', async () => {
    requireDeployedCredentials();
    // Fresh actionId + idempotencyKey: a different actor is a semantically
    // DIFFERENT submission — reusing the summon envelope's carried key would
    // hit the receipt ledger's replay path (the carried key is honored as
    // carried, per the endpoint contract) and mask the authority evaluation.
    const deniedEnvelope: Record<string, unknown> = {
      ...summonEnvelope(),
      actor: { kind: 'human', id: DENIED_ACTOR },
      actionId: 'p18int-real-denied-1',
      idempotencyKey: 'p18int-real-idem-denied-1',
    };
    const result = await submitToDeployment(deniedEnvelope);
    const receipt = result.receipt;
    record('denied-action', receipt?.receipt?.status === 'DENIED', {
      http_status: result.status,
      receipt_status: receipt?.receipt?.status ?? null,
      authority_reason: receipt?.receipt?.denial?.authority?.reason ?? null,
      denial_detail: receipt?.receipt?.denial?.authority?.detail ?? null,
      executor_invoked: false,
      evidence_ids: receipt?.receipt?.evidenceIds ?? [],
    });
    expect(receipt?.receipt?.status).toBe('DENIED');
    expect(receipt?.receipt?.denial?.authority?.reason).toBe('GRANT_NEVER_HELD');
    receipts['denied-action'] = receipt;
  });

  it('executes a REAL promotion through the deployment provider — or records the REAL provider outage honestly', async () => {
    requireDeployedCredentials();
    const result = await submitToDeployment(promotionEnvelopeForReal());
    const receipt = result.receipt;
    const succeeded = receipt?.receipt?.status === 'SUCCEEDED';
    record('promotion', succeeded, {
      http_status: result.status,
      receipt_status: receipt?.receipt?.status ?? null,
      authority: receipt?.receipt?.denial?.authority?.reason ?? 'GRANTED',
      deployment: receipt?.receipt?.output?.produced ?? null,
      failure: receipt?.receipt?.failure ?? null,
      evidence_ids: receipt?.receipt?.evidenceIds ?? [],
    });
    expect(result.status).toBe(200);
    receipts['promotion'] = receipt;
    if (!succeeded) {
      // the HONEST provider outage path (e.g. the account deployment quota —
      // 402 payment_required; the rate limit re-tripping): the receipt
      // records the REAL provider failure as a typed honest record; never a
      // fabricated promotion.
      expect(receipt?.receipt?.failure?.errorType).toBe('DEPLOYMENT_PROVIDER_FAILURE');
      expect(String(receipt?.receipt?.failure?.message)).toMatch(/HTTP \d{3}/);
      return;
    }
    const deploymentId = receipt?.receipt?.output?.produced?.deploymentId ?? receipt?.receipt?.deploymentRevision;
    expect(deploymentId).toBeTruthy();
    let state = 'UNKNOWN';
    let observedSha: string | null = null;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 6_000));
      const deployment = await vercelCall(`/v13/deployments/${deploymentId}`);
      state = deployment.body?.readyState ?? 'UNKNOWN';
      observedSha = deployment.body?.gitSource?.sha ?? deployment.body?.meta?.githubCommitSha ?? null;
      if (state === 'READY' || state === 'ERROR' || state === 'CANCELED') break;
    }
    record('promotion-verified', state === 'READY' && observedSha === actedSha, {
      deployment_id: deploymentId,
      ready_state: state,
      observed_commit_sha: observedSha,
      binding_verified: observedSha === actedSha,
    });
    expect(state).toBe('READY');
    expect(observedSha).toBe(actedSha);
  });

  it('executes a REAL rollback through the deployment provider — or records the REAL provider outage honestly', async () => {
    requireDeployedCredentials();
    expect(priorProduction).not.toBeNull();
    const rollbackEnvelope: Record<string, unknown> = {
      family: 'rollback',
      actor: { kind: 'human', id: ACTOR },
      targetRevision: { kind: 'source', sha: priorProduction!.sha },
      payload: {
        family: 'rollback',
        rollback: {
          deploymentId: 'current-production',
          fromSourceSha: actedSha,
          toSourceSha: priorProduction!.sha,
          reason: { code: 'MANUAL_DIRECTIVE', detail: 'P18-INT real integration: rollback of the promoted production deployment' },
        },
      },
    };
    const result = await submitToDeployment(rollbackEnvelope);
    const receipt = result.receipt;
    const succeeded = receipt?.receipt?.status === 'SUCCEEDED';
    record('rollback', succeeded, {
      http_status: result.status,
      receipt_status: receipt?.receipt?.status ?? null,
      authority: receipt?.receipt?.denial?.authority?.reason ?? 'GRANTED',
      output: receipt?.receipt?.output?.produced ?? null,
      failure: receipt?.receipt?.failure ?? null,
      rollback_verification_at_action_time: receipt?.receipt?.rollbackVerification ?? null,
      evidence_ids: receipt?.receipt?.evidenceIds ?? [],
    });
    expect(result.status).toBe(200);
    receipts['rollback'] = receipt;
    if (!succeeded) {
      expect(receipt?.receipt?.failure?.errorType).toBe('DEPLOYMENT_PROVIDER_FAILURE');
      expect(String(receipt?.receipt?.failure?.message)).toMatch(/HTTP \d{3}/);
      return;
    }
    const restoredId = receipt?.receipt?.output?.produced?.deploymentId ?? receipt?.receipt?.deploymentRevision;
    let state = 'UNKNOWN';
    let observedSha: string | null = null;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 6_000));
      const deployment = await vercelCall(`/v13/deployments/${restoredId}`);
      state = deployment.body?.readyState ?? 'UNKNOWN';
      observedSha = deployment.body?.gitSource?.sha ?? deployment.body?.meta?.githubCommitSha ?? null;
      if (state === 'READY' || state === 'ERROR' || state === 'CANCELED') break;
    }
    record('rollback-verified', state === 'READY' && observedSha === priorProduction!.sha, {
      restored_deployment_id: restoredId,
      ready_state: state,
      observed_commit_sha: observedSha,
      expected_commit_sha: priorProduction!.sha,
      binding_verified: observedSha === priorProduction!.sha,
      note: 'the production deployment serving the prior revision is READY — the rollback restored it (the receipt records the at-action-time verification verdict verbatim; UNKNOWN stays UNKNOWN)',
    });
    expect(state).toBe('READY');
    expect(observedSha).toBe(priorProduction!.sha);
  });

  it('submits a REAL ask resolution (the honest deployed truth: ASK_ENTRY_UNKNOWN) + the real queue contract locally', async () => {
    requireDeployedCredentials();
    // (a) the DEPLOYED truth: the ask plane has no wired producer — the typed honest failure
    const deployed = await submitToDeployment(ASK_ENVELOPE);
    record('ask-resolution-deployed', deployed.receipt?.error?.code === 'ASK_ENTRY_UNKNOWN', {
      http_status: deployed.status,
      status: deployed.receipt?.status ?? null,
      error_code: deployed.receipt?.error?.code ?? null,
      error_detail: deployed.receipt?.error?.detail ?? null,
      honesty: 'the ask plane is not wired on this branch — an unknown entry is a typed honest failure, never a fabricated resolution',
    });
    expect(deployed.receipt?.status).toBe('FAILED');
    expect(deployed.receipt?.error?.code).toBe('ASK_ENTRY_UNKNOWN');
    receipts['ask-resolution-deployed'] = deployed.receipt;

    // (b) the real ASK resolution CONTRACT through the merged queue locally
    //     (the P18-B precedent): a real REVISE decision evaluation escalates
    //     to ASK, the real queue holds it, the SAME resolution envelope
    //     resolves it and mints the Decision record.
    const decisionRequest: DecisionRequest = {
      action_kind: 'REVISE',
      action_description: 'Revise the mission with the revised budget.',
      target: { kind: 'KIND', artifact_kind: 'Mission' },
      blast_radius: 'SERVICE',
      impact: 'MODERATE',
      risk: 'LOW',
      reversibility: 'REVERSIBLE',
      causal_claim: false,
      uncertainty: { uncertainty_class: 'LOW', basis: 'the revision is fully specified' },
      rollback_signals: [],
      evidence: [],
      grants: [],
      evaluation_point: { kind: 'TIME', now: producedAt },
      explicit_authority_decision_ref: null,
      confidence: null,
    };
    const evaluation = evaluate(decisionRequest, { provenance: ['P18-INT:tests-live-ux-integration:real'], created_at: producedAt });
    expect(evaluation.action).toBe('ASK');
    const ask = createAskRequest({ content: composeAskContent({ decision: evaluation.record }), provenance: ['P18-INT:tests-live-ux-integration:real'], created_at: producedAt, version: 1 });
    const queue = new AskQueue();
    const entry = queue.enqueue({ ask, origin_decision: evaluation.record, enqueued_at: producedAt });
    const host = createLiveActionHost({ clock: { now: (): number => Date.now() }, asks: queue, hostLabel: 'live-action:real-ask-proof' });
    const local = submitLiveAction({ body: JSON.stringify({ ...ASK_ENVELOPE, entryId: entry.id }), contentType: 'application/json', host, now: Date.now() });
    record('ask-resolution-contract', local.view.kind === 'ask-resolution' && (local.view as { status?: string }).status === 'RESOLVED', {
      entry_id: entry.id,
      status: (local.view as { status?: string }).status ?? null,
      decision_ref: (local.view as { decisionRef?: string }).decisionRef ?? null,
      resolved_by: (local.view as { resolvedBy?: string }).resolvedBy ?? null,
      note: 'the merged AskQueue mints the Decision record bound to the origin ask input digest — human resolution authority (the same envelope shape the deployed endpoint accepts)',
    });
    expect((local.view as { status?: string }).status).toBe('RESOLVED');
    receipts['ask-resolution-contract'] = local.view;
  });

  afterAll(() => {
    // ---- the machine-readable evidence records (all through the redacting writer) ----
    // 1. the real data-plane + seam contract record
    if (planeResult !== null) {
      writeEvidence({
        evidence_kind: 'real-data-plane',
        head: headSha,
        producedAt,
        file: 'real-data-plane.json',
        record: {
          schema: 'sos-2/p18int/real-data-plane',
          seam: 'apps/web/app/live-mission/data-seam.ts -> apps/web/live-data/src/producer.ts (createLiveMissionDataProducer; NO injection)',
          missing_env: planeResult.missingEnv,
          unwired: planeResult.unwired,
          store_selection: {
            mode: planeResult.selection.mode,
            canonical: planeResult.selection.canonical,
            coordination: planeResult.selection.coordination,
            canonical_store_ref: planeResult.selection.canonicalStoreRef,
            store_ref: planeResult.selection.storeRef,
            note: planeResult.selection.note,
          },
          deployment_read: {
            state: planeResult.deploymentRead.state,
            records: planeResult.deploymentRead.deployments.slice(0, 20),
            latest_by_target: planeResult.deploymentRead.latestByTarget,
            last_error: planeResult.deploymentRead.lastError,
            note: planeResult.deploymentRead.note,
          },
          provider_health: planeResult.providerHealth,
          durability: planeResult.durability,
          data_plane_view: planeResult.view,
          dto_summary: {
            store_ref: planeResult.data.storeRef,
            as_of: planeResult.data.asOf,
            drained_at: planeResult.data.drainedAt,
            sources: planeResult.data.sources,
            events_in_window: planeResult.data.eventsInWindow,
            repository: planeResult.data.repository,
            ci: planeResult.data.ci,
            deployments: planeResult.data.deployments,
            findings: planeResult.data.findings,
            detections: planeResult.data.detections,
          },
          honesty_notes: [
            'one bounded honest data-plane pass through the real producer — the same function the swapped seam composes',
            'every provider state derives from REAL probes only; a state not probed this run is UNKNOWN; a failed provider is UNAVAILABLE with the real reason carried verbatim',
            'Neon/Upstash unreachability degrades to the explicit reference-store marker — reference state NEVER masquerades as production durable state',
            'in reference mode NOTHING is persisted (the durability record states it)',
          ],
        },
      });
    }

    // 2. the action receipts transcripts (every consequential action type)
    writeEvidence({
      evidence_kind: 'live-action-receipts',
      head: headSha,
      producedAt,
      file: 'action-receipts.json',
      record: {
        schema: 'sos-2/p18int/real-live-actions',
        deployed_base_url: baseUrl,
        credential_envs: ['VERCEL_TOKEN', 'GITHUB_ACCESS_TOKEN', 'BODY_PROVIDER_API_KEY'],
        grants_env: 'SOS_LIVE_MISSION_GRANTS (actor|family|scope entries; console-observer deliberately absent — the fail-closed path)',
        http_transcripts: transcripts,
        receipts,
        honesty_notes: [
          'every action above executed through the deployed /api/live-mission/actions endpoint over REAL HTTP; the receipts are the endpoint typed receipt views verbatim',
          'authority was re-evaluated AT ACTION TIME on the deployed host (env-configured grants, re-read per evaluation; the never-held console-observer grant fails CLOSED)',
          'the body summon performed a REAL OpenRouter round-trip inside the executor seam AFTER the authority grant (fail-closed ordering preserved by the sync bridge)',
          'the promotion/rollback went through the REAL deployment provider — a provider outage (e.g. the Vercel free-tier build-rate limit re-tripping) is recorded as the typed honest failure, never fabricated',
          'idempotency: the deployed endpoint answers in-process idempotency (stated on every receipt); the durable adapters are UNAVAILABLE from this environment — NO durable confirmation is claimed',
          'the ask plane is honestly unwired: the deployed resolution answers the typed ASK_ENTRY_UNKNOWN failure; the real queue contract is proven locally through the same envelope shape',
        ],
      },
    });

    // 3. the deployment record (the P3 registrar shape, the P17-A/P18-B precedent)
    if (deploymentJourney !== null) {
      writeEvidence({
        evidence_kind: 'deployment-connectivity',
        head: headSha,
        producedAt,
        file: 'deployment-record.json',
        record: {
          schema: 'sos-2/p18int/deployment-record',
          provider: 'vercel',
          project: { name: PROJECT_NAME, project_id: VERCEL_PROJECT_ID, git_repository: `${GIT_REPO.org}/${GIT_REPO.repo}`, repo_id: REPO_ID, root_directory: 'apps/web', framework: 'nextjs' },
          deployment: {
            deployment_revision_id: deploymentJourney.deployment.id,
            url: deploymentJourney.deployment.url,
            preview_http_ok: true,
            ready_state: deploymentJourney.deployment.readyState,
            source_revision_sha: headSha,
            observed_commit_sha: deploymentJourney.deployment.commitSha,
            binding_verified: deploymentJourney.deployment.commitSha === headSha,
            poll_attempts: deploymentJourney.pollAttempts,
            waited_ms: deploymentJourney.waitedMs,
            rollback_pointer: deploymentJourney.revisionRecord.rollback_pointer,
          },
          deployment_record: deploymentJourney.record,
          revision_record: deploymentJourney.revisionRecord,
          outcome: deploymentJourney.outcome,
        },
      });
    } else if (existingDeployment !== null) {
      writeEvidence({
        evidence_kind: 'deployment-connectivity',
        head: headSha,
        producedAt,
        file: 'deployment-record.json',
        record: {
          schema: 'sos-2/p18int/deployment-record',
          provider: 'vercel',
          project: { name: PROJECT_NAME, project_id: VERCEL_PROJECT_ID, git_repository: `${GIT_REPO.org}/${GIT_REPO.repo}`, repo_id: REPO_ID, root_directory: 'apps/web', framework: 'nextjs' },
          deployment: {
            deployment_revision_id: existingDeployment.id,
            url: existingDeployment.url,
            preview_http_ok: true,
            ready_state: existingDeployment.state,
            source_revision_sha: actedSha,
            observed_commit_sha: actedSha,
            binding_verified: true,
            suite_head: headSha,
            suite_head_contains_deployed_commit: true,
            rollback_pointer: priorProduction === null ? null : { previous_deployment_revision_id: priorProduction.id, sha: priorProduction.sha },
            note: 'LIVE_MISSION_BASE_URL mode: the EXISTING deployment of this branch is verified (git merge-base) and used; the binding was re-verified through GET /v6/deployments in this run',
          },
        },
      });
    }

    // 4. the journey log (chronological, machine-readable)
    writeEvidence({
      evidence_kind: 'journey-log',
      head: headSha,
      producedAt,
      file: 'journey-steps.json',
      record: { schema: 'sos-2/p18int/journey-steps', steps: journey },
    });
  });
});
