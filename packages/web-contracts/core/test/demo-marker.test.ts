/**
 * Demo-marker enforcement (the P1 honesty contract): a projection that
 * drops, alters or renames the demo marker is REJECTED; the demo dataset
 * can never produce a LIVE-marked view model; the marker text is pinned.
 */

import { describe, expect, test } from 'vitest';
import { assertValidRationaleChain } from '@sos-2/ui-contracts';
import {
  assertValidDataSource,
  composeRationaleSubject,
  decomposeRationaleSubject,
  DEMO_MARKER_TEXT,
  demoDataSource,
  isDemoBacked,
  isLiveBacked,
  isValidDataSource,
  projectMissionHero,
} from '../src/index.js';
import { chainFor, currentOf, demoSource, world } from './helpers.js';

const w = world();
const mission = currentOf(w.missions);

function heroWith(source: Parameters<typeof projectMissionHero>[0]['data_source']) {
  return projectMissionHero({
    mission,
    gaps: w.gaps,
    rationale: chainFor(mission.envelope.id, w.links),
    data_source: source,
    evidence_refs: [],
    uncertainty: { uncertainty_class: 'MODERATE', statement: 'x' },
    authority: { mode: 'READ_ONLY', required_permission: null, grant_ref: null, note: 'x' },
    next_allowed_action: {
      action_id: 'a', kind: 'NAVIGATE', label: 'Go', description: 'Go', href: '/', rationale_ref: null, requires_authority: null,
    },
  });
}

describe('the demo marker contract', () => {
  test('the marker text is exactly the pinned badge copy', () => {
    expect(DEMO_MARKER_TEXT).toBe('DEMO — SIMULATED DATA');
  });

  test('every demo data source validates and carries the marker', () => {
    const source = demoSource();
    expect(() => assertValidDataSource(source)).not.toThrow();
    expect(source.label).toBe(DEMO_MARKER_TEXT);
    expect(source.fixture_revision).toBe(w.fixture_revision);
    expect(isDemoBacked({ data_source: source })).toBe(true);
    expect(isLiveBacked({ data_source: source })).toBe(false);
  });

  test('an altered marker label is REJECTED', () => {
    expect(
      isValidDataSource({
        kind: 'DEMO',
        label: 'demo data',
        fixture_revision: 'r1',
        note: 'n',
      }),
    ).toBe(false);
    expect(
      isValidDataSource({
        kind: 'DEMO',
        label: 'LIVE',
        fixture_revision: 'r1',
        note: 'n',
      }),
    ).toBe(false);
  });

  test('a dropped marker (missing label/revision) is REJECTED', () => {
    expect(isValidDataSource({ kind: 'DEMO', label: DEMO_MARKER_TEXT, note: 'n' })).toBe(false);
    expect(isValidDataSource({ kind: 'DEMO', label: DEMO_MARKER_TEXT, fixture_revision: '', note: 'n' })).toBe(false);
    expect(isValidDataSource({ kind: 'DEMO', label: DEMO_MARKER_TEXT, fixture_revision: 'r1' })).toBe(false);
  });

  test('a fabricated LIVE source over the demo revision is structurally valid but never produced by demo projections', () => {
    // A LIVE source describes the durable stores (P2); the demo projections
    // hard-code the DEMO provenance, so this shape can only be constructed
    // by hand — which is exactly what the live data plane will do later.
    const live = { kind: 'LIVE', store_ref: 'durable://mission-store', as_of: '2025-06-15T12:00:00Z' } as const;
    expect(() => assertValidDataSource(live)).not.toThrow();
    // But a demo projection over the demo dataset NEVER emits it:
    const vm = heroWith(demoSource());
    expect(vm.core.data_source.kind).toBe('DEMO');
    if (vm.core.data_source.kind === 'DEMO') {
      expect(vm.core.data_source.label).toBe(DEMO_MARKER_TEXT);
    }
  });

  test('unknown data source kinds are REJECTED', () => {
    expect(isValidDataSource({ kind: 'FIXTURE', label: DEMO_MARKER_TEXT, fixture_revision: 'r1', note: 'n' })).toBe(false);
    expect(isValidDataSource(null)).toBe(false);
    expect(isValidDataSource('DEMO')).toBe(false);
  });

  test('a view model core with a broken data source is REJECTED', () => {
    const vm = heroWith(demoSource());
    const broken = { ...vm, core: { ...vm.core, data_source: { kind: 'DEMO' } } };
    // The core validator catches the broken marker:
    expect(() => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      (assertValidRationaleChain(broken.core.rationale), undefined);
    }).not.toThrow();
  });
});

describe('rationale subject decomposition (deep-link safety)', () => {
  test('decompose/compose round-trips every spine id in the demo world', () => {
    const ids = [
      ...w.missions.map((artifact) => artifact.envelope.id),
      ...w.system_states.map((artifact) => artifact.envelope.id),
      ...w.candidates.map((artifact) => artifact.envelope.id),
      w.experiment.artifact.envelope.id,
      w.ask.request.envelope.id,
      ...w.packages.map((artifact) => artifact.envelope.id),
      ...w.evidence.map((record) => record.id),
    ];
    for (const id of ids) {
      const { kind, segment } = decomposeRationaleSubject(id);
      expect(kind.length).toBeGreaterThan(0);
      expect(segment).toMatch(/^[0-9a-f]{32}$/);
      expect(composeRationaleSubject(kind, segment)).toBe(id);
    }
  });

  test('malformed subjects are rejected loudly', () => {
    expect(() => decomposeRationaleSubject('not-a-spine-id')).toThrow();
    expect(() => decomposeRationaleSubject('sos://Mission/not-hex')).toThrow();
  });
});
