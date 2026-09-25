/**
 * The honest-state machine suite of the real persistence + deployment
 * adapters (Work Order P17-A) — offline, deterministic: UNKNOWN before
 * any probe (never health); CONNECTED only after a successful REAL
 * probe; UNAVAILABLE on transport/DNS/auth/server failures with the
 * real reason recorded; DEGRADED on 429; the frozen-port health bridge
 * maps AVAILABLE/UNAVAILABLE/UNKNOWN without ever upgrading without
 * evidence; a fabricated CONNECTED report is a typed violation.
 */

import { describe, expect, it } from 'vitest';
import { assertValidRealPersistenceProviderStateReport } from '@sos-2/real-persistence';
import { mapProviderStateToPortAvailability } from '@sos-2/real-persistence';
import { assertValidRealDeploymentProviderStateReport } from '@sos-2/deployment-providers';
import { persistenceWorld } from './world.js';
import { NeonPostgresStoreAdapter } from '@sos-2/real-persistence';
import { UpstashRedisCoordinationAdapter } from '@sos-2/real-persistence';
import { R2ObjectStoreAdapter } from '@sos-2/real-persistence';
import { PersistenceProbeLedger, PersistenceTranscriptRecorder } from '@sos-2/real-persistence';
import { ManualClock } from '@sos-2/live-store';
import { createRecordingFetchPort } from '@sos-2/real-persistence';
import { bindGlobalFetch } from '@sos-2/deployment-providers';
import { DeploymentProbeLedger, RealVercelDeploymentProvider } from '@sos-2/deployment-providers';
import { ScriptedHttpWorld, T0, neonSql } from './world.js';

const instantSleep = async () => {};

describe('the honest-state machine (scripted real probes)', () => {
  it('reports UNKNOWN before any probe — never health, never fabricated', () => {
    const { postgres, redis, objectStore } = persistenceWorld([]);
    for (const adapter of [postgres, redis, objectStore]) {
      expect(adapter.providerState().state).toBe('UNKNOWN');
      expect(adapter.health().status).toBe('UNKNOWN');
      expect(adapter.providerState().probes).toEqual([]);
    }
  });

  it('reports CONNECTED + frozen AVAILABLE only after a successful REAL probe', async () => {
    const { postgres, redis, objectStore } = persistenceWorld([
      { provider: 'neon', status: 200, body: neonSql('SELECT', [{ ping: 1 }]) },
      { provider: 'upstash', status: 200, body: { result: 'PONG' } },
      { provider: 'r2', status: 200, headers: {}, body: '' },
    ]);
    await expect(postgres.probe()).resolves.toBe(true);
    await expect(redis.probe()).resolves.toBe(true);
    await expect(objectStore.probe()).resolves.toBe(true);
    expect(postgres.providerState().state).toBe('CONNECTED');
    expect(redis.providerState().state).toBe('CONNECTED');
    expect(objectStore.providerState().state).toBe('CONNECTED');
    expect(postgres.health().status).toBe('AVAILABLE');
    expect(redis.health().status).toBe('AVAILABLE');
    expect(objectStore.health().status).toBe('AVAILABLE');
    expect(postgres.providerState().api_revision).toBe('neon.http-sql.v1');
    expect(redis.providerState().api_revision).toBe('upstash.rest.v1');
    expect(objectStore.providerState().api_revision).toBe('s3.2006-03-01');
  });

  it('reports UNAVAILABLE with the REAL reason on transport failures (DNS resolution failures included)', async () => {
    const { postgres, redis, objectStore } = persistenceWorld([
      { provider: 'neon', status: 0, transportError: 'getaddrinfo ENOTFOUND ep-gone-pooler.aws.neon.tech' },
      { provider: 'upstash', status: 0, transportError: 'getaddrinfo ENOTFOUND gone-db.upstash.io' },
      { provider: 'r2', status: 0, transportError: 'connect ETIMEDOUT 0123456789abcdef.r2.cloudflarestorage.com:443' },
    ]);
    await expect(postgres.probe()).resolves.toBe(false);
    await expect(redis.probe()).resolves.toBe(false);
    await expect(objectStore.probe()).resolves.toBe(false);
    for (const adapter of [postgres, redis, objectStore]) {
      const state = adapter.providerState();
      expect(state.state).toBe('UNAVAILABLE');
      expect(state.last_error).toContain('transport failure');
      expect(adapter.health().status).toBe('UNAVAILABLE');
    }
    expect(postgres.providerState().last_error).toContain('ENOTFOUND');
    expect(redis.providerState().last_error).toContain('ENOTFOUND');
    expect(objectStore.providerState().last_error).toContain('ETIMEDOUT');
  });

  it('reports UNAVAILABLE on authentication failures (401) and server errors (5xx) with the real statuses', async () => {
    const { redis, objectStore } = persistenceWorld([
      { provider: 'upstash', status: 401, body: { error: 'Unauthorized' } },
      { provider: 'r2', status: 500, body: '<?xml version="1.0"?><Error><Code>InternalError</Code><Message>boom</Message></Error>' },
    ]);
    await expect(redis.probe()).resolves.toBe(false);
    await expect(objectStore.probe()).resolves.toBe(false);
    expect(redis.providerState().state).toBe('UNAVAILABLE');
    expect(redis.providerState().last_error).toContain('401');
    expect(objectStore.providerState().state).toBe('UNAVAILABLE');
    expect(objectStore.providerState().last_error).toContain('500');
  });

  it('reports DEGRADED on 429 (throttled) — the provider answered, constrained; frozen health stays AVAILABLE-with-detail', async () => {
    const { redis } = persistenceWorld([{ provider: 'upstash', status: 429, body: { error: 'Too Many Requests' } }]);
    await expect(redis.probe()).resolves.toBe(false);
    const state = redis.providerState();
    expect(state.state).toBe('DEGRADED');
    expect(state.last_error).toContain('429');
    // The frozen port bridge: DEGRADED answered its probe -> AVAILABLE (the
    // limitation is carried on the P17-A surface + the health detail).
    expect(mapProviderStateToPortAvailability('DEGRADED')).toBe('AVAILABLE');
    expect(redis.health().status).toBe('AVAILABLE');
    expect(redis.health().detail).toContain('DEGRADED');
  });

  it('an R2 probe of a missing bucket is an honest UNAVAILABLE-with-reason (provisioning required)', async () => {
    const { objectStore } = persistenceWorld([{ provider: 'r2', status: 404, headers: {}, body: '' }]);
    await expect(objectStore.probe()).resolves.toBe(false);
    const state = objectStore.providerState();
    expect(state.state).toBe('UNAVAILABLE');
    expect(state.last_error).toContain('does not exist');
  });

  it('rejects fabricated CONNECTED reports typed-ly (both lanes)', () => {
    expect(() =>
      assertValidRealPersistenceProviderStateReport({
        state: 'CONNECTED',
        provider_id: 'neon',
        probed_at: '2026-04-16T12:00:00.000Z',
        credential_env: 'DATABASE_URL',
        api_revision: null,
        last_error: null,
        probes: [],
        note: 'fabricated',
      }),
    ).toThrow(/fabricated CONNECTED/);
    expect(() =>
      assertValidRealDeploymentProviderStateReport({
        state: 'CONNECTED',
        provider_id: 'vercel',
        probed_at: '2026-04-16T12:00:00.000Z',
        credential_env: 'VERCEL_TOKEN',
        api_revision: null,
        last_error: null,
        probes: [],
        note: 'fabricated',
      }),
    ).toThrow(/fabricated CONNECTED/);
  });

  it('rejects inconsistent UNKNOWN reports (probes exist but none UNKNOWN)', () => {
    expect(() =>
      assertValidRealPersistenceProviderStateReport({
        state: 'UNKNOWN',
        provider_id: 'r2',
        probed_at: '2026-04-16T12:00:00.000Z',
        credential_env: null,
        api_revision: null,
        last_error: null,
        probes: [
          { provider: 'r2', probeId: 'r2:head-bucket', endpoint: '/', at: '2026-04-16T12:00:00.000Z', status: 200, ok: true, failure: null, apiRevision: 's3.2006-03-01' },
        ],
        note: 'inconsistent',
      }),
    ).toThrow(/inconsistent UNKNOWN/);
  });

  it('the provider-state reports carry env NAMES only — never credential values', () => {
    const { postgres } = persistenceWorld([]);
    const report = postgres.providerState();
    expect(report.credential_env).toBe('DATABASE_URL');
    expect(JSON.stringify(report).includes('neon-secret')).toBe(false);
  });
});

describe('the Vercel provider honest-state machine (scripted real probes)', () => {
  function vercelProvider(entries: readonly { status: number; body?: unknown; transportError?: string }[]) {
    const world = new ScriptedHttpWorld(
      entries.map((entry) => ({
        provider: 'vercel',
        status: entry.status,
        body: entry.body,
        transportError: entry.transportError,
        headers: {},
      })),
    );
    const provider = new RealVercelDeploymentProvider({
      token: 'vcp_scriptedtoken12345678901234567',
      teamId: 'team_scripted',
      fetch: world.fetch,
      clock: new ManualClock(T0),
      ledger: new DeploymentProbeLedger(),
      credentialEnv: 'VERCEL_TOKEN',
      sleep: instantSleep,
      baseUrl: 'https://api.vercel.com',
    });
    return { provider, world };
  }

  it('UNKNOWN before any probe; CONNECTED after the authenticated /v2/user handshake', async () => {
    const { provider } = vercelProvider([]);
    expect(provider.providerState().state).toBe('UNKNOWN');
    const connected = vercelProvider([{ status: 200, body: { user: { id: 'user_1', username: 'operator', defaultTeamId: 'team_1' } } }]);
    const user = await connected.provider.probe();
    expect(user?.username).toBe('operator');
    expect(connected.provider.providerState().state).toBe('CONNECTED');
    expect(connected.provider.providerState().api_revision).toBe('vercel.v2');
  });

  it('UNAVAILABLE on 401 (rejected credential) with the real reason recorded', async () => {
    const { provider } = vercelProvider([{ status: 401, body: { error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } } }]);
    await expect(provider.probe()).resolves.toBeNull();
    const state = provider.providerState();
    expect(state.state).toBe('UNAVAILABLE');
    expect(state.last_error).toContain('401');
    expect(state.last_error).toContain('Unauthorized');
  });

  it('DEGRADED on 429 rate limiting (the real Vercel quota surface)', async () => {
    const { provider } = vercelProvider([{ status: 429, body: { error: { code: 'TOO_MANY_REQUESTS', message: 'Rate limited' } } }]);
    await expect(provider.probe()).resolves.toBeNull();
    expect(provider.providerState().state).toBe('DEGRADED');
  });
});

describe('the composition honest defaults', () => {
  it('the transcript-recording boundary records every real round-trip redacted (names only)', async () => {
    const world = new ScriptedHttpWorld([{ provider: 'upstash', status: 200, body: { result: 'PONG' } }]);
    const clock = new ManualClock(T0);
    const ledger = new PersistenceProbeLedger();
    const transcript = new PersistenceTranscriptRecorder({
      credentialReference: () => 'UPSTASH_REDIS_REST_TOKEN',
    });
    const recording = createRecordingFetchPort({ provider: 'upstash', inner: world.fetch, transcript, clock });
    const redis = new UpstashRedisCoordinationAdapter({
      restUrl: 'https://scripted-ewe-000000.upstash.io',
      token: 'AbCdEf1234567890123456789012345678901234',
      tier: 'production',
      fetch: recording,
      clock,
      ledger,
      credentialEnv: 'UPSTASH_REDIS_REST_TOKEN',
    });
    await redis.probe();
    const transcriptJson = transcript.toJSON();
    expect(transcriptJson).toContain('[REDACTED:env-name:UPSTASH_REDIS_REST_TOKEN]');
    expect(transcriptJson.includes('AbCdEf1234567890123456789012345678901234')).toBe(false);
    expect(JSON.parse(transcriptJson)).toHaveLength(1);
  });

  it('the Neon adapter transcript replaces the connection-string header with the env NAME reference', async () => {
    const world = new ScriptedHttpWorld([{ provider: 'neon', status: 200, body: neonSql('SELECT', [{ ping: 1 }]) }]);
    const clock = new ManualClock(T0);
    const ledger = new PersistenceProbeLedger();
    const transcript = new PersistenceTranscriptRecorder({ credentialReference: () => 'DATABASE_URL' });
    const recording = createRecordingFetchPort({ provider: 'neon', inner: world.fetch, transcript, clock });
    const postgres = new NeonPostgresStoreAdapter({
      connectionString: 'postgres://operator:neon-secret@ep-scripted-pooler.us-east-1.aws.neon.tech/sos?sslmode=require',
      fetch: recording,
      clock,
      ledger,
      credentialEnv: 'DATABASE_URL',
      baseUrl: 'https://ep-scripted-pooler.us-east-1.aws.neon.tech',
    });
    await postgres.probe();
    const transcriptJson = transcript.toJSON();
    expect(transcriptJson).toContain('[REDACTED:env-name:DATABASE_URL]');
    expect(transcriptJson.includes('neon-secret')).toBe(false);
    expect(transcriptJson.includes('sslmode=require')).toBe(false);
  });

  it('a transport failure is recorded in the transcript with status null + the real reason', async () => {
    const world = new ScriptedHttpWorld([{ provider: 'r2', status: 0, transportError: 'getaddrinfo ENOTFOUND gone.r2.cloudflarestorage.com' }]);
    const clock = new ManualClock(T0);
    const ledger = new PersistenceProbeLedger();
    const transcript = new PersistenceTranscriptRecorder({ credentialReference: () => 'R2_SECRET_ACCESS_KEY' });
    const recording = createRecordingFetchPort({ provider: 'r2', inner: world.fetch, transcript, clock });
    const objectStore = new R2ObjectStoreAdapter({
      accountId: '0123456789abcdef0123456789abcdef',
      accessKeyId: '00001111222233334444555566667777',
      secretAccessKey: '9999888877776666555544443333222211110000999988887777666655554444',
      bucketName: 'sos20-evidence-prod',
      tier: 'production',
      fetch: recording,
      clock,
      ledger,
      credentialEnv: 'R2_SECRET_ACCESS_KEY',
    });
    await objectStore.probe();
    const entries = transcript.all();
    expect(entries).toHaveLength(1);
    expect(entries[0]!.response.status).toBeNull();
    expect(entries[0]!.response.headers['transport-error']).toContain('ENOTFOUND');
  });

  it('bindGlobalFetch is the documented impure boundary (never called in reference mode)', () => {
    expect(typeof bindGlobalFetch).toBe('function');
  });
});
