/**
 * ACCEPTANCE (Work Order P11): RECONNECT + STATE RECONCILIATION — the
 * companion reconciles its durable local event log against the P2
 * live-store on reconnect using idempotent event ingestion with replay
 * protection: NO DUPLICATION, NO LOSS. Replayed events are deduplicated
 * EXACTLY (exactly-once); sequence continuity is gap-free (a gap is a
 * typed violation, never silent).
 */

import { describe, expect, it } from 'vitest';
import { acceptanceWorld, localWorkOrder, pairCommand } from './acceptance-world.js';
import { reconcileLocalEventLog } from '@sos-2/local-companion';
import type { LocalEventLog } from '@sos-2/local-companion';
import { createInMemoryLiveStore } from '@sos-2/live-store';
import { ManualClock } from '@sos-2/live-store';

describe('acceptance: reconnect does not duplicate or lose task events', () => {
  it('the full offline -> reconnect cycle reconciles exactly-once with gap-free continuity', async () => {
    const world = acceptanceWorld();
    await world.store.authorityGrants.put(world.grant);
    world.devicePresence.setOnline(false);
    world.commandSource.push(pairCommand());
    world.commandSource.push({
      kind: 'run-work-order',
      order: localWorkOrder('task-reconnect-0001', world.grant, [
        { kind: 'workspace.write', path: 'acme/src/reconnect.ts', content: 'export const reconnect = true;\n' },
        { kind: 'observations.emit', observation_kind: 'body.progress', payload: { stage: 'queued' } },
      ]),
    });
    await world.host.drain(); // offline: pair + queue

    // The pending suffix (pairing + queue events accumulated offline).
    const pending = world.companion.eventLog.pendingAfter(world.companion.eventLog.watermark());
    expect(pending.length).toBeGreaterThanOrEqual(2);
    // GAP-FREE continuity of the accumulated suffix (1..N contiguous).
    expect(pending.map((event) => event.seq)).toEqual(Array.from({ length: pending.length }, (_, index) => index + 1));

    // RECONNECT: the host reconciles FIRST, then releases + runs.
    world.devicePresence.setOnline(true);
    const onlineOutcomes = await world.host.drain();
    const reconciled = onlineOutcomes.find((outcome) => outcome.status === 'RECONCILED');
    expect(reconciled).toBeDefined();
    if (reconciled !== undefined && reconciled.status === 'RECONCILED') {
      expect(reconciled.report.replayed).toBe(pending.length);
      expect(reconciled.report.applied).toBe(pending.length);
      expect(reconciled.report.duplicates).toBe(0);
      expect(reconciled.report.range).toEqual({ from: 1, to: pending.length });
    }

    // NO LOSS: every pending local event is now durably held by the P2
    // live-store under its deterministic replay-protection id.
    for (const event of pending) {
      const stored = await world.store.observationEvents.get(`local-companion:device-acceptance-0001:${event.event_id}`);
      expect(stored).toBeDefined();
      expect(stored?.kind).toBe(event.kind);
      expect(stored?.source).toBe('local-companion:device-acceptance-0001');
    }

    // NO DUPLICATION: the post-run events reconcile exactly-once on the
    // follow-up pass (the reconnect reconciliation covered the offline
    // suffix; the run emitted new events after it).
    const followUp = await world.host.reconcile();
    if (followUp.status === 'RECONCILED') {
      expect(followUp.report.applied).toBeGreaterThan(0);
      expect(followUp.report.duplicates).toBe(0);
    }
    // And a further reconciliation of the stable state is a no-op.
    const second = await world.host.reconcile();
    if (second.status === 'RECONCILED') {
      expect(second.report.replayed).toBe(0);
    }
    // And re-replaying the FULL suffix against the store that already
    // holds everything (the lost-acknowledgement restart) deduplicates
    // EXACTLY — the durable COMPANION-event count never doubles (the
    // store also holds the fabric's own operation observations, which are
    // not companion events and are filtered out of this count).
    const companionEventsInStore = (await world.store.observationEvents.list()).items.filter(
      (item) => item.source === 'local-companion:device-acceptance-0001',
    );
    const storeCount = companionEventsInStore.length;
    const lostAckLog: LocalEventLog = {
      append: (input) => world.companion.eventLog.append(input),
      events: () => world.companion.eventLog.events(),
      pendingAfter: (seq) => world.companion.eventLog.pendingAfter(seq),
      acknowledge: () => undefined,
      watermark: () => 0,
    };
    const replay = await reconcileLocalEventLog({ log: lostAckLog, observationEvents: world.store.observationEvents });
    expect(replay.replayed).toBe(storeCount);
    expect(replay.applied).toBe(0);
    expect(replay.duplicates).toBe(storeCount);
    const companionEventsAfter = (await world.store.observationEvents.list()).items.filter(
      (item) => item.source === 'local-companion:device-acceptance-0001',
    );
    expect(companionEventsAfter.length).toBe(storeCount);
  });

  it('a gap in the local event log sequence is a typed COMPANION_RECONCILIATION_GAP violation — never silent, never folded away', async () => {
    const clock = new ManualClock(Date.parse('2026-01-15T09:00:00Z'));
    const store = createInMemoryLiveStore({ clock });
    const gappy: LocalEventLog = {
      append: () => {
        throw new Error('not used');
      },
      events: () => [],
      pendingAfter: (seq) =>
        seq === 0
          ? [
              {
                event_id: 'evt-0001',
                seq: 1,
                source: 'local-companion:queue',
                kind: 'local.queue.queued',
                payload: { task_id: 't1' },
                device_id: 'device-acceptance-0001',
                provenance: ['local-companion:queue', 'device:device-acceptance-0001'],
                occurred_at: '2026-01-15T09:00:00Z',
              },
              {
                event_id: 'evt-0003',
                seq: 3,
                source: 'local-companion:queue',
                kind: 'local.queue.queued',
                payload: { task_id: 't3' },
                device_id: 'device-acceptance-0001',
                provenance: ['local-companion:queue', 'device:device-acceptance-0001'],
                occurred_at: '2026-01-15T09:00:01Z',
              },
            ]
          : [],
      acknowledge: () => undefined,
      watermark: () => 0,
    };
    await expect(reconcileLocalEventLog({ log: gappy, observationEvents: store.observationEvents })).rejects.toThrow('COMPANION_RECONCILIATION_GAP');
    // And NOTHING was ingested from the gappy log (fail-closed: the gap
    // aborts the pass before the store ever sees event 3).
    expect((await store.observationEvents.list()).items.length).toBe(0);
  });
});
