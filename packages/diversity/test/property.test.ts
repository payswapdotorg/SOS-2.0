/**
 * Property tests: randomized populations — deterministic archive updates,
 * canonical coverage reports, canonical round trips, guard correctness
 * (Work Order W13 verification: "randomized populations — ... archive
 * updates deterministic").
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { canonicalSerialize } from '@sos-2/semantic-spine';
import { assertPreservesFamilies, DiversityArchive, familyRepresentatives } from '../src/index.js';
import type { DiversityEntry } from '../src/index.js';
import { COST_LATENCY_SPEC, costLatencyBehavior, entry, qualitativeUncertainty } from './helpers.js';

const FAMILY_NAMES = ['durable-queue', 'edge-cache', 'blob-store', 'sharded-store', 'embedded-store'] as const;

const entryArb: fc.Arbitrary<DiversityEntry> = fc
  .record({
    seed: fc.string({ minLength: 1, maxLength: 12 }).filter((s) => !s.includes('"')),
    family: fc.constantFrom(...FAMILY_NAMES),
    fitness: fc.double({ min: 0, max: 1, noNaN: true }),
    cost: fc.integer({ min: 0, max: 3000 }),
    latency: fc.integer({ min: 0, max: 500 }),
    sampleSize: fc.integer({ min: 0, max: 50 }),
  })
  .map((value) =>
    entry(
      value.seed,
      value.family,
      value.fitness,
      costLatencyBehavior(value.cost, value.latency),
      qualitativeUncertainty(value.sampleSize),
    ),
  );

const populationArb = fc.uniqueArray(entryArb, { minLength: 1, maxLength: 24, selector: (entry) => entry.id });

describe('diversity property tests — determinism and canonical round trips', () => {
  it('archive updates are deterministic: the final archive is a pure function of the entry SET', () => {
    fc.assert(
      fc.property(populationArb, (population) => {
        const forward = new DiversityArchive(COST_LATENCY_SPEC);
        for (const candidate of population) {
          forward.insert(candidate);
        }
        const backward = new DiversityArchive(COST_LATENCY_SPEC);
        for (const candidate of [...population].reverse()) {
          backward.insert(candidate);
        }
        expect(canonicalSerialize(backward.snapshot())).toBe(canonicalSerialize(forward.snapshot()));
        return true;
      }),
      { numRuns: 50 },
    );
  });

  it('coverage reports are deterministic and canonical across insertion orders', () => {
    fc.assert(
      fc.property(populationArb, (population) => {
        const forward = new DiversityArchive(COST_LATENCY_SPEC);
        for (const candidate of population) {
          forward.insert(candidate);
        }
        const rotated = [...population];
        rotated.push(rotated.shift()!);
        const backward = new DiversityArchive(COST_LATENCY_SPEC);
        for (const candidate of rotated) {
          backward.insert(candidate);
        }
        expect(canonicalSerialize(backward.coverageReport())).toBe(canonicalSerialize(forward.coverageReport()));
        // invariants of the report itself
        const report = forward.coverageReport();
        expect(report.occupied_cells).toBe(forward.size);
        expect(report.occupied_cells).toBe(report.cells.length);
        expect(report.families).toEqual([...report.families].sort());
        expect(report.occupancy_ratio).toBe(report.occupied_cells / report.total_cells);
        return true;
      }),
      { numRuns: 50 },
    );
  });

  it('snapshots round-trip canonically through restore', () => {
    fc.assert(
      fc.property(populationArb, (population) => {
        const archive = new DiversityArchive(COST_LATENCY_SPEC);
        for (const candidate of population) {
          archive.insert(candidate);
        }
        const snapshot = archive.snapshot();
        const restored = DiversityArchive.restore(JSON.parse(canonicalSerialize(snapshot)));
        expect(canonicalSerialize(restored.snapshot())).toBe(canonicalSerialize(snapshot));
        expect(canonicalSerialize(restored.coverageReport())).toBe(canonicalSerialize(archive.coverageReport()));
        return true;
      }),
      { numRuns: 40 },
    );
  });

  it('the guard accepts every selection that keeps a representative per high-performing family', () => {
    fc.assert(
      fc.property(populationArb, fc.double({ min: 0, max: 1, noNaN: true }), (population, threshold) => {
        // select the family representatives of the high-performing families plus everything below threshold
        const highFamilies = new Set(
          familyRepresentatives(population)
            .filter((rep) => rep.fitness >= threshold)
            .map((rep) => rep.family),
        );
        const selected = population.filter(
          (candidate) => !highFamilies.has(candidate.family) || candidate.id === familyRepresentatives(
            population.filter((p) => p.family === candidate.family),
          )[0]!.id,
        );
        expect(() => assertPreservesFamilies(population, selected, threshold)).not.toThrow();
        return true;
      }),
      { numRuns: 50 },
    );
  });

  it('the guard rejects dropping every representative of a high-performing family', () => {
    fc.assert(
      fc.property(populationArb, fc.double({ min: 0, max: 1, noNaN: true }), (population, threshold) => {
        const highFamilies = new Set(
          familyRepresentatives(population)
            .filter((rep) => rep.fitness >= threshold)
            .map((rep) => rep.family),
        );
        if (highFamilies.size === 0) {
          return true; // nothing high-performing: no collapse possible
        }
        const victim = [...highFamilies][0]!;
        const selected = population.filter((candidate) => candidate.family !== victim);
        if (selected.length === population.length) {
          return true; // family had no members (impossible); skip
        }
        expect(() => assertPreservesFamilies(population, selected, threshold)).toThrow(/diversity collapse REJECTED/);
        return true;
      }),
      { numRuns: 50 },
    );
  });

  it('familyRepresentatives always passes the guard at any threshold (never collapses)', () => {
    fc.assert(
      fc.property(populationArb, fc.double({ min: 0, max: 1, noNaN: true }), (population, threshold) => {
        const representatives = familyRepresentatives(population);
        expect(representatives.length).toBe(new Set(population.map((p) => p.family)).size);
        expect(() => assertPreservesFamilies(population, representatives, threshold)).not.toThrow();
        return true;
      }),
      { numRuns: 50 },
    );
  });
});
