/**
 * P18-B deterministic reference-mode acceptance suite (7/8):
 * THE PROVIDER ADAPTERS — the honest four-state machine, offline.
 *
 * The console's composition-boundary adapters (the Vercel records read +
 * the OpenRouter body-model probe) answer the honest states
 * (CONNECTED / UNKNOWN / UNAVAILABLE) from REAL probes only — scripted
 * offline here with fixed literals (the P17 discipline). Never a
 * fabricated success; never health for absence of information.
 */

import { describe, expect, it } from 'vitest';
import { readVercelDeploymentRecords, pickProduction, findByCommitSha } from '@live-mission/vercel-records';
import { probeOpenRouterBodyModel } from '@live-mission/openrouter-probe';
import { vercelRecordsFetch, vercelTransportFailureFetch } from './helpers/scripted-vercel';
import { RealRecordsExecutor, RealRecordsRollbackVerifier, RealBodyLifecycleExecutor, ProviderUnavailableExecutor } from '@live-mission/live-executors';
import type { VercelDeploymentIdentity } from '@sos-2/deployment-providers';

const HEAD_SHA = '3717b6ccac8e0741e8a0eef7fd3b0aa92502f6ea';
const OLD_SHA = 'b5938ea4654144df287ce3e907389fc1f911ccf6';

describe('the Vercel records adapter (the honest four-state machine)', () => {
  it('UNKNOWN when unconfigured (missing env NAMES only — never health)', async () => {
    const result = await readVercelDeploymentRecords({ token: null, projectId: null, orgId: null, fetch: vercelRecordsFetch() });
    expect(result.state).toBe('UNKNOWN');
    expect(result.detail).toContain('VERCEL_TOKEN');
    expect(result.detail).toContain('VERCEL_PROJECT_ID');
    expect(result.deployments).toEqual([]);
  });

  it('CONNECTED when the real read answers (the records + the production pointer + the transcript)', async () => {
    const result = await readVercelDeploymentRecords({ token: 'deterministic-scripted', projectId: 'prj_deterministic_scripted', orgId: null, fetch: vercelRecordsFetch() });
    expect(result.state).toBe('CONNECTED');
    expect(result.apiRevision).toBe('vercel.v6');
    expect(result.deployments).toHaveLength(2);
    expect(result.production?.id).toBe('dpl_deterministic_head_0001');
    expect(result.requests.length).toBeGreaterThan(0); // the transcript (method + path + status)
    expect(result.requests.map((request) => request.method).every((method) => method === 'GET')).toBe(true);
  });

  it('UNAVAILABLE when the read fails (the exact error recorded verbatim)', async () => {
    const result = await readVercelDeploymentRecords({ token: 'deterministic-scripted', projectId: 'prj_deterministic_scripted', orgId: null, fetch: vercelTransportFailureFetch() });
    expect(result.state).toBe('UNAVAILABLE');
    expect(result.lastError).toContain('ENOTFOUND api.vercel.com');
    expect(result.deployments).toEqual([]);
  });

  it('picks the LATEST production record (createdAt desc) and finds by exact commit sha', () => {
    const records: readonly VercelDeploymentIdentity[] = [
      { id: 'dpl_a', url: null, readyState: 'READY', createdAt: 1, target: 'production', commitSha: 'a'.repeat(40), commitMessage: null, commitRef: null, teamId: null, projectId: null, region: null },
      { id: 'dpl_b', url: null, readyState: 'READY', createdAt: 5, target: 'production', commitSha: 'b'.repeat(40), commitMessage: null, commitRef: null, teamId: null, projectId: null, region: null },
      { id: 'dpl_c', url: null, readyState: 'READY', createdAt: 9, target: null, commitSha: 'c'.repeat(40), commitMessage: null, commitRef: null, teamId: null, projectId: null, region: null },
    ];
    expect(pickProduction(records)?.id).toBe('dpl_b');
    expect(findByCommitSha(records, 'b'.repeat(40))?.id).toBe('dpl_b');
    expect(findByCommitSha(records, 'z'.repeat(40))).toBeNull();
  });
});

describe('the OpenRouter body-model probe adapter', () => {
  it('UNKNOWN when unconfigured (missing env NAME only)', async () => {
    const result = await probeOpenRouterBodyModel({ apiKey: null });
    expect(result.state).toBe('UNKNOWN');
    expect(result.detail).toContain('BODY_PROVIDER_API_KEY');
  });

  it('CONNECTED when the provider answers (the real provider facts recorded)', async () => {
    const result = await probeOpenRouterBodyModel({
      apiKey: 'sk-or-v1-deterministic-scripted-not-a-real-credential',
      modelPort: {
        complete: () =>
          Promise.resolve({
            ok: true,
            response: { id: 'resp-probe-0001', model: 'qwen/qwen3-coder-flash', content: 'ready', finish_reason: 'stop', usage: { prompt_tokens: 12, completion_tokens: 1, total_tokens: 13 } },
          }),
      },
    });
    expect(result.state).toBe('CONNECTED');
    expect(result.response?.id).toBe('resp-probe-0001');
    expect(result.response?.model).toBe('qwen/qwen3-coder-flash');
    expect(result.detail).toContain('resp-probe-0001');
  });

  it('UNAVAILABLE when the provider fails (the typed error — never a fabricated session)', async () => {
    const result = await probeOpenRouterBodyModel({
      apiKey: 'sk-or-v1-deterministic-scripted-not-a-real-credential',
      modelPort: {
        complete: () =>
          Promise.resolve({
            ok: false,
            error: { status: 401, kind: 'AUTH' as const, message: 'invalid api key (scripted)' },
          }),
      },
    });
    expect(result.state).toBe('UNAVAILABLE');
    expect(result.error?.kind).toBe('AUTH');
    expect(result.error?.status).toBe(401);
  });

  it('requests the bounded probe (16 tokens, temperature 0 — the cheapest real answer)', async () => {
    let seen: { max_tokens: number | null; temperature: number | null; model: string } | null = null;
    await probeOpenRouterBodyModel({
      apiKey: 'sk-or-v1-deterministic-scripted-not-a-real-credential',
      modelPort: {
        complete: (request) => {
          seen = { max_tokens: request.max_tokens, temperature: request.temperature, model: request.model };
          return Promise.resolve({ ok: true, response: { id: 'r', model: request.model, content: 'ready', finish_reason: 'stop', usage: null } });
        },
      },
    });
    expect(seen).toMatchObject({ max_tokens: 16, temperature: 0, model: 'qwen/qwen3-coder-flash' });
  });
});

describe('the real records executor (Vercel-bound transitions)', () => {
  const records: readonly VercelDeploymentIdentity[] = [
    { id: 'dpl_head', url: null, readyState: 'READY', createdAt: 2, target: 'production', commitSha: HEAD_SHA, commitMessage: null, commitRef: null, teamId: null, projectId: null, region: null },
    { id: 'dpl_old', url: null, readyState: 'READY', createdAt: 1, target: 'production', commitSha: OLD_SHA, commitMessage: null, commitRef: null, teamId: null, projectId: null, region: null },
  ];

  it('promotes a REALLY-deployed revision (the receipt deployment id is the real dpl id)', () => {
    const pointers = new Map();
    const executor = new RealRecordsExecutor(records, pointers, records[0]!, '2026-09-26T00:00:00.000Z');
    const result = executor.execute({ op: 'promotion.apply', fromEnvironment: 'staging', toEnvironment: 'production', sourceSha: HEAD_SHA }, { actionId: 'a', idempotencyKey: 'k', actor: { kind: 'human', id: 'console-user' }, targetRevision: { kind: 'source', sha: HEAD_SHA }, at: 0 });
    expect(result).toMatchObject({ status: 'ok', output: { produced: { deploymentId: 'dpl_head', sourceSha: HEAD_SHA, previousDeploymentId: 'dpl_head' } } });
    expect(pointers.get('production')).toMatchObject({ deploymentId: 'dpl_head', sourceSha: HEAD_SHA });
  });

  it('fails CLOSED for a never-deployed revision (NO_REAL_DEPLOYMENT_FOR_SHA)', () => {
    const executor = new RealRecordsExecutor(records, new Map(), null, '2026-09-26T00:00:00.000Z');
    const result = executor.execute({ op: 'promotion.apply', fromEnvironment: 'staging', toEnvironment: 'production', sourceSha: 'z'.repeat(40) }, { actionId: 'a', idempotencyKey: 'k', actor: { kind: 'human', id: 'console-user' }, targetRevision: { kind: 'source', sha: 'z'.repeat(40) }, at: 0 });
    expect(result).toMatchObject({ status: 'error', errorType: 'NO_REAL_DEPLOYMENT_FOR_SHA' });
  });

  it('rolls back to a REALLY-deployed revision with the previous pointer recorded', () => {
    const pointers = new Map();
    const executor = new RealRecordsExecutor(records, pointers, records[0]!, '2026-09-26T00:00:00.000Z');
    const result = executor.execute({ op: 'rollback.apply', deploymentId: 'dpl_head', fromSourceSha: HEAD_SHA, toSourceSha: OLD_SHA, reason: { code: 'MANUAL_DIRECTIVE', detail: 'deterministic' } }, { actionId: 'a', idempotencyKey: 'k', actor: { kind: 'human', id: 'console-user' }, targetRevision: { kind: 'source', sha: OLD_SHA }, at: 0 });
    expect(result).toMatchObject({ status: 'ok', output: { produced: { deploymentId: 'dpl_old', rolledBackFromDeploymentId: 'dpl_head' } } });
    expect(pointers.get('production')).toMatchObject({ deploymentId: 'dpl_old', sourceSha: OLD_SHA, rolledBackFrom: 'dpl_head' });
  });

  it('the rollback verifier answers VERIFIED / UNKNOWN from the real records', () => {
    const verifier = new RealRecordsRollbackVerifier(records);
    expect(verifier.verify('dpl_old', OLD_SHA)).toMatchObject({ verdict: 'VERIFIED', observedSourceSha: OLD_SHA });
    expect(verifier.verify('dpl_old', HEAD_SHA)).toMatchObject({ verdict: 'FAILED' });
    expect(verifier.verify('dpl_unknown', OLD_SHA)).toMatchObject({ verdict: 'UNKNOWN', observedSourceSha: null });
  });
});

describe('the real body-lifecycle executor (OpenRouter-backed sessions)', () => {
  const connectedProbe = {
    state: 'CONNECTED' as const,
    detail: 'scripted probe answered',
    response: { id: 'resp-1', model: 'qwen/qwen3-coder-flash', content: 'ready', finish_reason: 'stop', usage: { prompt_tokens: 12, completion_tokens: 1, total_tokens: 13 } },
    error: null,
    apiRevision: 'openrouter.v1',
  };
  const unavailableProbe = {
    state: 'UNAVAILABLE' as const,
    detail: 'scripted provider failure',
    response: null,
    error: { status: 0, kind: 'NETWORK' as const, message: 'ENOTFOUND openrouter.ai (scripted)' },
    apiRevision: 'openrouter.v1',
  };

  it('starts a session with the provider facts when the probe answered (never a fabricated RUNNING)', () => {
    const sessions = new Map();
    const executor = new RealBodyLifecycleExecutor(sessions, connectedProbe, '2026-09-26T00:00:00.000Z');
    const result = executor.execute({ op: 'body.start', bodyId: 'body-1' }, { actionId: 'a', idempotencyKey: 'k', actor: { kind: 'human', id: 'console-user' }, targetRevision: { kind: 'source', sha: 's' }, at: 0 });
    expect(result).toMatchObject({ status: 'ok', output: { produced: { bodyId: 'body-1', state: 'RUNNING', provider: 'openrouter', modelResponseId: 'resp-1', servedModel: 'qwen/qwen3-coder-flash' } } });
    expect(sessions.get('body-1')).toMatchObject({ state: 'RUNNING', startedAt: '2026-09-26T00:00:00.000Z' });
  });

  it('FAILS honestly when the provider did not answer (PROVIDER_UNAVAILABLE — the body was NOT summoned)', () => {
    const sessions = new Map();
    const executor = new RealBodyLifecycleExecutor(sessions, unavailableProbe, '2026-09-26T00:00:00.000Z');
    const result = executor.execute({ op: 'body.start', bodyId: 'body-1' }, { actionId: 'a', idempotencyKey: 'k', actor: { kind: 'human', id: 'console-user' }, targetRevision: { kind: 'source', sha: 's' }, at: 0 });
    expect(result).toMatchObject({ status: 'error', errorType: 'PROVIDER_UNAVAILABLE', retryable: true });
    expect(sessions.size).toBe(0); // never a fabricated RUNNING session
  });

  it('answers UNKNOWN_BODY honestly for lifecycle operations without a live session', () => {
    const executor = new RealBodyLifecycleExecutor(new Map(), connectedProbe, '2026-09-26T00:00:00.000Z');
    const result = executor.execute({ op: 'body.pause', bodyId: 'body-none' }, { actionId: 'a', idempotencyKey: 'k', actor: { kind: 'human', id: 'console-user' }, targetRevision: { kind: 'source', sha: 's' }, at: 0 });
    expect(result).toMatchObject({ status: 'error', errorType: 'UNKNOWN_BODY', retryable: false });
  });
});

describe('the fail-closed provider executor (UNAVAILABLE — no fake confirmations)', () => {
  it('answers the typed error for every family it covers', () => {
    const executor = new ProviderUnavailableExecutor(['promotion', 'rollback', 'deployment'], 'VERCEL_RECORDS_UNAVAILABLE', 'scripted failure');
    for (const operation of [
      { op: 'promotion.apply' as const, fromEnvironment: 'staging', toEnvironment: 'production', sourceSha: 's' },
      { op: 'rollback.apply' as const, deploymentId: 'd', fromSourceSha: 'a', toSourceSha: 'b', reason: { code: 'MANUAL_DIRECTIVE' as const, detail: 'x' } },
    ]) {
      const result = executor.execute(operation, { actionId: 'a', idempotencyKey: 'k', actor: { kind: 'human', id: 'console-user' }, targetRevision: { kind: 'source', sha: 's' }, at: 0 });
      expect(result).toMatchObject({ status: 'error', errorType: 'VERCEL_RECORDS_UNAVAILABLE', retryable: true });
    }
  });
});
