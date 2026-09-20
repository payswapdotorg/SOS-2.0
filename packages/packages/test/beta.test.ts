import { describe, expect, it } from 'vitest';
import {
  betaPosterior,
  betaQuantile,
  DEFAULT_BETA_PRIOR,
  logGamma,
  regularizedIncompleteBeta,
} from '../src/index.js';

describe('beta math (deterministic, zero dependencies)', () => {
  it('logGamma matches known values', () => {
    expect(logGamma(1)).toBeCloseTo(0, 12);
    expect(logGamma(2)).toBeCloseTo(0, 12);
    expect(logGamma(6)).toBeCloseTo(Math.log(120), 12); // 5! = 120
    expect(logGamma(0.5)).toBeCloseTo(0.5 * Math.log(Math.PI), 12);
  });

  it('regularizedIncompleteBeta is the Beta CDF: I_x(1,1) = x (uniform)', () => {
    for (const x of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
      expect(regularizedIncompleteBeta(x, 1, 1)).toBeCloseTo(x, 12);
    }
  });

  it('regularizedIncompleteBeta at symmetric points: I_0.5(2,2) = 0.5', () => {
    expect(regularizedIncompleteBeta(0.5, 2, 2)).toBeCloseTo(0.5, 12);
    expect(regularizedIncompleteBeta(0.5, 5, 5)).toBeCloseTo(0.5, 12);
    // Symmetry: I_x(a, b) = 1 - I_{1-x}(b, a)
    const x = 0.3;
    const direct = regularizedIncompleteBeta(x, 2, 5);
    const mirrored = 1 - regularizedIncompleteBeta(1 - x, 5, 2);
    expect(direct).toBeCloseTo(mirrored, 12);
  });

  it('betaQuantile inverts the CDF and is symmetric for symmetric parameters', () => {
    expect(betaQuantile(0.5, 5, 5)).toBeCloseTo(0.5, 10);
    expect(betaQuantile(0.5, 1, 1)).toBeCloseTo(0.5, 10);
    // Known Beta(2,1) CDF: F(x) = x^2 => quantile(0.25) = 0.5
    expect(betaQuantile(0.25, 2, 1)).toBeCloseTo(0.5, 10);
    // Known Beta(1,2) CDF: F(x) = 2x - x^2 => quantile(0.5) = 1 - sqrt(0.5)
    expect(betaQuantile(0.5, 1, 2)).toBeCloseTo(1 - Math.sqrt(0.5), 10);
    for (const p of [0.05, 0.25, 0.5, 0.75, 0.95]) {
      const q = betaQuantile(p, 9, 3);
      expect(regularizedIncompleteBeta(q, 9, 3)).toBeCloseTo(p, 8);
    }
  });

  it('betaQuantile is monotone in p', () => {
    let previous = -Infinity;
    for (const p of [0.01, 0.1, 0.25, 0.5, 0.75, 0.9, 0.99]) {
      const q = betaQuantile(p, 3.5, 7.25);
      expect(q).toBeGreaterThan(previous);
      previous = q;
    }
  });

  it('betaPosterior carries mean, variance, credible interval and observations', () => {
    const posterior = betaPosterior(8, 2);
    // Beta(9, 3): mean 9/12 = 0.75
    expect(posterior.alpha).toBe(9);
    expect(posterior.beta).toBe(3);
    expect(posterior.observations).toBe(10);
    expect(posterior.mean).toBeCloseTo(0.75, 12);
    // Variance = ab / ((a+b)^2 (a+b+1)) = 27 / (144 * 13)
    expect(posterior.variance).toBeCloseTo(27 / (144 * 13), 12);
    const [lo, hi] = posterior.credible_interval_p90;
    expect(lo).toBeLessThan(0.75);
    expect(hi).toBeGreaterThan(0.75);
    expect(hi - lo).toBeGreaterThan(0);
    // Equal-tailed 90%: 5% mass below lo, 5% above hi
    expect(regularizedIncompleteBeta(lo, 9, 3)).toBeCloseTo(0.05, 6);
    expect(regularizedIncompleteBeta(hi, 9, 3)).toBeCloseTo(0.95, 6);
  });

  it('betaPosterior with a custom prior applies the prior exactly', () => {
    const posterior = betaPosterior(0, 0, { alpha: 2, beta: 5 });
    expect(posterior.alpha).toBe(2);
    expect(posterior.beta).toBe(5);
    expect(posterior.observations).toBe(0);
    expect(posterior.mean).toBeCloseTo(2 / 7, 12);
  });

  it('the default prior is the uniform Beta(1,1)', () => {
    expect(DEFAULT_BETA_PRIOR.alpha).toBe(1);
    expect(DEFAULT_BETA_PRIOR.beta).toBe(1);
    const posterior = betaPosterior(1, 0);
    expect(posterior.alpha).toBe(2);
    expect(posterior.beta).toBe(1);
  });

  it('rejects negative and non-integer observation counts and bad priors', () => {
    expect(() => betaPosterior(-1, 0)).toThrow(/successes/);
    expect(() => betaPosterior(0.5, 0)).toThrow(/successes/);
    expect(() => betaPosterior(0, -2)).toThrow(/failures/);
    expect(() => betaPosterior(0, 0, { alpha: 0, beta: 1 })).toThrow(/prior/);
    expect(() => betaPosterior(0, 0, { alpha: 1, beta: Number.POSITIVE_INFINITY })).toThrow(/prior/);
    expect(() => betaQuantile(1.5, 1, 1)).toThrow(/probability/);
    expect(() => regularizedIncompleteBeta(0.5, 0, 1)).toThrow(/a > 0/);
    expect(() => logGamma(0)).toThrow(/x > 0/);
  });
});
