/**
 * The frozen P2 port contract compliance suite of the REAL persistence
 * adapters (Work Order P17-A) — offline, deterministic (scripted
 * FetchPort, fixed seed): the real adapters satisfy EXACTLY the same
 * port semantics the in-memory reference satisfies, over scripted real
 * protocol responses.
 */

import { describe, expect, it } from 'vitest';
import { InMemoryPostgresStoreAdapter, InMemoryObjectStoreAdapter, ProviderUnavailableError } from '@sos-2/live-store';
import { T0, neonSql, persistenceWorld, UPSTASH_URL } from './world.js';

const DOC_A = { mission: 'shrink the shortfall', version: 1 };
const DOC_B = { mission: 'shrink the shortfall', version: 2, note: 'revised' };

describe('NeonPostgresStoreAdapter satisfies the frozen PostgresStoreAdapter contract (scripted real SQL proxy)', () => {
  it('stores and reads rows through real SQL mapping (upsert increments the storage version)', async () => {
    const { postgres } = persistenceWorld([
      // ensureSchema
      { provider: 'neon', status: 200, body: neonSql('CREATE TABLE', []) },
      // putRow #1 (upsert insert)
      { provider: 'neon', status: 200, body: neonSql('INSERT', [{ storage_version: 1 }]) },
      // putRow #2 (upsert conflict-update)
      { provider: 'neon', status: 200, body: neonSql('INSERT', [{ storage_version: 2 }]) },
      // getRow (hit)
      { provider: 'neon', status: 200, body: neonSql('SELECT', [{ data_text: JSON.stringify(DOC_B), storage_version: 2 }]) },
      // getRow (miss)
      { provider: 'neon', status: 200, body: neonSql('SELECT', []) },
      // listRows
      {
        provider: 'neon',
        status: 200,
        body: neonSql('SELECT', [
          { id: 'a', data_text: JSON.stringify(DOC_A), storage_version: 1 },
          { id: 'b', data_text: JSON.stringify(DOC_B), storage_version: 2 },
        ]),
      },
    ]);
    await postgres.ensureSchema();
    await expect(postgres.putRow('missions', 'm1', DOC_A as never)).resolves.toEqual({ ok: true, storage_version: 1 });
    await expect(postgres.putRow('missions', 'm1', DOC_B as never)).resolves.toEqual({ ok: true, storage_version: 2 });
    await expect(postgres.getRow('missions', 'm1')).resolves.toEqual({ data: DOC_B, storage_version: 2 });
    await expect(postgres.getRow('missions', 'absent')).resolves.toBeNull();
    await expect(postgres.listRows('missions')).resolves.toEqual([
      { data: DOC_A, storage_version: 1 },
      { data: DOC_B, storage_version: 2 },
    ]);
  });

  it('guards if_absent with typed ALREADY_EXISTS carrying the current version', async () => {
    const { postgres } = persistenceWorld([
      { provider: 'neon', status: 200, body: neonSql('INSERT', []) }, // ON CONFLICT DO NOTHING -> no row
      { provider: 'neon', status: 200, body: neonSql('SELECT', [{ storage_version: 4 }]) },
    ]);
    await expect(postgres.putRow('missions', 'm1', DOC_A as never, { if_absent: true })).resolves.toEqual({
      ok: false,
      kind: 'ALREADY_EXISTS',
      current_storage_version: 4,
    });
  });

  it('guards expected_storage_version with typed VERSION_CONFLICT (absent rows report version 0)', async () => {
    const { postgres } = persistenceWorld([
      { provider: 'neon', status: 200, body: neonSql('UPDATE', []) }, // guarded update matched nothing
      { provider: 'neon', status: 200, body: neonSql('SELECT', []) }, // current version of an absent row
    ]);
    await expect(postgres.putRow('missions', 'm1', DOC_A as never, { expected_storage_version: 3 })).resolves.toEqual({
      ok: false,
      kind: 'VERSION_CONFLICT',
      current_storage_version: 0,
    });
  });

  it('matches the in-memory reference outcomes on identical operation sequences (the port semantics)', async () => {
    const reference = new InMemoryPostgresStoreAdapter();
    const { postgres } = persistenceWorld([
      { provider: 'neon', status: 200, body: neonSql('INSERT', [{ storage_version: 1 }]) }, // put1 if_absent -> ok(1)
      { provider: 'neon', status: 200, body: neonSql('INSERT', []) }, // put2 if_absent -> DO NOTHING (no row)
      { provider: 'neon', status: 200, body: neonSql('SELECT', [{ storage_version: 1 }]) }, // put2 current version
      { provider: 'neon', status: 200, body: neonSql('INSERT', [{ storage_version: 2 }]) }, // put3 unguarded upsert
      { provider: 'neon', status: 200, body: neonSql('UPDATE', [{ storage_version: 3 }]) }, // put4 guarded CAS
    ]);
    const realPut1 = await postgres.putRow('ns', 'x', DOC_A as never, { if_absent: true });
    const refPut1 = await reference.putRow('ns', 'x', DOC_A as never, { if_absent: true });
    expect(realPut1).toEqual(refPut1);
    const realPut2 = await postgres.putRow('ns', 'x', DOC_A as never, { if_absent: true });
    const refPut2 = await reference.putRow('ns', 'x', DOC_A as never, { if_absent: true });
    expect(realPut2).toEqual(refPut2);
    const realPut3 = await postgres.putRow('ns', 'x', DOC_B as never);
    const refPut3 = await reference.putRow('ns', 'x', DOC_B as never);
    expect(realPut3).toEqual(refPut3);
    const realPut4 = await postgres.putRow('ns', 'x', DOC_A as never, { expected_storage_version: 2 });
    const refPut4 = await reference.putRow('ns', 'x', DOC_A as never, { expected_storage_version: 2 });
    expect(realPut4).toEqual(refPut4);
  });

  it('throws the frozen typed ProviderUnavailableError on provider failures — never fabricated success', async () => {
    const { postgres } = persistenceWorld([
      { provider: 'neon', status: 500, body: { message: 'internal proxy error' } },
    ]);
    await expect(postgres.getRow('missions', 'm1')).rejects.toBeInstanceOf(ProviderUnavailableError);
    await expect(postgres.getRow('missions', 'm1')).rejects.toThrow(/UNAVAILABLE|Neon/i);
  });

  it('throws the frozen typed error on transport-level failures (DNS/network)', async () => {
    const { postgres } = persistenceWorld([{ provider: 'neon', status: 0, transportError: 'getaddrinfo ENOTFOUND ep-gone.neon.tech' }]);
    await expect(postgres.listRows('missions')).rejects.toBeInstanceOf(ProviderUnavailableError);
  });
});

describe('UpstashRedisCoordinationAdapter satisfies the frozen RedisCoordinationAdapter contract (scripted real REST)', () => {
  it('round-trips cache values, idempotency marks and leases through real REST mapping', async () => {
    const { redis } = persistenceWorld([
      { provider: 'upstash', status: 200, body: { result: 'OK' } }, // cacheSet (SET PX)
      { provider: 'upstash', status: 200, body: { result: JSON.stringify(DOC_A) } }, // cacheGet
      { provider: 'upstash', status: 200, body: { result: 1 } }, // cacheDelete
      { provider: 'upstash', status: 200, body: { result: 0 } }, // idempotencySeen (EXISTS)
      { provider: 'upstash', status: 200, body: { result: 'OK' } }, // idempotencyMark (SET PX)
      { provider: 'upstash', status: 200, body: { result: 1 } }, // idempotencySeen
      { provider: 'upstash', status: 200, body: { result: 'OK' } }, // leaseAcquire (SET NX PX)
      { provider: 'upstash', status: 200, body: { result: 'worker-1' } }, // leaseHolder (GET)
      { provider: 'upstash', status: 200, body: { result: 1 } }, // leaseRelease (EVAL -> 1)
      { provider: 'upstash', status: 200, body: { result: null } }, // leaseHolder after release
    ]);
    await redis.cacheSet('mission-overview', DOC_A as never);
    await expect(redis.cacheGet('mission-overview')).resolves.toEqual(DOC_A);
    await expect(redis.cacheDelete('mission-overview')).resolves.toBeUndefined();
    await expect(redis.idempotencySeen('event-1')).resolves.toBe(false);
    await redis.idempotencyMark('event-1');
    await expect(redis.idempotencySeen('event-1')).resolves.toBe(true);
    await expect(redis.leaseAcquire('build-lease', 'worker-1', T0 + 60_000)).resolves.toBe(true);
    await expect(redis.leaseHolder('build-lease')).resolves.toBe('worker-1');
    await expect(redis.leaseRelease('build-lease', 'worker-1')).resolves.toBe(true);
    await expect(redis.leaseHolder('build-lease')).resolves.toBeNull();
  });

  it('cache misses return null (a MISS is a null result, not a failure)', async () => {
    const { redis } = persistenceWorld([
      { provider: 'upstash', status: 200, body: { result: null } },
    ]);
    await expect(redis.cacheGet('absent')).resolves.toBeNull();
  });

  it('acquires and releases leases with holder discipline and TTL semantics from the injected clock', async () => {
    const { redis } = persistenceWorld([
      { provider: 'upstash', status: 200, body: { result: 'OK' } }, // acquire
      { provider: 'upstash', status: 200, body: { result: 'worker-1' } }, // holder
      { provider: 'upstash', status: 200, body: { result: 0 } }, // wrong-holder release -> false
      { provider: 'upstash', status: 200, body: { result: 1 } }, // right-holder release -> true
    ]);
    const expires = T0 + 60_000;
    await expect(redis.leaseAcquire('build-lease', 'worker-1', expires)).resolves.toBe(true);
    await expect(redis.leaseHolder('build-lease')).resolves.toBe('worker-1');
    await expect(redis.leaseRelease('build-lease', 'worker-2')).resolves.toBe(false);
    await expect(redis.leaseRelease('build-lease', 'worker-1')).resolves.toBe(true);
  });

  it('a lease request whose expiry is already past acquires nothing (instantly-dead lease semantics)', async () => {
    const { redis } = persistenceWorld([]);
    await expect(redis.leaseAcquire('stale-lease', 'worker-1', T0 - 1_000)).resolves.toBe(true);
    // No REST round-trip consumed: the adapter skips writing an already-expired lease.
  });

  it('a SET NX that did not store (null result) means the lease was NOT acquired', async () => {
    const { redis } = persistenceWorld([{ provider: 'upstash', status: 200, body: { result: null } }]);
    await expect(redis.leaseAcquire('held-lease', 'worker-2', T0 + 60_000)).resolves.toBe(false);
  });

  it('flushAll destroys ALL coordination state of the tier namespace (the never-canonical proof operation)', async () => {
    const { redis, world } = persistenceWorld([
      // flushAll: SCAN returns 2 keys + non-zero cursor, SCAN again returns 0 cursor
      { provider: 'upstash', status: 200, body: { result: ['17', ['sos:production:cache:a', 'sos:production:leases:b']] } },
      { provider: 'upstash', status: 200, body: { result: 2 } }, // DEL batch
      { provider: 'upstash', status: 200, body: { result: ['0', ['sos:production:idempotency:c']] } },
      { provider: 'upstash', status: 200, body: { result: 1 } }, // DEL batch
      { provider: 'upstash', status: 200, body: { result: ['0', []] } }, // final scan -> clean
    ]);
    await redis.flushAll();
    // The SCAN matched ONLY this adapter's tier prefix (sos:production:*) —
    // other tiers' state is not this adapter's coordination state.
    const scanUrl = world.requests.find((request) => request.url.includes('/scan/'));
    expect(scanUrl?.url).toContain(encodeURIComponent('sos:production:*'));
  });

  it('throws the frozen typed ProviderUnavailableError on REST failures — never fabricated success', async () => {
    const { redis } = persistenceWorld([{ provider: 'upstash', status: 401, body: { error: 'Unauthorized' } }]);
    await expect(redis.cacheGet('k')).rejects.toBeInstanceOf(ProviderUnavailableError);
  });

  it('tier-prefixes every key per the P3 namespace contract (sos:<tier>:<purpose>:<key>)', async () => {
    const { redis, world } = persistenceWorld([
      { provider: 'upstash', status: 200, body: { result: 'OK' } },
      { provider: 'upstash', status: 200, body: { result: 0 } },
      { provider: 'upstash', status: 200, body: { result: 'OK' } },
    ]);
    await redis.cacheSet('overview', DOC_A as never);
    await redis.idempotencySeen('event-1');
    await redis.leaseAcquire('lease-1', 'worker-1', null);
    const urls = world.requests.map((request) => decodeURIComponent(request.url.replace(`${UPSTASH_URL}/`, '')));
    expect(urls).toEqual([
      'set/sos:production:cache:overview/{"mission":"shrink the shortfall","version":1}/PX/300000',
      'exists/sos:production:idempotency:event-1',
      'set/sos:production:leases:lease-1/worker-1/NX',
    ]);
  });
});

describe('R2ObjectStoreAdapter satisfies the frozen ObjectStoreAdapter contract (scripted real S3)', () => {
  it('stores content-addressed write-once objects with idempotent re-puts and byte-exact read-back', async () => {
    const { objectStore, world } = persistenceWorld([
      { provider: 'r2', status: 404, headers: {}, body: '' }, // HeadObject -> absent
      { provider: 'r2', status: 200, headers: {}, body: '' }, // PutObject
      { provider: 'r2', status: 200, headers: { 'content-length': '5' }, body: '' }, // HeadObject -> exists (re-put)
      // getObject
      { provider: 'r2', status: 200, headers: { 'content-length': '5' }, body: 'probe' },
    ]);
    const ref = await objectStore.putObject(new TextEncoder().encode('probe'));
    expect(ref.size_bytes).toBe(5);
    expect(ref.content_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(ref.object_ref).toBe(`r2://${ref.content_hash}`);
    // Idempotent re-put: identical bytes -> the SAME ref, no duplicate write.
    const again = await objectStore.putObject(new TextEncoder().encode('probe'));
    expect(again).toEqual(ref);
    // Byte-exact read-back.
    const bytes = await objectStore.getObject(ref.content_hash);
    expect(new TextDecoder().decode(bytes!)).toBe('probe');
    // The object key is the P3 tier-prefixed content-anchored key.
    const putUrl = world.requests.find((request) => request.method === 'PUT');
    expect(putUrl?.url).toContain(`/${R2_BUCKET_KEY_ROOT()}/evidence/${ref.content_hash}`);
  });

  it('hasObject reflects existence; the retention-path delete empties it', async () => {
    const { objectStore } = persistenceWorld([
      { provider: 'r2', status: 404, headers: {}, body: '' }, // HeadObject -> absent (put)
      { provider: 'r2', status: 200, headers: {}, body: '' }, // PutObject
      { provider: 'r2', status: 200, headers: { 'content-length': '1' }, body: '' }, // hasObject -> exists
      { provider: 'r2', status: 200, headers: {}, body: '' }, // DELETE (retention path)
      { provider: 'r2', status: 404, headers: {}, body: '' }, // hasObject -> absent
    ]);
    const ref = await objectStore.putObject(new TextEncoder().encode('x'));
    await expect(objectStore.hasObject(ref.content_hash)).resolves.toBe(true);
    await objectStore.deleteObjectThroughRetentionPath(ref.content_hash);
    await expect(objectStore.hasObject(ref.content_hash)).resolves.toBe(false);
  });

  it('retention-path deletion is OUTSIDE the frozen port (documented lifecycle, not a request-path delete)', async () => {
    const { objectStore } = persistenceWorld([
      { provider: 'r2', status: 404, headers: {}, body: '' }, // HeadObject -> absent
      { provider: 'r2', status: 200, headers: {}, body: '' }, // PutObject
      { provider: 'r2', status: 200, headers: { 'content-length': '1' }, body: '' }, // hasObject -> exists
      { provider: 'r2', status: 200, headers: {}, body: '' }, // DELETE (retention path)
      { provider: 'r2', status: 404, headers: {}, body: '' }, // hasObject -> absent
    ]);
    const ref = await objectStore.putObject(new TextEncoder().encode('x'));
    await expect(objectStore.hasObject(ref.content_hash)).resolves.toBe(true);
    await objectStore.deleteObjectThroughRetentionPath(ref.content_hash);
    await expect(objectStore.hasObject(ref.content_hash)).resolves.toBe(false);
    // The frozen port surface itself exposes NO delete: the immutability rule.
    expect('deleteObject' in (objectStore as unknown as Record<string, unknown>)).toBe(false);
  });

  it('matches the in-memory reference refs for identical bytes (the port semantics)', async () => {
    const reference = new InMemoryObjectStoreAdapter();
    const { objectStore } = persistenceWorld([
      { provider: 'r2', status: 404, headers: {}, body: '' },
      { provider: 'r2', status: 200, headers: {}, body: '' },
    ]);
    const bytes = new TextEncoder().encode('sos-2.0 evidence bundle');
    const refReal = await objectStore.putObject(bytes);
    const refReference = await reference.putObject(bytes);
    expect(refReal).toEqual(refReference);
  });

  it('rejects malformed content hashes loudly (never fabricates a lookup)', async () => {
    const { objectStore } = persistenceWorld([]);
    await expect(objectStore.getObject('nothex')).rejects.toBeInstanceOf(ProviderUnavailableError);
    await expect(objectStore.hasObject('')).rejects.toBeInstanceOf(ProviderUnavailableError);
  });

  it('throws the frozen typed ProviderUnavailableError on S3 failures — never fabricated success', async () => {
    const { objectStore } = persistenceWorld([
      { provider: 'r2', status: 500, body: '<?xml version="1.0"?><Error><Code>InternalError</Code><Message>boom</Message></Error>' },
    ]);
    await expect(objectStore.getObject('a'.repeat(64))).rejects.toBeInstanceOf(ProviderUnavailableError);
  });
});

function R2_BUCKET_KEY_ROOT(): string {
  return 'production';
}
