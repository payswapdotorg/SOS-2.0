/**
 * P17-C deterministic reference-mode acceptance suite (2/6): the
 * honest-state machine over the COMPOSED plane. Every state derives from
 * a REAL probe record (the scripted HTTP round-trip standing in for the
 * provider); unprobed is UNKNOWN, failures are UNAVAILABLE with the
 * real error recorded, throttling is DEGRADED — and NOTHING is ever
 * fabricated.
 */

import { describe, expect, it } from 'vitest';
import { ManualClock } from '@sos-2/live-store';
import { aggregateProviderHealth, createRealObservationPlane } from '@sos-2/real-observation';
import type { FetchPort, HttpRequest, HttpResponse } from '@sos-2/real-observation';

const T0 = Date.parse('2026-09-25T12:00:00Z');

function response(status: number, body: unknown, headers: Record<string, string> = {}): HttpResponse {
  return { status, headers: { 'x-github-media-type': 'github.v3; format=json', ...headers }, body: JSON.stringify(body) };
}

function compose(fetch: FetchPort) {
  const clock = new ManualClock(T0);
  const plane = createRealObservationPlane({
    clock,
    fetch,
    github: { owner: 'payswapdotorg', repo: 'SOS-2.0', branch: 'main', token: 'ghp_scripted', tokenEnvName: 'PAYSWAP_GITHUB_TOKEN' },
    vercel: { token: 'vcp_scripted', tokenEnvName: 'PAYSWAP_VERCEL_TOKEN' },
    upstash: { restUrl: 'https://scripted.upstash.io', token: 'upstash_scripted', tokenEnvName: 'UPSTASH_REDIS_REST_TOKEN' },
    webhookSecret: { secret: 'whsec_scripted', secretEnvName: 'PAYSWAP_GITHUB_WEBHOOK_SECRET' },
    claims: { readClaims: async () => [] },
  });
  return plane;
}

describe('the honest-state machine over the composed plane', () => {
  it('reports every source UNKNOWN before the first drain (never probed is never health)', () => {
    const plane = compose(async () => {
      throw new Error('unreachable: no poll should happen');
    });
    const snapshot = plane.connectivity();
    expect(snapshot).toEqual([]);
  });

  it('reports CONNECTED for every healthy source after one drain, with probe evidence', async () => {
    const plane = compose(async (request: HttpRequest): Promise<HttpResponse> => {
      if (request.url.includes('/branches/main')) return response(200, { name: 'main', commit: { sha: 'probe-head-sha' } });
      if (request.url.includes('/repos/payswapdotorg/SOS-2.0/events')) return response(200, []);
      if (request.url.includes('/actions/runs')) return response(200, { workflow_runs: [] });
      if (request.url.includes('/rate_limit')) return response(200, { resources: { core: { limit: 5000, used: 0, remaining: 5000, reset: 1 } } });
      if (request.url.includes('/v6/deployments')) return response(200, { deployments: [] });
      if (request.url.includes('/pipeline')) return response(200, [{ result: 'PONG' }, { result: 0 }]);
      throw new Error(`no route for ${request.url}`);
    });
    await plane.drain();
    const snapshot = plane.connectivity();
    for (const record of snapshot) {
      expect(record.state).toBe('CONNECTED');
      expect(record.lastProbedAt).not.toBeNull();
      expect(record.probes.length).toBeGreaterThan(0);
    }
    // with NO organic events in this world, the fallback probes are due and
    // run — they are sources too, with their own honest states:
    expect(snapshot.map((record) => record.source).sort()).toEqual([
      'ci:github-actions:payswapdotorg/SOS-2.0',
      'deploy:vercel',
      'github:rate-limit',
      'github:rest-events:payswapdotorg/SOS-2.0',
      'provider-health:real-probes',
      'scheduled-probe:probe-ci-latest:payswapdotorg/SOS-2.0',
      'scheduled-probe:probe-deployment-latest',
      'scheduled-probe:probe-repo-head:payswapdotorg/SOS-2.0@main',
      'upstash:redis',
    ]);
  });

  it('reports the down source UNAVAILABLE with its real error while healthy sources stay CONNECTED', async () => {
    const plane = compose(async (request: HttpRequest): Promise<HttpResponse> => {
      if (request.url.includes('/branches/main')) return response(200, { name: 'main', commit: { sha: 'probe-head-sha' } });
      if (request.url.includes('/repos/payswapdotorg/SOS-2.0/events')) return response(401, { message: 'Bad credentials' });
      if (request.url.includes('/actions/runs')) return response(200, { workflow_runs: [] });
      if (request.url.includes('/rate_limit')) return response(200, { resources: { core: { limit: 5000, used: 0, remaining: 5000, reset: 1 } } });
      if (request.url.includes('/v6/deployments')) return response(200, { deployments: [] });
      if (request.url.includes('/pipeline')) return response(200, [{ result: 'PONG' }, { result: 0 }]);
      throw new Error(`no route for ${request.url}`);
    });
    await plane.drain();
    const bySource = new Map(plane.connectivity().map((record) => [record.source, record]));
    expect(bySource.get('github:rest-events:payswapdotorg/SOS-2.0')?.state).toBe('UNAVAILABLE');
    expect(bySource.get('github:rest-events:payswapdotorg/SOS-2.0')?.lastError).toContain('HTTP 401');
    expect(bySource.get('ci:github-actions:payswapdotorg/SOS-2.0')?.state).toBe('CONNECTED');
    expect(bySource.get('deploy:vercel')?.state).toBe('CONNECTED');
  });

  it('reports DEGRADED for a throttled (429) source — distinct from UNAVAILABLE', async () => {
    const plane = compose(async (request: HttpRequest): Promise<HttpResponse> => {
      if (request.url.includes('/branches/main')) return response(200, { name: 'main', commit: { sha: 'probe-head-sha' } });
      if (request.url.includes('/repos/payswapdotorg/SOS-2.0/events')) return response(429, { message: 'rate limited' });
      if (request.url.includes('/actions/runs')) return response(200, { workflow_runs: [] });
      if (request.url.includes('/rate_limit')) return response(200, { resources: { core: { limit: 5000, used: 0, remaining: 5000, reset: 1 } } });
      if (request.url.includes('/v6/deployments')) return response(200, { deployments: [] });
      if (request.url.includes('/pipeline')) return response(200, [{ result: 'PONG' }, { result: 0 }]);
      throw new Error(`no route for ${request.url}`);
    });
    await plane.drain();
    const record = plane.connectivity().find((entry) => entry.source === 'github:rest-events:payswapdotorg/SOS-2.0');
    expect(record?.state).toBe('DEGRADED');
  });

  it('aggregates the provider states: worst probed source wins per provider', async () => {
    const plane = compose(async (request: HttpRequest): Promise<HttpResponse> => {
      if (request.url.includes('/branches/main')) return response(200, { name: 'main', commit: { sha: 'probe-head-sha' } });
      if (request.url.includes('/repos/payswapdotorg/SOS-2.0/events')) return response(200, []);
      if (request.url.includes('/actions/runs')) return response(403, { message: 'forbidden' });
      if (request.url.includes('/rate_limit')) return response(200, { resources: { core: { limit: 5000, used: 0, remaining: 5000, reset: 1 } } });
      if (request.url.includes('/v6/deployments')) return response(200, { deployments: [] });
      if (request.url.includes('/pipeline')) return response(200, [{ result: 'PONG' }, { result: 0 }]);
      throw new Error(`no route for ${request.url}`);
    });
    await plane.drain();
    const aggregate = aggregateProviderHealth(plane.tracker);
    const byProvider = new Map(aggregate.map((entry) => [entry.provider, entry]));
    expect(byProvider.get('github')?.state).toBe('UNAVAILABLE'); // ci failed while events + rate-limit are fine — worst wins
    expect(byProvider.get('vercel')?.state).toBe('CONNECTED');
    expect(byProvider.get('upstash')?.state).toBe('CONNECTED');
    expect(byProvider.get('github')?.sources.length).toBe(5); // rest-events, rate-limit, ci + the two github probes
  });

  it('records a transport failure (network down) as UNAVAILABLE with the real reason', async () => {
    const plane = compose(async (request: HttpRequest): Promise<HttpResponse> => {
      if (request.url.includes('/branches/main')) return response(200, { name: 'main', commit: { sha: 'probe-head-sha' } });
      if (request.url.includes('/v6/deployments')) {
        throw new Error('transport failure for GET https://api.vercel.com/v6/deployments: DNS lookup failed');
      }
      if (request.url.includes('/repos/payswapdotorg/SOS-2.0/events')) return response(200, []);
      if (request.url.includes('/actions/runs')) return response(200, { workflow_runs: [] });
      if (request.url.includes('/rate_limit')) return response(200, { resources: { core: { limit: 5000, used: 0, remaining: 5000, reset: 1 } } });
      if (request.url.includes('/pipeline')) return response(200, [{ result: 'PONG' }, { result: 0 }]);
      throw new Error(`no route for ${request.url}`);
    });
    const report = await plane.drain();
    const summary = report.sourceSummaries.find((entry) => entry.source === 'deploy:vercel');
    expect(summary?.poll).toMatchObject({ kind: 'POLL_FAILED', reason: expect.stringContaining('DNS lookup failed') });
    const record = plane.connectivity().find((entry) => entry.source === 'deploy:vercel');
    expect(record?.state).toBe('UNAVAILABLE');
    expect(record?.lastError).toContain('DNS lookup failed');
    expect(record?.probes[0]?.status).toBeNull();
  });

  it('keeps redacted transcripts for every round-trip (env-name references, never token values)', async () => {
    const plane = compose(async (request: HttpRequest): Promise<HttpResponse> => {
      if (request.url.includes('/branches/main')) return response(200, { name: 'main', commit: { sha: 'probe-head-sha' } });
      if (request.url.includes('/repos/payswapdotorg/SOS-2.0/events')) return response(200, []);
      if (request.url.includes('/actions/runs')) return response(200, { workflow_runs: [] });
      if (request.url.includes('/rate_limit')) return response(200, { resources: { core: { limit: 5000, used: 0, remaining: 5000, reset: 1 } } });
      if (request.url.includes('/v6/deployments')) return response(200, { deployments: [] });
      if (request.url.includes('/pipeline')) return response(200, [{ result: 'PONG' }, { result: 0 }]);
      throw new Error(`no route for ${request.url}`);
    });
    await plane.drain();
    const transcript = plane.transcript.toJSON();
    expect(transcript).not.toContain('ghp_scripted');
    expect(transcript).not.toContain('vcp_scripted');
    expect(transcript).not.toContain('upstash_scripted');
    expect(transcript).toContain('[REDACTED:env-name:PAYSWAP_GITHUB_TOKEN]');
    expect(transcript).toContain('[REDACTED:env-name:PAYSWAP_VERCEL_TOKEN]');
    expect(transcript).toContain('[REDACTED:env-name:UPSTASH_REDIS_REST_TOKEN]');
    const entries = plane.transcript.all();
    expect(entries.length).toBeGreaterThanOrEqual(8);
    for (const entry of entries) {
      expect(entry.request.url.startsWith('https://')).toBe(true);
      expect(entry.response.status).toBe(200);
    }
  });
});
