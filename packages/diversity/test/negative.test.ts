/**
 * Negative tests: everything the diversity layer REJECTS loudly (Work Order
 * W13 acceptance: diversity collapse REJECTED is pinned in guard.test.ts;
 * here: invalid specs, invalid populations, uncertainty discipline).
 */

import { describe, expect, it } from 'vitest';
import { DiversityError } from '../src/index.js';
import { DiversityArchive } from '../src/index.js';
import { COST_LATENCY_SPEC, costLatencyBehavior, entry, qualitativeUncertainty } from './helpers.js';

describe('diversity negative discipline', () => {
  it('REJECTS archive specs with axes outside the nine frozen §11 dimensions', () => {
    expect(
      () =>
        new DiversityArchive({
          dimensions: [{ axis: 'lines_of_code', edges: [1000] }],
        }),
    ).toThrow(DiversityError);
    expect(
      () =>
        new DiversityArchive({
          dimensions: [{ axis: 'lines_of_code', edges: [1000] }],
        }),
    ).toThrow(/nine frozen §11 dimensions/);
  });

  it('REJECTS empty archive specs', () => {
    expect(() => new DiversityArchive({ dimensions: [] })).toThrow(/at least one behavior dimension/);
  });

  it('REJECTS entries whose ids are not package/composition spine ids', () => {
    const archive = new DiversityArchive(COST_LATENCY_SPEC);
    const notAnId = { ...entry('x', 'f', 0.5, costLatencyBehavior(50, 50)), id: 'not-an-id' };
    expect(() => archive.insert(notAnId)).toThrow(/well-formed spine artifact id/);
    const evidenceId = 'sos://Evidence/' + 'a'.repeat(32);
    expect(() => archive.insert({ ...entry('y', 'f', 0.5, costLatencyBehavior(50, 50)), id: evidenceId })).toThrow(
      /Package or PackageComposition id/,
    );
  });

  it('REJECTS entries with behavior outside the declared §11 axes (delegated W7 discipline)', () => {
    const archive = new DiversityArchive(COST_LATENCY_SPEC);
    expect(() =>
      archive.insert(
        entry('z', 'f', 0.5, {
          cost: 100,
          latency: 100,
          resilience: 3, // not on the declared spec
        }),
      ),
    ).toThrow(DiversityError);
    expect(() =>
      archive.insert(entry('z2', 'f', 0.5, { cost: 100 /* latency missing */ })),
    ).toThrow(DiversityError);
  });

  it('REJECTS uncertainty-stripped entries (§12 flows through the composed W7 authority)', () => {
    const archive = new DiversityArchive(COST_LATENCY_SPEC);
    const stripped = {
      id: entry('u', 'f', 0, costLatencyBehavior(0, 0)).id,
      family: 'f',
      fitness: 0.5,
      behavior: costLatencyBehavior(50, 50),
    };
    expect(() => archive.insert(stripped as never)).toThrow(DiversityError);
  });

  it('REJECTS a numeric probability without its calibration ref (§12, delegated)', () => {
    const archive = new DiversityArchive(COST_LATENCY_SPEC);
    const uncalibrated = entry('v', 'f', 0.5, costLatencyBehavior(50, 50), {
      uncertainty_class: 'MODERATE',
      sample_size: 5,
      calibrated_probability: 0.9,
      // calibration_ref missing
    });
    expect(() => archive.insert(uncalibrated)).toThrow(/calibration/);
  });

  it('REJECTS duplicate entry ids (one id, one cell — delegated W7 rule)', () => {
    const archive = new DiversityArchive(COST_LATENCY_SPEC);
    const first = entry('dup', 'f', 0.5, costLatencyBehavior(50, 50));
    archive.insert(first);
    const sameIdDifferentCell = { ...first, behavior: costLatencyBehavior(2000, 2000) };
    expect(() => archive.insert(sameIdDifferentCell)).toThrow(/already present/);
  });

  it('REJECTS snapshots whose elites violate the population discipline', () => {
    expect(() =>
      DiversityArchive.restore({
        spec: COST_LATENCY_SPEC,
        elites: [{ ...entry('w', 'f', 0.5, costLatencyBehavior(50, 50)), id: 'garbage' }],
      }),
    ).toThrow(DiversityError);
  });

  it('carries qualitative uncertainty payloads without inventing numbers', () => {
    const archive = new DiversityArchive(COST_LATENCY_SPEC);
    archive.insert(entry('q', 'f', 0.5, costLatencyBehavior(50, 50), qualitativeUncertainty(7)));
    expect(archive.elites()[0]!.uncertainty).toEqual({ uncertainty_class: 'MODERATE', sample_size: 7 });
  });
});
