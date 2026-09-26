/**
 * P18-A deterministic reference-mode suite (7): THE SEAM PRODUCER
 * CONTRACT — the architect's live-mission data seam. Pinned:
 *
 *   - createLiveMissionDataProducer() returns a () => Promise<LiveObservationDto>
 *     whose DTO is structurally EXACTLY the P17-C LiveObservationData
 *     (the seam type identity — LiveObservationDto = LiveObservationData);
 *   - every call is one bounded honest data-plane pass (the injectable
 *     seams compose the full plane: selection + deployment read + drain
 *     + durability + provenance);
 *   - the honest unwired path: an incomplete observation environment
 *     returns the P17-C emptyLiveObservation (UNKNOWN/NO_DATA — never a
 *     fabricated snapshot) with the missing env NAMES reported;
 *   - the DTO serializes across the server-component boundary (plain
 *     JSON, no Maps — the P17-C discipline).
 */

import { describe, expect, it } from 'vitest';
import type { LiveObservationData } from '@live-mission/dto';
import { emptyLiveObservation } from '@live-mission/dto';
import { createLiveMissionDataProducer, produceLiveMissionData } from '@live-data/producer';
import { runPlane } from './harness';
import { scriptedSource, instantSleep, T0 } from './world';
import { ManualClock } from '@sos-2/live-store';
import { scriptedWorld, defaultKnobs } from './world';

describe('the live-mission data seam producer (deterministic reference mode)', () => {
  it('produces the P17-C LiveObservationData through the full data plane (the exact seam type)', async () => {
    const world = scriptedWorld(defaultKnobs());
    const producer = createLiveMissionDataProducer({ source: scriptedSource(), clock: new ManualClock(T0), fetch: world.fetch, sleep: instantSleep });
    const data: LiveObservationData = await producer();
    expect(data.storeRef).toBe('neon:postgres:sos@main');
    expect(data.repository.subject).toBe('github:repo:payswapdotorg/SOS-2.0');
    expect(data.repository.branchHeads).toHaveLength(1);
    expect(data.drainedAt).not.toBeNull();
    // plain JSON across the boundary
    const serialized: LiveObservationData = JSON.parse(JSON.stringify(data));
    expect(serialized.repository.branchHeads[0]!.branch).toBe('main');
  });

  it('runs one bounded pass per call (successive calls are independent honest requests)', async () => {
    const world = scriptedWorld(defaultKnobs());
    const producer = createLiveMissionDataProducer({ source: scriptedSource(), clock: new ManualClock(T0), fetch: world.fetch, sleep: instantSleep });
    const first = await producer();
    const second = await producer();
    expect(first.asOf).toBe('2026-09-25T12:00:00.000Z');
    expect(second.asOf).toBe('2026-09-25T12:00:00.000Z');
    expect(second.repository.branchHeads[0]!.head).toBe(first.repository.branchHeads[0]!.head);
  });

  it('returns the honest unwired empty state when the observation environment is incomplete (never fabricated)', async () => {
    const world = scriptedWorld(defaultKnobs());
    const incompleteSource: Record<string, string> = { ...scriptedSource() };
    delete incompleteSource['GITHUB_ACCESS_TOKEN'];
    const result = await produceLiveMissionData({ source: incompleteSource, clock: new ManualClock(T0), fetch: world.fetch, sleep: instantSleep });
    expect(result.unwired).toBe(true);
    expect(result.missingEnv).toContain('GITHUB_ACCESS_TOKEN');
    expect(result.data.drainedAt).toBeNull();
    expect(result.data.eventsInWindow).toBe(0);
    expect(result.data.repository.freshness).toBe('NO_DATA');
    expect(result.data.findings).toEqual([]);
    expect(result.data.detections).toEqual([]);
    // the P17-C emptyLiveObservation shape (the same honest structure the seam default renders)
    const empty = emptyLiveObservation(result.data.storeRef, result.data.asOf, 'github:repo:payswapdotorg/SOS-2.0');
    expect(Object.keys(result.data).sort()).toEqual(Object.keys(empty).sort());
    // no observation poll happened (no drain was attempted — nothing fabricated)
    expect(world.counts['github:events']).toBeUndefined();
  });

  it('exposes the full data-plane result for evidence/inspection (view + selection + report + durability)', async () => {
    const { result } = await runPlane();
    expect(result.view.provenance.length).toBeGreaterThan(0);
    expect(result.selection).toBeDefined();
    expect(result.report).not.toBeNull();
    expect(result.durability).toBeDefined();
    expect(result.deploymentRead.deployments.length).toBeGreaterThan(0);
  });
});
