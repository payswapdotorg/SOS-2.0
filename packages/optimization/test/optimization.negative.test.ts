/**
 * Negative discipline tests for @sos-2/optimization.
 *
 * The forbidden shortcuts exercised here (spec/architecture-lock.md,
 * spec/architecture.md §9/§11/§12, W7 brief):
 *   - uncertainty stripped from candidates/results — REJECTED;
 *   - a numeric probability without calibration evidence — REJECTED;
 *   - mixed objective spaces (undefined dominance) — REJECTED;
 *   - flipping a frozen core-axis direction — REJECTED;
 *   - single-global-score ranking — REJECTED BY CONSTRUCTION: the result is
 *     the front/repertoire, never a winner; the fronts partition the input
 *     so no candidate is ever silently discarded by a ranking collapse.
 */

import { describe, expect, it } from 'vitest';
import {
  MapElitesArchive,
  dominates,
  nonDominatedSort,
  paretoFrontOf,
} from '../src/index.js';
import type { ParetoCandidate, TypedObjective } from '../src/index.js';
import { TWO_AXIS_SPEC, costLatency, elite, paretoCandidate } from './helpers.js';

describe('optimization negative discipline', () => {
  it('REJECTS a candidate whose uncertainty was stripped (uncertainty is mandatory, end-to-end)', () => {
    const stripped = {
      id: 'sos://CandidateState/' + '0'.repeat(32),
      family: 'edge-cache',
      objectives: costLatency(10, 20),
    } as unknown as ParetoCandidate;
    expect(() => nonDominatedSort([stripped])).toThrow(/uncertainty/);
  });

  it('REJECTS a numeric probability without its calibration ref (§12: numeric only where calibration exists)', () => {
    const uncalibratedNumeric = paretoCandidate('uc', 'edge-cache', costLatency(10, 20), {
      uncertainty_class: 'MODERATE',
      sample_size: 10,
      calibrated_probability: 0.9,
    });
    expect(() => nonDominatedSort([uncalibratedNumeric])).toThrow(
      /calibrated_probability and calibration_ref must be supplied together/,
    );
  });

  it('REJECTS a calibration ref without a probability (half-carried uncertainty is malformed)', () => {
    const halfCarried = paretoCandidate('hc', 'edge-cache', costLatency(10, 20), {
      uncertainty_class: 'MODERATE',
      sample_size: 10,
      calibration_ref: 'sos://Evaluation/' + 'a'.repeat(32),
    });
    expect(() => nonDominatedSort([halfCarried])).toThrow(
      /calibrated_probability and calibration_ref must be supplied together/,
    );
  });

  it('REJECTS mixed objective spaces (dominance is undefined, never silently resolved)', () => {
    const costLatencyCandidate = paretoCandidate('cl', 'a', costLatency(10, 20));
    const differentAxes = paretoCandidate('da', 'b', [
      { axis: 'COST', direction: 'MINIMIZE', value: 5 },
      { axis: 'RESILIENCE', direction: 'MAXIMIZE', value: 0.9 },
    ]);
    expect(() => nonDominatedSort([costLatencyCandidate, differentAxes])).toThrow(/comparability violated/);
    expect(() => dominates(costLatencyCandidate, differentAxes)).toThrow(/comparable only over comparable objective spaces|comparable objective spaces/);
  });

  it('REJECTS flipping a frozen core-axis direction (COST is MINIMIZE, by §11)', () => {
    const flipped: TypedObjective[] = [
      { axis: 'COST', direction: 'MAXIMIZE', value: 10 },
      { axis: 'LATENCY', direction: 'MINIMIZE', value: 20 },
    ];
    expect(() => nonDominatedSort([paretoCandidate('fl', 'a', flipped)])).toThrow(/frozen direction MINIMIZE/);
  });

  it('REJECTS objectives on non-§11 axes (the axis vocabulary is imported, not extended)', () => {
    const invented = [{ axis: 'GOD_OBJECT_SCORE', direction: 'MINIMIZE', value: 1 }] as unknown as TypedObjective[];
    expect(() => nonDominatedSort([paretoCandidate('iv', 'a', invented)])).toThrow(
      /objective axis must be one of the §11 dimensions/,
    );
  });

  it('REJECTS duplicate candidate ids in one sort (identity is identity)', () => {
    const a = paretoCandidate('same-seed', 'a', costLatency(10, 20));
    const b = paretoCandidate('same-seed', 'b', costLatency(30, 30));
    expect(a.id).toBe(b.id);
    expect(() => nonDominatedSort([a, b])).toThrow(/duplicate Pareto candidate id/);
  });

  it('has NO single-winner collapse: the front keeps every mutually non-dominated candidate and the fronts partition the input', () => {
    // A set where one candidate dominates SOME others but never all: the
    // single-global-score shortcut would rank and discard; the front keeps.
    const best = paretoCandidate('best', 'a', costLatency(1, 1));
    const cheap = paretoCandidate('cheap', 'b', costLatency(1, 1000));
    const fast = paretoCandidate('fast', 'c', costLatency(1000, 1));
    const dominated = paretoCandidate('dominated', 'd', costLatency(500, 500));
    const result = nonDominatedSort([best, cheap, fast, dominated]);
    // best dominates dominated (and ties none), cheap/fast are dominated by best
    // (best is cheaper AND faster) — wait: best(1,1) dominates all three.
    // The meaningful assertion for THIS shape: the front is exactly {best},
    // but dominated candidates are NOT discarded — they appear on later fronts.
    expect(result.fronts[0]!.candidates.map((candidate) => candidate.id)).toEqual([best.id]);
    const allIds = result.fronts.flatMap((front) => front.candidates.map((candidate) => candidate.id)).sort();
    expect(allIds).toEqual([best.id, cheap.id, fast.id, dominated.id].sort());
    expect(result.total_candidates).toBe(4);
    // And with a genuine trade-off, the front keeps them all:
    const tradeoffFront = paretoFrontOf([
      paretoCandidate('cheap2', 'b', costLatency(1, 1000)),
      paretoCandidate('fast2', 'c', costLatency(1000, 1)),
    ]);
    expect(tradeoffFront.candidates).toHaveLength(2);
  });

  it('REJECTS archive candidates with behavior on wrong/missing axes', () => {
    const archive = new MapElitesArchive(TWO_AXIS_SPEC);
    expect(() =>
      archive.insert(elite('missing', 'f', 0.5, { latency_ms: 10 })),
    ).toThrow(/exactly the spec axes/);
    expect(() =>
      archive.insert(
        elite('extra', 'f', 0.5, { latency_ms: 10, monthly_cost: 20, surprise: 1 }),
      ),
    ).toThrow(/exactly the spec axes/);
  });

  it('REJECTS non-finite fitness/behavior values', () => {
    const archive = new MapElitesArchive(TWO_AXIS_SPEC);
    expect(() =>
      archive.insert({ ...elite('inf', 'f', Number.POSITIVE_INFINITY, { latency_ms: 10, monthly_cost: 20 }) }),
    ).toThrow(/fitness must be a finite number/);
    expect(() =>
      archive.insert(elite('nan-behavior', 'f', 0.5, { latency_ms: Number.NaN, monthly_cost: 20 })),
    ).toThrow(/finite number/);
  });

  it('REJECTS duplicate ids across cells (one id, one cell)', () => {
    const archive = new MapElitesArchive(TWO_AXIS_SPEC);
    const first = elite('dup', 'f', 0.5, { latency_ms: 10, monthly_cost: 20 });
    archive.insert(first);
    expect(() => archive.insert(elite('dup', 'f', 0.9, { latency_ms: 500, monthly_cost: 800 }))).toThrow(
      /already present in the archive/,
    );
  });

  it('REJECTS malformed specs: duplicate axes, unsorted edges, empty edges', () => {
    expect(() => new MapElitesArchive({ dimensions: [{ axis: 'x', edges: [1] }, { axis: 'x', edges: [2] }] })).toThrow(
      /duplicate behavior axis/,
    );
    expect(() => new MapElitesArchive({ dimensions: [{ axis: 'x', edges: [100, 50] }] })).toThrow(
      /strictly ascending/,
    );
    expect(() => new MapElitesArchive({ dimensions: [{ axis: 'x', edges: [] }] })).toThrow(/at least one bin edge/);
    expect(() => new MapElitesArchive({ dimensions: [] })).toThrow(/at least one behavior dimension/);
  });
});
