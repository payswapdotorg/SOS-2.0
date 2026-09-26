/**
 * THE REAL-EXECUTOR SYNC BRIDGE (Work Order P18-B): binds REAL async
 * providers behind the merged action gateway's SYNCHRONOUS executor seam
 * without touching the frozen gateway contract (the P8 discipline: "real
 * providers attach later as adapters behind this seam, never as
 * authorities" — this module is exactly such an adapter).
 *
 * Mechanism: a worker thread owns every real HTTP round-trip; the sync
 * `execute()`/`verify()` calls hand the operation to the worker and block
 * on a SharedArrayBuffer until the worker writes the JSON result and
 * notifies (Atomics). The result region is fixed-capacity; every failure
 * (timeout, bridge unavailable, provider error) is a TYPED honest
 * failure — never a fabricated success.
 *
 * Ordering invariants preserved BY CONSTRUCTION: the real provider calls
 * happen ONLY inside the executor/verifier seams — i.e. strictly AFTER
 * the gateway's single CURRENT authority evaluation at action time
 * (fail-closed: a denied action never reaches a provider), and before
 * evidence emission.
 */

import { Worker } from 'node:worker_threads';
import type { ActionExecutor, ActionOperation, ExecutionContext, ExecutionResult, RollbackVerifier, RollbackVerifierObservation } from '@sos-2/action-gateway';
import type { Timestamp } from '@sos-2/action-gateway';

/** The provider configuration handed to the worker (values env-only; never echoed). */
export interface RealProviderConfig {
  readonly openRouter: { readonly apiKey: string; readonly model: string; readonly apiBase: string; readonly timeoutMs: number } | null;
  readonly vercel: {
    readonly token: string;
    readonly projectId: string;
    readonly teamId: string | null;
    readonly repoId: number | null;
    readonly target: 'preview' | 'production';
    readonly apiBase: string;
    readonly timeoutMs: number;
  } | null;
  readonly github: { readonly token: string; readonly apiBase: string; readonly owner: string; readonly repo: string; readonly timeoutMs: number } | null;
}

/** What the worker executes. */
export type BridgeJob =
  | { readonly kind: 'execute'; readonly operation: ActionOperation; readonly context: ExecutionContext }
  | { readonly kind: 'verify'; readonly deploymentId: string; readonly expectedSourceSha: string };

/** The worker's answer (JSON-serialized through the SharedArrayBuffer). */
export interface BridgeJobResult {
  readonly ok: boolean;
  readonly result?: ExecutionResult | RollbackVerifierObservation;
  readonly errorType?: string;
  readonly message?: string;
}

/** The SAB protocol: [0]=status(0 pending,1 done), [1]=byte length, payload from offset 8. */
const SAB_HEADER_BYTES = 8;
const SAB_CAPACITY_BYTES = 512 * 1024;

const WORKER_SOURCE = `
'use strict';
const { parentPort } = require('node:worker_threads');
let config = null;
parentPort.on('message', (message) => {
  if (message.init !== undefined) { config = message.init; parentPort.postMessage({ ack: true }); return; }
  runJob(message.job, message.sab).then((result) => writeResult(message.sab, result));
});
function writeResult(sab, result) {
  const bytes = Buffer.from(JSON.stringify(result), 'utf8');
  const header = new Int32Array(sab, 0, 2);
  if (bytes.length > sab.byteLength - 8) {
    header[1] = 0;
    Atomics.store(header, 0, 2); // 2 = error marker (oversized)
    Atomics.notify(header, 0);
    return;
  }
  new Uint8Array(sab, 8, bytes.length).set(bytes);
  Atomics.store(header, 1, bytes.length);
  Atomics.store(header, 0, 1);
  Atomics.notify(header, 0);
}
async function runJob(job, sab) {
  try {
    if (config === null) return { ok: false, errorType: 'BRIDGE_NOT_CONFIGURED', message: 'the bridge worker has no provider configuration' };
    if (job.kind === 'verify') return { ok: true, result: await verifyDeployment(job.deploymentId, job.expectedSourceSha) };
    return { ok: true, result: await executeOperation(job.operation, job.context) };
  } catch (error) {
    return { ok: false, errorType: 'PROVIDER_TRANSPORT_FAILURE', message: String(error && error.message ? error.message : error) };
  }
}
async function timedFetch(url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const text = await response.text();
    let body = null;
    try { body = text.length > 0 ? JSON.parse(text) : null; } catch { body = text.slice(0, 2000); }
    return { status: response.status, ok: response.ok, body, headers: Object.fromEntries(response.headers) };
  } finally { clearTimeout(timer); }
}
function errorSnippet(body) {
  if (body === null || typeof body !== 'object') return '';
  const error = body.error;
  if (error === null || typeof error !== 'object') return '';
  return ' provider said: ' + JSON.stringify(error).slice(0, 220);
}
async function githubCommitUrl(sha) {
  if (config.github === null) return null;
  const g = config.github;
  const response = await timedFetch(g.apiBase + '/repos/' + g.owner + '/' + g.repo + '/commits/' + sha, { headers: { Authorization: 'Bearer ' + g.token, Accept: 'application/vnd.github+json' } }, g.timeoutMs);
  if (response.status === 404) throw { code: 'TARGET_REVISION_NOT_FOUND', message: 'commit ' + sha + ' does not exist in ' + g.owner + '/' + g.repo + ' (HTTP 404) — the acted-on revision must be real, never fabricated' };
  if (!response.ok) throw { code: 'GITHUB_BINDING_PROBE_FAILED', message: 'github revision-binding probe answered HTTP ' + response.status };
  return 'https://github.com/' + g.owner + '/' + g.repo + '/commit/' + sha;
}
async function executeOperation(operation, context) {
  const op = operation.op;
  if (op === 'body.start') {
    if (config.openRouter === null) return { status: 'error', errorType: 'PROVIDER_NOT_CONNECTED', message: 'no OpenRouter body provider configured (BODY_PROVIDER_API_KEY absent) — the body summon honestly did not run', retryable: false };
    const o = config.openRouter;
    const commitUrl = await githubCommitUrl(context.targetRevision.sha).catch((error) => { throw error; });
    const response = await timedFetch(o.apiBase + '/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + o.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: o.model, max_tokens: 32, messages: [
        { role: 'system', content: 'You are an SOS execution body confirming a lease start. Reply with one short readiness line.' },
        { role: 'user', content: 'Body ' + operation.bodyId + ' lease start for source ' + context.targetRevision.sha + ' (action ' + context.actionId + '). Confirm readiness.' },
      ] }),
    }, o.timeoutMs);
    if (!response.ok) return { status: 'error', errorType: 'BODY_PROVIDER_UNAVAILABLE', message: 'OpenRouter answered HTTP ' + response.status + ' — the real provider failure is the honest record', retryable: true };
    const providerState = 'CONNECTED';
    return { status: 'ok', output: { produced: { bodyId: operation.bodyId, state: 'RUNNING', provider: 'openrouter', apiRevision: 'openrouter.v1', model: o.model, providerState, commitUrl: commitUrl === null ? 'unverified' : commitUrl, leaseScope: 'in-process' } } };
  }
  if (op === 'body.pause' || op === 'body.resume' || op === 'body.cancel' || op === 'body.replace') {
    return { status: 'error', errorType: 'PROVIDER_OPERATION_UNSUPPORTED', message: 'the OpenRouter body provider is stateless — only body.start performs a real provider round-trip; ' + op + ' honestly does not run', retryable: false };
  }
  if (op === 'promotion.apply' || op === 'deployment.apply') {
    if (config.vercel === null) return { status: 'error', errorType: 'PROVIDER_NOT_CONNECTED', message: 'no Vercel deployment provider configured (VERCEL_TOKEN/VERCEL_PROJECT_ID absent) — the promotion honestly did not run', retryable: false };
    const v = config.vercel;
    if (v.repoId === null) return { status: 'error', errorType: 'PROVIDER_NOT_CONNECTED', message: 'the Vercel project carries no linked repoId — git deployments cannot be created', retryable: false };
    const environment = op === 'promotion.apply' ? operation.toEnvironment : operation.environment;
    const sourceSha = op === 'promotion.apply' ? operation.sourceSha : operation.sourceSha;
    const commitUrl = await githubCommitUrl(sourceSha);
    const target = environment === 'production' && v.target === 'production' ? 'production' : 'preview';
    const response = await timedFetch(v.apiBase + '/v13/deployments?teamId=' + (v.teamId === null ? 'null' : v.teamId) + '&skipAutoDetectionConfirmation=1', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + v.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'sos-2-0', project: v.projectId, gitSource: { type: 'github', repoId: v.repoId, ref: sourceSha }, target: target }),
    }, v.timeoutMs);
    if (!response.ok) return { status: 'error', errorType: 'DEPLOYMENT_PROVIDER_FAILURE', message: 'Vercel POST /v13/deployments answered HTTP ' + response.status + ' — the real provider failure is the honest record' + errorSnippet(response.body), retryable: true };
    const deployment = response.body;
    return { status: 'ok', output: { produced: { deploymentId: deployment.id, url: deployment.url, readyState: deployment.readyState, target: target, environment: environment, sourceSha: sourceSha, provider: 'vercel', apiRevision: 'vercel.v13', commitUrl: commitUrl === null ? 'unverified' : commitUrl, note: 'deployment created (readiness not awaited inline — the deployment id is the real provider record)' } } };
  }
  if (op === 'rollback.apply') {
    if (config.vercel === null) return { status: 'error', errorType: 'PROVIDER_NOT_CONNECTED', message: 'no Vercel deployment provider configured — the rollback honestly did not run', retryable: false };
    const v = config.vercel;
    const listing = await timedFetch(v.apiBase + '/v6/deployments?projectId=' + v.projectId + '&teamId=' + (v.teamId === null ? 'null' : v.teamId) + '&limit=20&state=READY', { headers: { Authorization: 'Bearer ' + v.token } }, v.timeoutMs);
    if (!listing.ok) return { status: 'error', errorType: 'DEPLOYMENT_PROVIDER_FAILURE', message: 'Vercel GET /v6/deployments answered HTTP ' + listing.status + ' — cannot resolve the rollback target honestly', retryable: true };
    const deployments = (listing.body && listing.body.deployments) || [];
    const current = deployments.find((d) => d.target === 'production') || null;
    const restore = deployments.find((d) => d.target === 'production' && d.meta && typeof d.meta.githubCommitSha === 'string' && d.meta.githubCommitSha === operation.toSourceSha) || null;
    if (restore !== null && restore.id !== current.id) {
      const response = await timedFetch(v.apiBase + '/v13/deployments/' + restore.id + '/rollback?teamId=' + (v.teamId === null ? 'null' : v.teamId), {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + v.token, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }, v.timeoutMs);
      if (!response.ok) return { status: 'error', errorType: 'DEPLOYMENT_PROVIDER_FAILURE', message: 'Vercel POST /v13/deployments/' + restore.id + '/rollback answered HTTP ' + response.status + ' — the real provider failure is the honest record' + errorSnippet(response.body), retryable: true };
      return { status: 'ok', output: { produced: { deploymentId: restore.id, url: restore.url, readyState: 'READY', strategy: 'vercel-instant-rollback', fromSourceSha: operation.fromSourceSha, toSourceSha: operation.toSourceSha, provider: 'vercel', apiRevision: 'vercel.v13', note: 'rolled back to the prior READY production deployment serving ' + operation.toSourceSha } } };
    }
    if (v.repoId === null) return { status: 'error', errorType: 'DEPLOYMENT_PROVIDER_FAILURE', message: 'no READY production deployment serves ' + operation.toSourceSha + ' and the project carries no repoId for a restore deployment', retryable: false };
    const response = await timedFetch(v.apiBase + '/v13/deployments?teamId=' + (v.teamId === null ? 'null' : v.teamId) + '&skipAutoDetectionConfirmation=1', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + v.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'sos-2-0', project: v.projectId, gitSource: { type: 'github', repoId: v.repoId, ref: operation.toSourceSha }, target: 'production' }),
    }, v.timeoutMs);
    if (!response.ok) return { status: 'error', errorType: 'DEPLOYMENT_PROVIDER_FAILURE', message: 'Vercel restore-deployment answered HTTP ' + response.status + ' — the real provider failure is the honest record' + errorSnippet(response.body), retryable: true };
    return { status: 'ok', output: { produced: { deploymentId: response.body.id, url: response.body.url, readyState: response.body.readyState, strategy: 'git-restore-deployment', fromSourceSha: operation.fromSourceSha, toSourceSha: operation.toSourceSha, provider: 'vercel', apiRevision: 'vercel.v13', note: 'no READY production deployment served ' + operation.toSourceSha + ' — a git restore deployment was created instead (recorded honestly)' } } };
  }
  return { status: 'error', errorType: 'PROVIDER_OPERATION_UNSUPPORTED', message: 'no real provider is bound for operation ' + op + ' on the live-mission endpoint', retryable: false };
}
async function verifyDeployment(deploymentId, expectedSourceSha) {
  if (config.vercel === null) return { verdict: 'UNKNOWN', observedSourceSha: null, limitation: 'no Vercel provider configured — no rollback verification possible' };
  const v = config.vercel;
  const response = await timedFetch(v.apiBase + '/v13/deployments/' + deploymentId + '?teamId=' + (v.teamId === null ? 'null' : v.teamId), { headers: { Authorization: 'Bearer ' + v.token } }, v.timeoutMs);
  if (!response.ok) return { verdict: 'UNKNOWN', observedSourceSha: null, limitation: 'GET deployment answered HTTP ' + response.status + ' — UNKNOWN stays UNKNOWN' };
  const deployment = response.body;
  const observed = deployment.gitSource && typeof deployment.gitSource.sha === 'string' ? deployment.gitSource.sha : (deployment.meta && typeof deployment.meta.githubCommitSha === 'string' ? deployment.meta.githubCommitSha : null);
  if (deployment.readyState !== 'READY') return { verdict: 'UNKNOWN', observedSourceSha: observed, limitation: 'deployment readyState is ' + deployment.readyState + ' at verification time — not yet verified, never folded into success' };
  if (observed === expectedSourceSha) return { verdict: 'VERIFIED', observedSourceSha: observed, limitation: null };
  return { verdict: 'FAILED', observedSourceSha: observed, limitation: 'observed ' + observed + ', expected ' + expectedSourceSha };
}
`;

export interface SyncProviderBridge {
  readonly executor: ActionExecutor;
  readonly verifier: RollbackVerifier;
  /** True when the worker bridge is live (honest capability report). */
  readonly live: boolean;
  close(): void;
}

/**
 * Create the sync bridge over real providers. When worker threads or
 * SharedArrayBuffer are unavailable in the runtime, the returned bridge
 * reports live=false and every operation fails with the typed honest
 * BRIDGE_UNAVAILABLE error (never a fabricated provider outcome).
 */
export function createSyncProviderBridge(config: RealProviderConfig, options: { readonly families?: readonly ('body-lifecycle' | 'promotion' | 'rollback' | 'deployment')[]; readonly timeoutMs?: number } = {}): SyncProviderBridge {
  const families = options.families ?? ['body-lifecycle', 'promotion', 'rollback', 'deployment'];
  const timeoutMs = options.timeoutMs ?? 20_000;
  let worker: Worker | null = null;
  let configured = false;
  try {
    worker = new Worker(WORKER_SOURCE, { eval: true });
  } catch {
    worker = null;
  }
  if (worker !== null) {
    worker.unref();
    const init = worker.postMessage({ init: config });
    void init;
    configured = true;
  }

  function run(job: BridgeJob): BridgeJobResult {
    if (worker === null) {
      return { ok: false, errorType: 'BRIDGE_UNAVAILABLE', message: 'the worker-thread bridge could not start in this runtime — the real provider honestly did not run' };
    }
    const sab = new SharedArrayBuffer(SAB_HEADER_BYTES + SAB_CAPACITY_BYTES);
    const header = new Int32Array(sab, 0, 2);
    header[0] = 0;
    worker.postMessage({ job, sab });
    const status = Atomics.wait(header, 0, 0, timeoutMs);
    if (status !== 'ok' && Atomics.load(header, 0) === 0) {
      return { ok: false, errorType: 'BRIDGE_TIMEOUT', message: `the real provider round-trip did not answer within ${String(timeoutMs)}ms — treated as a typed honest failure (never a fabricated success)` };
    }
    if (Atomics.load(header, 0) === 2) {
      return { ok: false, errorType: 'BRIDGE_RESULT_OVERSIZED', message: 'the provider result exceeded the bridge capacity — treated as a typed honest failure' };
    }
    const length = Atomics.load(header, 1);
    if (length <= 0) {
      return { ok: false, errorType: 'BRIDGE_PROTOCOL_FAILURE', message: 'the bridge worker returned an empty result — treated as a typed honest failure' };
    }
    const bytes = new Uint8Array(sab, SAB_HEADER_BYTES, length);
    const text = Buffer.from(bytes).toString('utf8');
    try {
      return JSON.parse(text) as BridgeJobResult;
    } catch {
      return { ok: false, errorType: 'BRIDGE_PROTOCOL_FAILURE', message: 'the bridge worker returned a non-JSON result — treated as a typed honest failure' };
    }
  }

  const executor: ActionExecutor = {
    families,
    execute(operation: ActionOperation, context: ExecutionContext): ExecutionResult {
      const outcome = run({ kind: 'execute', operation, context });
      if (!outcome.ok) {
        return { status: 'error', errorType: outcome.errorType ?? 'BRIDGE_FAILURE', message: outcome.message ?? 'the sync provider bridge failed', retryable: false };
      }
      const result = outcome.result as ExecutionResult | undefined;
      if (result === undefined || (result.status !== 'ok' && result.status !== 'error')) {
        return { status: 'error', errorType: 'BRIDGE_PROTOCOL_FAILURE', message: 'the bridge returned a malformed execution result', retryable: false };
      }
      return result;
    },
  };

  const verifier: RollbackVerifier = {
    verify(deploymentId: string, expectedSourceSha: string, _at: Timestamp): RollbackVerifierObservation {
      const outcome = run({ kind: 'verify', deploymentId, expectedSourceSha });
      if (!outcome.ok) {
        return { verdict: 'UNKNOWN', observedSourceSha: null, limitation: `${outcome.errorType ?? 'BRIDGE_FAILURE'}: ${outcome.message ?? 'the bridge failed'} — UNKNOWN stays UNKNOWN` };
      }
      const result = outcome.result as RollbackVerifierObservation | undefined;
      if (result === undefined || (result.verdict !== 'VERIFIED' && result.verdict !== 'FAILED' && result.verdict !== 'UNKNOWN')) {
        return { verdict: 'UNKNOWN', observedSourceSha: null, limitation: 'the bridge returned a malformed verification result — UNKNOWN stays UNKNOWN' };
      }
      return result;
    },
  };

  return {
    executor,
    verifier,
    live: configured,
    close(): void {
      worker?.terminate().catch(() => undefined);
    },
  };
}
