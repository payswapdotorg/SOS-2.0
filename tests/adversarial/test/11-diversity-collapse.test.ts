/**
 * ADVERSARIAL CLASS 11 — DIVERSITY COLLAPSE (single-survivor /
 * identical-candidate sets are REJECTED by the diversity gate).
 *
 * The fault: a selection keeps only one family's representatives (or
 * identical candidates of one family) while other high-performing families
 * are dropped entirely. The diversity gate must REJECT the collapse with a
 * typed check (collapsed_families listed, preserved: false) and the
 * asserting form must throw — the repertoire may never silently collapse to
 * a universal winner — and the trace chain stays queryable.
 */

import { describe, expect, test } from 'vitest';
import { DiversityArchive, DiversityError, assertPreservesFamilies, checkFamilyPreservation, defaultDiversitySpec, familyRepresentatives } from '@sos-2/diversity';
import type { DiversityEntry } from '@sos-2/diversity';
import { deriveDeterministicArtifactId } from '@sos-2/semantic-spine';
import { ADVERSARIAL_PROVENANCE, T0, assertTraceQueryable } from './helpers.js';
import { createTraceLink } from '@sos-2/semantic-spine';

const SPEC = {
  dimensions: [
    { axis: 'cost', edges: [100, 1000] },
    { axis: 'latency', edges: [50, 200] },
  ],
};

function packageEntry(family: string, note: string, fitness: number, behavior: Record<string, number>): DiversityEntry {
  return {
    id: deriveDeterministicArtifactId('Package', { note, family }),
    family,
    fitness,
    behavior,
    uncertainty: { uncertainty_class: 'MODERATE', sample_size: 5 },
  };
}

const POPULATION: DiversityEntry[] = [
  packageEntry('edge-cache', 'elite-edge-1', 0.9, { cost: 80, latency: 30 }),
  packageEntry('edge-cache', 'elite-edge-2', 0.88, { cost: 250, latency: 60 }),
  packageEntry('durable-queue', 'elite-durable-1', 0.85, { cost: 500, latency: 250 }),
  packageEntry('regional-mirror', 'elite-mirror-1', 0.82, { cost: 1200, latency: 120 }),
];

describe('adversarial class 11: diversity collapse', () => {
  test('a single-survivor selection is REJECTED (typed check: collapsed families listed)', () => {
    // The selection keeps ONLY the edge-cache family (both entries are
    // high-performing); durable-queue and regional-mirror are dropped.
    const selection = POPULATION.filter((entry) => entry.family === 'edge-cache');
    const check = checkFamilyPreservation(POPULATION, selection, 0.5);
    expect(check.preserved).toBe(false);
    expect(check.collapsed_families.sort()).toEqual(['durable-queue', 'regional-mirror']);
    // The per-family summary is retained for audit.
    const families = new Map(check.families.map((family) => [family.family, family]));
    expect(families.get('durable-queue')!.high_performing).toBe(true);
    expect(families.get('durable-queue')!.selected_count).toBe(0);
    expect(families.get('edge-cache')!.selected_count).toBe(2);
  });

  test('the asserting form THROWS on collapse (the collapse never silently passes)', () => {
    const selection = POPULATION.filter((entry) => entry.family === 'edge-cache');
    expect(() => assertPreservesFamilies(POPULATION, selection, 0.5)).toThrow(DiversityError);
    try {
      assertPreservesFamilies(POPULATION, selection, 0.5);
    } catch (error) {
      expect(error).toBeInstanceOf(DiversityError);
      expect((error as Error).message).toContain('durable-queue');
    }
  });

  test('an identical-candidate set of ONE family is likewise REJECTED (single winner)', () => {
    // Two IDENTICAL behavior vectors from the same family — the "universal
    // winner" collapse the lock forbids. Both are part of the population.
    const identicalA = packageEntry('edge-cache', 'identical-a', 0.9, { cost: 80, latency: 30 });
    const identicalB = packageEntry('edge-cache', 'identical-b', 0.9, { cost: 80, latency: 30 });
    const population = [...POPULATION, identicalA, identicalB];
    const selection = [identicalA, identicalB];
    expect(() => assertPreservesFamilies(population, selection, 0.5)).toThrow(DiversityError);
    const check = checkFamilyPreservation(population, selection, 0.5);
    expect(check.preserved).toBe(false);
    expect(check.collapsed_families.length).toBe(2);
  });

  test('a diversity-PRESERVING selection passes (one representative per family)', () => {
    // The sanctioned reduction: the BEST representative per family.
    const representatives = familyRepresentatives(POPULATION);
    expect(representatives.length).toBe(3);
    const check = checkFamilyPreservation(POPULATION, representatives, 0.5);
    expect(check.preserved).toBe(true);
    expect(check.collapsed_families).toEqual([]);
    expect(() => assertPreservesFamilies(POPULATION, representatives, 0.5)).not.toThrow();
  });

  test('the archive retains its coverage after the rejected collapse (queryable)', () => {
    const archive = new DiversityArchive(SPEC);
    for (const entry of POPULATION) {
      archive.insert(entry);
    }
    // The collapse attempt does not mutate the archive.
    expect(() => assertPreservesFamilies(POPULATION, POPULATION.slice(0, 1), 0.5)).toThrow(DiversityError);
    expect(archive.size).toBe(4);
    expect(archive.families().sort()).toEqual(['durable-queue', 'edge-cache', 'regional-mirror']);
    const report = archive.coverageReport();
    expect(report.families.sort()).toEqual(['durable-queue', 'edge-cache', 'regional-mirror']);
    expect(report.occupied_cells).toBeGreaterThanOrEqual(3);
    // The default spec (the frozen section-11 axes) is available + valid.
    expect(defaultDiversitySpec().dimensions.length).toBe(9);
  });

  test('the trace chain stays queryable after the diversity rejection', () => {
    const selection = POPULATION.filter((entry) => entry.family === 'edge-cache');
    void selection;
    const links = POPULATION.map((entry) =>
      createTraceLink({
        source: entry.id,
        target: deriveDeterministicArtifactId('PackageComposition', { note: 'adversarial-11-repertoire' }),
        type: 'COMPATIBLE_WITH',
        provenance: [...ADVERSARIAL_PROVENANCE, 'adversarial:11:package-in-repertoire'],
      }),
    );
    const { queryFrom } = assertTraceQueryable(links);
    for (const entry of POPULATION) {
      expect(queryFrom(entry.id).length).toBe(1);
    }
    void T0;
  });
});
