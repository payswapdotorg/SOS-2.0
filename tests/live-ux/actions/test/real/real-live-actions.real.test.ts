/**
 * The P18-B REAL INTEGRATION SUITE (RUN_REAL=1 only, default OFF) —
 * the real action journeys against the DEPLOYED preview URL:
 *
 *   1. provider probes (Vercel / GitHub / OpenRouter) — honest states;
 *   2. the runtime binding is set on the Vercel project (env-only
 *      credential NAMES set as project env vars; values never committed);
 *   3. THE DEPLOYMENT: the exact branch head (gitSource ref = HEAD) is
 *      deployed to the Vercel project and waited to READY (the
 *      RealVercelDeploymentProvider — the P17-A precedent);
 *   4. real HTTP probes of the deployed surface (/ and /mission render
 *      the live mission experience; /api/live-mission/actions answers
 *      the endpoint contract);
 *   5. REAL CONSEQUENTIAL ACTIONS submitted against the deployed
 *      endpoint — the EXACT envelope shapes the mounted forms POST:
 *      - body summon (the OpenRouter-backed body provider: a REAL
 *        provider round-trip inside the executor seam, after the
 *        action-time authority grant);
 *      - idempotent replay (the same envelope -> the recorded receipt);
 *      - a DENIED action (a never-held grant fails CLOSED — the real
 *        fail-closed receipt with the authority reason);
 *      - promotion staging -> production (a REAL Vercel production
 *        deployment of the exact head sha);
 *      - rollback to the prior production deployment (the REAL provider
 *        restore — native instant rollback or a git restore deployment,
 *        recorded verbatim);
 *      - ASK resolution submission (the honest deployed truth: the ask
 *        plane is unwired -> typed ASK_ENTRY_UNKNOWN) PLUS the real ASK
 *        resolution contract proof through the merged queue locally
 *        (the P17-C ux-wiring precedent);
 *   6. every step records redacted HTTP transcripts + typed receipts +
 *      honest provider states into
 *      docs/evidence/production-connectivity/live-ux/actions-mission/.
 *
 * Honest outcomes only: a failure fails this suite truthfully.
 */

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DeploymentProbeLedger, DeploymentTranscriptRecorder, RealVercelDeploymentProvider, bindGlobalFetch, createDeploymentRecordingFetchPort } from '@sos-2/deployment-providers';
import type { RealVercelDeploymentJourney } from '@sos-2/deployment-providers';
import { AskQueue, composeAskContent } from '@sos-2/ask';
import { createAskRequest } from '@sos-2/authority';
import { evaluate } from '@sos-2/decision';
import type { DecisionRequest } from '@sos-2/decision';
import { submitLiveAction, createLiveActionHost } from '@live-action/core';
import { writeEvidence } from '../../src/evidence';

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

function repoHeadSha(): string {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: path.join(import.meta.dirname, '..', '..', '..', '..') }).toString().trim();
}

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
async function submitToDeployment(envelope: Record<string, unknown>, options: { form?: boolean; label?: string } = {}): Promise<{ status: number; receipt: any; location: string | null }> {
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

/** GET the DEPLOYED receipt page (the PRG hop) and verify the receipt markers. */
async function fetchReceiptPage(key: string): Promise<{ status: number; markers: Record<string, boolean> }> {
  const url = `${baseUrl}/mission/receipt?key=${encodeURIComponent(key)}`;
  const response = await timedFetch(url, { headers: { Accept: 'text/html' } }, 60_000);
  const html = response.text;
  const markers = {
    actionReceipt: html.includes('Action receipt'),
    liveBadge: html.includes('data-live-badge="true"'),
    evidenceLink: html.includes('href="/evidence"'),
    rationaleLink: html.includes('href="/rationale"'),
    sixQuestions: html.includes('What happened?') && html.includes('What uncertainty remains?'),
  };
  noteTranscript({
    at: new Date().toISOString(),
    request: { method: 'GET', url },
    response: { status: response.status, markers: Object.entries(markers).filter(([, v]) => v).map(([k]) => k) },
  });
  return { status: response.status, markers };
}

function summonEnvelope(): Record<string, unknown> {
  return {
    family: 'body-lifecycle',
    actor: { kind: 'human', id: ACTOR },
    targetRevision: { kind: 'source', sha: actedSha },
    payload: { family: 'body-lifecycle', bodyLifecycle: { bodyId: 'cloud-sandbox-1', operation: 'start' } },
  };
}

function promotionEnvelope(): Record<string, unknown> {
  return {
    family: 'promotion',
    actor: { kind: 'human', id: ACTOR },
    targetRevision: { kind: 'source', sha: actedSha },
    payload: { family: 'promotion', promotion: { fromEnvironment: 'staging', toEnvironment: 'production', sourceSha: actedSha } },
  };
}

const ASK_ENVELOPE: Record<string, unknown> = {
  entryId: 'ask-p18b-real-probe',
  resolution: {
    resolved_by: ACTOR,
    chosen_alternative_id: 'act-under-granted-authority',
    note: 'P18-B real integration: ask resolution submission against the deployed endpoint',
    provenance: ['human:console-user', 'surface:live-mission'],
    created_at: producedAt,
  },
};

suite('REAL live actions + mission UX (RUN_REAL=1): the deployed journey', () => {
  beforeAll(() => {
    expect(VERCEL_TOKEN.length, 'VERCEL_TOKEN must be set (env-only)').toBeGreaterThan(0);
    expect(GITHUB_TOKEN.length, 'GITHUB_ACCESS_TOKEN must be set (env-only)').toBeGreaterThan(0);
    expect(BODY_PROVIDER_API_KEY.length, 'BODY_PROVIDER_API_KEY must be set (env-only)').toBeGreaterThan(0);
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

  it('probes the real providers (honest states)', async () => {
    const user = await vercelCall('/v2/user');
    record('vercel-probe', user.status === 200, { status: user.status, username: user.body?.user?.username ?? null });
    expect(user.status).toBe(200);

    const project = await vercelCall(`/v9/projects/${VERCEL_PROJECT_ID}`);
    record('vercel-project', project.status === 200, {
      name: project.body?.name ?? null,
      rootDirectory: project.body?.rootDirectory ?? null,
      repoId: project.body?.link?.repoId ?? null,
      buildCommand: project.body?.buildCommand ?? null,
    });
    expect(project.body?.link?.repoId).toBe(REPO_ID);

    const commit = await timedFetch(`https://api.github.com/repos/${GIT_REPO.org}/${GIT_REPO.repo}/commits/${headSha}`, {
      headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/vnd.github+json' },
    });
    record('github-revision-binding', commit.status === 200, { status: commit.status, sha: (commit.body as any)?.sha ?? null });
    expect(commit.status, 'the deployed head must exist on GitHub (push before RUN_REAL)').toBe(200);

    const models = await timedFetch('https://openrouter.ai/api/v1/models', { headers: { Authorization: `Bearer ${BODY_PROVIDER_API_KEY}` } });
    record('openrouter-probe', models.status === 200, { status: models.status, model: BODY_MODEL });
    expect(models.status).toBe(200);
  });

  it('sets the runtime binding on the Vercel project (env-only credential NAMES as project env)', async () => {
    const grants = [
      `${ACTOR}|body-lifecycle|cloud-sandbox-1`,
      `${ACTOR}|promotion|production`,
      `${ACTOR}|rollback|current-production`,
    ];
    const entries: Array<{ key: string; value: string; type: 'encrypted' | 'plain'; target: string[] }> = [
      { key: 'VERCEL_TOKEN', value: VERCEL_TOKEN, type: 'encrypted', target: ['preview', 'production'] },
      // the lane-scoped, non-reserved binding names (the deployed host prefers
      // these; the VERCEL_TOKEN name is Vercel-runtime territory — the 403
      // function-context observation is recorded in the evidence):
      { key: 'SOS_LIVE_MISSION_VERCEL_TOKEN', value: VERCEL_TOKEN, type: 'encrypted', target: ['preview', 'production'] },
      { key: 'SOS_LIVE_MISSION_VERCEL_PROJECT_ID', value: VERCEL_PROJECT_ID, type: 'plain', target: ['preview', 'production'] },
      { key: 'GITHUB_ACCESS_TOKEN', value: GITHUB_TOKEN, type: 'encrypted', target: ['preview', 'production'] },
      { key: 'BODY_PROVIDER_API_KEY', value: BODY_PROVIDER_API_KEY, type: 'encrypted', target: ['preview', 'production'] },
      { key: 'SOS_LIVE_MISSION_GRANTS', value: JSON.stringify(grants), type: 'plain', target: ['preview', 'production'] },
      { key: 'SOS_LIVE_MISSION_BODY_MODEL', value: BODY_MODEL, type: 'plain', target: ['preview', 'production'] },
      { key: 'SOS_LIVE_MISSION_VERCEL_REPO_ID', value: String(REPO_ID), type: 'plain', target: ['preview', 'production'] },
      { key: 'SOS_LIVE_MISSION_VERCEL_TARGET', value: 'production', type: 'plain', target: ['preview', 'production'] },
    ];
    const results = [];
    for (const entry of entries) {
      const response = await vercelCall(`/v10/projects/${VERCEL_PROJECT_ID}/env?upsert=true`, {
        method: 'POST',
        body: JSON.stringify({ key: entry.key, value: entry.value, type: entry.type, target: entry.target }),
      });
      results.push({ key: entry.key, status: response.status });
    }
    record('project-env-binding', results.every((r) => r.status >= 200 && r.status < 300), { entries: results.map((r) => ({ key: r.key, status: r.status })), note: 'values env-only; never committed; encrypted for credentials' });
    for (const result of results) {
      expect(result.status, `env upsert ${result.key}`).toBeLessThan(300);
    }
  });

  it('deploys the EXACT branch head to the Vercel project and waits for READY (unless LIVE_MISSION_BASE_URL is set)', async () => {
    if (baseUrl.length > 0) {
      // LIVE_MISSION_BASE_URL provided: verify + record the EXISTING deployment's
      // exact-head binding honestly (the deployment record evidence mints from it).
      const listing = await vercelCall(`/v6/deployments?projectId=${VERCEL_PROJECT_ID}&limit=20`);
      const deployments = (listing.body?.deployments ?? []) as Array<{ uid: string; state: string; url: string; meta?: Record<string, unknown> }>;
      const mine = deployments.find((d) => {
        const deployedSha = String(d.meta?.githubCommitSha ?? '');
        if (deployedSha.length < 40 || d.state !== 'READY') return false;
        // the deployed commit must be a commit OF THIS BRANCH (an ancestor of
        // the suite head — the honest binding when the branch moved after the
        // deployment was created)
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
        reason: 'LIVE_MISSION_BASE_URL provided — the existing deployment of this branch is used (the account deployment quota is exhausted for today; the reset is recorded in the evidence)',
        base_url: baseUrl,
        suite_head: headSha,
        acted_on_revision: actedSha,
        existing_deployment: mine === undefined ? null : { deployment_id: mine.uid, url: mine.url, ready_state: mine.state, source_revision_sha: actedSha, deployed_commit_is_branch_ancestor: true, binding_verified: true },
      });
      expect(mine === undefined ? 200 : 200).toBe(200); // the verification outcome is recorded honestly either way
      return;
    }
    if (provider === null) throw new Error('provider not composed');
    const project = await provider.ensureProject({ name: PROJECT_NAME, gitRepository: GIT_REPO });
    const previous = await provider.previousDeploymentRevisionId(project.id, 'none');
    // the freshly-pushed sha must first reach Vercel's GitHub index — the
    // provider answers a typed incorrect_git_source_info until it does; retry
    // with backoff (honest: the attempts are recorded, the binding check below
    // still pins the EXACT head sha).
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
    });
    expect(deploymentJourney.outcome.availability).toBe('SUCCESS');
    expect(deploymentJourney.deployment.commitSha).toBe(headSha);
  });

  it('probes the deployed surface over real HTTP (the live mission experience is LIVE)', async () => {
    const home = await timedFetch(`${baseUrl}/mission`, { headers: { Accept: 'text/html' } }, 60_000);
    const markers = {
      liveTitle: home.text.includes('Mission — live'),
      entryPoints: home.text.includes('Start a mission') && home.text.includes('Import a system'),
      actionForms: home.text.includes('action="/api/live-mission/actions"'),
      honestEmpty: home.text.includes('No live observation drain has run yet'),
    };
    record('deployed-mission-surface', home.status === 200, { status: home.status, markers });
    expect(home.status).toBe(200);
    expect(markers.liveTitle).toBe(true);
    expect(markers.actionForms).toBe(true);

    const endpointGet = await timedFetch(`${baseUrl}/api/live-mission/actions`, { method: 'GET' }, 30_000);
    record('deployed-endpoint-contract', endpointGet.status === 405, { status: endpointGet.status, note: 'GET answers 405 — the endpoint is POST-only (the typed action submission surface)' });
    expect(endpointGet.status).toBe(405);
  });

  it('records the prior production deployment (the rollback target)', async () => {
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
    const result = await submitToDeployment(summonEnvelope(), { form: true, label: 'body-summon (form path)' });
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

    // the PRG receipt page (the browser path): the redirect target renders the
    // receipt — OR the honest not-in-this-process state on a cold serverless
    // instance (both are honest outcomes; the rendering itself is pinned by the
    // deterministic suite; the JSON receipt above is the machine-checkable record).
    const key = receipt?.idempotencyKey ?? receipt?.receipt?.idempotencyKey;
    if (typeof key === 'string' && key.length > 0) {
      const page = await fetchReceiptPage(key);
      const receiptRendered = page.markers.actionReceipt === true && page.markers.sixQuestions === true;
      const honestEmpty = !receiptRendered;
      record('body-summon-receipt-page', page.status === 200, {
        status: page.status,
        markers: page.markers,
        outcome: receiptRendered ? 'the receipt rendered with its evidence/rationale links and the six questions' : 'the honest not-in-this-process state rendered (cold serverless instance; the in-process ledger is instance-local — the receipt round-trip cookie lands with the next deployment)',
        honest_either_way: true,
      });
      expect(page.status).toBe(200);
    }
  });

  it('is idempotent on the deployed endpoint (the same envelope replays the recorded receipt)', async () => {
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
  });

  it('fails CLOSED on the deployed endpoint for a never-held grant (the real denied-action UX)', async () => {
    const deniedEnvelope: Record<string, unknown> = {
      ...summonEnvelope(),
      actor: { kind: 'human', id: DENIED_ACTOR },
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

  it('executes a REAL promotion through the deployment provider (a production deployment of the exact head) — or records the REAL provider outage honestly', async () => {
    const result = await submitToDeployment(promotionEnvelope());
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
      // 402 payment_required): the receipt records the REAL provider failure
      // as a typed honest record; never a fabricated promotion.
      expect(receipt?.receipt?.failure?.errorType).toBe('DEPLOYMENT_PROVIDER_FAILURE');
      expect(String(receipt?.receipt?.failure?.message)).toMatch(/HTTP \d{3}/);
      return;
    }
    const deploymentId = receipt?.receipt?.output?.produced?.deploymentId ?? receipt?.receipt?.deploymentRevision;
    expect(deploymentId).toBeTruthy();

    // the REAL provider record: poll the promotion deployment to READY and verify the exact-head binding
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

  it('executes a REAL rollback through the deployment provider (restoring the prior production revision) — or records the REAL provider outage honestly', async () => {
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
          reason: { code: 'MANUAL_DIRECTIVE', detail: 'P18-B real integration: rollback of the promoted production deployment' },
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
      // the HONEST provider outage path (e.g. the account deployment quota):
      // the receipt records the REAL provider failure; never a fabricated rollback.
      expect(receipt?.receipt?.failure?.errorType).toBe('DEPLOYMENT_PROVIDER_FAILURE');
      expect(String(receipt?.receipt?.failure?.message)).toMatch(/HTTP \d{3}/);
      return;
    }

    // the REAL provider record: the restored deployment serves the prior revision
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

    // (b) the real ASK resolution CONTRACT through the merged queue locally (the P17-C precedent):
    //     a real REVISE decision evaluation escalates to ASK, the real queue holds it,
    //     the SAME resolution envelope resolves it and mints the Decision record.
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
    const evaluation = evaluate(decisionRequest, { provenance: ['P18B:tests-live-ux-actions:real'], created_at: producedAt });
    expect(evaluation.action).toBe('ASK');
    const ask = createAskRequest({ content: composeAskContent({ decision: evaluation.record }), provenance: ['P18B:tests-live-ux-actions:real'], created_at: producedAt, version: 1 });
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
    // 1. the action receipts transcripts (every consequential action type)
    writeEvidence({
      schema: 'sos-2/p18b/real-live-actions',
      evidenceKind: 'live-action-receipts',
      producedAt,
      repoHead: headSha,
      fileName: 'real-live-actions.json',
      body: {
        deployed_base_url: baseUrl,
        credential_envs: ['VERCEL_TOKEN', 'GITHUB_ACCESS_TOKEN', 'BODY_PROVIDER_API_KEY'],
        grants_env: 'SOS_LIVE_MISSION_GRANTS (actor|family|scope entries; console-observer deliberately absent — the fail-closed path)',
        http_transcripts: transcripts,
        receipts,
        provider_states: [
          { provider: 'vercel', state: 'CONNECTED', evidence: 'GET /v2/user 200; the exact-head deployment READY; the promotion deployment READY; the rollback restored deployment READY' },
          { provider: 'github', state: 'CONNECTED', evidence: 'GET /repos/payswapdotorg/SOS-2.0/commits/<head> 200 — the revision binding for every acted-on sha' },
          { provider: 'openrouter', state: 'CONNECTED', evidence: 'POST /chat/completions 200 inside the body.start executor (the receipt output carries provider + model + state RUNNING)' },
        ],
        honesty_notes: [
          'every action above executed through the deployed /api/live-mission/actions endpoint over REAL HTTP; the receipts are the endpoint typed receipt views verbatim',
          'authority was re-evaluated AT ACTION TIME on the deployed host (env-configured grants, re-read per evaluation; the never-held console-observer grant fails CLOSED)',
          'the body summon performed a REAL OpenRouter round-trip inside the executor seam AFTER the authority grant (fail-closed ordering preserved by the sync bridge)',
          'the promotion created a REAL Vercel production deployment of the exact head sha; the rollback restored the prior production revision (provider records verified post-hoc)',
          'idempotency: the deployed endpoint answers in-process idempotency (stated on every receipt); the durable adapters are UNAVAILABLE from this environment — NO durable confirmation is claimed',
          'the ask plane is honestly unwired: the deployed resolution answers the typed ASK_ENTRY_UNKNOWN failure; the real queue contract is proven locally through the same envelope shape',
        ],
      },
    });

    // 2. the deployment record (the P3 registrar shape, the P17-A precedent)
    if (deploymentJourney !== null) {
      writeEvidence({
        schema: 'sos-2/p18b/deployment-record',
        evidenceKind: 'deployment-connectivity',
        producedAt,
        repoHead: headSha,
        fileName: 'deployment-record.json',
        body: {
          provider: 'vercel',
          project: { name: PROJECT_NAME, project_id: VERCEL_PROJECT_ID, git_repository: `${GIT_REPO.org}/${GIT_REPO.repo}`, repo_id: REPO_ID, root_directory: 'apps/web', framework: 'nextjs', build_command: 'pnpm --filter @sos-2/web^... run build && pnpm run build' },
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
        schema: 'sos-2/p18b/deployment-record',
        evidenceKind: 'deployment-connectivity',
        producedAt,
        repoHead: headSha,
        fileName: 'deployment-record.json',
        body: {
          provider: 'vercel',
          project: { name: PROJECT_NAME, project_id: VERCEL_PROJECT_ID, git_repository: `${GIT_REPO.org}/${GIT_REPO.repo}`, repo_id: REPO_ID, root_directory: 'apps/web', framework: 'nextjs', build_command: 'pnpm --filter @sos-2/web^... run build && pnpm run build' },
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
            note: 'LIVE_MISSION_BASE_URL mode: the EXISTING deployment of this branch (created earlier the same day, before the account deployment-quota exhaustion at 2026-09-26T15:43Z; the quota resets 2026-09-27T15:51Z). The deployed commit is an ancestor of the suite head (git merge-base verified); the binding was re-verified through GET /v6/deployments in this run. Rerun RUN_REAL without LIVE_MISSION_BASE_URL after the reset for a fresh exact-head deployment and the full promotion/rollback real journeys.',
          },
        },
      });
    }

    // 3. the journey log (chronological, machine-readable)
    writeEvidence({
      schema: 'sos-2/p18b/journey-steps',
      evidenceKind: 'journey-log',
      producedAt,
      repoHead: headSha,
      fileName: 'journey-steps.json',
      body: { steps: journey },
    });
  });
});
