/**
 * @sos-2/event-ingestion unit contract tests: normalization determinism,
 * replay protection, typed rejection, source health, probe scheduling
 * honesty and coverage states. (Journey-level acceptance lives in
 * tests/observation.)
 */

import { describe, expect, it } from 'vitest';
import { createInMemoryLiveStore, ManualClock } from '@sos-2/live-store';
import type { EventSourcePort, EventSourceDescription, ExternalEventEnvelope, ObservationEventFamily } from '../src/index.js';
import { composeEventId, normalizeExternalEvent, EventIngestionPipeline, ProbeScheduler, CoverageLedger } from '../src/index.js';

const clock = () => new ManualClock(Date.parse('2026-09-21T12:00:00Z'));

function githubSource(): EventSourcePort {
  const description: EventSourceDescription = {
    source: 'github:webhook:payswapdotorg/SOS-2.0',
    family: 'github',
    connection: 'simulated',
    description: 'reference github webhook source',
  };
  const envelopes: ExternalEventEnvelope[] = [
    {
      externalId: 'delivery-0001',
      kind: 'github.push',
      occurredAt: '2026-09-21T11:59:00Z',
      payload: { ref: 'refs/heads/main', before: 'before-sha', after: '86a6921631113167f071c2f9019dddd0c1ab6447' },
      provenance: ['github:webhook'],
    },
  ];
  return { describe: () => description, poll: async () => [...envelopes] };
}

describe('normalizeExternalEvent', () => {
  it('composes the durable id deterministically from (source, externalId)', async () => {
    const source = githubSource().describe();
    const envelope = (await githubSource().poll())[0]!;
    const first = normalizeExternalEvent(source, envelope);
    const second = normalizeExternalEvent(source, envelope);
    expect(first.id).toBe(composeEventId(source.source, envelope.externalId));
    expect(second.id).toBe(first.id);
  });

  it('rejects a non-RFC3339 occurredAt with a typed error', () => {
    const source = githubSource().describe();
    expect(() =>
      normalizeExternalEvent(source, {
        externalId: 'x',
        kind: 'github.push',
        occurredAt: 'not-a-timestamp',
        payload: {},
        provenance: ['test'],
      }),
    ).toThrow(/RFC3339/);
  });

  it('preserves the payload verbatim (truth states survive bit-exact)', () => {
    const source = githubSource().describe();
    const input = normalizeExternalEvent(source, {
      externalId: 'tel-1',
      kind: 'telemetry.observation',
      occurredAt: '2026-09-21T11:00:00Z',
      payload: { subject_ref: 'otel:service:checkout', availability: 'UNAVAILABLE', window: { start: '2026-09-21T10:00:00Z', end: '2026-09-21T11:00:00Z' } },
      provenance: ['otel:collector:prod'],
    });
    expect(input.payload).toEqual({
      subject_ref: 'otel:service:checkout',
      availability: 'UNAVAILABLE',
      window: { start: '2026-09-21T10:00:00Z', end: '2026-09-21T11:00:00Z' },
    });
  });
});

describe('EventIngestionPipeline', () => {
  it('APPLIES then answers DUPLICATE for a redelivered event (never double-applied)', async () => {
    const store = createInMemoryLiveStore();
    const pipeline = new EventIngestionPipeline({ observationEvents: store.observationEvents, clock: clock() });
    const source = githubSource().describe();
    const envelope = (await githubSource().poll())[0]!;
    const input = normalizeExternalEvent(source, envelope);
    const first = await pipeline.ingest(input);
    const second = await pipeline.ingest(input);
    expect(first.kind).toBe('APPLIED');
    expect(second.kind).toBe('DUPLICATE');
    if (second.kind === 'DUPLICATE') {
      expect(second.eventId).toBe(input.id);
    }
    const listing = await store.observationEvents.list({ limit: 100 });
    expect(listing.items.length).toBe(1);
  });

  it('REJECTS an invalid event with a typed outcome and keeps running', async () => {
    const store = createInMemoryLiveStore();
    const pipeline = new EventIngestionPipeline({ observationEvents: store.observationEvents, clock: clock() });
    const outcome = await pipeline.ingest({
      id: 'bad-event',
      source: 'github:webhook:x',
      kind: '',
      occurred_at: '2026-09-21T11:00:00Z',
      payload: {},
      provenance: ['test'],
    });
    expect(outcome.kind).toBe('REJECTED');
    const listing = await store.observationEvents.list({ limit: 100 });
    expect(listing.items.length).toBe(0);
  });

  it('pollSource records typed POLL_FAILED when the source throws', async () => {
    const store = createInMemoryLiveStore();
    const pipeline = new EventIngestionPipeline({ observationEvents: store.observationEvents, clock: clock() });
    const description: EventSourceDescription = { source: 'ci:bus:broken', family: 'ci', connection: 'simulated', description: null };
    const failing: EventSourcePort = { describe: () => description, poll: async () => {
      throw new Error('connection refused');
    } };
    const summary = await pipeline.pollSource(failing);
    expect(summary.poll.kind).toBe('POLL_FAILED');
    const health = pipeline.healthSnapshot().find((entry) => entry.source === 'ci:bus:broken');
    expect(health?.pollFailureCount).toBe(1);
    expect(health?.lastPollOutcome).toBe('POLL_FAILED');
  });

  it('tracks per-source health counters', async () => {
    const store = createInMemoryLiveStore();
    const pipeline = new EventIngestionPipeline({ observationEvents: store.observationEvents, clock: clock() });
    await pipeline.pollSource(githubSource());
    await pipeline.pollSource(githubSource());
    const health = pipeline.healthSnapshot().find((entry) => entry.source === 'github:webhook:payswapdotorg/SOS-2.0');
    expect(health?.appliedCount).toBe(1);
    expect(health?.duplicateCount).toBe(1);
    expect(health?.lastEventAt).toBe('2026-09-21T11:59:00Z');
  });
});

describe('ProbeScheduler', () => {
  it('stands down (SKIPPED_COVERED) when organic coverage is fresh', async () => {
    const outcomes = await runProbes({ covered: true });
    expect(outcomes.map((outcome) => outcome.kind)).toEqual(['SKIPPED_COVERED']);
  });

  it('runs when coverage is insufficient and the interval elapsed', async () => {
    const outcomes = await runProbes({ covered: false });
    expect(outcomes.map((outcome) => outcome.kind)).toEqual(['RAN']);
    expect(outcomes[0]?.envelope?.kind).toBe('scheduled-probe.result');
  });

  it('SKIPPED_INTERVAL before the minimum interval elapses', async () => {
    const manualClock = new ManualClock(Date.parse('2026-09-21T12:00:00Z'));
    const { scheduler } = buildProbes(manualClock, false);
    await scheduler.runDue();
    manualClock.advance(1000);
    const second = await scheduler.runDue();
    expect(second.map((outcome) => outcome.kind)).toEqual(['SKIPPED_INTERVAL']);
  });

  function buildProbes(manualClock: ManualClock, covered: boolean) {
    const definition = {
      probeId: 'probe-repo-head',
      subject: 'github:repo:payswapdotorg/SOS-2.0',
      fillsFamily: 'github' as ObservationEventFamily,
      minIntervalSec: 3600,
      purpose: 'no webhook receiver connected yet',
    };
    const probe = {
      definition,
      run: async () => ({
        externalId: `probe-${Date.parse('2026-09-21T12:00:00Z')}`,
        kind: 'scheduled-probe.result',
        occurredAt: '2026-09-21T12:00:00Z',
        payload: { subject_ref: 'github:repo:payswapdotorg/SOS-2.0', branch: 'main', head: 'probe-sha' },
        provenance: ['scheduled-probe:probe-repo-head'],
      }),
    };
    const scheduler = new ProbeScheduler({ clock: manualClock, isCovered: async () => covered, probes: [probe] });
    return { scheduler };
  }

  async function runProbes({ covered }: { covered: boolean }) {
    const { scheduler } = buildProbes(clock(), covered);
    return scheduler.runDue();
  }
});

describe('CoverageLedger', () => {
  it('reports NOT_COVERED with zero events and PROBE_ONLY for probe events', async () => {
    const store = createInMemoryLiveStore();
    const pipeline = new EventIngestionPipeline({ observationEvents: store.observationEvents, clock: clock() });
    await pipeline.ingest({
      id: 'probe:1',
      source: 'scheduled-probe:probe-repo-head',
      kind: 'scheduled-probe.result',
      occurred_at: '2026-09-21T11:55:00Z',
      payload: { subject_ref: 'github:repo:payswapdotorg/SOS-2.0', branch: 'main', head: 'probe-sha' },
      provenance: ['scheduled-probe:probe-repo-head'],
    });
    const ledger = new CoverageLedger({
      observationEvents: store.observationEvents,
      clock: clock(),
      freshAfterMs: 600_000,
      subjects: [{ subject: 'github:repo:payswapdotorg/SOS-2.0', sources: ['github:webhook:payswapdotorg/SOS-2.0', 'scheduled-probe:probe-repo-head'] }],
    });
    const coverage = await ledger.coverageFor('github:repo:payswapdotorg/SOS-2.0', 'github');
    expect(coverage.state).toBe('PROBE_ONLY');
    expect(coverage.probeEventCount).toBe(1);
    expect(coverage.organicEventCount).toBe(0);
  });

  it('distinguishes COVERED_FRESH from COVERED_STALE by the freshness window', async () => {
    const store = createInMemoryLiveStore();
    const pipeline = new EventIngestionPipeline({ observationEvents: store.observationEvents, clock: clock() });
    await pipeline.pollSource(githubSource());
    const wiring = [{ subject: 'github:repo:payswapdotorg/SOS-2.0', sources: ['github:webhook:payswapdotorg/SOS-2.0'] }];
    const fresh = new CoverageLedger({ observationEvents: store.observationEvents, clock: clock(), freshAfterMs: 600_000, subjects: wiring });
    expect((await fresh.coverageFor('github:repo:payswapdotorg/SOS-2.0', 'github')).state).toBe('COVERED_FRESH');
    const staleClock = new ManualClock(Date.parse('2026-09-21T13:30:00Z'));
    const stale = new CoverageLedger({ observationEvents: store.observationEvents, clock: staleClock, freshAfterMs: 600_000, subjects: wiring });
    expect((await stale.coverageFor('github:repo:payswapdotorg/SOS-2.0', 'github')).state).toBe('COVERED_STALE');
  });
});
