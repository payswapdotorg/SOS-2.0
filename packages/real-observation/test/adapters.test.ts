/**
 * Deterministic reference-mode unit tests for @sos-2/real-observation
 * (Work Order P17-C). ZERO NETWORK: every adapter runs against a
 * scripted FetchPort; every clock is a ManualClock. The full
 * source→plane→System-State acceptance suite lives in
 * tests/real-observation (@sos-2/tests-real-observation); these unit
 * tests pin the adapters' mapping and the honest-state machine.
 */

import { describe, expect, it } from 'vitest';
import { ManualClock, createInMemoryLiveStore } from '@sos-2/live-store';
import type { Clock } from '@sos-2/live-store';
import { EventIngestionPipeline } from '@sos-2/event-ingestion';
import type { EventIngestionPipeline as Pipeline } from '@sos-2/event-ingestion';
import {
  ConnectivityTracker,
  GitHubCiSource,
  GitHubEventsSource,
  GitHubWebhookReceiver,
  ProviderHealthSource,
  TranscriptRecorder,
  VercelDeploymentsSource,
  classifyProbe,
  expectedSignature,
  mapRestEventItem,
  mapVercelDeployment,
  mapWorkflowRun,
  normalizeWebhookDelivery,
  redactObservationSecrets,
  signalStatusFor,
} from '../src/index.js';
import type { FetchPort, HttpRequest, HttpResponse } from '../src/index.js';

const CLOCK_AT = Date.parse('2026-09-25T12:00:00Z');

function clock(): Clock {
  return new ManualClock(CLOCK_AT);
}

/** A scripted FetchPort: routes by url substring, in order. */
function scriptedFetch(routes: readonly { match: string; response: HttpResponse }[], callsOut?: HttpRequest[]): FetchPort {
  return async (request: HttpRequest): Promise<HttpResponse> => {
    callsOut?.push(request);
    const route = routes.find((candidate) => request.url.includes(candidate.match));
    if (route === undefined) {
      throw new Error(`no scripted route for ${request.url}`);
    }
    return route.response;
  };
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): HttpResponse {
  return { status, headers: { 'x-github-media-type': 'github.v3; format=json', ...headers }, body: JSON.stringify(body) };
}

describe('the honest connectivity state machine', () => {
  it('reports UNKNOWN for a source that was never probed', () => {
    const tracker = new ConnectivityTracker();
    expect(tracker.recordFor('github:rest-events:x/y').state).toBe('UNKNOWN');
    expect(tracker.recordFor('github:rest-events:x/y').lastProbedAt).toBeNull();
  });

  it('reports CONNECTED only from a real successful probe', () => {
    const tracker = new ConnectivityTracker();
    tracker.record('s', 'github', { provider: 'github', endpoint: '/e', method: 'GET', at: '2026-09-25T12:00:00Z', status: 200, ok: true, failure: null, apiRevision: 'github.v3' });
    expect(tracker.recordFor('s').state).toBe('CONNECTED');
    expect(tracker.recordFor('s').lastError).toBeNull();
  });

  it('reports UNAVAILABLE with the real error recorded for a failed probe', () => {
    const tracker = new ConnectivityTracker();
    tracker.record('s', 'vercel', { provider: 'vercel', endpoint: '/v6/deployments', method: 'GET', at: '2026-09-25T12:00:00Z', status: 401, ok: false, failure: 'HTTP 401: authentication failed', apiRevision: 'vercel.v6' });
    const record = tracker.recordFor('s');
    expect(record.state).toBe('UNAVAILABLE');
    expect(record.lastError).toBe('HTTP 401: authentication failed');
    expect(record.lastProbedAt).toBe('2026-09-25T12:00:00Z');
  });

  it('reports DEGRADED for a throttled probe (429), distinct from UNAVAILABLE', () => {
    expect(classifyProbe({ provider: 'github', endpoint: '/e', method: 'GET', at: '2026-09-25T12:00:00Z', status: 429, ok: false, failure: 'rate limited', apiRevision: 'github.v3' })).toBe('DEGRADED');
    expect(classifyProbe({ provider: 'github', endpoint: '/e', method: 'GET', at: '2026-09-25T12:00:00Z', status: 500, ok: false, failure: 'boom', apiRevision: 'github.v3' })).toBe('UNAVAILABLE');
    expect(classifyProbe({ provider: 'github', endpoint: '/e', method: 'GET', at: '2026-09-25T12:00:00Z', status: 200, ok: false, failure: 'shape', apiRevision: 'github.v3' })).toBe('UNAVAILABLE');
  });

  it('aggregates per provider: worst probed state wins, no probes is UNKNOWN', () => {
    const tracker = new ConnectivityTracker();
    tracker.record('a', 'github', { provider: 'github', endpoint: '/a', method: 'GET', at: '2026-09-25T12:00:00Z', status: 200, ok: true, failure: null, apiRevision: 'github.v3' });
    tracker.record('b', 'github', { provider: 'github', endpoint: '/b', method: 'GET', at: '2026-09-25T12:00:01Z', status: 403, ok: false, failure: 'HTTP 403', apiRevision: 'github.v3' });
    expect(tracker.providerState('github').state).toBe('UNAVAILABLE');
    expect(tracker.providerState('vercel').state).toBe('UNKNOWN');
  });
});

describe('GitHub REST events mapping (the polling fallback shape)', () => {
  it('maps a PushEvent to the github.push envelope payload', () => {
    const mapped = mapRestEventItem({
      id: '22146051554',
      type: 'PushEvent',
      created_at: '2026-09-25T07:37:48Z',
      payload: { ref: 'refs/heads/main', head: '711cfd60b7eb90b338a8ce17cadcafb72a0d1e6e', before: '19c1bf26fdd2a23aabb9df2ae0f8a07095684ed4' },
    });
    expect(mapped).toEqual({
      externalId: '22146051554',
      kind: 'github.push',
      occurredAt: '2026-09-25T07:37:48Z',
      payload: { ref: 'refs/heads/main', before: '19c1bf26fdd2a23aabb9df2ae0f8a07095684ed4', after: '711cfd60b7eb90b338a8ce17cadcafb72a0d1e6e' },
    });
  });

  it('maps a PullRequestEvent to the github.pull_request envelope payload', () => {
    const mapped = mapRestEventItem({
      id: '22146051555',
      type: 'PullRequestEvent',
      created_at: '2026-09-25T07:40:00Z',
      payload: { action: 'opened', number: 42, pull_request: { head: { sha: 'headsha' }, base: { ref: 'main' } } },
    });
    expect(mapped).toEqual({
      externalId: '22146051555',
      kind: 'github.pull_request',
      occurredAt: '2026-09-25T07:40:00Z',
      payload: { action: 'opened', number: 42, head: 'headsha', base: 'main' },
    });
  });

  it('does not map non-revision event types (honest: nothing projected, nothing lost)', () => {
    expect(mapRestEventItem({ id: '1', type: 'WatchEvent', created_at: '2026-09-25T07:00:00Z', payload: {} })).toBeNull();
    expect(mapRestEventItem({ id: '2', type: 'CreateEvent', created_at: '2026-09-25T07:00:00Z', payload: { ref: 'x', ref_type: 'branch' } })).toBeNull();
  });

  it('polls the real endpoint through the injected FetchPort and produces envelopes', async () => {
    const tracker = new ConnectivityTracker();
    const transcript = new TranscriptRecorder();
    const calls: HttpRequest[] = [];
    const source = new GitHubEventsSource({
      config: { owner: 'payswapdotorg', repo: 'SOS-2.0', token: 'ghp_test', tokenEnvName: 'PAYSWAP_GITHUB_TOKEN' },
      fetch: scriptedFetch([
        {
          match: '/repos/payswapdotorg/SOS-2.0/events',
          response: json(200, [
            { id: 'e1', type: 'PushEvent', created_at: '2026-09-25T07:37:48Z', payload: { ref: 'refs/heads/main', head: 'aaa', before: 'bbb' } },
            { id: 'e2', type: 'WatchEvent', created_at: '2026-09-25T07:38:00Z', payload: {} },
          ]),
        },
      ], calls),
      clock: clock(),
      tracker,
      transcript,
    });
    const envelopes = await source.poll();
    expect(envelopes).toHaveLength(1);
    expect(envelopes[0]!.kind).toBe('github.push');
    expect(calls[0]!.headers['authorization']).toBe('Bearer ghp_test');
    expect(tracker.recordFor(source.sourceId()).state).toBe('CONNECTED');
  });

  it('throws with the real reason on a 401 (typed POLL_FAILED upstream; UNAVAILABLE recorded)', async () => {
    const tracker = new ConnectivityTracker();
    const source = new GitHubEventsSource({
      config: { owner: 'o', repo: 'r', token: 'bad', tokenEnvName: 'PAYSWAP_GITHUB_TOKEN' },
      fetch: scriptedFetch([{ match: '/events', response: json(401, { message: 'Bad credentials' }) }]),
      clock: clock(),
      tracker,
      transcript: new TranscriptRecorder(),
    });
    await expect(source.poll()).rejects.toThrow('HTTP 401');
    const record = tracker.recordFor(source.sourceId());
    expect(record.state).toBe('UNAVAILABLE');
    expect(record.lastError).toContain('HTTP 401');
  });
});

describe('GitHub Actions CI mapping (per commit, status verbatim)', () => {
  it('maps a completed run to its conclusion uppercased, and in-progress runs to their status', () => {
    expect(
      mapWorkflowRun({ id: 36141162649, name: 'SOS repository verification', head_sha: 'efd4449', status: 'completed', conclusion: 'success', created_at: '2026-09-25T13:28:22Z', updated_at: '2026-09-25T13:28:33Z' }),
    ).toEqual({ runId: '36141162649', pipeline: 'SOS repository verification', ref: 'efd4449', status: 'SUCCESS', occurredAt: '2026-09-25T13:28:33Z' });
    expect(mapWorkflowRun({ id: 2, name: 'CI', head_sha: 's', status: 'in_progress', conclusion: null, created_at: '2026-09-25T13:00:00Z', updated_at: '2026-09-25T13:01:00Z' })?.status).toBe('IN_PROGRESS');
    expect(mapWorkflowRun({ id: 3, name: 'CI', head_sha: 's', status: 'completed', conclusion: null, created_at: '2026-09-25T13:00:00Z', updated_at: '2026-09-25T13:01:00Z' })?.status).toBe('UNKNOWN');
    expect(mapWorkflowRun({ id: 4, name: 'CI', head_sha: 's', status: 'completed', conclusion: 'failure', created_at: '2026-09-25T13:00:00Z', updated_at: '2026-09-25T13:01:00Z' })?.status).toBe('FAILURE');
  });

  it('polls the runs endpoint and emits status-keyed external ids (status transitions are new events)', async () => {
    const tracker = new ConnectivityTracker();
    const source = new GitHubCiSource({
      config: { owner: 'o', repo: 'r', token: 'ghp_test', tokenEnvName: 'PAYSWAP_GITHUB_TOKEN' },
      fetch: scriptedFetch([
        {
          match: '/actions/runs',
          response: json(200, {
            workflow_runs: [
              { id: 1, name: 'verify', head_sha: 'sha1', status: 'completed', conclusion: 'success', created_at: '2026-09-25T10:00:00Z', updated_at: '2026-09-25T10:01:00Z' },
            ],
          }),
        },
      ]),
      clock: clock(),
      tracker,
      transcript: new TranscriptRecorder(),
    });
    const envelopes = await source.poll();
    expect(envelopes[0]!.externalId).toBe('run-1-SUCCESS');
    expect(envelopes[0]!.payload).toEqual({ pipeline: 'verify', ref: 'sha1', status: 'SUCCESS', runId: '1' });
    expect(tracker.recordFor(source.sourceId()).state).toBe('CONNECTED');
  });
});

describe('Vercel deployment mapping (read directly, no sibling dependency)', () => {
  it('maps a READY git deployment to a deployed change bound to the commit sha', () => {
    const mapped = mapVercelDeployment({
      uid: 'dpl_test',
      readyState: 'READY',
      created: 1790341206629,
      target: null,
      source: 'git',
      meta: { githubCommitSha: 'ddef342e3b805882c311c942fe4958c0c14b0494' },
    });
    expect(mapped).toEqual({ environment: 'production', revision: 'ddef342e3b805882c311c942fe4958c0c14b0494', action: 'deployed', occurredAt: new Date(1790341206629).toISOString(), externalId: 'dpl-dpl_test-deployed' });
  });

  it('maps a rollback-sourced READY deployment to rolled-back with the restored revision', () => {
    const mapped = mapVercelDeployment({ uid: 'dpl_rb', readyState: 'READY', created: 1790341300000, target: 'production', source: 'rollback', meta: { githubCommitSha: 'restoredsha' } });
    expect(mapped?.action).toBe('rolled-back');
    expect(mapped?.revision).toBe('restoredsha');
  });

  it('does not map building deployments or deployments without a commit sha (never fabricated)', () => {
    expect(mapVercelDeployment({ uid: 'dpl_b', readyState: 'BUILDING', created: 1, meta: { githubCommitSha: 'x' } })).toBeNull();
    expect(mapVercelDeployment({ uid: 'dpl_c', readyState: 'READY', created: 1, meta: {} })).toBeNull();
  });

  it('polls the deployments API and records honest connectivity', async () => {
    const tracker = new ConnectivityTracker();
    const calls: HttpRequest[] = [];
    const source = new VercelDeploymentsSource({
      config: { token: 'vcp_test', tokenEnvName: 'PAYSWAP_VERCEL_TOKEN' },
      fetch: scriptedFetch([{ match: '/v6/deployments', response: { status: 200, headers: { 'x-vercel-id': 'abc' }, body: JSON.stringify({ deployments: [{ uid: 'dpl_1', readyState: 'READY', created: 1790341206629, meta: { githubCommitSha: 's1' } }] }) } }], calls),
      clock: clock(),
      tracker,
      transcript: new TranscriptRecorder(),
    });
    const envelopes = await source.poll();
    expect(envelopes).toHaveLength(1);
    expect(calls[0]!.headers['authorization']).toBe('Bearer vcp_test');
    expect(tracker.recordFor(source.sourceId()).state).toBe('CONNECTED');
  });
});

describe('the webhook-shaped receiver (fail-closed HMAC)', () => {
  it('rejects a delivery with a missing or wrong signature (never ingests)', async () => {
    const { pipeline } = wiredReceiver();
    const receiver = new GitHubWebhookReceiver({ secret: 'whsec_test', secretEnvName: 'PAYSWAP_GITHUB_WEBHOOK_SECRET', pipeline, clock: clock() });
    const missing = await receiver.handleDelivery({ method: 'POST', headers: {}, body: '{}' });
    expect(missing[0]!.kind).toBe('INVALID_SIGNATURE');
    const body = JSON.stringify({ ref: 'refs/heads/main', before: 'b', after: 'a' });
    const wrong = await receiver.handleDelivery({ method: 'POST', headers: { 'x-hub-signature-256': 'sha256=' + '0'.repeat(64), 'x-github-delivery': 'd1', 'x-github-event': 'push' }, body });
    expect(wrong[0]!.kind).toBe('INVALID_SIGNATURE');
  });

  it('ingests a correctly signed push delivery through the merged pipeline (replay-protected)', async () => {
    const { receiver } = wiredReceiver();
    const body = JSON.stringify({ ref: 'refs/heads/main', before: '0000000000000000000000000000000000000000', after: '1111111111111111111111111111111111111111' });
    const signature = expectedSignature('whsec_test', body);
    const first = await receiver.handleDelivery({ method: 'POST', headers: { 'x-hub-signature-256': signature, 'x-github-delivery': 'd-push-1', 'x-github-event': 'push' }, body });
    expect(first[0]!.kind).toBe('INGESTED');
    if (first[0]!.kind === 'INGESTED') {
      expect(first[0]!.outcome.kind).toBe('APPLIED');
    }
    const second = await receiver.handleDelivery({ method: 'POST', headers: { 'x-hub-signature-256': signature, 'x-github-delivery': 'd-push-1', 'x-github-event': 'push' }, body });
    expect(second[0]!.kind).toBe('INGESTED');
    if (second[0]!.kind === 'INGESTED') {
      expect(second[0]!.outcome.kind).toBe('DUPLICATE');
    }
  });

  it('answers IGNORED_EVENT_TYPE for event types the plane does not map', async () => {
    const { receiver } = wiredReceiver();
    const body = JSON.stringify({ action: 'started' });
    const outcome = await receiver.handleDelivery({ method: 'POST', headers: { 'x-hub-signature-256': expectedSignature('whsec_test', body), 'x-github-delivery': 'd-w', 'x-github-event': 'watch' }, body });
    expect(outcome[0]!.kind).toBe('IGNORED_EVENT_TYPE');
  });
});

function wiredReceiver(): { receiver: GitHubWebhookReceiver; pipeline: Pipeline } {
  const store = createInMemoryLiveStore();
  const pipeline = new EventIngestionPipeline({ observationEvents: store.observationEvents, clock: new ManualClock(CLOCK_AT) });
  const receiver = new GitHubWebhookReceiver({ secret: 'whsec_test', secretEnvName: 'PAYSWAP_GITHUB_WEBHOOK_SECRET', pipeline, clock: new ManualClock(CLOCK_AT) });
  return { receiver, pipeline };
}

describe('provider health signals (real probes, honest statuses)', () => {
  it('emits one signal per provider with the honest status from the probe', async () => {
    const tracker = new ConnectivityTracker();
    const source = new ProviderHealthSource({
      probes: [
        { provider: 'github', request: { method: 'GET', url: 'https://api.github.com/rate_limit', headers: {}, body: null }, expectBody: (body) => body.includes('resources'), apiRevision: 'github.v3' },
        { provider: 'vercel', request: { method: 'GET', url: 'https://api.vercel.com/v6/deployments?limit=1', headers: {}, body: null }, expectBody: (body) => body.includes('deployments'), apiRevision: 'vercel.v6' },
      ],
      fetch: scriptedFetch([
        { match: '/rate_limit', response: json(200, { resources: { core: { limit: 5000, used: 1, remaining: 4999, reset: 1790346912 } } }) },
        { match: '/v6/deployments', response: { status: 429, headers: {}, body: '{"error":"rate limited"}' } },
      ]),
      clock: clock(),
      tracker,
      transcript: new TranscriptRecorder(),
    });
    const envelopes = await source.poll();
    expect(envelopes.map((envelope) => envelope.payload)).toEqual([
      { provider: 'github', status: 'HEALTHY' },
      { provider: 'vercel', status: 'DEGRADED' },
    ]);
    expect(envelopes.map((envelope) => envelope.externalId)).toEqual(['health-github-HEALTHY', 'health-vercel-DEGRADED']);
  });

  it('maps statuses honestly (429 DEGRADED; failures UNAVAILABLE)', () => {
    expect(signalStatusFor(200, true)).toBe('HEALTHY');
    expect(signalStatusFor(429, false)).toBe('DEGRADED');
    expect(signalStatusFor(500, true)).toBe('UNAVAILABLE');
    expect(signalStatusFor(401, true)).toBe('UNAVAILABLE');
    expect(signalStatusFor(200, false)).toBe('UNAVAILABLE');
  });
});

describe('the redaction corpus (names/pattern ids only, never values)', () => {
  it('redacts GitHub PATs, Vercel tokens, bearer values and keeps ids only (synthetic fragments — never real credentials)', () => {
    const githubPat = `ghp_${'a'.repeat(36)}`;
    const vercelToken = `vcp_${'b'.repeat(36)}`;
    const bearerValue = `Bearer ${'cQAAAAAAA'.repeat(4)}`;
    const openAiKey = `sk-proj-${'d'.repeat(24)}`;
    const text = `token ${githubPat} and ${vercelToken} and ${bearerValue} plus ${openAiKey}`;
    const result = redactObservationSecrets(text);
    expect(result.redacted).not.toContain(githubPat);
    expect(result.redacted).not.toContain(vercelToken);
    expect(result.redacted).not.toContain(bearerValue);
    expect(result.redacted).not.toContain(openAiKey);
    expect(result.findings.map((finding) => finding.patternId).sort()).toEqual(['bearer-token-value', 'github-pat-classic', 'openai-style-api-key', 'vercel-access-token']);
  });

  it('redacts the transcript authorization header into an env-name reference, never the value', () => {
    const recorder = new TranscriptRecorder({ authorizationReference: () => 'PAYSWAP_GITHUB_TOKEN' });
    recorder.record({
      at: '2026-09-25T12:00:00Z',
      source: 'github:rest-events:o/r',
      request: { method: 'GET', url: 'https://api.github.com/repos/o/r/events', headers: { authorization: `Bearer ghp_${'e'.repeat(36)}` }, body: null },
      response: json(200, [{ id: 'e1', type: 'PushEvent', created_at: '2026-09-25T07:37:48Z', payload: { ref: 'refs/heads/main', head: 'a', before: 'b' } }]),
      transportError: null,
    });
    const entry = recorder.all()[0]!;
    expect(entry.request.headers['authorization']).toBe('[REDACTED:env-name:PAYSWAP_GITHUB_TOKEN]');
    const serialized = recorder.toJSON();
    expect(serialized).not.toContain(`ghp_${'e'.repeat(8)}`);
    expect(entry.response.headers['x-github-media-type']).toBe('github.v3; format=json');
  });
});
