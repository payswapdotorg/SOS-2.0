/**
 * @sos-2/brownfield — PROPERTY tests (W15): randomized system snapshots ->
 * loop determinism.
 *
 *   1. every generated valid snapshot completes the loop with a COMPLETE
 *      trace chain (the invariant holds for arbitrary systems, not just the
 *      golden one);
 *   2. the loop is DETERMINISTIC: two independent runs (fresh registry and
 *      stores) produce byte-identical canonical serializations;
 *   3. input ORDER does not matter: shuffling the snapshot sections
 *      produces the identical result (the normalized model and digests are
 *      canonically sorted);
 *   4. ambiguity invariant: a snapshot containing a 'service' module (an
 *      ambiguous observed kind) yields >= 2 retained hypotheses.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { GOLDEN_BROWNFIELD_SCENARIO, goldenInput } from './helpers.js';
import {
  buildBrownfieldLoopInput,
  canonicalBrownfieldText,
  implementationModelId,
  normalizeSnapshot,
  runBrownfieldLoop,
} from '../src/index.js';
import type { BrownfieldFixtureJson, BrownfieldModule, BrownfieldSnapshot } from '../src/index.js';
import type { ImplementationDependency, InterfaceDeclaration } from '@sos-2/semantic-spine';
import type { RawObservation } from '@sos-2/telemetry';

const MODULE_ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz';

const moduleIdArbitrary = fc
  .tuple(fc.integer({ min: 1, max: 8 }), fc.integer({ min: 0, max: 1000 }))
  .map(([length, salt]) => {
    const letters = Array.from({ length }, (_, index) => MODULE_ID_ALPHABET[(salt + index * 7) % 26]).join('');
    return `mod-${letters}`;
  });

const moduleArbitrary: fc.Arbitrary<BrownfieldModule> = fc
  .tuple(moduleIdArbitrary, fc.constantFrom('service', 'library'), fc.integer({ min: 0, max: 3 }))
  .map(([id, kind, variant]) => ({
    id,
    kind,
    path: `src/${id}/index.ts`,
    revision: 'ab' + 'c'.repeat(38),
    realizes: variant >= 3 ? ['store:generated-index'] : [],
    realized_by: [],
  }));

const snapshotArbitrary: fc.Arbitrary<BrownfieldSnapshot> = fc
  .uniqueArray(moduleArbitrary, { minLength: 1, maxLength: 8, selector: (module) => module.id })
  .chain((modules) => {
    const ids = modules.map((module) => module.id);
    // Dependency pairs are generated DIRECTLY from distinct endpoints (a
    // filter-based predicate is unsatisfiable for single-module snapshots
    // and would stall the generator; with one module there are no edges).
    const pairArbitrary: fc.Arbitrary<ImplementationDependency> | null =
      ids.length >= 2
        ? fc
            .constantFrom(...ids)
            .chain((source) =>
              fc
                .constantFrom(...ids.filter((id) => id !== source))
                .map((target): ImplementationDependency => ({ source, target, kind: 'uses' })),
            )
        : null;
    const dependencyArbitrary: fc.Arbitrary<ImplementationDependency[]> =
      pairArbitrary === null
        ? fc.constant([])
        : fc.uniqueArray(pairArbitrary, {
            minLength: 0,
            maxLength: Math.min(12, ids.length * 2),
            selector: (dependency) => `${dependency.source}->${dependency.target}`,
          });
    return dependencyArbitrary.map((dependencies) => {
      const runtimeObservations: RawObservation[] = modules.map((module) => ({
        subject_ref: module.id,
        availability: 'SUCCESS',
        window: { start: GOLDEN_BROWNFIELD_SCENARIO.snapshot.created_at, end: GOLDEN_BROWNFIELD_SCENARIO.now },
        observed: null,
        attributes: {
          'runtime.node_kind': 'Component',
          'runtime.edges': dependencies
            .filter((dependency) => dependency.source === module.id)
            .map((dependency) => ({ target: dependency.target, kind: 'Dependency' })),
        },
        producer: GOLDEN_BROWNFIELD_SCENARIO.producer,
      }));
      const interfaces: InterfaceDeclaration[] = [];
      const snapshot: BrownfieldSnapshot = {
        system_name: 'generated-legacy-system',
        revision: 'ab' + 'c'.repeat(38),
        created_at: GOLDEN_BROWNFIELD_SCENARIO.snapshot.created_at,
        modules: [...modules].sort((a, b) => (a.id < b.id ? -1 : 1)),
        interfaces,
        dependencies: [...dependencies].sort(
          (a, b) => (a.source < b.source ? -1 : a.source > b.source ? 1 : a.target < b.target ? -1 : 1),
        ),
        runtime_observations: runtimeObservations,
        telemetry_traces: GOLDEN_BROWNFIELD_SCENARIO.snapshot.telemetry_traces,
      };
      return snapshot;
    });
  });

/** Build a full scenario around a generated snapshot. */
function scenarioForSnapshot(snapshot: BrownfieldSnapshot): BrownfieldFixtureJson {
  // The target is the canonically-FIRST module (order-independent), so a
  // shuffled snapshot builds the same scenario.
  const target = [...snapshot.modules].sort((a, b) => (a.id < b.id ? -1 : 1))[0]!;
  const declaredNodes = [
    ...snapshot.modules.map((module) => ({ id: module.id, kind: 'Component', criticality: 'normal' as const, attributes: {} })),
    { id: 'legacy-reporting', kind: 'Component', criticality: 'normal' as const, attributes: {} },
  ];
  const declaredEdges = snapshot.dependencies.map((dependency) => ({
    source: dependency.source,
    target: dependency.target,
    kind: 'Dependency',
    criticality: 'normal' as const,
    attributes: {},
  }));
  return {
    ...GOLDEN_BROWNFIELD_SCENARIO,
    snapshot,
    declared: {
      nodes: declaredNodes,
      edges: declaredEdges,
      provenance: ['W15:property-test:declared'],
      created_at: GOLDEN_BROWNFIELD_SCENARIO.snapshot.created_at,
    },
    goal: {
      ...GOLDEN_BROWNFIELD_SCENARIO.goal,
      target_component: target.id,
      replacement_id: `${target.id}-evolved`,
    },
  };
}

describe('property: randomized system snapshots -> loop determinism', () => {
  it('every generated snapshot completes the loop with a complete trace chain and is deterministic', () => {
    const property = fc.property(snapshotArbitrary, (snapshot) => {
      const scenario = scenarioForSnapshot(snapshot);
      const first = runBrownfieldLoop(buildBrownfieldLoopInput(scenario, 'nominal').input);
      const second = runBrownfieldLoop(buildBrownfieldLoopInput(scenario, 'nominal').input);
      // determinism: byte-identical canonical serialization
      expect(canonicalBrownfieldText(second)).toBe(canonicalBrownfieldText(first));
      // the traceability invariant holds for arbitrary systems
      expect(first.chain.complete).toBe(true);
      expect(first.chain.missing).toEqual([]);
      // the learning stage actually learned something
      expect(first.stages.learning.memory_entries.length).toBeGreaterThanOrEqual(3);
      // honest nominal decision: EXPERIMENT (or ASK/REJECT from the gates —
      // never ACT: no real intervention evidence exists)
      expect(['EXPERIMENT', 'GATHER_EVIDENCE', 'ASK', 'REJECT']).toContain(first.stages.promotion.decision);
      // ambiguity invariant: a 'service' module keeps the hypothesis space competing
      if (snapshot.modules.some((module) => module.kind === 'service')) {
        expect(first.stages.recovery.ambiguity_detected).toBe(true);
        expect(first.stages.recovery.hypothesis_count).toBeGreaterThanOrEqual(2);
      }
    });
    fc.assert(property, { numRuns: 25 });
  });

  it('snapshot section ORDER does not change the normalized model id or the loop result', () => {
    const property = fc.property(snapshotArbitrary, fc.array(fc.integer(), { minLength: 0, maxLength: 32 }), (snapshot, seeds) => {
      const shuffledModules = shuffle(snapshot.modules, seeds[0] ?? 0);
      const shuffledDependencies = shuffle(snapshot.dependencies, seeds[1] ?? 1);
      const shuffledObservations = shuffle(snapshot.runtime_observations, seeds[2] ?? 2);
      const shuffled: BrownfieldSnapshot = {
        ...snapshot,
        modules: shuffledModules,
        dependencies: shuffledDependencies,
        runtime_observations: shuffledObservations,
      };
      // the normalized model id is order-independent
      expect(implementationModelId(shuffled)).toBe(implementationModelId(snapshot));
      expect(normalizeSnapshot(shuffled)).toEqual(normalizeSnapshot(snapshot));
      // and so is the whole loop
      const base = runBrownfieldLoop(buildBrownfieldLoopInput(scenarioForSnapshot(snapshot), 'nominal').input);
      const shuffledResult = runBrownfieldLoop(buildBrownfieldLoopInput(scenarioForSnapshot(shuffled), 'nominal').input);
      expect(canonicalBrownfieldText(shuffledResult)).toBe(canonicalBrownfieldText(base));
    });
    fc.assert(property, { numRuns: 15 });
  });

  it('the golden scenario is deterministic across many rebuilds', () => {
    const property = fc.property(fc.integer({ min: 0, max: 1000 }), (salt) => {
      void salt;
      const result = runBrownfieldLoop(goldenInput('nominal').input);
      expect(result.chain.complete).toBe(true);
      expect(result.stages.promotion.decision).toBe('EXPERIMENT');
    });
    fc.assert(property, { numRuns: 5 });
  });
});

function shuffle<T>(items: readonly T[], seed: number): T[] {
  const array = [...items];
  let state = seed >>> 0;
  const random = (): number => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
  for (let index = array.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    const current = array[index]!;
    array[index] = array[swap]!;
    array[swap] = current;
  }
  return array;
}
