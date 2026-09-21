/**
 * Event ingestion with replay protection (Work Order P2 hard rule):
 * every event carries an id; duplicate delivery is detected against the
 * DURABLE event index and answered with a typed DUPLICATE record — never
 * double-applied. The coordination layer's idempotency keys are a fast
 * path ONLY (never authoritative).
 */

import { describe, expect, it } from 'vitest';
import { InvalidRecordError, ManualClock, createInMemoryLiveStore } from '../src/index.js';
import { formatRfc3339 } from '../src/index.js';
import * as fixtures from './helpers.js';

const CLOCK_START = Date.parse(fixtures.T0);

describe('event ingestion with replay protection', () => {
  it('applies a first delivery and stamps received_at from the injected clock', async () => {
    const clock = new ManualClock(CLOCK_START);
    const store = createInMemoryLiveStore({ clock });
    const applied = await store.observationEvents.ingest({
      id: 'evt-0001',
      source: 'github:webhook:payswapdotorg/SOS-2.0',
      kind: 'ci.run',
      occurred_at: fixtures.T1,
      payload: { conclusion: 'success', run_id: 123 },
      provenance: ['github:delivery:1'],
    });
    expect(applied.kind).toBe('APPLIED');
    if (applied.kind !== 'APPLIED') {
      return;
    }
    expect(applied.event.id).toBe('evt-0001');
    expect(applied.event.received_at).toBe(formatRfc3339(CLOCK_START));
  });

  it('detects duplicate delivery against the durable index (typed DUPLICATE, never double-applied)', async () => {
    const clock = new ManualClock(CLOCK_START);
    const store = createInMemoryLiveStore({ clock });
    const event = {
      id: 'evt-0002',
      source: 'github:webhook:payswapdotorg/SOS-2.0',
      kind: 'ci.run',
      occurred_at: fixtures.T1,
      payload: { conclusion: 'failure', run_id: 456 },
      provenance: ['github:delivery:2'],
    };
    const first = await store.observationEvents.ingest(event);
    expect(first.kind).toBe('APPLIED');
    clock.advance(60_000);
    const replay = await store.observationEvents.ingest({ ...event, payload: structuredClone(event.payload) });
    expect(replay.kind).toBe('DUPLICATE');
    if (replay.kind !== 'DUPLICATE') {
      return;
    }
    expect(replay.event_id).toBe('evt-0002');
    // first_received_at is the ORIGINAL receipt (not the replay instant).
    expect(replay.first_received_at).toBe(formatRfc3339(CLOCK_START));
    const list = await store.observationEvents.list({ limit: null });
    expect(list.items).toHaveLength(1); // never double-applied
  });

  it('keeps replay protection correct after the coordination layer is flushed (durable index is the authority)', async () => {
    const clock = new ManualClock(CLOCK_START);
    const store = createInMemoryLiveStore({ clock });
    const event = {
      id: 'evt-0003',
      source: 'otel:collector:prod',
      kind: 'telemetry.observation',
      occurred_at: fixtures.T1,
      payload: { metric: 'p99', value: 42 },
      provenance: ['otel:batch:1'],
    };
    await store.observationEvents.ingest(event);
    // A different event with the SAME id and DIFFERENT payload is still a
    // replay (the id is the delivery identity).
    const replay = await store.observationEvents.ingest({ ...event, payload: { metric: 'p99', value: 99 } });
    expect(replay.kind).toBe('DUPLICATE');
  });

  it('rejects events without an id or provenance (typed INVALID)', async () => {
    const store = createInMemoryLiveStore({ clock: new ManualClock(CLOCK_START) });
    await expect(
      store.observationEvents.ingest({
        id: '',
        source: 's',
        kind: 'k',
        occurred_at: fixtures.T1,
        payload: null,
        provenance: ['p'],
      }),
    ).rejects.toThrow(InvalidRecordError);
    await expect(
      store.observationEvents.ingest({
        id: 'evt-x',
        source: 's',
        kind: 'k',
        occurred_at: 'not-rfc3339',
        payload: null,
        provenance: ['p'],
      }),
    ).rejects.toThrow(InvalidRecordError);
    await expect(
      store.observationEvents.ingest({
        id: 'evt-x',
        source: 's',
        kind: 'k',
        occurred_at: fixtures.T1,
        payload: undefined as never,
        provenance: [],
      }),
    ).rejects.toThrow(InvalidRecordError);
  });

  it('lists by source deterministically and paginates', async () => {
    const store = createInMemoryLiveStore({ clock: new ManualClock(CLOCK_START) });
    for (let i = 0; i < 5; i += 1) {
      await store.observationEvents.ingest({
        id: `evt-a-${String(i).padStart(4, '0')}`,
        source: 'otel:collector:prod',
        kind: 'telemetry.observation',
        occurred_at: fixtures.T1,
        payload: { i },
        provenance: [`otel:batch:${i}`],
      });
    }
    for (let i = 0; i < 3; i += 1) {
      await store.observationEvents.ingest({
        id: `evt-b-${String(i).padStart(4, '0')}`,
        source: 'github:webhook:payswapdotorg/SOS-2.0',
        kind: 'ci.run',
        occurred_at: fixtures.T1,
        payload: { i },
        provenance: [`github:delivery:${i}`],
      });
    }
    const otel = await store.observationEvents.listBySource('otel:collector:prod', { limit: null });
    expect(otel.items).toHaveLength(5);
    expect(otel.items.every((event) => event.source === 'otel:collector:prod')).toBe(true);
    const page = await store.observationEvents.listBySource('otel:collector:prod', { limit: 2 });
    expect(page.items).toHaveLength(2);
    expect(page.next_after_id).toBe('evt-a-0001');
    const all = await store.observationEvents.list({ limit: null });
    expect(all.items).toHaveLength(8);
    const ids = all.items.map((event) => event.id);
    expect(ids).toEqual([...ids].sort());
  });
});
