/**
 * Provider-boundary tests (Work Order P2):
 *
 *   REDIS IS NEVER CANONICAL — flushing/destroying the coordination layer
 *   (or removing it entirely) leaves semantic state INTACT and QUERYABLE
 *   from the durable store: byte-identical canonical query results, intact
 *   replay protection, intact revisions.
 *
 *   THE FAILURE MODEL IS TYPED — a provider that fails surfaces typed
 *   availability records (ProviderUnavailableError: the operation was NOT
 *   performed; ProviderUnknownError: the outcome cannot be determined).
 *   Success is NEVER fabricated. Best-effort coordination failures NEVER
 *   fail semantics and are NEVER silently dropped: typed
 *   CoordinationDegradationRecords are recorded and queryable.
 */

import { describe, expect, test } from 'vitest';
import { canonicalSerialize } from '@sos-2/semantic-spine';
import type { ProviderHealthRecord } from '@sos-2/api-contracts';
import { ObjectIntegrityError, ProviderUnavailableError, ProviderUnknownError } from '../src/errors.js';
import type { PostgresRow, PostgresStoreAdapter, RedisCoordinationAdapter } from '../src/provider-ports.js';
import { OBJECT_STORE_ROLE, POSTGRES_ROLE, REDIS_ROLE } from '../src/provider-ports.js';
import { InMemoryObjectStoreAdapter, InMemoryPostgresStoreAdapter, InMemoryRedisCoordinationAdapter } from '../src/in-memory-providers.js';
import { createInMemoryLiveStore } from '../src/facade.js';
import { buildFixtureWorld, fixtureClock } from './helpers.js';

// ---------------------------------------------------------------------------
// Failing provider doubles (typed failure injection)
// ---------------------------------------------------------------------------

class FailingPostgresAdapter implements PostgresStoreAdapter {
  readonly providerId = 'postgres:failing-double';
  readonly role = POSTGRES_ROLE;

  constructor(
    private readonly failure: 'UNAVAILABLE' | 'UNKNOWN',
    private readonly fallback: PostgresStoreAdapter,
  ) {}

  health(): ProviderHealthRecord {
    return {
      provider: this.providerId,
      role: this.role,
      target: 'Neon',
      implementation: 'test-double',
      availability: this.failure === 'UNAVAILABLE' ? 'UNAVAILABLE' : 'UNKNOWN',
      code: this.failure === 'UNAVAILABLE' ? 'CONNECTION_FAILED' : 'OUTCOME_UNDETERMINED',
      canonical: true,
      detail: this.failure === 'UNAVAILABLE' ? 'connection refused (test double)' : 'request timed out; outcome unknown (test double)',
    };
  }

  private fail(): never {
    if (this.failure === 'UNAVAILABLE') {
      throw new ProviderUnavailableError({
        error_kind: 'UNAVAILABLE',
        provider: this.providerId,
        code: 'CONNECTION_FAILED',
        detail: 'connection refused (test double)',
      });
    }
    throw new ProviderUnknownError({
      error_kind: 'UNKNOWN',
      provider: this.providerId,
      code: 'OUTCOME_UNDETERMINED',
      detail: 'request timed out; outcome unknown (test double)',
    });
  }

  async getRow(): Promise<PostgresRow | undefined> {
    this.fail();
  }

  async putRow(): Promise<PostgresRow> {
    this.fail();
  }

  async listRows(): Promise<PostgresRow[]> {
    this.fail();
  }

  async listTables(): Promise<string[]> {
    return this.fallback.listTables();
  }
}

class FailingRedisAdapter implements RedisCoordinationAdapter {
  readonly providerId = 'redis:failing-double';
  readonly role = REDIS_ROLE;

  health(): ProviderHealthRecord {
    return {
      provider: this.providerId,
      role: this.role,
      target: 'Upstash',
      implementation: 'test-double',
      availability: 'UNAVAILABLE',
      code: 'CONNECTION_FAILED',
      canonical: false,
      detail: 'coordination layer down (test double) — semantics must not notice',
    };
  }

  private fail(): never {
    throw new ProviderUnavailableError({
      error_kind: 'UNAVAILABLE',
      provider: this.providerId,
      code: 'CONNECTION_FAILED',
      detail: 'coordination cache operation failed (test double)',
    });
  }

  async cacheGet(): Promise<string | undefined> {
    this.fail();
  }

  async cachePut(): Promise<void> {
    this.fail();
  }

  async cacheDelete(): Promise<void> {
    this.fail();
  }

  async idempotencySeen(): Promise<boolean> {
    this.fail();
  }

  async idempotencyRegister(): Promise<void> {
    this.fail();
  }

  async leaseHeartbeat(): Promise<void> {
    this.fail();
  }

  async leaseIsLive(): Promise<boolean> {
    this.fail();
  }

  async flushAll(): Promise<void> {
    this.fail();
  }
}

// ---------------------------------------------------------------------------
// REDIS IS NEVER CANONICAL
// ---------------------------------------------------------------------------

describe('Redis is never canonical', () => {
  test('flushing the coordination layer leaves semantic state intact and queryable (byte-identical)', async () => {
    const world = buildFixtureWorld();
    const coordination = new InMemoryRedisCoordinationAdapter();
    const store = createInMemoryLiveStore({ clock: fixtureClock(), coordination });
    await seedWorld(store, world);

    const before = await snapshotAll(store, world);

    // Destroy the coordination layer.
    await coordination.flushAll();

    const after = await snapshotAll(store, world);
    expect(after).toEqual(before);
    expect(after.mission).toBe(canonicalSerialize(world.mission));
    expect(after.task).toBe(canonicalSerialize(world.taskV2));
    expect(after.eventCount).toBe(3);
  });

  test('replay protection + optimistic concurrency still work after a flush', async () => {
    const world = buildFixtureWorld();
    const coordination = new InMemoryRedisCoordinationAdapter();
    const store = createInMemoryLiveStore({ clock: fixtureClock(), coordination });
    await seedWorld(store, world);

    await coordination.flushAll();

    const duplicate = await store.events.ingest(world.events[0]!);
    expect(duplicate.outcome).toBe('DUPLICATE');
    const stale = await store.task.put(world.task);
    expect(stale.outcome).toBe('REVISION_CONFLICT');
    const idempotent = await store.mission.put(world.mission);
    expect(idempotent.outcome).toBe('IDEMPOTENT_REPLAY');
  });

  test('the store works with NO coordination layer at all (semantics never depend on Redis)', async () => {
    const world = buildFixtureWorld();
    const store = createInMemoryLiveStore({ clock: fixtureClock(), coordination: null });
    await seedWorld(store, world);

    const mission = await store.mission.get(world.mission.envelope.id);
    expect(canonicalSerialize(mission)).toBe(canonicalSerialize(world.mission));
    const duplicate = await store.events.ingest(world.events[1]!);
    expect(duplicate.outcome).toBe('DUPLICATE');
    expect(store.health()).toHaveLength(2); // durable + object store only
    expect(store.coordinationHealth()).toEqual([]);
  });

  test('the coordination layer caches records but the cache is verified and evictable', async () => {
    const world = buildFixtureWorld();
    const coordination = new InMemoryRedisCoordinationAdapter();
    const store = createInMemoryLiveStore({ clock: fixtureClock(), coordination });
    await store.mission.put(world.mission);

    // The write-through populated the cache; reads still return the verbatim record.
    const cached = await coordination.cacheGet(`mission:${world.mission.envelope.id}`);
    expect(cached).toBe(canonicalSerialize(world.mission));
    const viaStore = await store.mission.get(world.mission.envelope.id);
    expect(canonicalSerialize(viaStore)).toBe(cached);

    // A POISONED cache entry (wrong canonical form) is evicted and repaired
    // from the durable store, and the degradation is RECORDED (typed).
    await coordination.cachePut(`mission:${world.mission.envelope.id}`, '{"poisoned":true}');
    const repaired = await store.mission.get(world.mission.envelope.id);
    expect(canonicalSerialize(repaired)).toBe(canonicalSerialize(world.mission));
    const degradations = store.coordinationHealth();
    expect(degradations).toHaveLength(1);
    expect(degradations[0]?.code).toBe('CACHE_CORRUPTION_EVICTED');
    expect(degradations[0]?.degraded_operations).toBe(1);
    // The cache was repaired.
    const after = await coordination.cacheGet(`mission:${world.mission.envelope.id}`);
    expect(after).toBe(canonicalSerialize(world.mission));
  });
});

// ---------------------------------------------------------------------------
// The typed failure model
// ---------------------------------------------------------------------------

describe('the explicit UNKNOWN/UNAVAILABLE failure model', () => {
  test('an UNAVAILABLE durable provider surfaces typed ProviderUnavailableError — success is never fabricated', async () => {
    const world = buildFixtureWorld();
    const failing = new FailingPostgresAdapter('UNAVAILABLE', new InMemoryPostgresStoreAdapter({ clock: fixtureClock() }));
    const store = createInMemoryLiveStore({ clock: fixtureClock(), durable: failing, coordination: null });

    await expect(store.mission.put(world.mission)).rejects.toBeInstanceOf(ProviderUnavailableError);
    await expect(store.mission.get(world.mission.envelope.id)).rejects.toBeInstanceOf(ProviderUnavailableError);
    await expect(store.mission.list()).rejects.toBeInstanceOf(ProviderUnavailableError);
    await expect(store.events.ingest(world.events[0]!)).rejects.toBeInstanceOf(ProviderUnavailableError);

    const caught = store.mission.put(world.mission).catch((cause: unknown) => cause) as Promise<unknown>;
    const error = (await caught) as ProviderUnavailableError;
    expect(error.availability.error_kind).toBe('UNAVAILABLE');
    expect(error.availability.provider).toBe('postgres:failing-double');
    expect(error.availability.code).toBe('CONNECTION_FAILED');
  });

  test('an UNKNOWN-outcome durable provider surfaces typed ProviderUnknownError (UNKNOWN is not UNAVAILABLE)', async () => {
    const world = buildFixtureWorld();
    const failing = new FailingPostgresAdapter('UNKNOWN', new InMemoryPostgresStoreAdapter({ clock: fixtureClock() }));
    const store = createInMemoryLiveStore({ clock: fixtureClock(), durable: failing, coordination: null });

    const error = (await store.task.put(world.task).catch((cause: unknown) => cause)) as ProviderUnknownError;
    expect(error).toBeInstanceOf(ProviderUnknownError);
    expect(error.availability.error_kind).toBe('UNKNOWN');
    expect(error.availability.code).toBe('OUTCOME_UNDETERMINED');
  });

  test('a FAILING coordination layer never fails semantics and its degradation is recorded (typed, never silent)', async () => {
    const world = buildFixtureWorld();
    const store = createInMemoryLiveStore({
      clock: fixtureClock(),
      coordination: new FailingRedisAdapter(),
    });

    // Writes and reads SUCCEED despite the coordination layer being down.
    const put = await store.mission.put(world.mission);
    expect(put.outcome).toBe('STORED');
    const got = await store.mission.get(world.mission.envelope.id);
    expect(canonicalSerialize(got)).toBe(canonicalSerialize(world.mission));
    const applied = await store.events.ingest(world.events[0]!);
    expect(applied.outcome).toBe('APPLIED');

    // The degradation is typed, counted and queryable — never silent.
    const degradations = store.coordinationHealth();
    expect(degradations.length).toBeGreaterThanOrEqual(1);
    expect(degradations.every((entry) => entry.provider === 'redis:failing-double')).toBe(true);
    expect(degradations.some((entry) => entry.code === 'COORDINATION_OPERATION_FAILED')).toBe(true);
    expect(degradations.some((entry) => entry.code === 'IDEMPOTENCY_REGISTER_FAILED')).toBe(true);
    expect(degradations.every((entry) => entry.degraded_operations >= 1)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Health records + object-store integrity
// ---------------------------------------------------------------------------

describe('typed provider health', () => {
  test('the reference facade reports all three provider roles (Redis reports canonical: false)', () => {
    const store = createInMemoryLiveStore({ clock: fixtureClock() });
    const health = store.health();
    expect(health).toHaveLength(3);

    const postgres = health.find((entry) => entry.provider === 'postgres:memory-reference');
    expect(postgres?.availability).toBe('UP');
    expect(postgres?.canonical).toBe(true);
    expect(postgres?.target).toBe('Neon');
    expect(postgres?.role).toBe(POSTGRES_ROLE);

    const redis = health.find((entry) => entry.provider === 'redis:memory-reference');
    expect(redis?.availability).toBe('UP');
    expect(redis?.canonical).toBe(false);
    expect(redis?.role).toBe(REDIS_ROLE);
    expect(redis?.target).toBe('Upstash');

    const objectStore = health.find((entry) => entry.provider === 'object-store:memory-reference');
    expect(objectStore?.availability).toBe('UP');
    expect(objectStore?.canonical).toBe(true);
    expect(objectStore?.target).toBe('Cloudflare R2');
    expect(objectStore?.role).toBe(OBJECT_STORE_ROLE);
  });

  test('a failing provider reports its typed availability through health()', () => {
    const failing = new FailingPostgresAdapter('UNAVAILABLE', new InMemoryPostgresStoreAdapter({ clock: fixtureClock() }));
    const store = createInMemoryLiveStore({ clock: fixtureClock(), durable: failing, coordination: null });
    const postgres = store.health().find((entry) => entry.provider === 'postgres:failing-double');
    expect(postgres?.availability).toBe('UNAVAILABLE');
    expect(postgres?.code).toBe('CONNECTION_FAILED');
  });
});

describe('object-store integrity (content addressing is enforced)', () => {
  test('different bytes under an existing content hash are a typed integrity violation', async () => {
    const objectStore = new InMemoryObjectStoreAdapter();
    const hash = 'a'.repeat(64);
    await objectStore.putObject(hash, new TextEncoder().encode('first'));
    await expect(objectStore.putObject(hash, new TextEncoder().encode('different'))).rejects.toBeInstanceOf(ObjectIntegrityError);
    // The original object is untouched.
    const bytes = await objectStore.getObject(hash);
    expect(new TextDecoder().decode(bytes)).toBe('first');
  });

  test('malformed content hashes are rejected loudly', async () => {
    const objectStore = new InMemoryObjectStoreAdapter();
    await expect(objectStore.putObject('nothex', new Uint8Array())).rejects.toBeInstanceOf(ObjectIntegrityError);
    await expect(objectStore.getObject('short')).rejects.toBeInstanceOf(ObjectIntegrityError);
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface SemanticSnapshot {
  mission: string;
  evidence: string;
  task: string;
  lease: string;
  events: string[];
  eventCount: number;
  artifactCount: number;
}

async function snapshotAll(store: ReturnType<typeof createInMemoryLiveStore>, world: ReturnType<typeof buildFixtureWorld>): Promise<SemanticSnapshot> {
  const mission = await store.mission.get(world.mission.envelope.id);
  const evidence = await store.evidence.get(world.evidence.id);
  const task = await store.task.get(world.task.task_id);
  const lease = await store.bodyLease.get(world.bodyLease.lease_id);
  const events = await store.events.list();
  return {
    mission: canonicalSerialize(mission),
    evidence: canonicalSerialize(evidence),
    task: canonicalSerialize(task),
    lease: canonicalSerialize(lease),
    events: events.map((event) => canonicalSerialize(event)),
    eventCount: await store.events.size(),
    artifactCount: (await store.artifacts.list()).length,
  };
}

async function seedWorld(store: ReturnType<typeof createInMemoryLiveStore>, world: ReturnType<typeof buildFixtureWorld>): Promise<void> {
  await store.mission.put(world.mission);
  await store.evidence.put(world.evidence);
  await store.task.put(world.task);
  await store.task.put(world.taskV2);
  await store.bodyLease.put(world.bodyLease);
  await store.artifacts.put(new TextEncoder().encode('a durable artifact blob'));
  for (const event of world.events) {
    await store.events.ingest(event);
  }
}
