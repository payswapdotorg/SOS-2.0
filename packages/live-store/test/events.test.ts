/**
 * Event ingestion + replay protection tests (Work Order P2): every event
 * carries an id; duplicate delivery is detected and skipped (typed
 * duplicate record, never double-applied); a divergent redelivery is a
 * typed conflict; replay protection survives coordination-layer loss
 * (the durable log is the dedup authority); ordering and pagination are
 * deterministic; ingested_at comes from the injected clock.
 */

import { describe, expect, test } from 'vitest';
import { canonicalSerialize } from '@sos-2/semantic-spine';
import { InvalidRecordError } from '../src/errors.js';
import { createInMemoryLiveStore } from '../src/facade.js';
import { InMemoryRedisCoordinationAdapter } from '../src/in-memory-providers.js';
import { buildFixtureWorld, fixtureClock } from './helpers.js';

describe('event ingestion', () => {
  test('new events are applied durably with injected-clock ingested_at', async () => {
    const world = buildFixtureWorld();
    const store = createInMemoryLiveStore({ clock: fixtureClock() });

    const applied = await store.events.ingest(world.events[0]!);
    expect(applied.outcome).toBe('APPLIED');
    if (applied.outcome === 'APPLIED') {
      expect(applied.event.event_id).toBe('gh-delivery-2001');
      expect(applied.event.ingested_at).toBe('2025-07-01T00:00:00.000Z');
      // The verbatim payload is preserved bit-exactly.
      expect(canonicalSerialize(applied.event.payload)).toBe(canonicalSerialize(world.events[0]!.payload));
    }
    expect(await store.events.size()).toBe(1);
  });

  test('the stored event is the request plus ingested_at (verbatim round trip)', async () => {
    const world = buildFixtureWorld();
    const store = createInMemoryLiveStore({ clock: fixtureClock() });
    await store.events.ingest(world.events[1]!);
    const stored = await store.events.get('ci-run-9001');
    expect(stored).toBeDefined();
    expect(stored?.source).toBe('github:actions:SOS-2.0');
    expect(stored?.subject_ref).toBe(world.missionV2.envelope.id);
    expect(stored?.provenance).toEqual(['ci:github-actions:run-9001']);
  });
});

describe('replay protection (duplicate delivery is skipped, never double-applied)', () => {
  test('an identical redelivery answers with the typed DUPLICATE record and does not re-apply', async () => {
    const world = buildFixtureWorld();
    const store = createInMemoryLiveStore({ clock: fixtureClock() });
    await store.events.ingest(world.events[0]!);

    const duplicate = await store.events.ingest(world.events[0]!);
    expect(duplicate.outcome).toBe('DUPLICATE');
    if (duplicate.outcome === 'DUPLICATE') {
      expect(duplicate.duplicate.error_kind).toBe('DUPLICATE');
      expect(duplicate.duplicate.event_id).toBe('gh-delivery-2001');
      expect(duplicate.duplicate.first_ingested_at).toBe('2025-07-01T00:00:00.000Z');
    }
    // NEVER double-applied: exactly one row, one list entry.
    expect(await store.events.size()).toBe(1);
    const rows = await store.providers.durable.listRows('observation_events');
    expect(rows).toHaveLength(1);
    expect((await store.events.list())).toHaveLength(1);
  });

  test('replay protection survives a FULL coordination-layer flush (durable dedup authority)', async () => {
    const world = buildFixtureWorld();
    const coordination = new InMemoryRedisCoordinationAdapter();
    const store = createInMemoryLiveStore({ clock: fixtureClock(), coordination });

    await store.events.ingest(world.events[0]!);
    // Destroy the coordination layer entirely.
    await coordination.flushAll();
    expect(await coordination.idempotencySeen('event:gh-delivery-2001')).toBe(false);

    // The duplicate is STILL detected from the durable log.
    const duplicate = await store.events.ingest(world.events[0]!);
    expect(duplicate.outcome).toBe('DUPLICATE');
    expect(await store.events.size()).toBe(1);
  });

  test('replay protection works with NO coordination layer at all', async () => {
    const world = buildFixtureWorld();
    const store = createInMemoryLiveStore({ clock: fixtureClock(), coordination: null });
    await store.events.ingest(world.events[2]!);
    const duplicate = await store.events.ingest(world.events[2]!);
    expect(duplicate.outcome).toBe('DUPLICATE');
    expect(await store.events.size()).toBe(1);
  });

  test('a divergent redelivery (same id, different content) is a typed EVENT_DIVERGENCE conflict', async () => {
    const world = buildFixtureWorld();
    const store = createInMemoryLiveStore({ clock: fixtureClock() });
    await store.events.ingest(world.events[0]!);

    const divergent = { ...world.events[0]!, payload: { ref: 'refs/heads/main', after: '0000000000000000000000000000000000000000' } };
    const outcome = await store.events.ingest(divergent);
    expect(outcome.outcome).toBe('EVENT_CONFLICT');
    if (outcome.outcome === 'EVENT_CONFLICT') {
      expect(outcome.conflict.code).toBe('EVENT_DIVERGENCE');
      expect(outcome.conflict.event_id).toBe('gh-delivery-2001');
      expect(outcome.conflict.first_ingested_at).toBe('2025-07-01T00:00:00.000Z');
    }
    // The original event is untouched.
    const stored = await store.events.get('gh-delivery-2001');
    expect(canonicalSerialize(stored?.payload)).toBe(canonicalSerialize(world.events[0]!.payload));
    expect(await store.events.size()).toBe(1);
  });
});

describe('deterministic event ordering + pagination', () => {
  test('events list in (occurred_at, event_id) order, stably', async () => {
    const world = buildFixtureWorld();
    const store = createInMemoryLiveStore({ clock: fixtureClock() });
    // Ingest out of order — order must still be (occurred_at, event_id).
    await store.events.ingest(world.events[2]!);
    await store.events.ingest(world.events[0]!);
    await store.events.ingest(world.events[1]!);

    const listing = await store.events.list();
    expect(listing.map((event) => event.event_id)).toEqual(['gh-delivery-2001', 'ci-run-9001', 'deploy-3001']);
    expect(await store.events.list()).toEqual(listing);
  });

  test('cursor pagination walks the event log exhaustively in order', async () => {
    const world = buildFixtureWorld();
    const store = createInMemoryLiveStore({ clock: fixtureClock() });
    for (const event of world.events) {
      await store.events.ingest(event);
    }

    const collected: string[] = [];
    let afterKey: string | null = null;
    for (let guard = 0; guard < 10; guard += 1) {
      const page = await store.events.listPage({ after_key: afterKey, limit: 2 });
      expect(page.total).toBe(3);
      collected.push(...page.items.map((event) => event.event_id));
      if (page.next_key === null) {
        break;
      }
      afterKey = page.next_key;
    }
    expect(collected).toEqual(['gh-delivery-2001', 'ci-run-9001', 'deploy-3001']);
  });
});

describe('invalid events are rejected loudly', () => {
  test('an event without an id / provenance / valid timestamp throws InvalidRecordError', async () => {
    const world = buildFixtureWorld();
    const store = createInMemoryLiveStore({ clock: fixtureClock() });

    const noId = { ...world.events[0]! };
    delete (noId as Record<string, unknown>)['event_id'];
    await expect(store.events.ingest(noId as never)).rejects.toThrow(InvalidRecordError);

    const noProvenance = { ...world.events[0]!, provenance: [] };
    await expect(store.events.ingest(noProvenance)).rejects.toThrow(InvalidRecordError);

    const badTime = { ...world.events[0]!, occurred_at: 'yesterday' };
    await expect(store.events.ingest(badTime)).rejects.toThrow(InvalidRecordError);

    expect(await store.events.size()).toBe(0);
  });
});
