/**
 * Unit tests: the Bayesian update path (Beta/Dirichlet posteriors with
 * sample size + time window preserved; calibration discipline).
 */

import { describe, expect, it } from 'vitest';
import { betaUpdate, dirichletUpdate, mergeWindows, updateApplicabilityEstimate } from '../src/index.js';
import { DEFAULT_BETA_PRIOR, betaPosterior } from '@sos-2/packages';
import { CALIBRATION, W0, W1, W2, calibratedEdgeEstimate } from './helpers.js';

describe('betaUpdate', () => {
  it('computes the conjugate update with the W6 authority math', () => {
    const result = betaUpdate(DEFAULT_BETA_PRIOR, { successes: 8, failures: 2, window: W0 });
    const authority = betaPosterior(8, 2);
    expect(result.posterior.alpha).toBe(authority.alpha);
    expect(result.posterior.beta).toBe(authority.beta);
    expect(result.posterior.mean).toBeCloseTo(authority.mean, 12);
    expect(result.posterior.credible_interval_p90[0]).toBeCloseTo(authority.credible_interval_p90[0], 10);
    expect(result.posterior.credible_interval_p90[1]).toBeCloseTo(authority.credible_interval_p90[1], 10);
  });

  it('preserves sample size and time window', () => {
    const result = betaUpdate({ alpha: 2, beta: 3 }, { successes: 5, failures: 4, window: W1 });
    expect(result.sample_size).toBe(9);
    expect(result.posterior.observations).toBe(9);
    expect(result.window).toEqual(W1);
  });

  it('marks numeric outputs UNCALIBRATED unless calibration evidence is attached', () => {
    const uncalibrated = betaUpdate(DEFAULT_BETA_PRIOR, { successes: 3, failures: 1, window: W0 });
    expect(uncalibrated.calibrated).toBe(false);
    expect(uncalibrated.calibration_ref).toBeNull();
    const calibrated = betaUpdate(DEFAULT_BETA_PRIOR, { successes: 3, failures: 1, window: W0 }, {
      calibration_ref: CALIBRATION,
    });
    expect(calibrated.calibrated).toBe(true);
    expect(calibrated.calibration_ref).toBe(CALIBRATION);
    // The numbers are identical — only the calibration status differs.
    expect(calibrated.posterior).toEqual(uncalibrated.posterior);
  });

  it('carries uncertainty through the credible interval (never a bare mean)', () => {
    const result = betaUpdate(DEFAULT_BETA_PRIOR, { successes: 2, failures: 8, window: W0 });
    expect(result.posterior.credible_interval_p90[0]).toBeLessThan(result.posterior.mean);
    expect(result.posterior.credible_interval_p90[1]).toBeGreaterThan(result.posterior.mean);
    expect(result.posterior.variance).toBeGreaterThan(0);
  });
});

describe('mergeWindows', () => {
  it('unions two windows (min start, max end)', () => {
    expect(mergeWindows(W0, W1)).toEqual(W2);
    expect(mergeWindows(W1, W0)).toEqual(W2);
    expect(mergeWindows(null, W1)).toEqual(W1);
    expect(mergeWindows(W0, null)).toEqual(W0);
  });
});

describe('updateApplicabilityEstimate — calibrated estimate', () => {
  it('uses the estimate as its prior; accumulates sample size; merges windows; stays calibrated', () => {
    const estimate = calibratedEdgeEstimate(0.8); // p=0.8, n=24, window W1
    const result = updateApplicabilityEstimate(estimate, { successes: 6, failures: 0, window: W0 });
    expect(result.estimate.kind).toBe('CALIBRATED');
    const updated = result.estimate as { kind: 'CALIBRATED'; probability: number; sample_size: number; window: unknown };
    // Prior Beta(0.8*24 + 1, 0.2*24 + 1) = Beta(20.2, 5.8); +6 successes.
    expect(updated.probability).toBeCloseTo((20.2 + 6) / (26 + 6), 10);
    expect(updated.sample_size).toBe(24 + 6);
    expect(updated.window).toEqual(W2); // W1 merged with W0
    expect(result.update.calibrated).toBe(true);
    expect(result.previous_sample_size).toBe(24);
    expect(result.added).toEqual({ successes: 6, failures: 0 });
  });

  it('accepts newly attached calibration evidence (the ref is replaced)', () => {
    const estimate = calibratedEdgeEstimate(0.5);
    const newCalibration = 'sos://Evaluation/' + 'e'.repeat(32);
    const result = updateApplicabilityEstimate(estimate, { successes: 1, failures: 1, window: W0 }, {
      calibration_ref: newCalibration,
    });
    expect((result.estimate as { calibration_ref: string }).calibration_ref).toBe(newCalibration);
    expect(result.update.calibration_ref).toBe(newCalibration);
  });
});

describe('updateApplicabilityEstimate — qualitative estimate', () => {
  it('invents NO numeric prior; without new calibration the estimate stays QUALITATIVE with size+window preserved', () => {
    const estimate = {
      kind: 'QUALITATIVE' as const,
      uncertainty_class: 'WEAK' as const,
      context: { deployment: 'edge' },
      sample_size: 5,
      window: W1,
    };
    const result = updateApplicabilityEstimate(estimate, { successes: 3, failures: 1, window: W0 });
    expect(result.estimate.kind).toBe('QUALITATIVE');
    const updated = result.estimate as { kind: 'QUALITATIVE'; sample_size: number; window: unknown };
    expect(updated.sample_size).toBe(5 + 4);
    expect(updated.window).toEqual(W2);
    expect(result.update.calibrated).toBe(false);
    expect(result.update.calibration_ref).toBeNull();
    // The numeric posterior exists in the update record (marked uncalibrated), never in the estimate.
    expect(result.update.posterior.mean).toBeCloseTo((1 + 3) / (2 + 4), 10);
    expect('probability' in result.estimate).toBe(false);
  });

  it('with new calibration evidence, mints a CALIBRATED estimate from the posterior', () => {
    const estimate = {
      kind: 'QUALITATIVE' as const,
      uncertainty_class: 'UNQUANTIFIED' as const,
      context: { deployment: 'edge' },
      sample_size: 2,
      window: null,
    };
    const result = updateApplicabilityEstimate(estimate, { successes: 7, failures: 3, window: W1 }, {
      calibration_ref: CALIBRATION,
    });
    expect(result.estimate.kind).toBe('CALIBRATED');
    const updated = result.estimate as { probability: number; sample_size: number };
    expect(updated.probability).toBeCloseTo((1 + 7) / (2 + 10), 10);
    expect(updated.sample_size).toBe(10);
    expect(result.update.calibrated).toBe(true);
  });
});

describe('dirichletUpdate', () => {
  it('computes the conjugate update over K categories (alphas = prior + counts; means sum to 1)', () => {
    const result = dirichletUpdate([10, 5, 5], 1);
    expect(result.posterior_alphas).toEqual([11, 6, 6]);
    expect(result.means.reduce((sum, mean) => sum + mean, 0)).toBeCloseTo(1, 12);
    expect(result.total_counts).toBe(20);
    expect(result.concentration).toBe(23);
    expect(result.calibrated).toBe(false);
  });

  it('accepts a per-category prior vector and calibration evidence', () => {
    const result = dirichletUpdate([2, 0], [3, 1], { calibration_ref: CALIBRATION });
    expect(result.posterior_alphas).toEqual([5, 1]);
    expect(result.calibrated).toBe(true);
    expect(result.calibration_ref).toBe(CALIBRATION);
    expect(result.means[0]).toBeCloseTo(5 / 6, 12);
  });
});
