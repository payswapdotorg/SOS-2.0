/**
 * Idempotent writes + stale-revision detection (Work Order P2 hard rules):
 *
 *  - replaying an identical write is a NO-OP returning the stored record
 *    (not an error, not a duplicate);
 *  - writing a record whose revision is OLDER than the stored revision
 *    fails with a TYPED conflict carrying the CURRENT revision;
 *  - expected-revision CAS mismatches fail typed;
 *  - same-revision lifecycle transitions (spine withStatus: id preserved)
 *    are stored;
 *  - immutable flat records reject different content under a stored id.
 */

import { describe, expect, it } from 'vitest';
import { canonicalSerialize } from '@sos-2/semantic-spine';
import { createInMemoryLiveStore, InvalidRecordError, ManualClock } from '../src/index.js';
import * as fixtures from './helpers.js';

describe('idempotent writes', () => {
  it('replaying an identical write is a no-op returning the stored record', async () => {
    const store = createInMemoryLiveStore({ clock: new ManualClock(0) });
    const mission = fixtures.missionFixture();
    const first = await store.missions.put(mission);
    expect(first.kind).toBe('STORED');
    if (first.kind !== 'STORED') {
      return;
    }
    const replay = await store.missions.put(structuredClone(mission));
    expect(replay.kind).toBe('IDENTICAL');
    if (replay.kind !== 'IDENTICAL') {
      return;
    }
    expect(canonicalSerialize(replay.record)).toBe(canonicalSerialize(mission));
    const list = await store.missions.list({ limit: null });
    expect(list.items).toHaveLength(1); // never a duplicate
  });

  it('idempotent replay holds for every record family', async () => {
    const store = createInMemoryLiveStore({ clock: new ManualClock(0) });
    const evidence = fixtures.evidenceFixture();
    const context = fixtures.contextFixture();
    const grant = fixtures.grantFixture();
    for (const [put, get, record] of [
      [store.evidence.put.bind(store.evidence), () => store.evidence.get(evidence.id), evidence],
      [store.contexts.put.bind(store.contexts), () => store.contexts.get(context.envelope.id), context],
      [store.authorityGrants.put.bind(store.authorityGrants), () => store.authorityGrants.get(grant.envelope.id), grant],
    ] as const) {
      const first = await put(record as never);
      expect(first.kind).toBe('STORED');
      if (first.kind !== 'STORED') {
        return;
      }
      const replay = await put(structuredClone(record) as never);
      expect(replay.kind).toBe('IDENTICAL');
      if (replay.kind !== 'IDENTICAL') {
        return;
      }
      expect(canonicalSerialize(replay.record)).toBe(canonicalSerialize(record));
      const loaded = await (get as () => Promise<unknown>)();
      expect(canonicalSerialize(loaded)).toBe(canonicalSerialize(record));
    }
  });
});

describe('stale-revision detection (optimistic concurrency)', () => {
  it('rejects an OLDER revision with a typed conflict carrying the current revision', async () => {
    const store = createInMemoryLiveStore({ clock: new ManualClock(0) });
    const mission = fixtures.missionFixture();
    await store.missions.put(fixtures.missionAtVersion(mission, 3)); // current revision 3
    const stale = await store.missions.put(fixtures.missionAtVersion(mission, 2));
    expect(stale).toMatchObject({ kind: 'CONFLICT', reason: 'STALE_REVISION', current_revision: 3 });
    expect(canonicalSerialize(stale.kind === 'CONFLICT' ? stale.current_record : null)).toBe(
      canonicalSerialize(fixtures.missionAtVersion(mission, 3)),
    );
    // The stored record is untouched.
    const loaded = await store.missions.get(mission.envelope.id);
    expect(loaded?.envelope.version).toBe(3);
  });

  it('rejects an expected-revision mismatch (CAS) with a typed conflict', async () => {
    const store = createInMemoryLiveStore({ clock: new ManualClock(0) });
    const mission = fixtures.missionFixture();
    await store.missions.put(fixtures.missionAtVersion(mission, 2));
    const cas = await store.missions.put(fixtures.missionAtVersion(mission, 3), { expected_revision: 1 });
    expect(cas).toMatchObject({ kind: 'CONFLICT', reason: 'REVISION_MISMATCH', current_revision: 2 });
    // Matching CAS passes.
    const ok = await store.missions.put(fixtures.missionAtVersion(mission, 3), { expected_revision: 2 });
    expect(ok.kind).toBe('STORED');
  });

  it('stores same-revision lifecycle transitions (id preserved — spine withStatus semantics)', async () => {
    const store = createInMemoryLiveStore({ clock: new ManualClock(0) });
    const mission = fixtures.missionFixture(); // DRAFT
    await store.missions.put(mission);
    const activated = fixtures.missionWithStatus(mission, 'ACTIVE');
    const result = await store.missions.put(activated);
    expect(result.kind).toBe('STORED');
    const loaded = await store.missions.get(mission.envelope.id);
    expect(loaded?.envelope.id).toBe(mission.envelope.id); // identity preserved
    expect(loaded?.envelope.version).toBe(1); // version not bumped by lifecycle
    expect(loaded?.envelope.status).toBe('ACTIVE');
    expect(loaded?.envelope.status).not.toBe('SUPERSEDED');
  });

  it('stores NEWER revisions under the same id (forward progress)', async () => {
    const store = createInMemoryLiveStore({ clock: new ManualClock(0) });
    const mission = fixtures.missionFixture();
    await store.missions.put(fixtures.missionAtVersion(mission, 1));
    const forward = await store.missions.put(fixtures.missionAtVersion(mission, 5));
    expect(forward.kind).toBe('STORED');
    const loaded = await store.missions.get(mission.envelope.id);
    expect(loaded?.envelope.version).toBe(5);
  });

  it('rejects different content under a stored IMMUTABLE record id (typed collision)', async () => {
    const store = createInMemoryLiveStore({ clock: new ManualClock(0) });
    const evidence = fixtures.evidenceFixture();
    await store.evidence.put(evidence);
    const tampered = { ...structuredClone(evidence), provenance: ['tampered:provenance'] };
    const result = await store.evidence.put(tampered);
    expect(result).toMatchObject({ kind: 'CONFLICT', reason: 'IMMUTABLE_COLLISION', current_revision: null });
    const loaded = await store.evidence.get(evidence.id);
    expect(canonicalSerialize(loaded)).toBe(canonicalSerialize(evidence)); // original intact
  });

  it('rejects invalid records with the typed InvalidRecordError (owning package validation)', async () => {
    const store = createInMemoryLiveStore({ clock: new ManualClock(0) });
    const mission = fixtures.missionFixture();
    const broken = { ...structuredClone(mission), content: { ...mission.content, purpose: '' } };
    await expect(store.missions.put(broken)).rejects.toThrow(InvalidRecordError);
    const badEvidence = { ...structuredClone(fixtures.evidenceFixture()), availability: 'MAYBE' as never };
    await expect(store.evidence.put(badEvidence)).rejects.toThrow(InvalidRecordError);
    await expect(store.missions.get('')).rejects.toThrow();
  });
});

describe('seek pagination (deterministic ordering)', () => {
  it('pages through records by id order with next_after_id', async () => {
    const store = createInMemoryLiveStore({ clock: new ManualClock(0) });
    // Three DISTINCT evidence records (distinct subjects -> distinct content-addressed ids).
    const records = [
      fixtures.evidenceFixtureWithSubject(`sos://SystemState/${'c'.repeat(32)}`),
      fixtures.evidenceFixtureWithSubject(`sos://SystemState/${'a'.repeat(32)}`),
      fixtures.evidenceFixtureWithSubject(`sos://SystemState/${'b'.repeat(32)}`),
    ];
    for (const record of records) {
      await store.evidence.put(record);
    }
    const page1 = await store.evidence.list({ limit: 2 });
    expect(page1.items).toHaveLength(2);
    expect(page1.next_after_id).not.toBeNull();
    const page2 = await store.evidence.list({ limit: 2, after_id: page1.next_after_id });
    expect(page2.items).toHaveLength(1);
    expect(page2.next_after_id).toBeNull();
    const all = [...page1.items, ...page2.items];
    const ids = all.map((record) => record.id);
    expect(ids).toEqual([...ids].sort());
    expect(new Set(ids).size).toBe(3);
  });
});
