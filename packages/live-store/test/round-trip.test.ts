/**
 * Round-trip preservation (Work Order P2 hard rule): for EVERY supported
 * record family, store -> load equality on the SPINE's canonical
 * serialization — semantic ids, exact revisions, truth states and
 * provenance preserved bit-exact; never re-minted, never rewritten.
 */

import { describe, expect, it } from 'vitest';
import { canonicalSerialize } from '@sos-2/semantic-spine';
import type { JsonValue } from '@sos-2/semantic-spine';
import { createInMemoryLiveStore } from '../src/index.js';
import type { LiveStore } from '../src/index.js';
import * as fixtures from './helpers.js';
import { assertValidRawObservation } from '@sos-2/telemetry';
import type { RawObservation } from '@sos-2/telemetry';
import { ManualClock } from '../src/index.js';

type FamilyCase = {
  name: string;
  record: unknown;
  put: (store: LiveStore, record: never) => Promise<{ kind: string }>;
  get: (store: LiveStore, record: never) => Promise<unknown>;
};

function cases(store: LiveStore): FamilyCase[] {
  return [
    {
      name: 'Mission',
      record: fixtures.missionFixture(),
      put: (s, r) => s.missions.put(r),
      get: (s, r) => s.missions.get((r as { envelope: { id: string } }).envelope.id),
    },
    {
      name: 'Context',
      record: fixtures.contextFixture(),
      put: (s, r) => s.contexts.put(r),
      get: (s, r) => s.contexts.get((r as { envelope: { id: string } }).envelope.id),
    },
    {
      name: 'SystemState',
      record: fixtures.systemStateFixture(),
      put: (s, r) => s.systemStates.put(r),
      get: (s, r) => s.systemStates.get((r as { envelope: { id: string } }).envelope.id),
    },
    {
      name: 'Evidence',
      record: fixtures.evidenceFixture('UNAVAILABLE'),
      put: (s, r) => s.evidence.put(r),
      get: (s, r) => s.evidence.get((r as { id: string }).id),
    },
    {
      name: 'ArchitectureGraph',
      record: fixtures.architectureFixture(),
      put: (s, r) => s.architecture.put(r),
      get: (s, r) => s.architecture.get((r as { envelope: { id: string } }).envelope.id),
    },
    {
      name: 'CandidateState',
      record: fixtures.candidateFixture(),
      put: (s, r) => s.candidates.put(r),
      get: (s, r) => s.candidates.get((r as { envelope: { id: string } }).envelope.id),
    },
    {
      name: 'AssuranceCase',
      record: fixtures.assuranceFixture(),
      put: (s, r) => s.assurance.put(r),
      get: (s, r) => s.assurance.get((r as { envelope: { id: string } }).envelope.id),
    },
    {
      name: 'Experiment',
      record: fixtures.experimentFixture(),
      put: (s, r) => s.experiments.put(r),
      get: (s, r) => s.experiments.get((r as { envelope: { id: string } }).envelope.id),
    },
    {
      name: 'Decision',
      record: fixtures.decisionFixture(),
      put: (s, r) => s.decisions.put(r),
      get: (s, r) => s.decisions.get((r as { envelope: { id: string } }).envelope.id),
    },
    {
      name: 'AuthorityGrant',
      record: fixtures.grantFixture(),
      put: (s, r) => s.authorityGrants.put(r),
      get: (s, r) => s.authorityGrants.get((r as { envelope: { id: string } }).envelope.id),
    },
    {
      name: 'Package',
      record: fixtures.packageFixture(),
      put: (s, r) => s.packages.put(r),
      get: (s, r) => s.packages.get((r as { envelope: { id: string } }).envelope.id),
    },
    {
      name: 'ArchitectureMemory (history)',
      record: fixtures.memoryFixture(),
      put: (s, r) => s.history.memories.put(r),
      get: (s, r) => s.history.memories.get((r as { envelope: { id: string } }).envelope.id),
    },
    {
      name: 'CausalHypothesis (history)',
      record: fixtures.hypothesisFixture(),
      put: (s, r) => s.history.hypotheses.put(r),
      get: (s, r) => s.history.hypotheses.get((r as { envelope: { id: string } }).envelope.id),
    },
  ];
}

describe('round-trip preservation (every supported family)', () => {
  const store = createInMemoryLiveStore({ clock: new ManualClock(0) });

  for (const family of cases(store)) {
    it(`preserves ${family.name} bit-exact on canonical serialization`, async () => {
      const result = await family.put(store, family.record as never);
      expect(result.kind).toBe('STORED');
      const loaded = await family.get(store, family.record as never);
      expect(loaded).toBeDefined();
      // Round-trip equality on the spine's canonical serialization.
      expect(canonicalSerialize(loaded)).toBe(canonicalSerialize(family.record));
      // Structural identity as well (the store returns the record verbatim).
      expect(loaded).toEqual(family.record);
    });
  }

  it('preserves the six distinct truth states verbatim (no conflation, no folding)', async () => {
    for (const availability of ['SUCCESS', 'FAILURE', 'UNKNOWN', 'UNAVAILABLE', 'UNSUPPORTED', 'PARTIAL'] as const) {
      const record = fixtures.evidenceFixtureWithSubject(`sos://SystemState/${'7'.repeat(32)}`, availability);
      await store.evidence.put(record);
      const loaded = await store.evidence.get(record.id);
      expect(loaded?.availability).toBe(availability);
      expect(canonicalSerialize(loaded)).toBe(canonicalSerialize(record));
    }
  });

  it('preserves provenance and exact revisions verbatim', async () => {
    const mission = fixtures.missionFixture();
    await store.missions.put(mission);
    const loaded = await store.missions.get(mission.envelope.id);
    expect(loaded?.envelope.provenance).toEqual(['P2:live-store-test']);
    expect(loaded?.envelope.version).toBe(1);
    expect(loaded?.envelope.created_at).toBe(fixtures.T0);
    expect(loaded?.envelope.id).toBe(mission.envelope.id);
    const evidence = fixtures.evidenceFixture();
    await store.evidence.put(evidence);
    const loadedEvidence = await store.evidence.get(evidence.id);
    expect(loadedEvidence?.source_revision).toBe('git-sha:' + 'f'.repeat(40));
    expect(loadedEvidence?.deployment_revision).toBe('deploy-2026-01-01');
    expect(loadedEvidence?.subject_revision).toBe('system-state:r1');
    expect(loadedEvidence?.window).toEqual(fixtures.TEST_WINDOW);
  });

  it('preserves an UNAVAILABLE RawObservation payload in an observation event verbatim', async () => {
    const observation: RawObservation = {
      subject_ref: 'otel:service:checkout',
      availability: 'UNAVAILABLE',
      window: fixtures.TEST_WINDOW,
      observed: null,
      attributes: { 'gap.reason': 'no data for the subject/window' },
      producer: fixtures.toolProducer(),
    };
    assertValidRawObservation(observation);
    const applied = await store.observationEvents.ingest({
      id: 'evt-gap-0001',
      source: 'otel:collector:prod',
      kind: 'telemetry.observation',
      occurred_at: fixtures.T1,
      payload: observation as unknown as JsonValue,
      provenance: ['telemetry:gap'],
    });
    expect(applied.kind).toBe('APPLIED');
    const loaded = await store.observationEvents.get('evt-gap-0001');
    expect(loaded?.payload).toEqual(observation);
    // The gap truth state survives ingestion — never folded into success or zero.
    const payload = loaded?.payload as unknown as RawObservation;
    assertValidRawObservation(payload);
    expect(payload.availability).toBe('UNAVAILABLE');
  });

  it('lists every family deterministically ordered by id', async () => {
    const families: { list: () => Promise<{ items: unknown[] }>; expected: number }[] = [
      { list: () => store.missions.list({ limit: null }), expected: 1 },
      { list: () => store.contexts.list({ limit: null }), expected: 1 },
      { list: () => store.systemStates.list({ limit: null }), expected: 1 },
      { list: () => store.evidence.list({ limit: null }), expected: 7 },
      { list: () => store.architecture.list({ limit: null }), expected: 1 },
      { list: () => store.candidates.list({ limit: null }), expected: 1 },
      { list: () => store.assurance.list({ limit: null }), expected: 1 },
      { list: () => store.experiments.list({ limit: null }), expected: 1 },
      { list: () => store.decisions.list({ limit: null }), expected: 1 },
      { list: () => store.authorityGrants.list({ limit: null }), expected: 1 },
      { list: () => store.packages.list({ limit: null }), expected: 1 },
      { list: () => store.history.memories.list({ limit: null }), expected: 1 },
      { list: () => store.history.hypotheses.list({ limit: null }), expected: 1 },
    ];
    for (const family of families) {
      const page = await family.list();
      expect(page.items.length).toBe(family.expected);
      const ids = page.items.map((item) => {
        const record = item as { envelope?: { id: string }; id?: string };
        return record.envelope?.id ?? record.id ?? '';
      });
      const sorted = [...ids].sort();
      expect(ids).toEqual(sorted);
    }
  });

  it('walks the stored revision chain (history) root -> head', async () => {
    const { createMission } = await import('@sos-2/mission');
    const root = fixtures.missionFixture();
    const v2 = createMission({
      content: root.content,
      provenance: ['P2:live-store-test:v2'],
      created_at: fixtures.T1,
      version: 2,
      status: 'ACTIVE',
      supersedes: root.envelope.id,
    });
    const v3 = createMission({
      content: root.content,
      provenance: ['P2:live-store-test:v3'],
      created_at: fixtures.T2,
      version: 3,
      status: 'ACTIVE',
      supersedes: v2.envelope.id,
    });
    await store.missions.put(v3); // out-of-order catch-up write first
    await store.missions.put(root);
    await store.missions.put(v2);
    const chain = await store.missions.history(v3.envelope.id);
    expect(chain.map((m) => m.envelope.version)).toEqual([1, 2, 3]);
    expect(chain.map((m) => m.envelope.id)).toEqual([root.envelope.id, v2.envelope.id, v3.envelope.id]);
  });
});
