/**
 * REDIS IS NEVER CANONICAL (Work Order P2 hard rule).
 *
 * The test destroys/flushes the coordination layer and proves semantic
 * state is INTACT and QUERYABLE from the durable store: records, revision
 * discipline, event replay protection and lease truth all survive; the
 * cache merely repopulates. The same holds when the coordination layer is
 * removed entirely (null) or FAILING (typed UNAVAILABLE).
 */

import { describe, expect, it } from 'vitest';
import { canonicalSerialize } from '@sos-2/semantic-spine';
import {
  InMemoryPostgresStoreAdapter,
  InMemoryRedisCoordinationAdapter,
  ManualClock,
  ProviderUnavailableError,
  createInMemoryLiveStore,
  formatRfc3339,
} from '../src/index.js';
import type { ObjectStoreAdapter, PostgresStoreAdapter, ProviderHealthRecord, RedisCoordinationAdapter } from '../src/index.js';
import * as fixtures from './helpers.js';

const CLOCK_START = Date.parse(fixtures.T0);

describe('Redis is never canonical (flush the coordination layer)', () => {
  it('semantic state survives a full coordination flush — intact and queryable', async () => {
    const clock = new ManualClock(CLOCK_START);
    const durable = new InMemoryPostgresStoreAdapter();
    const redis = new InMemoryRedisCoordinationAdapter({ clock });
    const store = createInMemoryLiveStore({ clock, durable, coordination: redis });

    // Populate semantic state across families + events + leases.
    const mission = fixtures.missionFixture();
    await store.missions.put(mission);
    const evidence = fixtures.evidenceFixture('UNAVAILABLE');
    await store.evidence.put(evidence);
    await store.observationEvents.ingest({
      id: 'evt-flush-0001',
      source: 'github:webhook:payswapdotorg/SOS-2.0',
      kind: 'ci.run',
      occurred_at: fixtures.T1,
      payload: { conclusion: 'success' },
      provenance: ['github:delivery:1'],
    });
    await store.bodyLeases.acquire({
      lease_id: 'lease-flush-0001',
      task_ref: 'task-flush',
      holder: 'body:runner-a',
      expires_at: formatRfc3339(clock.nowEpochMs() + 60_000),
    });

    // Warm the read-through cache, then verify reads work.
    expect(await store.missions.get(mission.envelope.id)).toBeDefined();
    expect(await store.evidence.get(evidence.id)).toBeDefined();
    expect(redis.cacheEntryCount).toBeGreaterThan(0);

    // ─── DESTROY ALL COORDINATION STATE ───
    await redis.flushAll();
    expect(redis.cacheEntryCount).toBe(0);

    // Semantic state is INTACT and QUERYABLE from the durable store.
    const missionAfter = await store.missions.get(mission.envelope.id);
    expect(canonicalSerialize(missionAfter)).toBe(canonicalSerialize(mission));
    const evidenceAfter = await store.evidence.get(evidence.id);
    expect(canonicalSerialize(evidenceAfter)).toBe(canonicalSerialize(evidence));
    expect(evidenceAfter?.availability).toBe('UNAVAILABLE'); // truth state preserved, never folded

    // Event replay protection still works from the DURABLE index.
    const replay = await store.observationEvents.ingest({
      id: 'evt-flush-0001',
      source: 'github:webhook:payswapdotorg/SOS-2.0',
      kind: 'ci.run',
      occurred_at: fixtures.T1,
      payload: { conclusion: 'success' },
      provenance: ['github:delivery:1'],
    });
    expect(replay.kind).toBe('DUPLICATE');
    const events = await store.observationEvents.list({ limit: null });
    expect(events.items).toHaveLength(1); // never double-applied

    // Lease truth is recomputed from the durable record + clock.
    clock.advance(120_000);
    const expired = await store.bodyLeases.expireDue(clock.nowEpochMs());
    expect(expired.map((record) => record.lease_id)).toEqual(['lease-flush-0001']);
    const lease = await store.bodyLeases.get('lease-flush-0001');
    expect(lease?.state).toBe('EXPIRED');

    // New writes still work and the cache repopulates (acceleration only).
    const v2 = fixtures.missionAtVersion(mission, 2);
    const stored = await store.missions.put(v2);
    expect(stored.kind).toBe('STORED');
    expect(await store.missions.get(mission.envelope.id)).toBeDefined();
    expect(redis.cacheEntryCount).toBeGreaterThan(0);

    // Revision discipline survives the flush: a stale write still conflicts.
    const stale = await store.missions.put(fixtures.missionAtVersion(mission, 1));
    expect(stale).toMatchObject({ kind: 'CONFLICT', reason: 'STALE_REVISION', current_revision: 2 });
  });
});

describe('Redis is never canonical (no coordination layer at all)', () => {
  it('the store works end-to-end with coordination: null', async () => {
    const clock = new ManualClock(CLOCK_START);
    const store = createInMemoryLiveStore({ clock, coordination: null });
    const mission = fixtures.missionFixture();
    expect((await store.missions.put(mission)).kind).toBe('STORED');
    expect((await store.missions.get(mission.envelope.id))?.envelope.id).toBe(mission.envelope.id);
    const applied = await store.observationEvents.ingest({
      id: 'evt-nocoord-0001',
      source: 's',
      kind: 'k',
      occurred_at: fixtures.T1,
      payload: { ok: true },
      provenance: ['p'],
    });
    expect(applied.kind).toBe('APPLIED');
    const replay = await store.observationEvents.ingest({
      id: 'evt-nocoord-0001',
      source: 's',
      kind: 'k',
      occurred_at: fixtures.T1,
      payload: { ok: true },
      provenance: ['p'],
    });
    expect(replay.kind).toBe('DUPLICATE');
    const health = store.health();
    expect(health.redis.status).toBe('UNKNOWN'); // honestly reported, never fabricated
    expect(health.redis.detail).toContain('never canonical');
  });
});

describe('Redis is never canonical (coordination layer FAILING)', () => {
  class UnavailableRedis implements RedisCoordinationAdapter {
    readonly providerName = 'redis' as const;
    readonly providerRole = 'coordination-only-never-canonical' as const;
    readonly providerTarget = 'upstash-redis' as const;

    health(): ProviderHealthRecord {
      return {
        provider: 'redis',
        role: this.providerRole,
        status: 'UNAVAILABLE',
        detail: 'connection refused (test double)',
      };
    }

    async cacheGet(): Promise<never> {
      throw new ProviderUnavailableError('redis', 'connection refused');
    }
    async cacheSet(): Promise<never> {
      throw new ProviderUnavailableError('redis', 'connection refused');
    }
    async cacheDelete(): Promise<never> {
      throw new ProviderUnavailableError('redis', 'connection refused');
    }
    async idempotencySeen(): Promise<never> {
      throw new ProviderUnavailableError('redis', 'connection refused');
    }
    async idempotencyMark(): Promise<never> {
      throw new ProviderUnavailableError('redis', 'connection refused');
    }
    async leaseAcquire(): Promise<never> {
      throw new ProviderUnavailableError('redis', 'connection refused');
    }
    async leaseRelease(): Promise<never> {
      throw new ProviderUnavailableError('redis', 'connection refused');
    }
    async leaseHolder(): Promise<never> {
      throw new ProviderUnavailableError('redis', 'connection refused');
    }
    async flushAll(): Promise<never> {
      throw new ProviderUnavailableError('redis', 'connection refused');
    }
  }

  it('semantic reads/writes keep working; health reports typed UNAVAILABLE', async () => {
    const clock = new ManualClock(CLOCK_START);
    const store = createInMemoryLiveStore({ clock, coordination: new UnavailableRedis() });
    const mission = fixtures.missionFixture();
    expect((await store.missions.put(mission)).kind).toBe('STORED');
    const loaded = await store.missions.get(mission.envelope.id);
    expect(canonicalSerialize(loaded)).toBe(canonicalSerialize(mission));
    const applied = await store.observationEvents.ingest({
      id: 'evt-unavail-0001',
      source: 's',
      kind: 'k',
      occurred_at: fixtures.T1,
      payload: null,
      provenance: ['p'],
    });
    expect(applied.kind).toBe('APPLIED');
    const replay = await store.observationEvents.ingest({
      id: 'evt-unavail-0001',
      source: 's',
      kind: 'k',
      occurred_at: fixtures.T1,
      payload: null,
      provenance: ['p'],
    });
    expect(replay.kind).toBe('DUPLICATE');
    // The failure is reported truthfully — never fabricated success.
    expect(store.health().redis.status).toBe('UNAVAILABLE');
  });
});

describe('durable provider failures are typed (never silent)', () => {
  class UnavailablePostgres implements PostgresStoreAdapter {
    readonly providerName = 'postgres' as const;
    readonly providerRole = 'durable-canonical-state' as const;
    readonly providerTarget = 'neon-postgres' as const;

    health(): ProviderHealthRecord {
      return { provider: 'postgres', role: this.providerRole, status: 'UNAVAILABLE', detail: 'connection refused (test double)' };
    }
    async getRow(): Promise<never> {
      throw new ProviderUnavailableError('postgres', 'connection refused');
    }
    async putRow(): Promise<never> {
      throw new ProviderUnavailableError('postgres', 'connection refused');
    }
    async listRows(): Promise<never> {
      throw new ProviderUnavailableError('postgres', 'connection refused');
    }
  }

  class UnavailableObjects implements ObjectStoreAdapter {
    readonly providerName = 'object-store' as const;
    readonly providerRole = 'large-immutable-artifacts' as const;
    readonly providerTarget = 'cloudflare-r2' as const;

    health(): ProviderHealthRecord {
      return { provider: 'object-store', role: this.providerRole, status: 'UNAVAILABLE', detail: 'connection refused (test double)' };
    }
    async putObject(): Promise<never> {
      throw new ProviderUnavailableError('object-store', 'connection refused');
    }
    async getObject(): Promise<never> {
      throw new ProviderUnavailableError('object-store', 'connection refused');
    }
    async hasObject(): Promise<never> {
      throw new ProviderUnavailableError('object-store', 'connection refused');
    }
  }

  it('durable-store failures surface as typed ProviderUnavailableError', async () => {
    const store = createInMemoryLiveStore({
      clock: new ManualClock(CLOCK_START),
      durable: new UnavailablePostgres(),
    });
    await expect(store.missions.get('sos://Mission/' + 'a'.repeat(32))).rejects.toThrow(ProviderUnavailableError);
    await expect(store.missions.put(fixtures.missionFixture())).rejects.toThrow(ProviderUnavailableError);
    expect(store.health().postgres.status).toBe('UNAVAILABLE');
  });

  it('object-store failures surface as typed ProviderUnavailableError', async () => {
    const store = createInMemoryLiveStore({
      clock: new ManualClock(CLOCK_START),
      objects: new UnavailableObjects(),
    });
    await expect(store.objects.putObject(new Uint8Array([1, 2, 3]))).rejects.toThrow(ProviderUnavailableError);
    expect(store.health().objectStore.status).toBe('UNAVAILABLE');
  });
});
