/**
 * Write-semantics tests (Work Order P2): idempotent writes (identical
 * replay = no-op returning the stored record), typed stale-revision
 * conflicts carrying the CURRENT revision (optimistic concurrency), typed
 * same-revision divergence conflicts, forward writes, the sanctioned
 * lifecycle transition (setStatus), loud invalid-record rejection and
 * typed not-found.
 */

import { describe, expect, test } from 'vitest';
import { canonicalSerialize } from '@sos-2/semantic-spine';
import { createPackageArtifact } from '@sos-2/packages';
import { InvalidRecordError, RecordNotFoundError } from '../src/errors.js';
import { createInMemoryLiveStore } from '../src/facade.js';
import { buildFixtureWorld, fixtureClock, PROVENANCE, T0, T2 } from './helpers.js';

describe('idempotent writes', () => {
  test('replaying an identical write is a NO-OP returning the stored record (not an error, not a duplicate)', async () => {
    const world = buildFixtureWorld();
    const store = createInMemoryLiveStore({ clock: fixtureClock() });

    const first = await store.task.put(world.task);
    expect(first.outcome).toBe('STORED');
    expect(canonicalSerialize(first.record)).toBe(canonicalSerialize(world.task));

    const replay = await store.task.put(world.task);
    expect(replay.outcome).toBe('IDEMPOTENT_REPLAY');
    expect(canonicalSerialize(replay.record)).toBe(canonicalSerialize(world.task));

    // Not a duplicate: size stays 1, and the durable write does not repeat.
    expect(await store.task.size()).toBe(1);
    const rows = await store.providers.durable.listRows('task');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.revision).toBe(1);
  });

  test('idempotency holds for every record family (mission, evidence, grant, lease)', async () => {
    const world = buildFixtureWorld();
    const store = createInMemoryLiveStore({ clock: fixtureClock() });

    for (const [repository, record, id] of [
      [store.mission, world.mission, world.mission.envelope.id],
      [store.evidence, world.evidence, world.evidence.id],
      [store.authorityGrant, world.grant, world.grant.envelope.id],
      [store.bodyLease, world.bodyLease, world.bodyLease.lease_id],
    ] as const) {
      const first = await repository.put(record);
      const replay = await repository.put(record);
      expect(first.outcome).toBe('STORED');
      expect(replay.outcome).toBe('IDEMPOTENT_REPLAY');
      expect(canonicalSerialize(replay.record)).toBe(canonicalSerialize(record));
      expect(await repository.get(id)).toBeDefined();
    }
  });
});

describe('stale-revision detection (optimistic concurrency)', () => {
  test('an older revision fails with a typed STALE_REVISION conflict carrying the current revision', async () => {
    const world = buildFixtureWorld();
    const store = createInMemoryLiveStore({ clock: fixtureClock() });

    // task v2 (revision 2) is stored; replaying task v1 (revision 1, different content) is stale.
    await store.task.put(world.taskV2);
    const stale = await store.task.put(world.task);
    expect(stale.outcome).toBe('REVISION_CONFLICT');
    if (stale.outcome === 'REVISION_CONFLICT') {
      expect(stale.conflict.error_kind).toBe('CONFLICT');
      expect(stale.conflict.code).toBe('STALE_REVISION');
      expect(stale.conflict.repository).toBe('Task');
      expect(stale.conflict.record_id).toBe(world.task.task_id);
      expect(stale.conflict.attempted_revision).toBe(1);
      expect(stale.conflict.current_revision).toBe(2);
    }
    // The stored record is untouched (the store never rewrites content).
    const stored = await store.task.get(world.task.task_id);
    expect(canonicalSerialize(stored)).toBe(canonicalSerialize(world.taskV2));
  });

  test('an envelope artifact with a lower version under the SAME id conflicts as stale', async () => {
    // Package artifacts support explicit id overrides, so a same-id
    // lower-version write is constructible — exactly the stale case.
    const world = buildFixtureWorld();
    const store = createInMemoryLiveStore({ clock: fixtureClock() });
    const sameId = 'sos://Package/' + '0123456789abcdef0123456789abcdef';
    const input = {
      content: world.pkg.content,
      authority_ref: world.pkg.envelope.authority_ref,
      supersedes: world.pkg.envelope.supersedes,
    };
    const packageV3 = createPackageArtifact({ ...input, id: sameId, version: 3, provenance: [PROVENANCE, 'pkg:v3'], created_at: T0, status: 'ACTIVE' });
    const packageV2 = createPackageArtifact({ ...input, id: sameId, version: 2, provenance: [PROVENANCE, 'pkg:v2'], created_at: T0, status: 'ACTIVE' });

    await store.package.put(packageV3);
    const stale = await store.package.put(packageV2);
    expect(stale.outcome).toBe('REVISION_CONFLICT');
    if (stale.outcome === 'REVISION_CONFLICT') {
      expect(stale.conflict.code).toBe('STALE_REVISION');
      expect(stale.conflict.current_revision).toBe(3);
      expect(stale.conflict.attempted_revision).toBe(2);
    }
  });

  test('a stale write never mutates the durable row', async () => {
    const world = buildFixtureWorld();
    const store = createInMemoryLiveStore({ clock: fixtureClock() });
    await store.developmentState.put(world.developmentStateV2);
    const rowsBefore = await store.providers.durable.listRows('development_state');
    await store.developmentState.put(world.developmentState);
    const rowsAfter = await store.providers.durable.listRows('development_state');
    expect(rowsAfter).toEqual(rowsBefore);
  });
});

describe('same-revision divergence', () => {
  test('different content at the stored revision fails with a typed REVISION_DIVERGENCE conflict', async () => {
    const world = buildFixtureWorld();
    const store = createInMemoryLiveStore({ clock: fixtureClock() });
    await store.task.put(world.task);

    const divergent = { ...world.task, owned_revision: '9999999999999999999999999999999999999999' };
    const outcome = await store.task.put(divergent);
    expect(outcome.outcome).toBe('REVISION_CONFLICT');
    if (outcome.outcome === 'REVISION_CONFLICT') {
      expect(outcome.conflict.code).toBe('REVISION_DIVERGENCE');
      expect(outcome.conflict.current_revision).toBe(1);
      expect(outcome.conflict.attempted_revision).toBe(1);
    }
    const stored = await store.task.get(world.task.task_id);
    expect(stored?.owned_revision).toBe(world.task.owned_revision);
  });

  test('a divergent status flip through RAW put conflicts (lifecycle uses setStatus)', async () => {
    const world = buildFixtureWorld();
    const store = createInMemoryLiveStore({ clock: fixtureClock() });
    await store.mission.put(world.mission);

    const flipped = {
      ...world.mission,
      envelope: { ...world.mission.envelope, status: 'SUPERSEDED' as const },
    };
    const outcome = await store.mission.put(flipped);
    expect(outcome.outcome).toBe('REVISION_CONFLICT');
    if (outcome.outcome === 'REVISION_CONFLICT') {
      expect(outcome.conflict.code).toBe('REVISION_DIVERGENCE');
    }
    // The stored mission is still ACTIVE — never silently flipped.
    expect((await store.mission.get(world.mission.envelope.id))?.envelope.status).toBe('ACTIVE');
  });
});

describe('forward writes', () => {
  test('a higher revision is stored (the task revision chain)', async () => {
    const world = buildFixtureWorld();
    const store = createInMemoryLiveStore({ clock: fixtureClock() });
    await store.task.put(world.task);
    const forward = await store.task.put(world.taskV2);
    expect(forward.outcome).toBe('STORED');
    expect(canonicalSerialize(forward.record)).toBe(canonicalSerialize(world.taskV2));
    expect(store.task.revisionOf(forward.record)).toBe(2);
    expect(await store.task.size()).toBe(1);
  });
});

describe('the sanctioned lifecycle transition (setStatus)', () => {
  test('setStatus applies the spine transition, preserving identity and revision', async () => {
    const world = buildFixtureWorld();
    const store = createInMemoryLiveStore({ clock: fixtureClock() });
    await store.mission.put(world.mission);

    const superseded = await store.mission.setStatus(world.mission.envelope.id, 'SUPERSEDED');
    expect(superseded.envelope.id).toBe(world.mission.envelope.id);
    expect(superseded.envelope.version).toBe(world.mission.envelope.version);
    expect(superseded.envelope.status).toBe('SUPERSEDED');
    expect(canonicalSerialize(superseded.envelope)).toBe(
      canonicalSerialize({ ...world.mission.envelope, status: 'SUPERSEDED' }),
    );
    // Content preserved bit-exactly.
    expect(canonicalSerialize(superseded.content)).toBe(canonicalSerialize(world.mission.content));

    // The ACTIVE -> SUPERSEDED record is durable and queryable.
    const reloaded = await store.mission.get(world.mission.envelope.id);
    expect(reloaded?.envelope.status).toBe('SUPERSEDED');
  });

  test('invalid lifecycle transitions are rejected loudly (SUPERSEDED is terminal)', async () => {
    const world = buildFixtureWorld();
    const store = createInMemoryLiveStore({ clock: fixtureClock() });
    await store.mission.put(world.mission);
    await store.mission.setStatus(world.mission.envelope.id, 'SUPERSEDED');
    await expect(store.mission.setStatus(world.mission.envelope.id, 'ACTIVE')).rejects.toBeInstanceOf(InvalidRecordError);
  });

  test('setStatus on a missing record is typed NOT_FOUND', async () => {
    const store = createInMemoryLiveStore({ clock: fixtureClock() });
    await expect(store.mission.setStatus('sos://Mission/' + 'e'.repeat(32), 'RETIRED')).rejects.toBeInstanceOf(
      RecordNotFoundError,
    );
  });
});

describe('invalid records are rejected loudly (never stored)', () => {
  test('a record failing the owning guard throws InvalidRecordError with the owning message', async () => {
    const world = buildFixtureWorld();
    const store = createInMemoryLiveStore({ clock: fixtureClock() });

    const badTask = { ...world.task, mission_ref: 'not-a-spine-id' };
    await expect(store.task.put(badTask)).rejects.toThrow(InvalidRecordError);
    await expect(store.task.put(badTask)).rejects.toThrow(/mission_ref/);

    const badEvidence = { ...world.evidence, availability: 'MAYBE' as never };
    await expect(store.evidence.put(badEvidence)).rejects.toThrow(InvalidRecordError);
    expect(await store.task.size()).toBe(0);
    expect(await store.evidence.size()).toBe(0);
  });

  test('the owning domain guards run VERBATIM (mission purpose discipline)', async () => {
    const world = buildFixtureWorld();
    const store = createInMemoryLiveStore({ clock: fixtureClock() });
    const purposeless = { ...world.mission, content: { ...world.mission.content, purpose: '' } };
    await expect(store.mission.put(purposeless)).rejects.toThrow(/purpose/);
  });
});

describe('not-found reads', () => {
  test('get of an absent id returns undefined (typed NOT_FOUND is the API mapping)', async () => {
    const store = createInMemoryLiveStore({ clock: fixtureClock() });
    expect(await store.task.get('task-missing')).toBeUndefined();
    expect(await store.evidence.get('sos://Evidence/' + '0'.repeat(32))).toBeUndefined();
  });
});

describe('timestamp provenance discipline', () => {
  test('durable rows carry injected-clock write instants (no hidden clocks)', async () => {
    const world = buildFixtureWorld();
    const clock = fixtureClock();
    const store = createInMemoryLiveStore({ clock });
    await store.task.put(world.task);
    const rows = await store.providers.durable.listRows('task');
    expect(rows[0]?.written_at).toBe('2025-07-01T00:00:00.000Z');
    await store.task.put(world.taskV2);
    const rowsAfter = await store.providers.durable.listRows('task');
    expect(rowsAfter[0]?.written_at).toBe('2025-07-01T00:00:01.000Z');
  });

  test('record timestamps are caller-supplied and preserved verbatim', async () => {
    const world = buildFixtureWorld();
    const store = createInMemoryLiveStore({ clock: fixtureClock() });
    await store.task.put(world.task);
    const loaded = await store.task.get(world.task.task_id);
    expect(loaded?.created_at).toBe(world.task.created_at);
    expect(loaded?.updated_at).toBe(world.task.updated_at);
    expect(loaded?.created_at).toBe(T0);
    expect(loaded?.updated_at).toBe(T2);
  });
});
