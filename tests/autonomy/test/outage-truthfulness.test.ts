/**
 * ACCEPTANCE SUITE 4 — OUTAGE TRUTHFULNESS (Work Order P12, pinned).
 *
 * "provider outage becomes truthful uncertainty/unavailability":
 *   - SUSPECTED is not LOST (a missed beat is UNKNOWN; only a verified
 *     failure is LOST — no fabricated liveness, no fabricated death);
 *   - outage windows are typed with truthful UNAVAILABLE statuses;
 *   - bounded fixed-schedule backoff with typed retry records, then ASK
 *     when the bounds are exhausted — never a silent infinite loop.
 */

import { describe, expect, it } from 'vitest';
import {
  BackoffRetryController,
  InMemoryAskSink,
  InMemoryOutageRegistry,
  providerStatusOf,
} from '@sos-2/autonomy-runtime';
import { createAutonomyWorld, seedWorld, startAcceptanceTask, FIRST_BODY, MISSED_BEAT_WINDOW_MS } from './world.js';
import { formatRfc3339 } from '@sos-2/live-store';

describe('P12 acceptance: provider outage becomes truthful uncertainty/unavailability', () => {
  it('SUSPECTED != LOST: a missed beat is truthful UNKNOWN; death requires a verified failure observation', async () => {
    const world = createAutonomyWorld();
    await seedWorld(world);
    const started = await startAcceptanceTask(world, 'task-suspected');
    expect(started.status).toBe('STARTED');
    const leaseId = started.status === 'STARTED' ? started.lease_id : '';

    // Fresh beat -> HEALTHY.
    world.beats.beat(FIRST_BODY, world.clock.nowEpochMs());
    expect((await world.supervisor.supervise(leaseId)).state).toBe('HEALTHY');

    // Stale beat -> SUSPECTED (UNKNOWN — the body may be alive).
    world.beats.forgetBody(FIRST_BODY);
    world.clock.advance(MISSED_BEAT_WINDOW_MS + 1_000);
    const suspected = await world.supervisor.supervise(leaseId);
    expect(suspected.state).toBe('SUSPECTED');
    expect(suspected.verifiedFailure).toBeNull();
    expect(suspected.detail).toContain('UNKNOWN');

    // Still no verification -> STILL SUSPECTED (never silently LOST).
    world.clock.advance(MISSED_BEAT_WINDOW_MS * 5);
    expect((await world.supervisor.supervise(leaseId)).state).toBe('SUSPECTED');

    // The verified failure observation is the ONLY path to LOST.
    world.failures.record({
      bodyId: FIRST_BODY,
      observationId: 'obs-verified-provider-crash',
      observedAt: formatRfc3339(world.clock.nowEpochMs()),
      detail: 'provider incident record attests the body crashed',
    });
    const lost = await world.supervisor.supervise(leaseId);
    expect(lost.state).toBe('LOST');
    expect(lost.verifiedFailure?.observationId).toBe('obs-verified-provider-crash');
  });

  it('the LOST verdict is durable as an observation event; the SUSPECTED verdicts are too (replay-safe)', async () => {
    const world = createAutonomyWorld();
    await seedWorld(world);
    const started = await startAcceptanceTask(world, 'task-verdict-events');
    expect(started.status).toBe('STARTED');
    const leaseId = started.status === 'STARTED' ? started.lease_id : '';

    world.beats.forgetBody(FIRST_BODY);
    world.clock.advance(MISSED_BEAT_WINDOW_MS + 1);
    await world.supervisor.supervise(leaseId); // SUSPECTED -> event
    world.failures.record({
      bodyId: FIRST_BODY,
      observationId: 'obs-verified-crash-2',
      observedAt: formatRfc3339(world.clock.nowEpochMs()),
      detail: 'verified crash',
    });
    await world.supervisor.supervise(leaseId); // LOST -> event

    const events = await world.store.observationEvents.list({ limit: null });
    const watch = events.items.filter((event) => event.source === 'autonomy-lease-watch');
    const kinds = watch.map((event) => event.kind).sort();
    expect(kinds).toEqual(['lease.lost', 'lease.suspected']);
    for (const event of watch) {
      expect((event.payload as Record<string, unknown>)['task_ref']).toBe('task-verdict-events');
    }
  });

  it('outage windows are typed with truthful UNAVAILABLE (never silent) and honest AVAILABLE when closed', () => {
    const registry = new InMemoryOutageRegistry();
    const before = providerStatusOf(registry, 'reference-cloud');
    expect(before.state).toBe('AVAILABLE');
    expect(before.detail).toContain('never claimed');

    const window = registry.open('reference-cloud', '2026-03-01T09:00:00Z', 'the provider reports a region-wide generation outage');
    expect(window.status).toBe('OPEN');
    const during = providerStatusOf(registry, 'reference-cloud');
    expect(during.state).toBe('UNAVAILABLE');
    expect(during.open_window?.detail).toContain('region-wide');

    const closed = registry.close('reference-cloud', '2026-03-01T12:00:00Z');
    expect(closed?.status).toBe('CLOSED');
    expect(providerStatusOf(registry, 'reference-cloud').state).toBe('AVAILABLE');
  });

  it('bounded backoff: typed retry records from the fixed schedule, then ASK — never a fourth retry', () => {
    const asks = new InMemoryAskSink();
    const controller = new BackoffRetryController({ backoffScheduleMs: [1_000, 4_000, 16_000] }, 'task-bounded', asks);

    const first = controller.next('2026-03-01T09:00:01Z');
    expect(first.kind).toBe('RETRY');
    if (first.kind === 'RETRY') {
      expect(first.record.attempt).toBe(1);
      expect(first.record.delay_ms).toBe(1_000);
      expect(first.record.exhausted).toBe(false);
    }

    const second = controller.next('2026-03-01T09:00:06Z');
    expect(second.kind).toBe('RETRY');
    const third = controller.next('2026-03-01T09:00:23Z');
    expect(third.kind).toBe('RETRY');
    if (third.kind === 'RETRY') {
      expect(third.record.exhausted).toBe(true);
    }

    // The bounds are exhausted: the NEXT decision is the ASK (no infinite loop).
    const fourth = controller.next('2026-03-01T09:01:00Z');
    expect(fourth.kind).toBe('ASK');
    if (fourth.kind === 'ASK') {
      expect(fourth.ask.attempts).toBe(3);
      expect(fourth.ask.reason).toContain('exhausted');
    }
    expect(asks.asks.length).toBe(1);
    // Every scheduled retry was a typed record: attempts == 3.
    expect(controller.attemptCount()).toBe(3);
  });
});
