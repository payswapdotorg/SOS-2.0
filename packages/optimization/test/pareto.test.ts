/**
 * Unit tests: Pareto non-dominated sorting over typed objectives.
 */

import { describe, expect, it } from 'vitest';
import { dominates, nonDominatedSort, paretoFrontOf } from '../src/index.js';
import {
  costLatency,
  costResilience,
  paretoCandidate,
  qualitativeUncertainty,
} from './helpers.js';

describe('dominates (weak Pareto dominance)', () => {
  it('A dominates B when at least as good everywhere and strictly better somewhere', () => {
    const a = paretoCandidate('a', 'edge-cache', costLatency(10, 20));
    const b = paretoCandidate('b', 'edge-cache', costLatency(12, 25));
    expect(dominates(a, b)).toBe(true);
    expect(dominates(b, a)).toBe(false);
  });

  it('equal objective vectors do not dominate each other (mutual non-domination)', () => {
    const a = paretoCandidate('a', 'family-a', costLatency(10, 20));
    const b = paretoCandidate('b', 'family-b', costLatency(10, 20));
    expect(dominates(a, b)).toBe(false);
    expect(dominates(b, a)).toBe(false);
  });

  it('trade-off candidates do not dominate each other', () => {
    const cheap = paretoCandidate('cheap', 'cheap', costLatency(5, 200));
    const fast = paretoCandidate('fast', 'fast', costLatency(50, 10));
    expect(dominates(cheap, fast)).toBe(false);
    expect(dominates(fast, cheap)).toBe(false);
  });

  it('respects MAXIMIZE directions (resilience)', () => {
    const strong = paretoCandidate('strong', 'durable', costResilience(10, 0.99));
    const weak = paretoCandidate('weak', 'durable', costResilience(10, 0.9));
    expect(dominates(strong, weak)).toBe(true);
    expect(dominates(weak, strong)).toBe(false);
  });
});

describe('nonDominatedSort', () => {
  it('returns the front — every mutually non-dominated candidate, never a single winner', () => {
    const cheap = paretoCandidate('cheap', 'cheap', costLatency(5, 200));
    const fast = paretoCandidate('fast', 'fast', costLatency(50, 10));
    const balanced = paretoCandidate('balanced', 'balanced', costLatency(25, 60));
    const result = nonDominatedSort([cheap, fast, balanced]);
    expect(result.fronts[0]!.candidates).toHaveLength(3);
    expect(result.fronts).toHaveLength(1);
  });

  it('partitions the input into ranked fronts (nothing discarded)', () => {
    const best = paretoCandidate('best', 'a', costLatency(1, 1));
    const mid = paretoCandidate('mid', 'b', costLatency(10, 10));
    const worst = paretoCandidate('worst', 'c', costLatency(100, 100));
    const result = nonDominatedSort([worst, best, mid]);
    expect(result.fronts).toHaveLength(3);
    expect(result.fronts[0]!.candidates.map((candidate) => candidate.id)).toEqual([best.id]);
    expect(result.fronts[1]!.candidates.map((candidate) => candidate.id)).toEqual([mid.id]);
    expect(result.fronts[2]!.candidates.map((candidate) => candidate.id)).toEqual([worst.id]);
    expect(result.total_candidates).toBe(3);
  });

  it('orders candidates inside a front canonically by id (deterministic)', () => {
    const x = paretoCandidate('zzz-late-id', 'x', costLatency(5, 200));
    const y = paretoCandidate('aaa-early-id', 'y', costLatency(50, 10));
    const front = paretoFrontOf([x, y]);
    expect(front.candidates.map((candidate) => candidate.id)).toEqual([...front.candidates.map((c) => c.id)].sort());
  });

  it('preserves uncertainty verbatim through evaluation (never point scores alone)', () => {
    const calibrated = paretoCandidate('cal', 'a', costLatency(5, 5), {
      uncertainty_class: 'STRONG',
      sample_size: 42,
      calibrated_probability: 0.93,
      calibration_ref: 'sos://Evaluation/' + 'c'.repeat(32),
    });
    const qualitative = paretoCandidate('qua', 'b', costLatency(6, 6), qualitativeUncertainty(7));
    const result = nonDominatedSort([calibrated, qualitative]);
    const found = result.fronts.flatMap((front) => front.candidates);
    const cal = found.find((candidate) => candidate.id === calibrated.id)!;
    const qua = found.find((candidate) => candidate.id === qualitative.id)!;
    expect(cal.uncertainty.uncertainty_class).toBe('STRONG');
    expect(cal.uncertainty.sample_size).toBe(42);
    expect(cal.uncertainty.calibrated_probability).toBe(0.93);
    expect(qua.uncertainty.uncertainty_class).toBe('MODERATE');
    expect(qua.uncertainty.sample_size).toBe(7);
    expect(qua.uncertainty.calibrated_probability).toBeUndefined();
  });

  it('reports the common axes of the sort', () => {
    const result = nonDominatedSort([paretoCandidate('a', 'f', costResilience(1, 0.5))]);
    expect(result.axes).toEqual(['COST', 'RESILIENCE']);
  });

  it('an empty sort yields an honest empty front (never an error, never fake data)', () => {
    const result = nonDominatedSort([]);
    expect(result.fronts).toEqual([]);
    expect(paretoFrontOf([]).candidates).toEqual([]);
    expect(result.total_candidates).toBe(0);
  });
});
