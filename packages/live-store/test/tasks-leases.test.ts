/**
 * Durable task/checkpoint records + body lease state (Work Order P2).
 *
 * The §6 task-durability shape (spec/productization-execution-architecture.md
 * §6): task identity + mission link, plan/work graph, owned revisions,
 * authority context, body lease ref, checkpoints, artifacts,
 * observations/evidence, unresolved uncertainty, retries/recovery,
 * cost/resource usage, final verification. A body crash, provider outage
 * or user computer shutdown must not erase the task — pinned below by
 * ending the task's lease and proving the task intact.
 */

import { describe, expect, it } from 'vitest';
import { canonicalSerialize } from '@sos-2/semantic-spine';
import {
  InvalidRecordError,
  ManualClock,
  UnknownStoreError,
  createInMemoryLiveStore,
  formatRfc3339,
} from '../src/index.js';
import type { TaskRecord } from '../src/index.js';
import * as fixtures from './helpers.js';

const CLOCK_START = Date.parse(fixtures.T0);

function taskFixture(): TaskRecord {
  return {
    task_id: 'task-greenfield-0001',
    mission_ref: `sos://Mission/${'a'.repeat(32)}`,
    status: 'RUNNING',
    plan: { steps: ['formalize-mission', 'plan-architecture', 'implement'] },
    owned_revision: { source_revision: 'git-sha:' + 'f'.repeat(40), deployment_revision: 'deploy-2026-01-01' },
    authority_context: { grant_refs: [`sos://AuthorityGrant/${'g'.repeat(32)}`], notes: 'bounded autonomy' },
    body_lease_ref: null,
    checkpoints: [],
    artifacts: [],
    observations: [],
    unresolved_uncertainty: ['canary tolerance at 25% exposure unknown'],
    retries: 0,
    recovery_state: null,
    resource_usage: { cpu_seconds: 12.5 },
    final_verification: null,
    revision: 1,
    created_at: fixtures.T0,
    updated_at: fixtures.T0,
  };
}

describe('durable task records (the §6 shape)', () => {
  it('stores and round-trips the full §6 shape bit-exact', async () => {
    const store = createInMemoryLiveStore({ clock: new ManualClock(CLOCK_START) });
    const task = taskFixture();
    const result = await store.tasks.put(task);
    expect(result.kind).toBe('STORED');
    const loaded = await store.tasks.get('task-greenfield-0001');
    expect(canonicalSerialize(loaded)).toBe(canonicalSerialize(task));
  });

  it('rejects a task record missing any §6 field (typed INVALID)', async () => {
    const store = createInMemoryLiveStore({ clock: new ManualClock(CLOCK_START) });
    const broken = { ...taskFixture() } as Record<string, unknown>;
    delete broken['final_verification'];
    await expect(store.tasks.put(broken as never)).rejects.toThrow(InvalidRecordError);
  });

  it('appends checkpoints and artifacts with revision bumps (CAS-guarded)', async () => {
    const clock = new ManualClock(CLOCK_START);
    const store = createInMemoryLiveStore({ clock });
    const task = taskFixture();
    await store.tasks.put(task);

    clock.advance(1_000);
    const checkpointResult = await store.tasks.appendCheckpoint('task-greenfield-0001', {
      checkpoint_id: 'cp-1',
      recorded_at: formatRfc3339(clock.nowEpochMs()),
      label: 'after-mission-formalization',
      work_graph_state: { steps: ['formalize-mission'], done: ['formalize-mission'] },
      notes: null,
    });
    expect(checkpointResult.kind).toBe('STORED');
    expect(checkpointResult.kind === 'STORED' && checkpointResult.record.revision).toBe(2);
    expect(checkpointResult.kind === 'STORED' && checkpointResult.record.checkpoints).toHaveLength(1);
    expect(checkpointResult.kind === 'STORED' && checkpointResult.record.updated_at).toBe(formatRfc3339(clock.nowEpochMs()));

    clock.advance(1_000);
    const artifactResult = await store.tasks.attachArtifact('task-greenfield-0001', {
      artifact_id: 'task-greenfield-0001:report',
      content_hash: 'a'.repeat(64),
      object_ref: `r2://${'a'.repeat(64)}`,
      size_bytes: 2048,
      description: 'the completion report artifact',
    });
    expect(artifactResult.kind).toBe('STORED');
    expect(artifactResult.kind === 'STORED' && artifactResult.record.revision).toBe(3);
    expect(artifactResult.kind === 'STORED' && artifactResult.record.artifacts).toHaveLength(1);

    // A stale CAS (expected revision 1 after three writes) fails typed.
    const stale = await store.tasks.appendCheckpoint(
      'task-greenfield-0001',
      {
        checkpoint_id: 'cp-2',
        recorded_at: formatRfc3339(clock.nowEpochMs()),
        label: null,
        work_graph_state: {},
        notes: null,
      },
      { expected_revision: 1 },
    );
    expect(stale).toMatchObject({ kind: 'CONFLICT', reason: 'REVISION_MISMATCH', current_revision: 3 });
  });

  it('records the final verification record durably', async () => {
    const clock = new ManualClock(CLOCK_START);
    const store = createInMemoryLiveStore({ clock });
    await store.tasks.put(taskFixture());
    clock.advance(5_000);
    const verified = await store.tasks.recordVerification('task-greenfield-0001', {
      verified: true,
      recorded_at: formatRfc3339(clock.nowEpochMs()),
      evidence_refs: [`sos://Evidence/${'e'.repeat(32)}`],
      summary: 'tests + contract checks + browser journey all green',
    });
    expect(verified.kind).toBe('STORED');
    const loaded = await store.tasks.get('task-greenfield-0001');
    expect(loaded?.final_verification?.verified).toBe(true);
    expect(loaded?.final_verification?.evidence_refs).toHaveLength(1);
  });

  it('throws a typed error when appending to an unstored task', async () => {
    const store = createInMemoryLiveStore({ clock: new ManualClock(CLOCK_START) });
    await expect(
      store.tasks.appendCheckpoint('task-unknown', {
        checkpoint_id: 'cp-x',
        recorded_at: fixtures.T1,
        label: null,
        work_graph_state: {},
        notes: null,
      }),
    ).rejects.toThrow(UnknownStoreError);
  });

  it('a body crash (lease ended) never erases the task — §6 durability', async () => {
    const clock = new ManualClock(CLOCK_START);
    const store = createInMemoryLiveStore({ clock });
    const task = taskFixture();
    await store.tasks.put(task);
    const lease = await store.bodyLeases.acquire({
      lease_id: 'lease-0001',
      task_ref: 'task-greenfield-0001',
      holder: 'body:cloud-runner-1',
      body_id: 'cloud-runner-1',
      expires_at: formatRfc3339(clock.nowEpochMs() + 60_000),
    });
    expect(lease.kind).toBe('STORED');
    const linked = await store.tasks.put({
      ...task,
      body_lease_ref: 'lease-0001',
      revision: 2,
      updated_at: formatRfc3339(clock.nowEpochMs()),
    });
    expect(linked.kind).toBe('STORED');

    // The body dies: the lease expires at the TTL.
    clock.advance(120_000);
    const expired = await store.bodyLeases.expireDue(clock.nowEpochMs());
    expect(expired.map((record) => record.lease_id)).toEqual(['lease-0001']);
    expect(expired[0]!.state).toBe('EXPIRED');

    // The task survives body loss with EVERY §6 field intact.
    const survived = await store.tasks.get('task-greenfield-0001');
    expect(survived).toBeDefined();
    expect(survived?.task_id).toBe('task-greenfield-0001');
    expect(survived?.mission_ref).toBe(task.mission_ref);
    expect(survived?.plan).toEqual(task.plan);
    expect(survived?.owned_revision).toEqual(task.owned_revision);
    expect(survived?.authority_context).toEqual(task.authority_context);
    expect(survived?.body_lease_ref).toBe('lease-0001'); // the historical ref is retained
    expect(survived?.unresolved_uncertainty).toEqual(task.unresolved_uncertainty);
    expect(survived?.resource_usage).toEqual(task.resource_usage);
    expect(survived?.revision).toBe(2);
  });
});

describe('body lease state (durable truth; coordination mirrors only)', () => {
  it('acquires, releases and rejects re-acquisition under a used lease id', async () => {
    const clock = new ManualClock(CLOCK_START);
    const store = createInMemoryLiveStore({ clock });
    const acquired = await store.bodyLeases.acquire({
      lease_id: 'lease-0100',
      task_ref: 'task-x',
      holder: 'body:runner-a',
    });
    expect(acquired.kind).toBe('STORED');
    expect(acquired.kind === 'STORED' && acquired.record.state).toBe('ACTIVE');

    // Identical re-acquire is an idempotent no-op.
    const replay = await store.bodyLeases.acquire({
      lease_id: 'lease-0100',
      task_ref: 'task-x',
      holder: 'body:runner-a',
    });
    expect(replay.kind).toBe('IDENTICAL');

    // A DIFFERENT acquire under the used id is a typed conflict.
    const clash = await store.bodyLeases.acquire({
      lease_id: 'lease-0100',
      task_ref: 'task-y',
      holder: 'body:runner-b',
    });
    expect(clash).toMatchObject({ kind: 'CONFLICT', reason: 'REVISION_MISMATCH', current_revision: 1 });

    clock.advance(1_000);
    const released = await store.bodyLeases.release('lease-0100', { reason: 'task completed' });
    expect(released.kind).toBe('STORED');
    expect(released.kind === 'STORED' && released.record.state).toBe('RELEASED');
    expect(released.kind === 'STORED' && released.record.release_reason).toBe('task completed');

    // An ended lease never reactivates (typed INVALID on release attempt).
    await expect(store.bodyLeases.release('lease-0100', { reason: 'again' })).rejects.toThrow(InvalidRecordError);
    // ...and cannot be re-acquired under the same single-use id.
    const afterEnd = await store.bodyLeases.acquire({
      lease_id: 'lease-0100',
      task_ref: 'task-x',
      holder: 'body:runner-a',
    });
    expect(afterEnd.kind).toBe('CONFLICT');
  });

  it('revokes an ACTIVE lease (terminal)', async () => {
    const clock = new ManualClock(CLOCK_START);
    const store = createInMemoryLiveStore({ clock });
    await store.bodyLeases.acquire({ lease_id: 'lease-0200', task_ref: 'task-x', holder: 'body:runner-a' });
    clock.advance(1_000);
    const revoked = await store.bodyLeases.revoke('lease-0200', { reason: 'policy violation' });
    expect(revoked.kind).toBe('STORED');
    expect(revoked.kind === 'STORED' && revoked.record.state).toBe('REVOKED');
  });

  it('expires only ACTIVE leases whose TTL has passed, deterministically', async () => {
    const clock = new ManualClock(CLOCK_START);
    const store = createInMemoryLiveStore({ clock });
    await store.bodyLeases.acquire({
      lease_id: 'lease-0300',
      task_ref: 'task-a',
      holder: 'body:runner-a',
      expires_at: formatRfc3339(clock.nowEpochMs() + 10_000),
    });
    await store.bodyLeases.acquire({
      lease_id: 'lease-0301',
      task_ref: 'task-b',
      holder: 'body:runner-b',
      expires_at: null, // non-expiring
    });
    clock.advance(5_000);
    expect(await store.bodyLeases.expireDue(clock.nowEpochMs())).toEqual([]); // not yet
    clock.advance(10_000);
    const expired = await store.bodyLeases.expireDue(clock.nowEpochMs());
    expect(expired.map((record) => record.lease_id)).toEqual(['lease-0300']);
    // Idempotent: expiring again is a no-op.
    expect(await store.bodyLeases.expireDue(clock.nowEpochMs())).toEqual([]);
    // The non-expiring lease is untouched.
    const live = await store.bodyLeases.get('lease-0301');
    expect(live?.state).toBe('ACTIVE');
  });

  it('validates lease records with the typed InvalidRecordError', async () => {
    const store = createInMemoryLiveStore({ clock: new ManualClock(CLOCK_START) });
    const broken = { ...taskFixture(), state: 'MAYBE' };
    await expect(store.bodyLeases.put({ ...broken } as never)).rejects.toThrow(InvalidRecordError);
  });
});
