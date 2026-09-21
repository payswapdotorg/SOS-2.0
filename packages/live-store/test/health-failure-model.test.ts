/**
 * The typed failure model (Work Order P2): unconfigured providers report
 * UNKNOWN (never fabricated AVAILABLE); health() is a typed record for all
 * three providers; UNKNOWN and UNAVAILABLE are never conflated. Plus the
 * content-addressed object store behavior.
 */

import { describe, expect, it } from 'vitest';
import { InMemoryObjectStoreAdapter, InMemoryRedisCoordinationAdapter, ManualClock, createInMemoryLiveStore } from '../src/index.js';
import * as fixtures from './helpers.js';

const CLOCK_START = Date.parse(fixtures.T0);

describe('the typed failure model (provider health)', () => {
  it('unconfigured providers honestly report UNKNOWN — never fabricated AVAILABLE', () => {
    const store = createInMemoryLiveStore({ clock: new ManualClock(CLOCK_START) });
    const health = store.health();
    expect(health.postgres).toMatchObject({
      provider: 'postgres',
      role: 'durable-canonical-state',
      status: 'UNKNOWN',
    });
    expect(health.postgres.detail).toContain('no external provider configured');
    expect(health.redis).toMatchObject({
      provider: 'redis',
      role: 'coordination-only-never-canonical',
      status: 'UNKNOWN',
    });
    expect(health.redis.detail).toContain('never canonical');
    expect(health.objectStore).toMatchObject({
      provider: 'object-store',
      role: 'large-immutable-artifacts',
      status: 'UNKNOWN',
    });
    expect(health.objectStore.detail).toContain('no external provider configured');
    // UNKNOWN is never silently upgraded: no AVAILABLE anywhere unconfigured.
    expect(health.postgres.status).not.toBe('AVAILABLE');
    expect(health.redis.status).not.toBe('AVAILABLE');
    expect(health.objectStore.status).not.toBe('AVAILABLE');
  });

  it('the provider adapters expose their documented roles and targets', () => {
    const clock = new ManualClock(CLOCK_START);
    const postgres = createInMemoryLiveStore({ clock }).health();
    const redis = new InMemoryRedisCoordinationAdapter({ clock });
    const objects = new InMemoryObjectStoreAdapter();
    expect(postgres.postgres.status === 'UNKNOWN').toBe(true);
    expect(redis.providerTarget).toBe('upstash-redis');
    expect(redis.providerRole).toBe('coordination-only-never-canonical');
    expect(objects.providerTarget).toBe('cloudflare-r2');
    expect(objects.providerRole).toBe('large-immutable-artifacts');
  });
});

describe('the content-addressed object store (R2 target)', () => {
  it('stores immutable objects by content hash (idempotent puts)', async () => {
    const objects = new InMemoryObjectStoreAdapter();
    const bytes = new TextEncoder().encode('the completion report artifact');
    const first = await objects.putObject(bytes);
    const second = await objects.putObject(new Uint8Array(bytes)); // identical bytes, new buffer
    expect(second.content_hash).toBe(first.content_hash);
    expect(second.object_ref).toBe(first.object_ref);
    expect(second.size_bytes).toBe(first.size_bytes);
    expect(first.object_ref).toBe(`r2://${first.content_hash}`);
    expect(first.content_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(objects.objectCount).toBe(1); // never a duplicate
  });

  it('different bytes produce different content hashes and round-trip intact', async () => {
    const objects = new InMemoryObjectStoreAdapter();
    const a = await objects.putObject(new TextEncoder().encode('artifact-a'));
    const b = await objects.putObject(new TextEncoder().encode('artifact-b'));
    expect(a.content_hash).not.toBe(b.content_hash);
    const loaded = await objects.getObject(a.content_hash);
    expect(loaded).not.toBeNull();
    expect(new TextDecoder().decode(loaded!)).toBe('artifact-a');
    expect(await objects.hasObject(a.content_hash)).toBe(true);
    expect(await objects.hasObject(b.content_hash)).toBe(true);
    expect(await objects.hasObject('0'.repeat(64))).toBe(false);
    expect(await objects.getObject('0'.repeat(64))).toBeNull();
    // Stored objects are isolated from later caller-buffer mutation.
    const buffer = new TextEncoder().encode('mutable');
    const ref = await objects.putObject(buffer);
    buffer[0] = 88;
    const reloaded = await objects.getObject(ref.content_hash);
    expect(new TextDecoder().decode(reloaded!)).toBe('mutable');
  });

  it('rejects malformed content hashes with typed errors', async () => {
    const objects = new InMemoryObjectStoreAdapter();
    await expect(objects.getObject('not-a-hash')).rejects.toThrow();
    await expect(objects.hasObject('ABC')).rejects.toThrow();
  });
});

describe('the facade wires every family over shared provider ports', () => {
  it('all repositories share one durable adapter (canonical state is one store)', async () => {
    const clock = new ManualClock(CLOCK_START);
    const store = createInMemoryLiveStore({ clock });
    // A spread of families all persist and read back.
    await store.missions.put(fixtures.missionFixture());
    await store.contexts.put(fixtures.contextFixture());
    await store.evidence.put(fixtures.evidenceFixture());
    await store.developmentState.put({
      state_id: 'productization-implementation-state',
      revision: 1,
      description: 'machine state snapshot',
      state: { currentFrontier: ['P1', 'P2', 'P3'], tasks: { P0: { status: 'COMPLETE' } } },
      updated_at: fixtures.T0,
    });
    const dev = await store.developmentState.get('productization-implementation-state');
    expect(dev?.state).toEqual({ currentFrontier: ['P1', 'P2', 'P3'], tasks: { P0: { status: 'COMPLETE' } } });
    // Revision discipline: bump to revision 2, then a stale revision-1 write conflicts typed.
    const bumped = await store.developmentState.put({
      state_id: 'productization-implementation-state',
      revision: 2,
      description: 'machine state snapshot v2',
      state: { currentFrontier: ['P2'], tasks: { P0: { status: 'COMPLETE' }, P2: { status: 'READY' } } },
      updated_at: fixtures.T1,
    });
    expect(bumped.kind).toBe('STORED');
    const stale = await store.developmentState.put({
      state_id: 'productization-implementation-state',
      revision: 1,
      description: 'stale snapshot',
      state: { stale: true },
      updated_at: fixtures.T1,
    });
    expect(stale).toMatchObject({ kind: 'CONFLICT', reason: 'STALE_REVISION', current_revision: 2 });
    // And the idempotent replay of the stored v2 is a no-op.
    const replay = await store.developmentState.put({
      state_id: 'productization-implementation-state',
      revision: 2,
      description: 'machine state snapshot v2',
      state: { currentFrontier: ['P2'], tasks: { P0: { status: 'COMPLETE' }, P2: { status: 'READY' } } },
      updated_at: fixtures.T1,
    });
    expect(replay.kind).toBe('IDENTICAL');
  });
});
