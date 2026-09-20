/**
 * Beta-posterior baseline for binary package outcomes
 * (docs/probabilistic-learning.md: "For simple binary package outcomes, a
 * Beta posterior can be used as a baseline").
 *
 * Zero external dependencies: the regularized incomplete beta function is
 * computed with the standard continued-fraction expansion (Lentz's modified
 * algorithm, Numerical Recipes §6.4) over the log-gamma Lanczos
 * approximation; equal-tailed credible-interval bounds are recovered by
 * bisection on the (monotone) incomplete beta. All functions are pure and
 * deterministic.
 *
 * SEMANTIC DISCIPLINE (docs/probabilistic-learning.md):
 *   Probability represents uncertainty; it does not manufacture certainty.
 *   A Beta posterior carries sample size and uncertainty by construction —
 *   the mean alone is never the whole story, so `betaPosterior` always
 *   exposes alpha/beta, the posterior variance and a 90% equal-tailed
 *   credible interval. The prior is explicit (default Jeffreys-style
 *   Beta(1,1)); nothing hidden is added.
 */

import { PackageError } from './errors.js';

const LANCZOS_G = 7;
const LANCZOS_COEFFICIENTS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
  -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
  1.5056327351493116e-7,
] as const;

/** Natural log of the Gamma function (Lanczos approximation; x > 0). */
export function logGamma(x: number): number {
  if (x <= 0) {
    throw new PackageError(`logGamma requires x > 0, received: ${JSON.stringify(x)}`);
  }
  if (x < 0.5) {
    // Reflection formula: Gamma(x) * Gamma(1-x) = pi / sin(pi x)
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  }
  const z = x - 1;
  let a = LANCZOS_COEFFICIENTS[0]!;
  const t = z + LANCZOS_G + 0.5;
  for (let i = 1; i < LANCZOS_COEFFICIENTS.length; i += 1) {
    a += LANCZOS_COEFFICIENTS[i]! / (z + i);
  }
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
}

/** log Beta(a, b) function (stable difference of log-gammas). */
function logBetaFn(a: number, b: number): number {
  return logGamma(a) + logGamma(b) - logGamma(a + b);
}

/**
 * Regularized incomplete beta I_x(a, b) — the Beta(a, b) CDF at x.
 * Continued fraction (modified Lentz, Numerical Recipes §6.4); a, b > 0;
 * x in [0, 1]. Deterministic.
 */
export function regularizedIncompleteBeta(x: number, a: number, b: number): number {
  if (a <= 0 || b <= 0) {
    throw new PackageError(`incomplete beta requires a > 0 and b > 0, received: (${a}, ${b})`);
  }
  if (x <= 0) {
    return 0;
  }
  if (x >= 1) {
    return 1;
  }
  // Symmetry: I_x(a, b) = 1 - I_{1-x}(b, a); use the form that converges fast.
  if (x > (a + 1) / (a + b + 2)) {
    return 1 - regularizedIncompleteBeta(1 - x, b, a);
  }
  const logFront = a * Math.log(x) + b * Math.log(1 - x) - logBetaFn(a, b);
  const front = Math.exp(logFront);
  return (front * betacf(a, b, x)) / a;
}

/** The continued fraction I_x(a,b)/(x^a (1-x)^b / Beta(a,b))/a (modified Lentz). */
function betacf(a: number, b: number, x: number): number {
  const tiny = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < tiny) {
    d = tiny;
  }
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 300; m += 1) {
    const twoM = 2 * m;
    // Even step coefficient.
    let aa = (m * (b - m) * x) / ((qam + twoM) * (a + twoM));
    d = 1 + aa * d;
    if (Math.abs(d) < tiny) {
      d = tiny;
    }
    c = 1 + aa / c;
    if (Math.abs(c) < tiny) {
      c = tiny;
    }
    d = 1 / d;
    h *= d * c;
    // Odd step coefficient.
    aa = (-(a + m) * (qab + m) * x) / ((a + twoM) * (a + twoM + 1));
    d = 1 + aa * d;
    if (Math.abs(d) < tiny) {
      d = tiny;
    }
    c = 1 + aa / c;
    if (Math.abs(c) < tiny) {
      c = tiny;
    }
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < 1e-14) {
      break;
    }
  }
  return h;
}

/** Equal-tailed Beta(a, b) quantile at probability p, by bisection. Deterministic. */
export function betaQuantile(p: number, a: number, b: number): number {
  if (!(p >= 0 && p <= 1)) {
    throw new PackageError(`quantile probability must be in [0, 1], received: ${JSON.stringify(p)}`);
  }
  if (a <= 0 || b <= 0) {
    throw new PackageError(`beta quantile requires a > 0 and b > 0, received: (${a}, ${b})`);
  }
  if (p === 0) {
    return 0;
  }
  if (p === 1) {
    return 1;
  }
  // The Beta CDF is strictly increasing on (0, 1); bisection is robust.
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 200; i += 1) {
    const mid = lo + (hi - lo) / 2;
    const cdf = regularizedIncompleteBeta(mid, a, b);
    if (cdf < p) {
      lo = mid;
    } else {
      hi = mid;
    }
    if (hi - lo < 1e-12) {
      break;
    }
  }
  return lo + (hi - lo) / 2;
}

/** Default prior for the binary-outcome baseline: Beta(1, 1) (uniform). */
export const DEFAULT_BETA_PRIOR: Readonly<{ alpha: number; beta: number }> = Object.freeze({ alpha: 1, beta: 1 });

/** A Beta posterior over a binary success probability. */
export interface BetaPosterior {
  /** Posterior alpha = prior alpha + observed successes. */
  alpha: number;
  /** Posterior beta = prior beta + observed failures. */
  beta: number;
  /** Posterior mean = alpha / (alpha + beta). */
  mean: number;
  /** Posterior variance. */
  variance: number;
  /** 90% equal-tailed credible interval [lo, hi]. */
  credible_interval_p90: readonly [number, number];
  /** Number of observations the posterior was updated with. */
  observations: number;
}

/**
 * Beta posterior for binary package outcomes (successes/failures) with an
 * explicit prior (default Beta(1,1)). The result always carries sample size
 * (observations) and uncertainty (variance + 90% credible interval) — a bare
 * mean is never the whole story.
 */
export function betaPosterior(
  successes: number,
  failures: number,
  prior: { alpha: number; beta: number } = DEFAULT_BETA_PRIOR,
): BetaPosterior {
  if (!Number.isInteger(successes) || successes < 0) {
    throw new PackageError(`successes must be a non-negative integer, received: ${JSON.stringify(successes)}`);
  }
  if (!Number.isInteger(failures) || failures < 0) {
    throw new PackageError(`failures must be a non-negative integer, received: ${JSON.stringify(failures)}`);
  }
  if (!Number.isFinite(prior.alpha) || prior.alpha <= 0 || !Number.isFinite(prior.beta) || prior.beta <= 0) {
    throw new PackageError(
      `prior must have finite alpha > 0 and beta > 0, received: ${JSON.stringify(prior)}`,
    );
  }
  const alpha = prior.alpha + successes;
  const beta = prior.beta + failures;
  const mean = alpha / (alpha + beta);
  const variance = (alpha * beta) / ((alpha + beta) ** 2 * (alpha + beta + 1));
  const lo = betaQuantile(0.05, alpha, beta);
  const hi = betaQuantile(0.95, alpha, beta);
  return {
    alpha,
    beta,
    mean,
    variance,
    credible_interval_p90: [lo, hi],
    observations: successes + failures,
  };
}
