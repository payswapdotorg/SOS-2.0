/**
 * Property tests: randomized inputs —
 *   - facade query determinism (identical results on repeated queries),
 *   - Beta update authority consistency (default prior == the W6 baseline),
 *   - sample-size and window-preservation laws of the update path,
 *   - Dirichlet laws (alphas = prior + counts; means sum to 1),
 *   - canonical round trips.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { canonicalSerialize, contentHash } from '@sos-2/semantic-spine';
import { DEFAULT_BETA_PRIOR, betaPosterior } from '@sos-2/packages';
import type { ApplicabilityEstimate } from '@sos-2/packages';
import { RetrievalFacade, betaUpdate, dirichletUpdate, updateApplicabilityEstimate } from '../src/index.js';
import { buildFixture, W0, W1 } from './helpers.js';

const fcWindow = fc
  .record({
    start: fc.integer({ min: 0, max: 500 }),
    duration: fc.integer({ min: 0, max: 500 }),
  })
  .map(({ start, duration }) => ({
    start: new Date(Date.UTC(2025, 0, 1) + start * 3_600_000).toISOString(),
    end: new Date(Date.UTC(2025, 0, 1) + (start + duration) * 3_600_000).toISOString(),
  }));

const fcBatch = fc.record({
  successes: fc.integer({ min: 0, max: 50 }),
  failures: fc.integer({ min: 0, max: 50 }),
  window: fcWindow,
}).filter((batch) => batch.successes + batch.failures >= 1);

const fcPrior = fc.record({
  alpha: fc.double({ min: 0.1, max: 20, noNaN: true }),
  beta: fc.double({ min: 0.1, max: 20, noNaN: true }),
});

const fcCalibratedEstimate = fc.record({
  probability: fc.double({ min: 0.01, max: 0.99, noNaN: true }),
  sampleSize: fc.integer({ min: 1, max: 40 }),
  window: fc.option(fcWindow, { nil: null }),
}).map<ApplicabilityEstimate>(({ probability, sampleSize, window }) => ({
  kind: 'CALIBRATED',
  probability,
  calibration_ref: 'sos://Evaluation/' + 'a'.repeat(32),
  uncertainty_class: 'MODERATE',
  context: { deployment: 'edge' },
  sample_size: sampleSize,
  window: window ?? W1,
}));

const fcQualitativeEstimate = fc.record({
  sampleSize: fc.integer({ min: 0, max: 40 }),
  window: fc.option(fcWindow, { nil: null }),
}).map<ApplicabilityEstimate>(({ sampleSize, window }) => ({
  kind: 'QUALITATIVE',
  uncertainty_class: 'WEAK',
  context: { deployment: 'edge' },
  sample_size: sampleSize,
  window,
}));

describe('facade property tests', () => {
  it('query determinism: the same registry and query always produce identical search context', () => {
    const fixture = buildFixture();
    const facade = new RetrievalFacade(fixture.registry);
    const query = { capability: 'image-resize', context: { deployment: 'edge' } } as const;
    const first = facade.query({ ...query });
    for (let i = 0; i < 5; i += 1) {
      const again = facade.query({ ...query });
      expect(canonicalSerialize(again)).toBe(canonicalSerialize(first));
    }
  });

  it('query canonical round trip: the search context serializes canonically and hash-stably', () => {
    const fixture = buildFixture();
    const facade = new RetrievalFacade(fixture.registry);
    const context = facade.query({ capability: 'image', context: { deployment: 'edge' } });
    const text = canonicalSerialize(context);
    const parsed = JSON.parse(text);
    expect(canonicalSerialize(parsed)).toBe(text);
    expect(contentHash(parsed)).toBe(contentHash(context));
  });
});

describe('Bayesian update property tests', () => {
  it('authority consistency: with the default Beta(1,1) prior, betaUpdate IS the W6 betaPosterior', () => {
    fc.assert(
      fc.property(fcBatch, (batch) => {
        const result = betaUpdate(DEFAULT_BETA_PRIOR, batch);
        const authority = betaPosterior(batch.successes, batch.failures);
        expect(result.posterior.alpha).toBeCloseTo(authority.alpha, 12);
        expect(result.posterior.beta).toBeCloseTo(authority.beta, 12);
        expect(result.posterior.mean).toBeCloseTo(authority.mean, 12);
        expect(result.posterior.variance).toBeCloseTo(authority.variance, 12);
        expect(result.posterior.credible_interval_p90[0]).toBeCloseTo(authority.credible_interval_p90[0], 9);
        expect(result.posterior.credible_interval_p90[1]).toBeCloseTo(authority.credible_interval_p90[1], 9);
        expect(result.sample_size).toBe(batch.successes + batch.failures);
      }),
    );
  });

  it('conjugacy law: posterior alphas are prior + counts, for any prior', () => {
    fc.assert(
      fc.property(fcPrior, fcBatch, (prior, batch) => {
        const result = betaUpdate(prior, batch);
        expect(result.posterior.alpha).toBeCloseTo(prior.alpha + batch.successes, 12);
        expect(result.posterior.beta).toBeCloseTo(prior.beta + batch.failures, 12);
        expect(result.posterior.mean).toBeGreaterThan(0);
        expect(result.posterior.mean).toBeLessThan(1);
        expect(result.posterior.credible_interval_p90[0]).toBeLessThanOrEqual(result.posterior.mean);
        expect(result.posterior.credible_interval_p90[1]).toBeGreaterThanOrEqual(result.posterior.mean);
      }),
    );
  });

  it('window preservation: the update always carries a non-null window', () => {
    fc.assert(
      fc.property(fcBatch, (batch) => {
        const result = betaUpdate({ alpha: 1, beta: 1 }, batch);
        expect(result.window).toEqual(batch.window);
      }),
    );
  });

  it('estimate update laws: sample sizes accumulate; calibrated estimates stay calibrated and in [0,1]', () => {
    fc.assert(
      fc.property(fcCalibratedEstimate, fcBatch, (estimate, batch) => {
        const result = updateApplicabilityEstimate(estimate, batch);
        const updated = result.estimate;
        expect(updated.kind).toBe('CALIBRATED');
        if (updated.kind === 'CALIBRATED' && estimate.kind === 'CALIBRATED') {
          expect(updated.probability).toBeGreaterThanOrEqual(0);
          expect(updated.probability).toBeLessThanOrEqual(1);
          expect(updated.sample_size).toBe(estimate.sample_size + batch.successes + batch.failures);
          expect(updated.calibration_ref).toBe(estimate.calibration_ref);
        }
        expect(result.update.window).not.toBeNull();
      }),
    );
  });

  it('qualitative estimate update law: without calibration the estimate NEVER becomes numeric (size accumulates, window preserved)', () => {
    fc.assert(
      fc.property(fcQualitativeEstimate, fcBatch, (estimate, batch) => {
        const result = updateApplicabilityEstimate(estimate, batch);
        expect(result.estimate.kind).toBe('QUALITATIVE');
        if (result.estimate.kind === 'QUALITATIVE') {
          expect(result.estimate.sample_size).toBe(estimate.sample_size + batch.successes + batch.failures);
          expect('probability' in result.estimate).toBe(false);
        }
        expect(result.update.calibrated).toBe(false);
        expect(result.update.window).not.toBeNull();
      }),
    );
  });

  it('dirichlet laws: alphas = prior + counts; means sum to 1; counts preserved', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 30 }), { minLength: 2, maxLength: 6 }),
        fc.double({ min: 0.1, max: 5, noNaN: true }),
        (counts, concentration) => {
          const result = dirichletUpdate(counts, concentration);
          expect(result.posterior_alphas).toEqual(counts.map((count) => count + concentration));
          expect(result.means.reduce((sum, mean) => sum + mean, 0)).toBeCloseTo(1, 12);
          expect(result.total_counts).toBe(counts.reduce((sum, count) => sum + count, 0));
          expect(result.concentration).toBeCloseTo(
            result.posterior_alphas.reduce((sum, alpha) => sum + alpha, 0),
            12,
          );
          expect(result.calibrated).toBe(false);
        },
      ),
    );
  });

  it('canonical round trip: update results serialize canonically', () => {
    fc.assert(
      fc.property(fcCalibratedEstimate, fcBatch, (estimate, batch) => {
        const result = updateApplicabilityEstimate(estimate, batch, { calibration_ref: 'sos://Evaluation/' + 'b'.repeat(32) });
        const text = canonicalSerialize(result);
        expect(canonicalSerialize(JSON.parse(text))).toBe(text);
      }),
    );
  });
});
