/**
 * @sos-2/telemetry-runtime unit contract tests: verbatim truth-state
 * preservation, deterministic replay ids, typed poll failures, gap
 * accounting. (Journey acceptance lives in tests/observation.)
 */

import { describe, expect, it } from 'vitest';
import { createInMemoryLiveStore, ManualClock } from '@sos-2/live-store';
import { EventIngestionPipeline } from '@sos-2/event-ingestion';
import { InMemoryTelemetrySource } from '@sos-2/telemetry';
import type { RawObservation } from '@sos-2/telemetry';
import { TelemetryRuntime } from '../src/index.js';

const T0 = Date.parse('2026-09-21T12:00:00Z');

function capture(subject: string, availability: RawObservation['availability'], start: string, end: string): RawObservation {
  return {
    subject_ref: subject,
    availability,
    window: { start, end },
    observed: null,
    attributes: {},
    producer: { tool: 'test-source', tool_version: null, model: null, model_version: null, command: null, environment: null },
  };
}

describe('TelemetryRuntime', () => {
  it('carries captures verbatim — an UNAVAILABLE gap stays UNAVAILABLE in the durable payload', async () => {
    const store = createInMemoryLiveStore();
    const pipeline = new EventIngestionPipeline({ observationEvents: store.observationEvents, clock: new ManualClock(T0) });
    const source = new InMemoryTelemetrySource({
      id: 'otel:collector:prod',
      observations: [capture('otel:service:checkout', 'UNAVAILABLE', '2026-09-21T11:00:00Z', '2026-09-21T12:00:00Z')],
    });
    const runtime = new TelemetryRuntime({ sources: [source], pipeline, clock: new ManualClock(T0) });
    const reports = await runtime.pollAll();
    expect(reports[0]?.gaps).toBe(1);
    const listing = await store.observationEvents.list({ limit: 100 });
    expect(listing.items.length).toBe(1);
    const payload = listing.items[0]?.payload as { availability: string; subject_ref: string };
    expect(payload.availability).toBe('UNAVAILABLE');
    expect(payload.subject_ref).toBe('otel:service:checkout');
  });

  it('re-poll of the same buffer deduplicates exactly (deterministic ids)', async () => {
    const store = createInMemoryLiveStore();
    const pipeline = new EventIngestionPipeline({ observationEvents: store.observationEvents, clock: new ManualClock(T0) });
    const source = new InMemoryTelemetrySource({
      id: 'metrics:store',
      observations: [capture('otel:service:api', 'SUCCESS', '2026-09-21T11:00:00Z', '2026-09-21T12:00:00Z')],
    });
    const runtime = new TelemetryRuntime({ sources: [source], pipeline, clock: new ManualClock(T0) });
    await runtime.pollAll();
    const second = await runtime.pollAll();
    expect(second[0]?.duplicates).toBe(1);
    expect(second[0]?.ingested).toBe(0);
    const listing = await store.observationEvents.list({ limit: 100 });
    expect(listing.items.length).toBe(1);
  });

  it('records a typed POLL_FAILED outcome when fetch throws (no fabricated gap event)', async () => {
    const store = createInMemoryLiveStore();
    const pipeline = new EventIngestionPipeline({ observationEvents: store.observationEvents, clock: new ManualClock(T0) });
    const failing = {
      id: 'broken:backend',
      description: null,
      fetch: (): RawObservation[] => {
        throw new Error('backend unreachable');
      },
    };
    const runtime = new TelemetryRuntime({ sources: [failing], pipeline, clock: new ManualClock(T0) });
    const reports = await runtime.pollAll();
    expect(reports[0]?.failure).toBe('backend unreachable');
    const listing = await store.observationEvents.list({ limit: 100 });
    expect(listing.items.length).toBe(0);
  });

  it('counts SUCCESS captures as ingested, not gaps', async () => {
    const store = createInMemoryLiveStore();
    const pipeline = new EventIngestionPipeline({ observationEvents: store.observationEvents, clock: new ManualClock(T0) });
    const source = new InMemoryTelemetrySource({
      id: 'logs:pipeline',
      observations: [
        capture('otel:service:web', 'SUCCESS', '2026-09-21T11:00:00Z', '2026-09-21T12:00:00Z'),
        capture('otel:service:web', 'FAILURE', '2026-09-21T12:00:00Z', '2026-09-21T12:05:00Z'),
      ],
    });
    const runtime = new TelemetryRuntime({ sources: [source], pipeline, clock: new ManualClock(T0) });
    const reports = await runtime.pollAll();
    expect(reports[0]?.ingested).toBe(2);
    expect(reports[0]?.gaps).toBe(0);
  });
});
