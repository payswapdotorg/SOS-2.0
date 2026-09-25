/**
 * LANE C, NEGATIVE CASE 12 — DEMO / LIVE-STATE CONFUSION (the P1
 * demo-honesty contract: "The product must never make demo fixture
 * state look like live state").
 *
 * The fault: an attempt to pass DEMO fixture state off as LIVE — a
 * demo data source with its marker dropped or altered, a demo dataset
 * masquerading behind a LIVE data source, demo evidence records
 * entering the live evidence graph of a running product journey.
 * Every attempt is REJECTED or DETECTED: the data-source validator
 * rejects malformed/unaligned demo provenance with a typed
 * WebContractError; the demo fixture dataset is permanently typed
 * (every record carries the demo-fixture provenance marker that is
 * bound into its content-derived identity); and the LIVE evidence
 * graph of a completed flagship journey contains ZERO demo-marked
 * records. Never a silent pass, never a crash.
 */

import { describe, expect, test } from 'vitest';
import {
  DEMO_MARKER_TEXT,
  DEMO_PROVENANCE,
  assertValidDataSource,
  buildDemoWebWorld,
  demoDataSource,
  isDemoBacked,
  isLiveBacked,
} from '@sos-2/web-contracts';
import { WebContractError } from '@sos-2/web-contracts';
import { createEvidence } from '@sos-2/evidence';
import {
  LANE_PROVENANCE,
  assertNoDemoMarkers,
  assertProductGraphQueryableAndTruthful,
  createProductWorld,
  driveOnCloudTicks,
  makeEvidence,
  startFlagshipJourney,
  subjectId,
  toolProducer,
} from './helpers.js';

describe('P15 lane C negative case: demo / live-state confusion', () => {
  test('TYPED: the demo dataset is permanently typed — every demo evidence record carries the demo-fixture provenance marker', () => {
    const world = buildDemoWebWorld();
    expect(world.evidence.length).toBeGreaterThan(0);
    for (const record of world.evidence) {
      expect(
        record.provenance.includes(DEMO_PROVENANCE),
        'every demo evidence record must carry the demo-fixture provenance marker',
      ).toBe(true);
    }
    // The marker is bound into the record's content-derived identity: a
    // marker-stripped variant is a DIFFERENT record (the demo record can
    // never masquerade as an unmarked live record).
    const demoRecord = world.evidence[0]!;
    const strippedInput: Parameters<typeof createEvidence>[0] = {
      kind: demoRecord.kind,
      subject_ref: demoRecord.subject_ref,
      availability: demoRecord.availability,
      evidence_class: demoRecord.evidence_class,
      method: demoRecord.method,
      provenance: demoRecord.provenance.filter((entry) => entry !== DEMO_PROVENANCE),
      source_revision: demoRecord.source_revision,
      deployment_revision: demoRecord.deployment_revision,
      window: demoRecord.window,
      subject_revision: demoRecord.subject_revision,
      producer: demoRecord.producer,
    };
    if (demoRecord.confidence !== null) strippedInput.confidence = demoRecord.confidence;
    const stripped = createEvidence(strippedInput);
    expect(stripped.id).not.toBe(demoRecord.id);
  });

  test('REJECTED: a demo data source with its marker DROPPED or ALTERED is a typed rejection (the badge is structural, not decoration)', () => {
    // The confusion attempt 1: kind DEMO with a forged LIVE-looking label.
    expect(() =>
      assertValidDataSource({
        kind: 'DEMO',
        label: 'LIVE — REAL DATA',
        fixture_revision: 'r1',
        note: 'a demo dataset pretending to be live',
      }),
    ).toThrow(WebContractError);
    // The confusion attempt 2: the marker dropped from the field set.
    expect(() =>
      assertValidDataSource({
        kind: 'DEMO',
        fixture_revision: 'r1',
        note: 'a demo dataset with its marker dropped',
      }),
    ).toThrow(WebContractError);
    // The confusion attempt 3: an unknown kind entirely.
    expect(() =>
      assertValidDataSource({
        kind: 'FIXTURE_LIVE_MASHUP',
        label: DEMO_MARKER_TEXT,
        fixture_revision: 'r1',
        note: 'neither demo nor live',
      }),
    ).toThrow(WebContractError);
    // The honest forms validate cleanly (both directions).
    const demo = demoDataSource('r1', 'the fixed demo dataset');
    expect(demo.kind).toBe('DEMO');
    expect(demo.label).toBe(DEMO_MARKER_TEXT);
    expect(isDemoBacked({ data_source: demo })).toBe(true);
    expect(isLiveBacked({ data_source: demo })).toBe(false);
    expect(() => assertValidDataSource(demo)).not.toThrow();
  });

  test('REJECTED: a LIVE data source requires the exact durable-store field set (a live claim cannot be minted from demo shapes)', () => {
    // The confusion attempt: a LIVE source carrying DEMO fields.
    expect(() =>
      assertValidDataSource({
        kind: 'LIVE',
        label: DEMO_MARKER_TEXT,
        fixture_revision: 'r1',
        note: 'a live claim over a demo fixture',
      }),
    ).toThrow(WebContractError);
    // A well-formed LIVE source names its durable store + read instant.
    expect(() =>
      assertValidDataSource({ kind: 'LIVE', store_ref: 'live-store:missions', as_of: '2026-07-01T00:00:00.000Z' }),
    ).not.toThrow();
  });

  test('DETECTED: the demo fixture marker NEVER appears in the LIVE evidence graph of a completed flagship journey (zero leak)', async () => {
    const world = createProductWorld();
    await startFlagshipJourney(world);
    await driveOnCloudTicks(world);
    expect(world.journey.state().stage).toBe('COMPLETED');

    // The live evidence graph: gateway evidence + durable observation
    // events + the completion report — ZERO demo-fixture markers.
    assertNoDemoMarkers(world.evidence.all(), 'gateway evidence');
    const observations = await world.store.observationEvents.list({ limit: null });
    expect(observations.items.length).toBeGreaterThan(0);
    assertNoDemoMarkers(observations.items, 'observation events');
    assertNoDemoMarkers([world.journey.completionReport()!], 'completion report');
    // No demo artifact id from the demo world exists in the live graph.
    const demoWorld = buildDemoWebWorld();
    const liveEvidenceJson = JSON.stringify(world.evidence.all());
    for (const demoRecord of demoWorld.evidence) {
      expect(liveEvidenceJson.includes(demoRecord.id), `demo record ${demoRecord.id} leaked into the live evidence graph`).toBe(false);
    }
    // And the graph stays queryable and truthful after the scan.
    await assertProductGraphQueryableAndTruthful(world);
  });

  test('the lane\u2019s own fixtures are live-typed test evidence, never demo fixtures (the fence holds in both directions)', () => {
    // A record the lane creates for testing is plainly provenance-marked
    // as lane evidence — it is NOT a demo fixture and never claims to be.
    const record = makeEvidence(subjectId('SystemState', 'p15c-12-fence'), {
      provenance: [...LANE_PROVENANCE, 'observation:sha256:' + 'c'.repeat(64)],
    });
    expect(record.provenance.includes(DEMO_PROVENANCE)).toBe(false);
    expect(record.provenance.some((entry) => entry.startsWith('P15:'))).toBe(true);
    expect(record.producer.tool).toBe(toolProducer().tool);
  });
});
