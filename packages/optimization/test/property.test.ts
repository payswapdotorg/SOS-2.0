/**
 * Property tests: randomized candidate sets —
 *   - Pareto determinism (permutation invariance of the fronts),
 *   - archive determinism (insertion-order independence),
 *   - canonical round trips (candidates and snapshots),
 *   - structural laws (fronts partition the input; dominance is a strict
 *     partial order; uncertainty always survives evaluation).
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { canonicalSerialize, contentHash } from '@sos-2/semantic-spine';
import {
  MapElitesArchive,
  binIndex,
  dominates,
  nonDominatedSort,
} from '../src/index.js';
import type { CarriedUncertainty, EliteCandidate, MapElitesSpec, ParetoCandidate } from '../src/index.js';

// ---------------------------------------------------------------------------
// Generators (VALID input space)
// ---------------------------------------------------------------------------

const fcAxis = fc.constantFrom<'COST' | 'LATENCY' | 'RESILIENCE' | 'PRIVACY' | 'RESOURCE_FOOTPRINT' | 'HUMAN_COMPREHENSIBILITY'>(
  'COST',
  'LATENCY',
  'RESILIENCE',
  'PRIVACY',
  'RESOURCE_FOOTPRINT',
  'HUMAN_COMPREHENSIBILITY',
);
const fcDirection = fc.constantFrom<'MINIMIZE' | 'MAXIMIZE'>('MINIMIZE', 'MAXIMIZE');

const fcAxes = fc.uniqueArray(fcAxis, { minLength: 1, maxLength: 4 });

const fcCandidate = (axes: ('COST' | 'LATENCY' | 'RESILIENCE' | 'PRIVACY' | 'RESOURCE_FOOTPRINT' | 'HUMAN_COMPREHENSIBILITY')[]) =>
  fc.record({
    id: fc.stringMatching(/^[a-z][a-z0-9-]{3,20}$/),
    family: fc.stringMatching(/^[a-z][a-z0-9-]{3,15}$/),
    values: fc.array(fc.integer({ min: -50, max: 50 }), { minLength: axes.length, maxLength: axes.length }),
    sampleSize: fc.integer({ min: 0, max: 100 }),
    probability: fc.option(fc.double({ min: 0, max: 1, noNaN: true }), { nil: undefined }),
  });

function buildParetoCandidate(
  axes: readonly ('COST' | 'LATENCY' | 'RESILIENCE' | 'PRIVACY' | 'RESOURCE_FOOTPRINT' | 'HUMAN_COMPREHENSIBILITY')[],
  seed: { id: string; family: string; values: number[]; sampleSize: number; probability?: number },
): ParetoCandidate {
  const uncertainty: CarriedUncertainty =
    seed.probability === undefined
      ? { uncertainty_class: 'MODERATE', sample_size: seed.sampleSize }
      : {
          uncertainty_class: 'MODERATE',
          sample_size: seed.sampleSize,
          calibrated_probability: seed.probability,
          calibration_ref: 'sos://Evaluation/' + 'a'.repeat(32),
        };
  return {
    id: seed.id,
    family: seed.family,
    objectives: axes.map((axis, index) => ({
      axis,
      direction:
        axis === 'COST' || axis === 'LATENCY' || axis === 'RESOURCE_FOOTPRINT'
          ? ('MINIMIZE' as const)
          : ('MAXIMIZE' as const),
      value: seed.values[index] ?? 0,
    })),
    uncertainty,
  };
}

const fcParetoSet = fcAxes.chain((axes) =>
  fc
    .array(fcCandidate(axes), { minLength: 0, maxLength: 25 })
    .map((seeds) => {
      // Deduplicate by id (ids must be unique in one sort).
      const seen = new Set<string>();
      const unique = seeds.filter((seed) => {
        if (seen.has(seed.id)) {
          return false;
        }
        seen.add(seed.id);
        return true;
      });
      return unique.map((seed) => buildParetoCandidate(axes, seed));
    }),
);

const fcSpec: fc.Arbitrary<MapElitesSpec> = fc
  .record({
    axisName: fc.stringMatching(/^[a-z][a-z0-9_]{2,10}$/),
    edges: fc.uniqueArray(fc.integer({ min: -20, max: 20 }), { minLength: 1, maxLength: 4 }).map((values) =>
      [...values].sort((a, b) => a - b),
    ),
  })
  .map((dimension) => ({ dimensions: [{ axis: dimension.axisName, edges: dimension.edges }] }));

const fcElite = (spec: MapElitesSpec) =>
  fc.record({
    id: fc.stringMatching(/^[a-z][a-z0-9-]{3,20}$/),
    family: fc.stringMatching(/^[a-z][a-z0-9-]{3,15}$/),
    fitness: fc.integer({ min: -100, max: 100 }),
    behaviorValues: fc.array(fc.integer({ min: -40, max: 40 }), { minLength: 1, maxLength: 1 }),
    sampleSize: fc.integer({ min: 0, max: 50 }),
  }).map((seed) => {
    const elite: EliteCandidate = {
      id: seed.id,
      family: seed.family,
      fitness: seed.fitness,
      behavior: { [spec.dimensions[0]!.axis]: seed.behaviorValues[0]! },
      uncertainty: { uncertainty_class: 'WEAK', sample_size: seed.sampleSize },
    };
    return elite;
  });

const fcEliteSet = fcSpec.chain((spec) =>
  fc
    .array(fcElite(spec), { minLength: 0, maxLength: 20 })
    .map((elites) => {
      const seen = new Set<string>();
      return elites.filter((elite) => {
        if (seen.has(elite.id)) {
          return false;
        }
        seen.add(elite.id);
        return true;
      });
    })
    .map((elites) => ({ spec, elites })),
);

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

describe('Pareto property tests', () => {
  it('determinism: the fronts are a pure function of the input SET (permutation invariance)', () => {
    fc.assert(
      fc.property(fcParetoSet, (candidates) => {
        const original = nonDominatedSort(candidates);
        for (let attempt = 0; attempt < 3; attempt += 1) {
          const shuffled = [...candidates];
          // Deterministic shuffle driven by the attempt counter.
          for (let i = shuffled.length - 1; i > 0; i -= 1) {
            const j = (i * 7 + attempt * 13) % (i + 1);
            [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
          }
          expect(canonicalSerialize(nonDominatedSort(shuffled))).toBe(canonicalSerialize(original));
        }
      }),
    );
  });

  it('structure: the fronts partition the input (every candidate appears exactly once)', () => {
    fc.assert(
      fc.property(fcParetoSet, (candidates) => {
        const result = nonDominatedSort(candidates);
        const allIds = result.fronts.flatMap((front) => front.candidates.map((candidate) => candidate.id));
        expect(allIds.length).toBe(candidates.length);
        expect(new Set(allIds).size).toBe(candidates.length);
        for (const candidate of candidates) {
          expect(allIds).toContain(candidate.id);
        }
        expect(result.total_candidates).toBe(candidates.length);
      }),
    );
  });

  it('structure: no front-0 candidate is dominated by any other front-0 candidate', () => {
    fc.assert(
      fc.property(fcParetoSet, (candidates) => {
        const front = nonDominatedSort(candidates).fronts[0];
        if (front === undefined) {
          return;
        }
        for (const a of front.candidates) {
          for (const b of front.candidates) {
            if (a.id !== b.id) {
              expect(dominates(a, b)).toBe(false);
            }
          }
        }
      }),
    );
  });

  it('order: dominance is a strict partial order (irreflexive and antisymmetric)', () => {
    fc.assert(
      fc.property(fcParetoSet, (candidates) => {
        for (const a of candidates) {
          expect(dominates(a, a)).toBe(false);
        }
        for (let i = 0; i < candidates.length; i += 1) {
          for (let j = i + 1; j < candidates.length; j += 1) {
            const a = candidates[i]!;
            const b = candidates[j]!;
            if (dominates(a, b)) {
              expect(dominates(b, a)).toBe(false);
            }
          }
        }
      }),
    );
  });

  it('uncertainty preservation: every result candidate carries its uncertainty verbatim', () => {
    fc.assert(
      fc.property(fcParetoSet, (candidates) => {
        const result = nonDominatedSort(candidates);
        const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
        for (const front of result.fronts) {
          for (const candidate of front.candidates) {
            expect(candidate.uncertainty).toEqual(byId.get(candidate.id)!.uncertainty);
          }
        }
      }),
    );
  });

  it('canonical round trip: candidates serialize canonically and hash-stably', () => {
    fc.assert(
      fc.property(fcParetoSet, (candidates) => {
        for (const candidate of candidates) {
          const text = canonicalSerialize(candidate);
          const parsed = JSON.parse(text) as ParetoCandidate;
          expect(canonicalSerialize(parsed)).toBe(text);
          expect(contentHash(parsed)).toBe(contentHash(candidate));
        }
      }),
    );
  });
});

describe('MAP-Elites property tests', () => {
  it('archive determinism: insertion order never changes the final archive', () => {
    fc.assert(
      fc.property(fcEliteSet, (eliteSet) => {
        const { spec, elites } = eliteSet;
        const base = new MapElitesArchive(spec);
        for (const candidate of elites) {
          base.insert(candidate);
        }
        for (let attempt = 0; attempt < 3; attempt += 1) {
          const shuffled = [...elites];
          for (let i = shuffled.length - 1; i > 0; i -= 1) {
            const j = (i * 5 + attempt * 11) % (i + 1);
            [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
          }
          const other = new MapElitesArchive(spec);
          for (const candidate of shuffled) {
            other.insert(candidate);
          }
          expect(canonicalSerialize(other.snapshot())).toBe(canonicalSerialize(base.snapshot()));
        }
      }),
    );
  });

  it('snapshot/restore round trips exactly (canonical round trip)', () => {
    fc.assert(
      fc.property(fcEliteSet, (eliteSet) => {
        const { spec, elites } = eliteSet;
        const archive = new MapElitesArchive(spec);
        for (const candidate of elites) {
          archive.insert(candidate);
        }
        const snapshot = archive.snapshot();
        const restored = MapElitesArchive.restore(JSON.parse(canonicalSerialize(snapshot)) as typeof snapshot);
        expect(canonicalSerialize(restored.snapshot())).toBe(canonicalSerialize(snapshot));
        expect(restored.size).toBe(archive.size);
        expect(restored.families()).toEqual(archive.families());
      }),
    );
  });

  it('semantic confluence: the archive is exactly the per-cell winners (max fitness, min id on ties)', () => {
    fc.assert(
      fc.property(fcEliteSet, (eliteSet) => {
        const { spec, elites } = eliteSet;
        const archive = new MapElitesArchive(spec);
        for (const candidate of elites) {
          archive.insert(candidate);
        }
        const axis = spec.dimensions[0]!.axis;
        const edges = spec.dimensions[0]!.edges;
        const winners = new Map<number, EliteCandidate>();
        for (const candidate of elites) {
          const cell = binIndex(candidate.behavior[axis]!, edges);
          const current = winners.get(cell);
          if (
            current === undefined ||
            candidate.fitness > current.fitness ||
            (candidate.fitness === current.fitness && candidate.id < current.id)
          ) {
            winners.set(cell, candidate);
          }
        }
        expect(archive.size).toBe(winners.size);
        for (const [cell, winner] of winners) {
          expect(archive.get([cell])).toEqual(winner);
        }
        // No repertoire collapse: every family that wins at least one cell survives.
        const winningFamilies = [...new Set([...winners.values()].map((candidate) => candidate.family))].sort();
        expect(archive.families()).toEqual(winningFamilies);
      }),
    );
  });
});
