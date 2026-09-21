/**
 * DEMO-marker enforcement (the P10 honesty contract): every projection from
 * the demo dataset carries the exact DEMO marker with the fixture revision;
 * the demo dataset can never produce a LIVE-marked view model; a projection
 * that drops or alters the marker is rejected.
 */

import { describe, expect, test } from 'vitest';
import { assertValidDataSource, DEMO_MARKER_TEXT, demoDataSource, DEMO_NOTE, isValidDataSource } from '@sos-2/web-contracts';
import {
  buildDemoEcologyWorld,
  ECOLOGY_DEMO_FIXTURE_REVISION,
  projectEvolution,
  projectHistoryWorkspace,
  projectPackageEcology,
} from '../src/index.js';
import { allLinks, chainFor, liveRead, world } from './helpers.js';

const w = world();
const source = demoDataSource(ECOLOGY_DEMO_FIXTURE_REVISION, DEMO_NOTE);
const missionV2 = w.base.missions[w.base.missions.length - 1]!;
const cacheV2 = w.packages.find((artifact) => artifact.envelope.version === 2 && artifact.content.semantic_capability.includes('Edge-cached'))!;

const authority = {
  mode: 'READ_ONLY' as const,
  required_permission: null,
  grant_ref: null,
  note: 'Observation only.',
};

const nextAction = {
  action_id: 'return',
  kind: 'NAVIGATE' as const,
  label: 'Return',
  description: 'Back to the workspace.',
  href: '/packages',
  rationale_ref: null,
  requires_authority: null,
};

test('the ecology fixture is pinned to the exact P10 base revision', () => {
  expect(w.fixture_revision).toBe('c9baa42a72d76246a19144bf1679b8687d5a2d62');
  expect(ECOLOGY_DEMO_FIXTURE_REVISION).toBe(w.fixture_revision);
});

describe('every demo-backed P10 view model carries the intact DEMO marker', () => {
  test('package ecology view models', () => {
    const vm = projectPackageEcology({
      artifact: cacheV2,
      rationale: chainFor(cacheV2.envelope.id, allLinks(w), cacheV2.content.evidence_refs),
      data_source: source,
      uncertainty: { uncertainty_class: 'MODERATE', statement: 'Context-conditioned.' },
      authority,
      next_allowed_action: nextAction,
    });
    expect(vm.core.data_source).toEqual(source);
    const provenance = vm.core.data_source;
    if (provenance.kind !== 'DEMO') {
      throw new Error('the demo projection must carry the DEMO provenance');
    }
    expect(provenance.label).toBe(DEMO_MARKER_TEXT);
    expect(provenance.fixture_revision).toBe(ECOLOGY_DEMO_FIXTURE_REVISION);
  });

  test('history workspace view models', async () => {
    const read = await liveRead(w);
    const vm = projectHistoryWorkspace({
      artifacts: [...read.missions, ...read.packages],
      evidence: read.evidence,
      data_source: source,
      rationale: chainFor(missionV2.envelope.id, allLinks(w)),
      evidence_refs: [],
      uncertainty: { uncertainty_class: 'UNQUANTIFIED', statement: 'Complete projection.' },
      authority,
      next_allowed_action: nextAction,
    });
    expect(vm.core.data_source.kind).toBe('DEMO');
    expect(vm.chains.every((chain) => chain.data_source.kind === 'DEMO' && chain.data_source.label === DEMO_MARKER_TEXT)).toBe(true);
  });

  test('evolution view models', () => {
    const vm = projectEvolution({
      process_revisions: w.process_revisions,
      memories: [w.failure_memory],
      live_read: { store_ref: 'in-memory-reference://demo-ecology-seed', families_read: ['history.memories'], as_of: w.now },
      rationale: chainFor(w.process_revisions[2]!.envelope.id, allLinks(w)),
      data_source: source,
      evidence_refs: [],
      uncertainty: { uncertainty_class: 'MODERATE', statement: 'One trial window.' },
      authority,
      next_allowed_action: nextAction,
    });
    expect(vm.core.data_source.kind).toBe('DEMO');
    if (vm.core.data_source.kind === 'DEMO') {
      expect(vm.core.data_source.label).toBe(DEMO_MARKER_TEXT);
    }
  });
});

describe('the demo dataset can never produce a LIVE-marked view model', () => {
  test('the LIVE provenance shape is structurally available but not producible from the demo source', () => {
    const demoSource = demoDataSource(w.fixture_revision, DEMO_NOTE);
    expect(demoSource.kind).toBe('DEMO');
    expect(() => assertValidDataSource({ kind: 'LIVE', store_ref: '', as_of: '' })).toThrow();
    expect(isValidDataSource({ kind: 'LIVE', store_ref: 'postgres://x', as_of: 'r1' })).toBe(true);
    // The demo provenance is the only source the fixture builders produce:
    const worldAgain = buildDemoEcologyWorld();
    expect(worldAgain.fixture_revision).toBe(w.fixture_revision);
  });
});

describe('a data source that drops or alters the marker is rejected', () => {
  test('an altered label is rejected', () => {
    expect(() => assertValidDataSource({ ...source, label: 'demo' })).toThrow(/DEMO — SIMULATED DATA/);
  });

  test('a dropped fixture revision is rejected', () => {
    expect(() => assertValidDataSource({ ...source, fixture_revision: '' })).toThrow(/fixture_revision/);
  });

  test('an unexpected field is rejected (the exact field set is structural)', () => {
    expect(() => assertValidDataSource({ ...source, extra: true })).toThrow(/field set/);
  });
});
