/**
 * Unit tests: the diversity guards (Work Order W13 acceptance: diversity
 * collapse REJECTED, pinned here with a fixture set of diverse families).
 */

import { describe, expect, it } from 'vitest';
import { assertPreservesFamilies, checkFamilyPreservation, familyRepresentatives, preservesFamilies } from '../src/index.js';
import type { DiversityEntry } from '../src/index.js';
import { COST_LATENCY_SPEC, costLatencyBehavior, entry } from './helpers.js';

/** The fixture population: three materially different families, two high-performing. */
const DURABLE_QUEUE: DiversityEntry[] = [
  entry('dq-1', 'durable-queue', 0.91, costLatencyBehavior(50, 300)),
  entry('dq-2', 'durable-queue', 0.85, costLatencyBehavior(80, 280)),
];
const EDGE_CACHE: DiversityEntry[] = [
  entry('ec-1', 'edge-cache', 0.95, costLatencyBehavior(2000, 20)),
  entry('ec-2', 'edge-cache', 0.88, costLatencyBehavior(1800, 30)),
];
const BLOB_STORE: DiversityEntry[] = [
  entry('bs-1', 'blob-store', 0.40, costLatencyBehavior(300, 900)),
];

const POPULATION: DiversityEntry[] = [...DURABLE_QUEUE, ...EDGE_CACHE, ...BLOB_STORE];

describe('diversity guards — repertoire preservation', () => {
  it('accepts a selection that keeps a representative of every high-performing family', () => {
    const selected = [DURABLE_QUEUE[0]!, EDGE_CACHE[0]!, BLOB_STORE[0]!];
    const check = assertPreservesFamilies(POPULATION, selected, 0.9);
    expect(check.preserved).toBe(true);
    expect(check.collapsed_families).toEqual([]);
    expect(check.families.map((summary) => summary.family)).toEqual(['blob-store', 'durable-queue', 'edge-cache']);
  });

  it('REJECTS dropping a materially different high-performing family (collapse)', () => {
    // keep only the edge-cache champion: the durable-queue family (best 0.91 >= 0.9) collapses
    const selected = [EDGE_CACHE[0]!];
    expect(() => assertPreservesFamilies(POPULATION, selected, 0.9)).toThrow(/diversity collapse REJECTED/);
    expect(preservesFamilies(POPULATION, selected, 0.9)).toBe(false);
    const check = checkFamilyPreservation(POPULATION, selected, 0.9);
    expect(check.collapsed_families).toEqual(['durable-queue']);
  });

  it('REJECTS the single-winner collapse (one global champion across diverse families)', () => {
    // the single globally best entry is the edge-cache champion; selecting ONLY it collapses durable-queue
    const best = POPULATION.reduce((a, b) => (b.fitness > a.fitness ? b : a));
    expect(best.family).toBe('edge-cache');
    expect(() => assertPreservesFamilies(POPULATION, [best], 0.9)).toThrow(/diversity collapse REJECTED/);
  });

  it('allows dropping a family that is NOT high-performing under the declared threshold', () => {
    // blob-store (best 0.40) is below the 0.9 threshold: dropping it entirely is a legitimate preference
    const selected = [DURABLE_QUEUE[0]!, EDGE_CACHE[0]!];
    const check = assertPreservesFamilies(POPULATION, selected, 0.9);
    expect(check.preserved).toBe(true);
    const blob = check.families.find((summary) => summary.family === 'blob-store')!;
    expect(blob.high_performing).toBe(false);
    expect(blob.preserved).toBe(false);
  });

  it('requires the caller to declare the high-performing threshold (never invents one)', () => {
    expect(() => checkFamilyPreservation(POPULATION, POPULATION, Number.NaN)).toThrow(/finite number/);
    expect(() => checkFamilyPreservation(POPULATION, POPULATION, Number.POSITIVE_INFINITY)).toThrow(/finite number/);
  });

  it('REJECTS selections that invent entries outside the population', () => {
    const outsider = entry('outsider', 'phantom-family', 0.99, costLatencyBehavior(10, 10));
    expect(() => assertPreservesFamilies(POPULATION, [outsider], 0.9)).toThrow(/outside the population/);
  });

  it('familyRepresentatives never collapses a family (the sanctioned reduction)', () => {
    const representatives = familyRepresentatives(POPULATION);
    expect(representatives).toHaveLength(3);
    expect(representatives.map((rep) => rep.family)).toEqual(['blob-store', 'durable-queue', 'edge-cache']);
    // best per family with canonical tiebreak
    expect(representatives.find((rep) => rep.family === 'durable-queue')!.id).toBe(DURABLE_QUEUE[0]!.id);
    expect(representatives.find((rep) => rep.family === 'edge-cache')!.id).toBe(EDGE_CACHE[0]!.id);
    // the representatives selection always passes the guard
    expect(() => assertPreservesFamilies(POPULATION, representatives, 0.9)).not.toThrow();
    expect(() => assertPreservesFamilies(POPULATION, representatives, 0.0)).not.toThrow();
  });

  it('resolves equal-fitness contests by canonical id (deterministic representatives)', () => {
    const tied = [
      entry('tied-b', 'tied-family', 0.5, costLatencyBehavior(1, 1)),
      entry('tied-a', 'tied-family', 0.5, costLatencyBehavior(2, 2)),
    ];
    const representatives = familyRepresentatives(tied);
    expect(representatives).toHaveLength(1);
    expect(representatives[0]!.id).toBe(entry('tied-a', 'x', 0, costLatencyBehavior(0, 0)).id);
  });

  it('requires a non-empty population', () => {
    expect(() => familyRepresentatives([])).toThrow(/NON-EMPTY/);
    expect(() => checkFamilyPreservation([], [], 0.5)).toThrow(/NON-EMPTY/);
  });
});
