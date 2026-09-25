/**
 * THE NO-BODY OBSERVATION JOURNEY (Work Order P15, lane B) — continuous
 * observation while NO body is active (the P7 no-body loop + the P12
 * runtime in ONE composition):
 *
 *   - with ZERO bodies leased, observation events still ingest (github /
 *     CI / deployment / provider-health sources drain into the durable
 *     observation store);
 *   - System State stays TRUTHFUL: fresh claims read ALIGNED/DIVERGED,
 *     stale claims read STALE, unobserved subjects read UNVERIFIED —
 *     never a fabricated success;
 *   - NOTHING fabricates progress: no body is summoned, no task record,
 *     no lease, no checkpoint, no completion appears anywhere.
 */

import { describe, expect, it } from 'vitest';
import { REFERENCE_SUBJECTS } from '@sos-2/observation-host';
import {
  OBSERVATION_T0,
  OBSERVED_HEAD_SHA,
  createObservationWorld,
} from './world.js';

const FRESH_WINDOW_MS = 600_000; // the reference plane's freshness window (10 minutes)

describe('P15 lane-B no-body observation (governance without an agent)', () => {
  it('observation events still ingest with ZERO bodies active (drain -> applied events, live projections)', async () => {
    const world = createObservationWorld();
    const report = await world.plane.loop.drain();

    // Events ingested from every scripted family.
    expect(report.sourceSummaries.length).toBe(4);
    const applied = report.sourceSummaries.reduce((total, entry) => total + entry.applied, 0);
    expect(applied).toBeGreaterThan(0);
    for (const entry of report.sourceSummaries) {
      expect(entry.poll.kind).toBe('POLLED');
    }

    // The durable observation store holds the ingested events (with provenance).
    const stored = await world.plane.store.observationEvents.list({ limit: null });
    expect(stored.items.length).toBe(applied);
    for (const event of stored.items) {
      expect(event.provenance.length).toBeGreaterThan(0);
    }

    // Live projections are FRESH and truthful.
    const repo = report.snapshot.repositoryHeads.get(REFERENCE_SUBJECTS.repository);
    expect(repo).toBeDefined();
    expect(repo!.branchHeads['main']).toBe(OBSERVED_HEAD_SHA);
    expect(repo!.freshness.state).toBe('FRESH');

    // ZERO bodies: the observation plane never summons one (§5 — a body is
    // summoned only when active inspection/repair/deployment is required).
    const planeLeases = await world.plane.store.bodyLeases.list({ limit: null });
    const planeTasks = await world.plane.store.tasks.list({ limit: null });
    const autonomyLeases = await world.autonomy.store.bodyLeases.list({ limit: null });
    const autonomyTasks = await world.autonomy.store.tasks.list({ limit: null });
    expect(planeLeases.items.length).toBe(0);
    expect(planeTasks.items.length).toBe(0);
    expect(autonomyLeases.items.length).toBe(0);
    expect(autonomyTasks.items.length).toBe(0);
  });

  it('System State stays truthful: aligned, diverged, unverified — never a fabricated success', async () => {
    const world = createObservationWorld();
    const report = await world.plane.loop.drain();

    const bySubject = new Map(report.findings.map((finding) => [finding.subject, finding]));
    // The @main claim is ALIGNED (the observed head equals the claim).
    expect(bySubject.get(`${REFERENCE_SUBJECTS.repository}@main`)!.kind).toBe('ALIGNED');
    // The production claim is honestly DIVERGED (the tracker reports a stale revision).
    expect(bySubject.get('deploy:environment:production')!.kind).toBe('DIVERGED');
    // The unobserved subject is honestly UNVERIFIED — no source observes it.
    expect(bySubject.get('github:repo:other-org/unobserved-repo@main')!.kind).toBe('UNVERIFIED');

    // Detections stay evidence-bound (each names its evidence events).
    for (const detection of report.detections) {
      expect(detection.evidenceEventIds.length).toBeGreaterThan(0);
    }
  });

  it('stale is STALE: after the freshness window the same truth reads STALE (never silently ALIGNED)', async () => {
    const world = createObservationWorld();
    await world.plane.loop.drain();

    // No new events arrive; the clock moves 40 minutes past the window.
    world.clock.advance(FRESH_WINDOW_MS + 4 * 60_000);
    const stale = await world.plane.loop.drain();

    const repo = stale.snapshot.repositoryHeads.get(REFERENCE_SUBJECTS.repository);
    expect(repo!.freshness.state).toBe('STALE');
    expect(repo!.branchHeads['main']).toBe(OBSERVED_HEAD_SHA); // the last observed fact is retained
    const staleFinding = stale.findings.find((finding) => finding.subject === `${REFERENCE_SUBJECTS.repository}@main`);
    expect(staleFinding!.kind).toBe('STALE');
    const unverified = stale.findings.find((finding) => finding.subject === 'github:repo:other-org/unobserved-repo@main');
    expect(unverified!.kind).toBe('UNVERIFIED');
  });

  it('nothing fabricates progress: empty polls change NO state and emit NO events', async () => {
    const world = createObservationWorld();
    const first = await world.plane.loop.drain();
    const eventsAfterFirst = (await world.plane.store.observationEvents.list({ limit: null })).items.length;
    expect(eventsAfterFirst).toBeGreaterThan(0);

    // The sources are drained: every later poll is EMPTY.
    const second = await world.plane.loop.drain();
    const third = await world.plane.loop.drain();
    for (const entry of [...second.sourceSummaries, ...third.sourceSummaries]) {
      expect(entry.poll.kind).toBe('EMPTY');
    }

    // The observation loop itself fabricated NOTHING: no new events, no
    // claims changes, no tasks, no leases, no bodies.
    const eventsAfterThird = (await world.plane.store.observationEvents.list({ limit: null })).items.length;
    expect(eventsAfterThird).toBe(eventsAfterFirst);
    expect((await world.plane.store.bodyLeases.list({ limit: null })).items.length).toBe(0);
    expect((await world.plane.store.tasks.list({ limit: null })).items.length).toBe(0);
    expect((await world.autonomy.store.bodyLeases.list({ limit: null })).items.length).toBe(0);
    expect((await world.autonomy.store.tasks.list({ limit: null })).items.length).toBe(0);

    // And the truth is unchanged: the head projection is still the observed fact.
    const repo = third.snapshot.repositoryHeads.get(REFERENCE_SUBJECTS.repository);
    expect(repo!.branchHeads['main']).toBe(OBSERVED_HEAD_SHA);
  });

  it('replay is safe: redelivering identical events duplicates cleanly (no double-counted truth)', async () => {
    const world = createObservationWorld();
    await world.plane.loop.drain();
    const eventsBefore = (await world.plane.store.observationEvents.list({ limit: null })).items.length;
    expect(eventsBefore).toBeGreaterThan(0);

    // Simulate a webhook redelivery: the SAME envelope again.
    world.sources.github.push({
      externalId: 'delivery-0001',
      kind: 'github.push',
      occurredAt: '2026-09-21T11:58:00Z',
      payload: { ref: 'refs/heads/main', before: '46365ed6eb9e7706ceccabcd7942bf7fba610056', after: OBSERVED_HEAD_SHA },
      provenance: ['github:webhook:payswapdotorg/SOS-2.0'],
    });
    const replay = await world.plane.loop.drain();
    const githubSummary = replay.sourceSummaries.find((entry) => entry.source === 'github:webhook:payswapdotorg/SOS-2.0');
    expect(githubSummary!.applied).toBe(0);
    expect(githubSummary!.duplicates).toBe(1);

    // The durable store did not grow, and the truth is unchanged.
    const eventsAfterReplay = (await world.plane.store.observationEvents.list({ limit: null })).items.length;
    expect(eventsAfterReplay).toBe(eventsBefore);
    const repo = replay.snapshot.repositoryHeads.get(REFERENCE_SUBJECTS.repository);
    expect(repo!.branchHeads['main']).toBe(OBSERVED_HEAD_SHA);
  });

  it('the world epoch is fixed (no ambient time — the plane clock starts at the scripted instant)', () => {
    const world = createObservationWorld();
    expect(world.clock.nowEpochMs()).toBe(OBSERVATION_T0);
  });
});
