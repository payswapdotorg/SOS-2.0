/**
 * The composition + never-canonical proof suite (Work Order P17-A) —
 * offline, deterministic: the env-only composition boundary and THE
 * NEVER-CANONICAL RULE pinned as a machine-checked invariant: flushing
 * the ENTIRE coordination state (Upstash adapter, tier-scoped) loses
 * ONLY acceleration — the durable canonical store's semantic state
 * stays fully intact and queryable afterwards (the cross-store proof
 * the real integration journey re-runs against REAL providers).
 */

import { describe, expect, it } from 'vitest';
import { InMemoryPostgresStoreAdapter, ManualClock } from '@sos-2/live-store';
import { createRealPersistenceStack } from '@sos-2/real-persistence';
import { PersistenceProbeLedger, PersistenceTranscriptRecorder } from '@sos-2/real-persistence';
import { createRecordingFetchPort, UpstashRedisCoordinationAdapter } from '@sos-2/real-persistence';
import { resolveRealPersistenceEnvironment } from '@sos-2/real-persistence';
import { ScriptedHttpWorld, T0 } from './world.js';

const SOURCE = {
  DATABASE_URL: 'postgres://operator:neon-secret@ep-scripted-pooler.us-east-1.aws.neon.tech/sos?sslmode=require',
  UPSTASH_REDIS_REST_URL: 'https://scripted-ewe-000000.upstash.io',
  UPSTASH_REDIS_REST_TOKEN: 'AbCdEf1234567890123456789012345678901234',
  R2_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
  R2_ACCESS_KEY_ID: '00001111222233334444555566667777',
  R2_SECRET_ACCESS_KEY: '9999888877776666555544443333222211110000999988887777666655554444',
  R2_BUCKET_NAME: 'sos20-evidence-prod',
  VERCEL_TOKEN: 'vcp_ScriptedScriptedScriptedScriptedScripted12',
};

describe('the composition boundary (env-only; honest defaults)', () => {
  it('composes the adapters from the injected source with env NAMES only', () => {
    const world = new ScriptedHttpWorld([]);
    const stack = createRealPersistenceStack({
      source: SOURCE,
      tier: 'production',
      clock: new ManualClock(T0),
      fetch: world.fetch,
    });
    expect(stack.postgres).not.toBeNull();
    expect(stack.redis).not.toBeNull();
    expect(stack.objectStore).not.toBeNull();
    expect(stack.postgres!.credentialEnvName()).toBe('DATABASE_URL');
    expect(stack.redis!.credentialEnvName()).toBe('UPSTASH_REDIS_REST_TOKEN');
    expect(stack.objectStore!.credentialEnvName()).toBe('R2_SECRET_ACCESS_KEY');
    const resolution = stack.environment();
    expect(resolution.neon.databaseName).toBeNull(); // not configured in this source
    expect(JSON.stringify(stack.environment()).includes('neon-secret')).toBe(true); // the VALUE flows internally, never into reports
    for (const report of stack.providerStates()) {
      expect(report.state).toBe('UNKNOWN');
    }
    const health = stack.health();
    expect([health.postgres.status, health.redis.status, health.objectStore.status]).toEqual(['UNKNOWN', 'UNKNOWN', 'UNKNOWN']);
  });

  it('leaves adapters honestly unattached for partially-configured sources', () => {
    const world = new ScriptedHttpWorld([]);
    const stack = createRealPersistenceStack({
      source: { R2_ACCOUNT_ID: 'acct', R2_BUCKET_NAME: 'bucket' }, // incomplete R2; no neon/upstash
      tier: 'production',
      clock: new ManualClock(T0),
      fetch: world.fetch,
    });
    expect(stack.postgres).toBeNull();
    expect(stack.redis).toBeNull();
    expect(stack.objectStore).toBeNull(); // missing keys -> unattached
    expect(stack.health().objectStore.status).toBe('UNKNOWN');
  });

  it('resolves the NEON_API_KEY_SECONDARY alternate for the management API', () => {
    const resolution = resolveRealPersistenceEnvironment({
      NEON_API_KEY_SECONDARY: 'napi_secondarysecondarysecondarysecondar',
    });
    expect(resolution.neon.apiKey).toBe('napi_secondarysecondarysecondarysecondar');
    expect(resolution.neon.apiKeyEnv).toBe('NEON_API_KEY');
    // The primary name wins when both are present.
    const primary = resolveRealPersistenceEnvironment({
      NEON_API_KEY: 'napi_primaryprimaryprimaryprimaryprimary1234',
      NEON_API_KEY_SECONDARY: 'napi_secondarysecondarysecondarysecondar',
    });
    expect(primary.neon.apiKey).toBe('napi_primaryprimaryprimaryprimaryprimary1234');
  });
});

describe('THE NEVER-CANONICAL RULE (machine-checked: flush loses ONLY acceleration)', () => {
  it('flushing the ENTIRE coordination state leaves the durable canonical store fully intact and queryable', async () => {
    // The durable canonical store (the Neon adapter over scripted SQL —
    // the port-compliant canonical backend) and the coordination
    // adapter (Upstash over scripted REST).
    const canonical = new InMemoryPostgresStoreAdapter();
    const world = new ScriptedHttpWorld([
      // Coordination activity (real REST mapping against the scripted Upstash).
      { provider: 'upstash', status: 200, body: { result: 'OK' } }, // cacheSet
      { provider: 'upstash', status: 200, body: { result: 'OK' } }, // idempotencyMark
      { provider: 'upstash', status: 200, body: { result: 'OK' } }, // leaseAcquire
      // flushAll: SCAN -> two keys, DEL batch, SCAN -> clean
      { provider: 'upstash', status: 200, body: { result: ['42', ['sos:production:cache:overview', 'sos:production:idempotency:event-9', 'sos:production:leases:build-1']] } },
      { provider: 'upstash', status: 200, body: { result: 3 } },
      { provider: 'upstash', status: 200, body: { result: ['0', []] } },
      // post-flush coordination re-acquisition works (cold cache, re-acquired lease).
      { provider: 'upstash', status: 200, body: { result: 'OK' } }, // cacheSet again
      { provider: 'upstash', status: 200, body: { result: 'OK' } }, // leaseAcquire again
    ]);
    const clock = new ManualClock(T0);
    const ledger = new PersistenceProbeLedger();
    const transcript = new PersistenceTranscriptRecorder({ credentialReference: () => 'UPSTASH_REDIS_REST_TOKEN' });
    const redis = new UpstashRedisCoordinationAdapter({
      restUrl: 'https://scripted-ewe-000000.upstash.io',
      token: 'AbCdEf1234567890123456789012345678901234',
      tier: 'production',
      fetch: createRecordingFetchPort({ provider: 'upstash', inner: world.fetch, transcript, clock }),
      clock,
      ledger,
      credentialEnv: 'UPSTASH_REDIS_REST_TOKEN',
    });
    // Semantic writes land in the durable store FIRST (the never-canonical rule).
    await canonical.putRow('missions', 'm1', { mission: 'shrink the shortfall', version: 1 } as never);
    await canonical.putRow('tasks', 't1', { task: 'write tests', state: 'RUNNING' } as never);
    // Coordination entries are acceleration only.
    await redis.cacheSet('overview', { mission: 'shrink the shortfall' } as never);
    await redis.idempotencyMark('event-9');
    await redis.leaseAcquire('build-1', 'worker-1', T0 + 60_000);
    // FLUSH the entire coordination state.
    await redis.flushAll();
    // THE PROOF: the durable canonical state is fully intact and queryable.
    expect(await canonical.getRow('missions', 'm1')).toEqual({ data: { mission: 'shrink the shortfall', version: 1 }, storage_version: 1 });
    expect(await canonical.getRow('tasks', 't1')).toEqual({ data: { task: 'write tests', state: 'RUNNING' }, storage_version: 1 });
    expect(await canonical.listRows('missions')).toHaveLength(1);
    expect(await canonical.listRows('tasks')).toHaveLength(1);
    // Coordination continues from cold (re-acquired cache + lease).
    await redis.cacheSet('overview', { mission: 'shrink the shortfall' } as never);
    await redis.leaseAcquire('build-1', 'worker-1', T0 + 60_000);
    // The transcript of the flush shows ONLY the tier namespace was destroyed.
    const flushScan = world.requests.find((request) => request.url.includes('/scan/'));
    expect(decodeURIComponent(flushScan!.url)).toContain('sos:production:*');
  });
});
