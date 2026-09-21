/**
 * Task/checkpoint durability tests (Work Order P2, the section 6 shape of
 * spec/productization-execution-architecture.md): a body crash, provider
 * outage or process loss must not erase the task. The durable substrate
 * (the PostgresStoreAdapter role) outlives facade recreation; the full
 * section 6 field set round-trips; produced artifacts are content-addressed
 * in the object store and survive with the task.
 */

import { describe, expect, test } from 'vitest';
import { canonicalSerialize } from '@sos-2/semantic-spine';
import { createInMemoryLiveStore } from '../src/facade.js';
import { InMemoryPostgresStoreAdapter, InMemoryObjectStoreAdapter, InMemoryRedisCoordinationAdapter } from '../src/in-memory-providers.js';
import { buildFixtureWorld, fixtureClock } from './helpers.js';

describe('the section 6 task-durability shape', () => {
  test('a task record carries EVERY section 6 field and survives verbatim', async () => {
    const world = buildFixtureWorld();
    const store = createInMemoryLiveStore({ clock: fixtureClock() });
    await store.task.put(world.task);

    const task = await store.task.get(world.task.task_id);
    expect(task).toBeDefined();
    if (task === undefined) {
      return;
    }
    // Task identity and mission link.
    expect(task.task_id).toBe('task-checkout-queue-implementation');
    expect(task.mission_ref).toBe(world.missionV2.envelope.id);
    // Current plan/work graph.
    expect(task.plan.nodes).toHaveLength(2);
    expect(task.plan.edges).toEqual([{ from: 'plan-implement', to: 'plan-verify' }]);
    // Owned workspace/repository revision.
    expect(task.owned_revision).toBe(world.task.owned_revision);
    // Authority context.
    expect(task.authority_context.grant_refs).toEqual([world.grant.envelope.id]);
    // Body lease, when any.
    expect(task.body_lease_ref).toBe('lease-checkout-body-1');
    // Checkpoints (durable resume points).
    expect(task.checkpoints).toHaveLength(1);
    expect(task.checkpoints[0]?.checkpoint_id).toBe('checkpoint-buffer-skeleton');
    expect(task.checkpoints[0]?.state).toEqual({ files_written: ['src/queue/buffer.ts'], tests_passing: 12 });
    // Produced artifacts (empty until captured; referenced by content hash).
    expect(task.artifacts).toEqual([]);
    // Observations/evidence.
    expect(task.evidence_refs).toEqual([world.evidence.id]);
    // Unresolved uncertainty.
    expect(task.unresolved_uncertainty).toHaveLength(1);
    // Retries/recovery state.
    expect(task.retries.attempt_count).toBe(1);
    expect(task.retries.recovery_kind).toBe('RESUME_FROM_CHECKPOINT');
    // Cost/resource consumption.
    expect(task.cost).toEqual([{ kind: 'TOKENS', amount: 125000, unit: 'tokens', recorded_at: world.task.revision === 1 ? world.task.updated_at : world.task.updated_at }]);
    // Final verification record (null while unfinished).
    expect(task.final_verification).toBeNull();
  });

  test('a final verification record round-trips verbatim', async () => {
    const world = buildFixtureWorld();
    const store = createInMemoryLiveStore({ clock: fixtureClock() });
    const finished: typeof world.task = {
      ...world.taskV2,
      status: 'SUCCEEDED',
      final_verification: {
        verdict: 'VERIFIED',
        verified_at: world.taskV2.updated_at,
        evidence_refs: [world.evidence.id],
        summary: 'Integration tests and telemetry verification passed at the owned revision',
      },
      revision: 3,
    };
    await store.task.put(finished);
    const loaded = await store.task.get(finished.task_id);
    expect(loaded?.final_verification?.verdict).toBe('VERIFIED');
    expect(canonicalSerialize(loaded?.final_verification)).toBe(canonicalSerialize(finished.final_verification));
  });
});

describe('durability across facade recreation (body/process loss)', () => {
  test('recreating the facade over the SAME durable adapter recovers ALL state bit-exactly', async () => {
    const world = buildFixtureWorld();
    const durable = new InMemoryPostgresStoreAdapter({ clock: fixtureClock() });
    const objectStore = new InMemoryObjectStoreAdapter();
    const coordination = new InMemoryRedisCoordinationAdapter();

    const first = createInMemoryLiveStore({ clock: fixtureClock(), durable, coordination, objectStore });
    await first.mission.put(world.mission);
    await first.task.put(world.task);
    await first.task.put(world.taskV2);
    await first.bodyLease.put(world.bodyLease);
    await first.evidence.put(world.evidence);
    const artifact = await first.artifacts.put(new TextEncoder().encode('checkpoint evidence blob'));
    const leaseHeartbeatAt = '2025-07-01T00:00:30.000Z';
    await coordination.leaseHeartbeat(world.bodyLease.lease_id, 60, leaseHeartbeatAt);

    // "Body loss": the facade (and the whole coordination layer state via a
    // fresh flushable layer simulation) goes away; the DURABLE adapter and
    // object store survive.
    const second = createInMemoryLiveStore({ clock: fixtureClock(), durable, objectStore });

    const task = await second.task.get(world.task.task_id);
    expect(canonicalSerialize(task)).toBe(canonicalSerialize(world.taskV2));
    expect(task?.checkpoints[0]?.checkpoint_id).toBe('checkpoint-buffer-skeleton');
    const mission = await second.mission.get(world.mission.envelope.id);
    expect(canonicalSerialize(mission)).toBe(canonicalSerialize(world.mission));
    const lease = await second.bodyLease.get(world.bodyLease.lease_id);
    expect(canonicalSerialize(lease)).toBe(canonicalSerialize(world.bodyLease));
    const evidence = await second.evidence.get(world.evidence.id);
    expect(canonicalSerialize(evidence)).toBe(canonicalSerialize(world.evidence));

    // Artifacts survive by content hash.
    const bytes = await second.artifacts.get(artifact.content_hash);
    expect(new TextDecoder().decode(bytes)).toBe('checkpoint evidence blob');

    // The durable rows are exactly the ones the first facade wrote.
    const tables = await durable.listTables();
    expect(tables).toEqual(['body_lease', 'evidence', 'mission', 'task']);
  });

  test('body lease replacement: the task outlives the lease (§1 body rule)', async () => {
    const world = buildFixtureWorld();
    const store = createInMemoryLiveStore({ clock: fixtureClock() });
    await store.task.put(world.task);
    await store.bodyLease.put(world.bodyLease);

    // The lease is revoked and a replacement body acquires a new lease.
    const replacementLease = {
      ...world.bodyLease,
      lease_id: 'lease-checkout-body-2',
      body_ref: 'body:cloud-sandbox:runner-2',
      acquired_at: world.bodyLease.acquired_at,
      revision: 1,
      provenance: [...world.bodyLease.provenance, 'lease:replacement-after-revocation'],
    };
    await store.bodyLease.put(replacementLease);
    const resumedTask = {
      ...world.task,
      body_lease_ref: replacementLease.lease_id,
      status: 'RUNNING' as const,
      updated_at: world.task.updated_at,
      revision: 2,
    };
    await store.task.put(resumedTask);

    const task = await store.task.get(world.task.task_id);
    expect(task?.body_lease_ref).toBe('lease-checkout-body-2');
    expect(task?.checkpoints).toHaveLength(1);
    expect(canonicalSerialize(task)).toBe(canonicalSerialize(resumedTask));
    expect(await store.bodyLease.size()).toBe(2);
  });
});

describe('artifact blobs (content-addressed, immutable)', () => {
  test('identical bytes are idempotent by content hash; different bytes never collide', async () => {
    const store = createInMemoryLiveStore({ clock: fixtureClock() });
    const bytes = new TextEncoder().encode('evidence: build log 2025-06-03');

    const first = await store.artifacts.put(bytes);
    expect(first.outcome).toBe('STORED');
    expect(first.size_bytes).toBe(bytes.length);

    const replay = await store.artifacts.put(new TextEncoder().encode('evidence: build log 2025-06-03'));
    expect(replay.outcome).toBe('ALREADY_PRESENT');
    expect(replay.content_hash).toBe(first.content_hash);

    const other = await store.artifacts.put(new TextEncoder().encode('different evidence'));
    expect(other.content_hash).not.toBe(first.content_hash);

    expect(await store.artifacts.has(first.content_hash)).toBe(true);
    expect(await store.artifacts.has('0'.repeat(64))).toBe(false);
    const listing = await store.artifacts.list();
    expect(listing.map((entry) => entry.content_hash)).toEqual(
      [first.content_hash, other.content_hash].sort(),
    );
  });

  test('task artifacts reference blobs by content hash and the bytes stay retrievable', async () => {
    const world = buildFixtureWorld();
    const store = createInMemoryLiveStore({ clock: fixtureClock() });
    const blob = await store.artifacts.put(new TextEncoder().encode('final verification report'));
    const taskWithArtifact = {
      ...world.task,
      artifacts: [
        {
          content_hash: blob.content_hash,
          size_bytes: blob.size_bytes,
          created_at: world.task.updated_at,
          description: 'Final verification report',
        },
      ],
    };
    await store.task.put(taskWithArtifact);
    const loaded = await store.task.get(taskWithArtifact.task_id);
    expect(loaded?.artifacts[0]?.content_hash).toBe(blob.content_hash);
    const bytes = await store.artifacts.get(blob.content_hash);
    expect(new TextDecoder().decode(bytes)).toBe('final verification report');
  });
});
