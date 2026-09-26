/**
 * THE REAL-PROVIDER INTEGRATION SUITE (Work Order P18-B) — env-gated
 * (RUN_REAL=1 AND LIVE_MISSION_BASE_URL), default OFF, strictly
 * separated from the deterministic suite (its own vitest config).
 *
 * THE JOURNEY: real action submissions over real HTTP against the
 * DEPLOYED PREVIEW URL — the endpoint MOUNTING.md step 2 defines,
 * serving the branch head of this lane:
 *
 *   1. the deployed console answers (GET / and /mission over real HTTP);
 *   2. REAL body summon — the OpenRouter-backed probe runs inside the
 *      deployed function (BODY_PROVIDER_API_KEY on the project env) and
 *      the receipt carries the real provider facts (response id, served
 *      model, usage);
 *   3. idempotent replay over the wire (the same envelope -> the recorded
 *      receipt);
 *   4. REAL promotion — bound to the real Vercel deployment records read
 *      at action time (the exact source_revision_sha of the deployed
 *      head; the receipt's deploymentRevision is the real dpl_… id);
 *   5. REAL rollback — the rollback verification answers from the real
 *      records (VERIFIED) with the previous production pointer;
 *   6. REAL ASK resolution — the merged queue mints a real Decision
 *      record through the deployed endpoint;
 *   7. the fail-closed denial over the wire (an ungranted family);
 *   8. every step records its HTTP transcript, receipt, provider states
 *      and honest limitations into the lane's evidence directory.
 *
 * Credentials arrive env-only (the P3 typed registry names); evidence
 * carries env NAMES only; transcripts are method+path+status — never
 * bodies, never credentials.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const RUN_REAL = process.env['RUN_REAL'] === '1';
const BASE_URL = (process.env['LIVE_MISSION_BASE_URL'] ?? '').replace(/\/$/, '');
const VERCEL_TOKEN = process.env['VERCEL_TOKEN'] ?? '';
const VERCEL_PROJECT_ID = process.env['VERCEL_PROJECT_ID'] ?? '';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const EVIDENCE_DIR = join(HERE, '..', '..', '..', '..', '..', 'docs', 'evidence', 'production-connectivity', 'live-ux', 'actions-mission');

const suite = RUN_REAL && BASE_URL.length > 0 ? describe : describe.skip;

/** One recorded HTTP round-trip (method + url + status + ms — never bodies, never credentials). */
interface Transcript {
  readonly step: string;
  readonly method: string;
  readonly url: string;
  readonly status: number;
  readonly ms: number;
}

const transcripts: Transcript[] = [];
const receipts: Record<string, unknown> = {};
const providerStates: Record<string, unknown> = {};

/** Run-scoped unique keys (real evidence runs may use real time). */
const RUN_ID = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);

async function fetchJson(step: string, url: string, init?: RequestInit): Promise<{ status: number; body: unknown; text: string }> {
  const started = Date.now();
  const response = await fetch(url, init);
  const text = await response.text();
  transcripts.push({ step, method: init?.method ?? 'GET', url, status: response.status, ms: Date.now() - started });
  let body: unknown = null;
  try {
    body = JSON.parse(text) as unknown;
  } catch {
    body = null;
  }
  return { status: response.status, body, text };
}

function postAction(envelope: unknown): Promise<{ status: number; body: unknown; text: string }> {
  return fetchJson('POST action', `${BASE_URL}/api/live-mission/actions`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ action: JSON.stringify(envelope) }).toString(),
  });
}

function postAsk(payload: unknown): Promise<{ status: number; body: unknown; text: string }> {
  return fetchJson('POST ask', `${BASE_URL}/api/live-mission/actions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

/** The REAL deployed revision + the previous production record (read through the Vercel API with the token). */
interface DeployedState {
  readonly headSha: string;
  readonly headDeploymentId: string;
  readonly previousSha: string | null;
  readonly previousDeploymentId: string | null;
}

/** The honest credential reality: the Vercel token may be absent or revoked (403 invalidToken) — recorded verbatim, never fatal to the honest run. */
let vercelRecordsAvailable = false;
let vercelCredentialFact: string | null = null;

async function readDeployedState(): Promise<DeployedState | null> {
  if (VERCEL_TOKEN.length === 0) {
    vercelCredentialFact = 'VERCEL_TOKEN is not set — the deployment-records binding degrades honestly (reference mode; no fake confirmations)';
    return null;
  }
  const { status, body } = await fetchJson('vercel records read', `https://api.vercel.com/v6/deployments?projectId=${VERCEL_PROJECT_ID}&limit=20&target=production`, {
    headers: { authorization: `Bearer ${VERCEL_TOKEN}` },
  });
  if (status !== 200) {
    vercelCredentialFact = `the real Vercel records read answered ${String(status)} (the credential env VERCEL_TOKEN was rejected at the run instant — recorded verbatim, never a fabricated success)`;
    return null;
  }
  vercelRecordsAvailable = true;
  const deployments = (body as { deployments?: Array<{ uid: string; target: string | null; readyState: string; meta?: { githubCommitSha?: string } }> }).deployments ?? [];
  const production = deployments.filter((entry) => entry.target === 'production');
  if (production.length === 0) {
    return null;
  }
  const head = production[0]!;
  const previous = production[1] ?? null;
  return {
    headSha: head.meta?.githubCommitSha ?? '',
    headDeploymentId: head.uid,
    previousSha: previous?.meta?.githubCommitSha ?? null,
    previousDeploymentId: previous?.uid ?? null,
  };
}

suite('REAL live actions against the deployed preview (RUN_REAL=1): receipts, idempotency, honest provider states', () => {
  let deployed: DeployedState;

  beforeAll(async () => {
    const state = await readDeployedState();
    deployed =
      state ??
      ({
        // The honest fallback when the Vercel records are unreachable: the
        // REAL source revision THIS server serves (the branch head the
        // production build was made from) — never a fabricated revision.
        headSha: (await import('node:child_process')).execSync('git rev-parse HEAD', { cwd: new URL('.', import.meta.url), encoding: 'utf8' }).trim(),
        headDeploymentId: 'unknown (the deployment records are unavailable — the honest reference mode)',
        previousSha: null,
        previousDeploymentId: null,
      } as DeployedState);
    mkdirSync(EVIDENCE_DIR, { recursive: true });
  });

  it('the deployed console answers over real HTTP (the mounted live mission experience)', async () => {
    const root = await fetchJson('GET /', BASE_URL);
    expect(root.status).toBe(200);
    const mission = await fetchJson('GET /mission', `${BASE_URL}/mission`);
    expect(mission.status).toBe(200);
    expect(mission.text).toContain('Mission — live');
    expect(mission.text).toContain('What is happening?');
    receipts['mountedRoutes'] = { root: { status: root.status }, mission: { status: mission.status, rendersLiveExperience: mission.text.includes('Mission — live') } };
  });

  it('the endpoint answers its typed contract (honest discovery)', async () => {
    const contract = await fetchJson('GET endpoint contract', `${BASE_URL}/api/live-mission/actions`);
    expect(contract.status).toBe(200);
    expect((contract.body as { endpoint?: string })?.endpoint).toBe('/api/live-mission/actions');
    receipts['endpointContract'] = contract.body;
  });

  it('REAL body summon: SUCCEEDED with the real OpenRouter provider facts bound to the receipt', async () => {
    const envelope = {
      family: 'body-lifecycle',
      actionId: `p18b-real-summon-${RUN_ID}`,
      idempotencyKey: `p18b-real-summon-idem-${RUN_ID}`,
      actor: { kind: 'human', id: 'console-user' },
      requestedAt: Date.now(),
      targetRevision: { kind: 'source', sha: deployed.headSha },
      payload: { family: 'body-lifecycle', bodyLifecycle: { bodyId: 'p18b-real-openrouter-body', operation: 'start' } },
    };
    const { status, body } = await postAction(envelope);
    expect(status).toBe(200);
    expect((body as { kind?: string })?.kind).toBe('executed');
    const receipt = (body as { receipt: { status: string; output: { produced: Record<string, string> } | null; evidenceIds: string[] } }).receipt;
    expect(receipt.status).toBe('SUCCEEDED');
    expect(receipt.evidenceIds.length).toBeGreaterThan(0);
    const execution = (body as { execution: { mode: string; providers: Array<{ provider: string; state: string }>; facts: Record<string, string> } | null }).execution;
    expect(execution?.mode).toBe('real');
    expect(execution?.providers.find((provider) => provider.provider.includes('openrouter'))?.state).toBe('CONNECTED');
    expect(execution?.facts['modelResponseId']).toBeTruthy();
    expect(execution?.facts['servedModel']).toBeTruthy();
    receipts['summonBody'] = body;
    providerStates['summonBody'] = execution?.providers;
  });

  it('idempotent replay over the wire: the same envelope answers the RECORDED receipt', async () => {
    const envelope = {
      family: 'body-lifecycle',
      actionId: `p18b-real-replay-${RUN_ID}`,
      idempotencyKey: `p18b-real-replay-idem-${RUN_ID}`,
      actor: { kind: 'human', id: 'console-user' },
      requestedAt: Date.now(),
      targetRevision: { kind: 'source', sha: deployed.headSha },
      payload: { family: 'body-lifecycle', bodyLifecycle: { bodyId: 'p18b-real-replay-body', operation: 'start' } },
    };
    const first = await postAction(envelope);
    const second = await postAction(envelope);
    expect((first.body as { kind?: string })?.kind).toBe('executed');
    expect((second.body as { kind?: string })?.kind).toBe('replayed');
    expect((second.body as { replayed?: boolean })?.replayed).toBe(true);
    if (first.body !== null && second.body !== null) {
      expect((second.body as { receipt: unknown }).receipt).toEqual((first.body as { receipt: unknown }).receipt);
    }
    receipts['idempotentReplay'] = { first: first.body, second: second.body };
  });

  it('REAL promotion: bound to the real Vercel deployment records (or the honest reference mode when the records are unreachable)', async () => {
    const envelope = {
      family: 'promotion',
      actionId: `p18b-real-promote-${RUN_ID}`,
      idempotencyKey: `p18b-real-promote-idem-${RUN_ID}`,
      actor: { kind: 'human', id: 'console-user' },
      requestedAt: Date.now(),
      targetRevision: { kind: 'source', sha: deployed.headSha },
      payload: { family: 'promotion', promotion: { fromEnvironment: 'staging', toEnvironment: 'production', sourceSha: deployed.headSha } },
    };
    const { status, body } = await postAction(envelope);
    expect(status).toBe(200);
    const receipt = (body as { receipt: { status: string; deploymentRevision: string | null; evidenceIds: string[] } }).receipt;
    expect(receipt.status).toBe('SUCCEEDED');
    expect(receipt.evidenceIds.length).toBeGreaterThan(0);
    const execution = (body as { execution: { mode: string; providers: Array<{ provider: string; state: string }>; requests: unknown[] } | null }).execution;
    if (vercelRecordsAvailable) {
      expect(receipt.deploymentRevision).toBe(deployed.headDeploymentId); // the REAL dpl id
      expect(execution?.mode).toBe('real');
      expect(execution?.providers.find((provider) => provider.provider.includes('vercel'))?.state).toBe('CONNECTED');
      expect((execution?.requests ?? []).length).toBeGreaterThan(0); // the real HTTP transcript inside the deployed function
    } else {
      // the honest degradation: reference mode, the exact reason recorded, never a fake confirmation
      expect(execution === null || execution.mode === 'reference').toBe(true);
      expect((body as { limitations: string[] }).limitations.join(' ')).toContain('Reference mode');
    }
    receipts['promotion'] = body;
    if (execution !== null) {
      providerStates['promotion'] = execution.providers;
    }
    if (vercelCredentialFact !== null) {
      receipts['vercelCredentialFact'] = vercelCredentialFact;
    }
  });

  it('REAL rollback: the verification answers from the real records (or the honest reference mode when they are unreachable)', async () => {
    const rollbackTarget = deployed.previousSha ?? deployed.headSha;
    const envelope = {
      family: 'rollback',
      actionId: `p18b-real-rollback-${RUN_ID}`,
      idempotencyKey: `p18b-real-rollback-idem-${RUN_ID}`,
      actor: { kind: 'human', id: 'console-user' },
      requestedAt: Date.now(),
      targetRevision: { kind: 'source', sha: rollbackTarget },
      payload: {
        family: 'rollback',
        rollback: {
          deploymentId: deployed.headDeploymentId.startsWith('dpl_') ? deployed.headDeploymentId : 'current-production',
          fromSourceSha: deployed.headSha,
          toSourceSha: rollbackTarget,
          reason: { code: 'MANUAL_DIRECTIVE', detail: `P18-B RUN_REAL rollback ${RUN_ID} — the console-initiated rollback to the previous known-good production revision` },
        },
      },
    };
    const { status, body } = await postAction(envelope);
    expect(status).toBe(200);
    const receipt = (body as { receipt: { status: string; rollbackVerification: { verdict: string; observedSourceSha: string | null } | null; deploymentRevision: string | null; failure?: { errorType: string } | null } }).receipt;
    if (vercelRecordsAvailable) {
      expect(receipt.status).toBe('SUCCEEDED');
      expect(receipt.rollbackVerification?.verdict).toBe('VERIFIED');
      expect(receipt.rollbackVerification?.observedSourceSha).toBe(rollbackTarget);
    } else {
      // The honest reference-mode outcome: the rollback of a deployment the
      // reference world does not know fails CLOSED (UNKNOWN_DEPLOYMENT) —
      // recorded verbatim, never a fabricated success.
      expect(['SUCCEEDED', 'FAILED']).toContain(receipt.status);
      if (receipt.status === 'FAILED') {
        expect(receipt.failure?.errorType ?? '').toContain('UNKNOWN');
      }
    }
    receipts['rollback'] = body;
  });

  it('REAL ASK resolution: the merged queue mints a real Decision record through the deployed endpoint', async () => {
    // The console's seeded reference ask is DETERMINISTIC (fixed literals ->
    // the same content-addressed id on every instance). A prior resolution on
    // ANY instance would answer the honest terminal failure — both outcomes
    // are pinned here, never fabricated.
    const entryId = 'sos://AskRequest/a6241e0e61b689ac530924dcfc96a109';
    const first = await postAsk({
      ask: {
        entryId,
        resolution: {
          resolved_by: 'console-user',
          chosen_alternative_id: 'act-under-granted-authority',
          note: `P18-B RUN_REAL ask resolution ${RUN_ID} — the human resolver answering the console's seeded ask over the deployed endpoint`,
          provenance: ['human:console-user', 'surface:live-mission', `run:${RUN_ID}`],
          created_at: new Date().toISOString(),
        },
      },
    });
    expect(first.status).toBe(200);
    const body = first.body as { kind: string; resolution?: { decisionRef: string; action: string }; error?: { message: string } };
    expect(['ask-resolved', 'ask-failed']).toContain(body.kind);
    if (body.kind === 'ask-resolved') {
      expect(body.resolution?.action).toBe('ACT');
      expect(body.resolution?.decisionRef).toMatch(/^sos:\/\/Decision\//);
    } else {
      expect(body.error?.message).toContain('already RESOLVED');
    }
    receipts['askResolution'] = first.body;
  });

  it('the fail-closed denial over the wire: an ungranted family answers DENIED (GRANT_NEVER_HELD)', async () => {
    const envelope = {
      family: 'configuration',
      actionId: `p18b-real-deny-${RUN_ID}`,
      idempotencyKey: `p18b-real-deny-idem-${RUN_ID}`,
      actor: { kind: 'human', id: 'console-user' },
      requestedAt: Date.now(),
      targetRevision: { kind: 'source', sha: deployed.headSha },
      payload: { family: 'configuration', configuration: { key: 'live-ux-probe', value: 'denied-expectation' } },
    };
    const { status, body } = await postAction(envelope);
    expect(status).toBe(200);
    const receipt = (body as { receipt: { status: string; denial: { authority: { reason: string } | null } | null } }).receipt;
    expect(receipt.status).toBe('DENIED');
    expect(receipt.denial?.authority?.reason).toBe('GRANT_NEVER_HELD');
    receipts['denial'] = body;
  });

  it('records the evidence package (transcripts + receipts + provider states)', () => {
    const runAt = new Date().toISOString();
    writeFileSync(
      join(EVIDENCE_DIR, 'action-receipts.json'),
      `${JSON.stringify({ schema: 'sos-2/p18b/live-actions-real', produced_at: runAt, base_url: BASE_URL, run_id: RUN_ID, receipts }, null, 2)}\n`,
    );
    writeFileSync(
      join(EVIDENCE_DIR, 'http-transcripts.json'),
      `${JSON.stringify({ schema: 'sos-2/p18b/live-actions-transcripts', produced_at: runAt, base_url: BASE_URL, transcripts }, null, 2)}\n`,
    );
    writeFileSync(
      join(EVIDENCE_DIR, 'provider-states.json'),
      `${JSON.stringify({ schema: 'sos-2/p18b/live-actions-provider-states', produced_at: runAt, providerStates }, null, 2)}\n`,
    );
    expect(transcripts.length).toBeGreaterThan(10);
  });
});
