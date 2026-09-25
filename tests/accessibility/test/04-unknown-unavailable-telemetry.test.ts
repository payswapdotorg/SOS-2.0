/**
 * LANE C, NEGATIVE CASE 04 — UNKNOWN / UNAVAILABLE TELEMETRY (the P7
 * honest-status discipline under fault injection).
 *
 * The fault: telemetry is UNKNOWN or UNAVAILABLE (a capture that could
 * not observe, a provider inside an outage window, an unprobed
 * provider). The system must keep every such status TRUTHFUL and
 * bit-exact — UNKNOWN where evidence is absent, UNAVAILABLE inside
 * observed outage windows, never fabricated success — through the
 * durable observation plane, the provider-health discipline and the
 * outage windows of the autonomy runtime. Never a silent pass (a
 * fabricated HEALTHY/AVAILABLE), never a crash.
 */

import { describe, expect, test } from 'vitest';
import { ProviderHealthTracker, aggregateProviderHealth, unprobedProviderHealth } from '@sos-2/cost-policy';
import type { ProbeReport } from '@sos-2/cost-policy';
import { InMemoryOutageRegistry, providerStatusOf } from '@sos-2/autonomy-runtime';
import { ManualClock, createInMemoryLiveStore, formatRfc3339 } from '@sos-2/live-store';
import { LANE_PROVENANCE, PRODUCT_T0, PolicyManualClock } from './helpers.js';

describe('P15 lane C negative case: unknown / unavailable telemetry', () => {
  test('TRUTHFUL: an UNAVAILABLE telemetry capture survives observation ingestion bit-exact (never folded into success)', async () => {
    const clock = new ManualClock(PRODUCT_T0);
    const store = createInMemoryLiveStore({ clock });
    // The fault: a telemetry capture that could NOT observe.
    const outcome = await store.observationEvents.ingest({
      id: 'p15c-04-telemetry-unavailable-0001',
      source: 'runtime:telemetry',
      kind: 'telemetry.observation',
      occurred_at: formatRfc3339(clock.nowEpochMs()),
      payload: {
        metric: 'payments.error_rate',
        status: 'UNAVAILABLE',
        detail: 'the runtime probe could not observe the metric (collection window missed)',
        samples: null,
      },
      provenance: [...LANE_PROVENANCE, 'p15c-04:unavailable-capture'],
    });
    expect(outcome.kind).toBe('APPLIED');

    // The stored record preserves the UNAVAILABLE truth state VERBATIM.
    const stored = await store.observationEvents.get('p15c-04-telemetry-unavailable-0001');
    expect(stored).toBeDefined();
    expect((stored!.payload as Record<string, unknown>)['status']).toBe('UNAVAILABLE');
    expect(JSON.stringify(stored!.payload)).toContain('could not observe');

    // Replay of the same event id is detected (replay protection), never double-applied.
    const replay = await store.observationEvents.ingest({
      id: 'p15c-04-telemetry-unavailable-0001',
      source: 'runtime:telemetry',
      kind: 'telemetry.observation',
      occurred_at: formatRfc3339(clock.nowEpochMs()),
      payload: { metric: 'payments.error_rate', status: 'UNAVAILABLE' },
      provenance: [...LANE_PROVENANCE, 'p15c-04:unavailable-capture-replay'],
    });
    expect(replay.kind).toBe('DUPLICATE');
    const listed = await store.observationEvents.list({ limit: null });
    expect(listed.items.length).toBe(1);
  });

  test('TRUTHFUL: provider health is UNKNOWN without observations and never fabricates recovery from silence', () => {
    const clock = new PolicyManualClock(1_000_000);
    const tracker = new ProviderHealthTracker(clock);
    // UNKNOWN where evidence is absent (never a guessed HEALTHY).
    expect(tracker.current('provider-p15c-neon').status).toBe('UNKNOWN');
    // An observation of unavailability says so:
    tracker.reportProbe('provider-p15c-neon', 'probe-1', { status: 'UNAVAILABLE', detail: 'connection refused' });
    expect(tracker.current('provider-p15c-neon').status).toBe('UNAVAILABLE');
    // Silence does NOT imply recovery — the last observed evidence stands.
    clock.advance(60_000);
    expect(tracker.current('provider-p15c-neon').status).toBe('UNAVAILABLE');
    // Recovery requires a NEW observation (never assumed).
    tracker.reportProbe('provider-p15c-neon', 'probe-1', { status: 'HEALTHY', detail: 'recovered' });
    expect(tracker.current('provider-p15c-neon').status).toBe('HEALTHY');
  });

  test('TRUTHFUL: an unprobed provider is honestly UNKNOWN — the unprobed record never claims health', () => {
    const record = unprobedProviderHealth('provider-p15c-unprobed');
    expect(record.status).toBe('UNKNOWN');
    expect(record.lastProbeAt).toBeNull();
    expect(record.reports).toEqual([]);
    expect(record.note.length).toBeGreaterThan(0);
  });

  test('TRUTHFUL: the health aggregate never upgrades mixed/absent evidence to HEALTHY', () => {
    expect(aggregateProviderHealth([])).toBe('UNKNOWN');
    expect(aggregateProviderHealth([probe('p1', 'UNKNOWN', 1)])).toBe('UNKNOWN');
    expect(aggregateProviderHealth([probe('p1', 'UNAVAILABLE', 1)])).toBe('UNAVAILABLE');
    expect(aggregateProviderHealth([probe('p1', 'HEALTHY', 1), probe('p2', 'UNKNOWN', 2)])).toBe('UNKNOWN');
    expect(aggregateProviderHealth([probe('p1', 'HEALTHY', 1)])).toBe('HEALTHY');
  });

  test('TRUTHFUL: an open outage window is the typed UNAVAILABLE (a fact about the window, never a guess)', () => {
    const registry = new InMemoryOutageRegistry();
    // Before any window: no fabricated unavailability either.
    const before = providerStatusOf(registry, 'provider-p15c-git');
    expect(before.state).toBe('AVAILABLE');
    expect(before.detail).toContain('never claimed');

    // The fault: the provider enters an outage window.
    const opened = registry.open('provider-p15c-git', '2026-07-01T09:00:00.000Z', 'the provider declared an outage (verified window)');
    expect(opened.status).toBe('OPEN');
    const during = providerStatusOf(registry, 'provider-p15c-git');
    expect(during.state).toBe('UNAVAILABLE');
    expect(during.open_window!.detail).toContain('verified window');

    // Closing the window returns to the observed-fact status (with the honest caveat).
    const closed = registry.close('provider-p15c-git', '2026-07-01T10:00:00.000Z');
    expect(closed!.status).toBe('CLOSED');
    const after = providerStatusOf(registry, 'provider-p15c-git');
    expect(after.state).toBe('AVAILABLE');
    expect(after.detail).toContain('internal provider health is never claimed');
  });
});

function probe(probeId: string, status: ProbeReport['status'], checkedAt: number): ProbeReport {
  return { probeId, status, detail: null, checkedAt };
}
