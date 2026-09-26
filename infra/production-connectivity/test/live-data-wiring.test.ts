/**
 * The DETERMINISTIC wiring suite of the P18-A live data-plane wiring
 * (Work Order P18-A): offline (a scripted FetchPort + ManualClock +
 * instant sleep), fixed seed, run-to-run identical. Pins:
 *
 *   - the P3-registry environment resolution (exact variable NAMES,
 *     absent slices reported honestly, never defaulted);
 *   - the observation FetchPort adapter (ONE network seam: binary
 *     request bodies encode, response bytes decode);
 *   - the durable-store selection: PRODUCTION_DURABLE only on a
 *     CONNECTED canonical probe; Neon transport/DNS failures degrade to
 *     the explicit reference marker with the real reason; absent
 *     credentials stay honestly UNKNOWN; Upstash is NEVER canonical
 *     (the sentence always carried, its state never promotes it);
 *   - the deployment-state read: the frozen client mapping (the exact
 *     source_revision_sha semantics), latest-by-target, honest
 *     UNAVAILABLE with the real reason on transport failure, honest
 *     UNKNOWN without a token;
 *   - the provider-health snapshot rows (roles, honest states);
 *   - the observation plane config (complete vs incomplete env).
 *
 * The merged P17-A wiring suite (wiring.test.ts) stays untouched.
 */

import { describe, expect, it } from 'vitest';
import { ManualClock } from '@sos-2/live-store';
import {
  adaptObservationFetchPort,
  createLiveDataPlaneHarness,
  defaultLiveDataPlaneSubjects,
  LIVE_DATA_ENVIRONMENT_VARIABLES,
  LIVE_DATA_NEVER_CANONICAL_NOTE,
  resolveLiveDataPlaneEnvironment,
} from '../src/live-data-wiring.js';
import type { FetchPort, HttpRequest, HttpResponse } from '@sos-2/real-persistence';

const T0 = 1_776_350_400_000; // 2026-04-16T12:00:00.000Z

/** A scripted FetchPort: responses consumed in fixed order (offline, deterministic). */
function scriptedFetch(responses: readonly (HttpResponse | { transportError: string })[]): { fetch: FetchPort; requests: HttpRequest[] } {
  const queue = [...responses];
  const requests: HttpRequest[] = [];
  const fetch: FetchPort = async (request) => {
    requests.push(request);
    const next = queue.shift();
    if (next === undefined) {
      throw new Error('the scripted port is exhausted — a deterministic defect in the test fixture');
    }
    if ('transportError' in next) {
      throw new Error(next.transportError);
    }
    return next;
  };
  return { fetch, requests };
}

function jsonResponse(status: number, body: unknown): HttpResponse {
  return {
    status,
    headers: { 'content-type': 'application/json' },
    bytes: new TextEncoder().encode(JSON.stringify(body)),
  };
}

const instantSleep = async () => {};

const NEON_URL = 'postgres://operator:neon-secret@ep-scripted-pooler.us-east-1.aws.neon.tech/sos?sslmode=require';
const UPSTASH_URL = 'https://scripted-ewe-000000.upstash.io';
const HEAD = '711cfd60b7eb90b338a8ce17cadcafb72a0d1e6e';
const OTHER_SHA = 'b5938ea4654144df287ce3e907389fc1f911ccf6';

function fullSource(): Record<string, string> {
  return {
    GITHUB_ACCESS_TOKEN: 'ghp_scriptedobservationtoken',
    GITHUB_WEBHOOK_SECRET: 'whsec_scripted',
    VERCEL_TOKEN: 'vcp_scripteddeploymenttoken',
    VERCEL_PROJECT_ID: 'prj_scripted00000000000000000000',
    VERCEL_ORG_ID: 'team_scripted00000000000000000',
    DATABASE_URL: NEON_URL,
    NEON_API_KEY: 'napi_scripted00000000000000000000',
    NEON_DATABASE_NAME: 'sos',
    NEON_BRANCH_NAME: 'main',
    UPSTASH_REDIS_REST_URL: UPSTASH_URL,
    UPSTASH_REDIS_REST_TOKEN: 'AAAAscriptedscriptedscriptedscripted',
    R2_ACCOUNT_ID: 'account123',
    R2_ACCESS_KEY_ID: 'accesskey123',
    R2_SECRET_ACCESS_KEY: 'secretkey1234567890abcdef',
    R2_BUCKET_NAME: 'sos20-evidence-prod',
  };
}

describe('the live data-plane environment resolution (P3 registry names)', () => {
  it('resolves every slice from the injected source by exact NAME', () => {
    const resolution = resolveLiveDataPlaneEnvironment(fullSource());
    expect(resolution.github.tokenEnv).toBe('GITHUB_ACCESS_TOKEN');
    expect(resolution.github.owner).toBe('payswapdotorg');
    expect(resolution.github.repo).toBe('SOS-2.0');
    expect(resolution.github.branch).toBe('main');
    expect(resolution.vercel.projectId).toBe('prj_scripted00000000000000000000');
    expect(resolution.neon.databaseName).toBe('sos');
    expect(resolution.absent).toEqual([]);
  });

  it('reports absent variables by NAME only (never defaulted, never fabricated)', () => {
    const resolution = resolveLiveDataPlaneEnvironment({});
    expect(resolution.github.token).toBeNull();
    expect(resolution.vercel.token).toBeNull();
    expect(resolution.neon.databaseUrl).toBeNull();
    expect(resolution.absent).toContain('GITHUB_ACCESS_TOKEN');
    expect(resolution.absent).toContain('VERCEL_TOKEN');
    expect(resolution.absent).toContain('DATABASE_URL');
    expect(resolution.absent).toContain('UPSTASH_REDIS_REST_URL');
    // names only — no value ever appears
    expect(JSON.stringify(resolution)).not.toContain('ghp_scripted');
  });

  it('supports subject overrides (the observation subject is composition wiring)', () => {
    const resolution = resolveLiveDataPlaneEnvironment(fullSource(), { owner: 'other-org', repo: 'other-repo', branch: 'develop' });
    expect(resolution.github.owner).toBe('other-org');
    expect(defaultLiveDataPlaneSubjects()).toEqual({ owner: 'payswapdotorg', repo: 'SOS-2.0', branch: 'main' });
  });
});

describe('the observation FetchPort adapter (one network seam)', () => {
  it('encodes string bodies to bytes and decodes byte responses to strings', async () => {
    const { fetch, requests } = scriptedFetch([jsonResponse(200, { result: 'PONG' })]);
    const observationFetch = adaptObservationFetchPort(fetch);
    const response = await observationFetch({ method: 'POST', url: `${UPSTASH_URL}/pipeline`, headers: { authorization: 'Bearer x' }, body: '[["PING"]]' });
    expect(response.status).toBe(200);
    expect(response.body).toBe(JSON.stringify({ result: 'PONG' }));
    expect(requests[0]!.body).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(requests[0]!.body!)).toBe('[["PING"]]');
    expect(requests[0]!.method).toBe('POST');
  });

  it('carries null bodies and transport failures unchanged', async () => {
    const { fetch } = scriptedFetch([{ transportError: 'getaddrinfo ENOTFOUND scripted-ewe-000000.upstash.io' }]);
    const observationFetch = adaptObservationFetchPort(fetch);
    await expect(observationFetch({ method: 'GET', url: `${UPSTASH_URL}/x`, headers: {}, body: null })).rejects.toThrow(/ENOTFOUND scripted-ewe-000000\.upstash\.io/);
  });
});

describe('the durable-store selection', () => {
  it('selects PRODUCTION_DURABLE when the canonical Neon probe answers (and never promotes Upstash)', async () => {
    const { fetch } = scriptedFetch([
      // Neon SQL ping
      jsonResponse(200, { fields: [{ name: 'ping', type: 'int4' }], rows: [{ ping: 1 }], command: 'SELECT', rowCount: 1 }),
      // Upstash PING
      jsonResponse(200, { result: 'PONG' }),
    ]);
    const harness = createLiveDataPlaneHarness({ source: fullSource(), tier: 'production', clock: new ManualClock(T0), fetch, sleep: instantSleep });
    const selection = await harness.selectDurableStore();
    expect(selection.mode).toBe('PRODUCTION_DURABLE');
    expect(selection.canonical.state).toBe('CONNECTED');
    expect(selection.canonical.provider).toBe('neon');
    expect(selection.canonicalStoreRef).toBe('neon:postgres:sos@main');
    expect(selection.storeRef).toBe('neon:postgres:sos@main');
    expect(selection.coordination.state).toBe('CONNECTED');
    expect(selection.coordination.neverCanonicalNote).toBe(LIVE_DATA_NEVER_CANONICAL_NOTE);
    expect(selection.coordination.neverCanonicalNote).toContain('never the canonical store');
  });

  it('degrades to the explicit reference marker with the REAL DNS fact when Neon is unreachable', async () => {
    const { fetch } = scriptedFetch([
      { transportError: 'transport failure for POST https://ep-scripted-pooler.us-east-1.aws.neon.tech/sql: fetch failed (getaddrinfo ENOTFOUND ep-scripted-pooler.us-east-1.aws.neon.tech)' },
      jsonResponse(200, { result: 'PONG' }),
    ]);
    const harness = createLiveDataPlaneHarness({ source: fullSource(), tier: 'production', clock: new ManualClock(T0), fetch, sleep: instantSleep });
    const selection = await harness.selectDurableStore();
    expect(selection.mode).toBe('REFERENCE_FALLBACK');
    expect(selection.canonical.state).toBe('UNAVAILABLE');
    expect(selection.canonical.lastError).toContain('getaddrinfo ENOTFOUND ep-scripted-pooler.us-east-1.aws.neon.tech');
    expect(selection.storeRef).toBe('reference:in-memory-observation-store');
    expect(selection.storeRef.startsWith('reference:')).toBe(true);
    expect(selection.note).toContain('explicitly NOT production durable state');
    // the coordination provider is never promoted even though it answered
    expect(selection.coordination.state).toBe('CONNECTED');
    expect(selection.mode).toBe('REFERENCE_FALLBACK');
  });

  it('stays honestly UNKNOWN (never fabricated) when credentials are absent', async () => {
    const { fetch } = scriptedFetch([]);
    const harness = createLiveDataPlaneHarness({ source: {}, tier: 'production', clock: new ManualClock(T0), fetch, sleep: instantSleep });
    const selection = await harness.selectDurableStore();
    expect(selection.mode).toBe('REFERENCE_FALLBACK');
    expect(selection.canonical.state).toBe('UNKNOWN');
    expect(selection.canonical.lastError).toBeNull();
    expect(selection.canonical.detail).toContain(LIVE_DATA_ENVIRONMENT_VARIABLES.databaseUrl);
    expect(selection.coordination.state).toBe('UNKNOWN');
    expect(selection.storeRef).toBe('reference:in-memory-observation-store');
  });

  it('reports Upstash UNAVAILABLE with its real reason while Neon stays canonical (partial availability)', async () => {
    const { fetch } = scriptedFetch([
      jsonResponse(200, { fields: [{ name: 'ping', type: 'int4' }], rows: [{ ping: 1 }], command: 'SELECT', rowCount: 1 }),
      { transportError: 'transport failure for POST https://scripted-ewe-000000.upstash.io/ping: fetch failed (NXDOMAIN)' },
    ]);
    const harness = createLiveDataPlaneHarness({ source: fullSource(), tier: 'production', clock: new ManualClock(T0), fetch, sleep: instantSleep });
    const selection = await harness.selectDurableStore();
    expect(selection.mode).toBe('PRODUCTION_DURABLE');
    expect(selection.coordination.state).toBe('UNAVAILABLE');
    expect(selection.coordination.lastError).toContain('NXDOMAIN');
  });
});

describe('the deployment-state read', () => {
  it('reads the REAL deployment records with the exact source_revision_sha and latest-by-target', async () => {
    const { fetch, requests } = scriptedFetch([
      jsonResponse(200, {
        deployments: [
          {
            uid: 'dpl_production000000000000000',
            url: 'sos-2-0-example.vercel.app',
            readyState: 'READY',
            createdAt: 1_776_350_000_000,
            target: 'production',
            meta: { githubCommitSha: HEAD, githubCommitRef: 'main', githubCommitMessage: 'P17-A merge' },
            projectId: 'prj_scripted00000000000000000000',
            regions: ['iad1'],
          },
          {
            uid: 'dpl_preview00000000000000000',
            url: 'sos-2-0-preview.vercel.app',
            readyState: 'READY',
            createdAt: 1_776_349_000_000,
            target: 'preview',
            meta: { githubCommitSha: OTHER_SHA },
            projectId: 'prj_scripted00000000000000000000',
            regions: ['iad1'],
          },
        ],
      }),
    ]);
    const harness = createLiveDataPlaneHarness({ source: fullSource(), tier: 'production', clock: new ManualClock(T0), fetch, sleep: instantSleep });
    const read = await harness.readDeploymentState();
    expect(read.state).toBe('CONNECTED');
    expect(read.deployments).toHaveLength(2);
    expect(read.deployments[0]).toMatchObject({ id: 'dpl_production000000000000000', commitSha: HEAD, target: 'production', readyState: 'READY', region: 'iad1' });
    expect(read.latestByTarget['production']?.commitSha).toBe(HEAD);
    expect(read.latestByTarget['preview']?.commitSha).toBe(OTHER_SHA);
    expect(read.apiRevision).toBe('vercel.v6');
    // the project filter went out on the wire (the frozen client mapping)
    expect(requests[0]!.url).toContain('/v6/deployments');
    expect(requests[0]!.url).toContain('projectId=prj_scripted00000000000000000000');
    // the credential never appears in the record (env NAME only)
    expect(JSON.stringify(read)).not.toContain('vcp_scripted');
    expect(read.credentialEnvName).toBe('VERCEL_TOKEN');
  });

  it('falls back to gitSource.sha when meta is absent (the frozen mapping semantics)', async () => {
    const { fetch } = scriptedFetch([
      jsonResponse(200, { deployments: [{ uid: 'dpl_gitsource0000000000000', readyState: 'READY', target: 'production', gitSource: { sha: OTHER_SHA, type: 'github' } }] }),
    ]);
    const harness = createLiveDataPlaneHarness({ source: fullSource(), tier: 'production', clock: new ManualClock(T0), fetch, sleep: instantSleep });
    const read = await harness.readDeploymentState();
    expect(read.deployments[0]!.commitSha).toBe(OTHER_SHA);
  });

  it('records UNAVAILABLE with the real reason on transport failure (never a fabricated list)', async () => {
    const { fetch } = scriptedFetch([{ transportError: 'transport failure for GET https://api.vercel.com/v6/deployments: fetch failed (connect ETIMEDOUT api.vercel.com:443)' }]);
    const harness = createLiveDataPlaneHarness({ source: fullSource(), tier: 'production', clock: new ManualClock(T0), fetch, sleep: instantSleep });
    const read = await harness.readDeploymentState();
    expect(read.state).toBe('UNAVAILABLE');
    expect(read.deployments).toEqual([]);
    expect(read.lastError).toContain('connect ETIMEDOUT api.vercel.com:443');
    expect(read.note).toContain('never fabricated');
  });

  it('is honestly UNKNOWN without a token', async () => {
    const { fetch } = scriptedFetch([]);
    const source = fullSource();
    delete source['VERCEL_TOKEN'];
    const harness = createLiveDataPlaneHarness({ source, tier: 'production', clock: new ManualClock(T0), fetch, sleep: instantSleep });
    const read = await harness.readDeploymentState();
    expect(read.state).toBe('UNKNOWN');
    expect(read.note).toContain('never fabricated');
  });
});

describe('the provider-health snapshot + the observation plane config', () => {
  it('carries every provider row with its role and honest state', async () => {
    const { fetch } = scriptedFetch([
      jsonResponse(200, { fields: [{ name: 'ping', type: 'int4' }], rows: [{ ping: 1 }], command: 'SELECT', rowCount: 1 }),
      jsonResponse(200, { result: 'PONG' }),
    ]);
    const harness = createLiveDataPlaneHarness({ source: fullSource(), tier: 'production', clock: new ManualClock(T0), fetch, sleep: instantSleep });
    await harness.selectDurableStore();
    const rows = harness.providerHealthSnapshot();
    const byProvider = new Map(rows.map((row) => [row.provider, row]));
    expect(byProvider.get('neon')).toMatchObject({ role: 'durable-canonical-state', state: 'CONNECTED' });
    expect(byProvider.get('upstash')).toMatchObject({ role: 'coordination-only-never-canonical', state: 'CONNECTED' });
    expect(byProvider.get('r2')?.state).toBe('UNKNOWN'); // unprobed this run — never health
    expect(byProvider.get('vercel')?.state).toBe('UNKNOWN'); // unprobed this run
    expect(rows.map((row) => row.provider)).toEqual([...rows.map((row) => row.provider)].sort());
  });

  it('exposes the observation plane config only when the observation env is complete', () => {
    const { fetch } = scriptedFetch([]);
    const harness = createLiveDataPlaneHarness({ source: fullSource(), tier: 'production', clock: new ManualClock(T0), fetch, sleep: instantSleep });
    const config = harness.observationPlaneConfig();
    expect(config).not.toBeNull();
    expect(config!.github).toMatchObject({ owner: 'payswapdotorg', repo: 'SOS-2.0', branch: 'main', tokenEnvName: 'GITHUB_ACCESS_TOKEN' });
    expect(config!.vercel.projectId).toBe('prj_scripted00000000000000000000');
    expect(config!.upstash.restUrl).toBe(UPSTASH_URL);
    const withoutGithub = fullSource();
    delete withoutGithub['GITHUB_ACCESS_TOKEN'];
    const incomplete = createLiveDataPlaneHarness({ source: withoutGithub, tier: 'production', clock: new ManualClock(T0), fetch, sleep: instantSleep });
    expect(incomplete.observationPlaneConfig()).toBeNull();
  });

  it('discovers the Vercel org id through the authenticated user probe (or null, honestly)', async () => {
    const { fetch } = scriptedFetch([jsonResponse(200, { user: { id: 'user_1', username: 'operator', defaultTeamId: 'team_discovered0000000000', billing: { plan: 'hobby' } } })]);
    const harness = createLiveDataPlaneHarness({ source: fullSource(), tier: 'production', clock: new ManualClock(T0), fetch, sleep: instantSleep });
    await expect(harness.discoverVercelOrgId()).resolves.toBe('team_discovered0000000000');
    const noToken = createLiveDataPlaneHarness({ source: {}, tier: 'production', clock: new ManualClock(T0), fetch: scriptedFetch([]).fetch, sleep: instantSleep });
    await expect(noToken.discoverVercelOrgId()).resolves.toBeNull();
  });
});
