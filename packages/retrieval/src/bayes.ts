/**
 * The Bayesian update path (Work Order W7: "a Beta/Dirichlet-style
 * posterior update utility for binary/counts outcomes with sample size +
 * time window preserved"; baseline per docs/probabilistic-learning.md).
 *
 * SEMANTIC DISCIPLINE (docs/probabilistic-learning.md, spec/meta-model.md,
 * spec/architecture.md §12):
 *   - "Probability represents uncertainty; it does not manufacture
 *     certainty" — every posterior carries its sample size (observations)
 *     and its observation time window; a bare mean is never the whole
 *     story (the 90% credible interval rides along);
 *   - "Store: model, evidence set, sample size, context, time window,
 *     calibration status and uncertainty";
 *   - NUMERIC OUTPUTS ARE MARKED UNCALIBRATED unless calibration evidence
 *     is attached: `betaUpdate`/`dirichletUpdate` results carry
 *     `calibrated: false` with a null calibration_ref unless the caller
 *     attaches one; an UNCALIBRATED numeric posterior can never be minted
 *     as a CALIBRATED applicability estimate —
 *     `updateApplicabilityEstimate` on a qualitative estimate without new
 *     calibration evidence yields a QUALITATIVE estimate (sample size and
 *     window preserved, numeric posterior reported separately, marked
 *     uncalibrated);
 *   - the BETA MATH IS DELEGATED to the W6 authority: the posterior shape
 *     (BetaPosterior) and the quantile computation (betaQuantile) come
 *     from @sos-2/packages — with the default Beta(1,1) prior, betaUpdate
 *     is EXACTLY the authority's betaPosterior (property-tested).
 */

import { DEFAULT_BETA_PRIOR, assertValidApplicability, betaQuantile } from '@sos-2/packages';
import type { ApplicabilityEstimate, BetaPosterior } from '@sos-2/packages';
import { assertValidTimeWindow, rfc3339ToEpochMs } from '@sos-2/provenance';
import type { TimeWindow } from '@sos-2/provenance';
import { isArtifactId } from '@sos-2/semantic-spine';
import { RetrievalFacadeError } from './errors.js';

/** A batch of binary outcomes observed in one time window. */
export interface BetaOutcomeBatch {
  /** Observed successes (non-negative integer). */
  successes: number;
  /** Observed failures (non-negative integer). */
  failures: number;
  /** The batch's observation window (required — time is never dropped). */
  window: TimeWindow;
}

/** The result of a Beta update: posterior + preserved size/window + calibration status. */
export interface BetaUpdateResult {
  /** The posterior (alpha/beta, mean, variance, 90% credible interval, observations). */
  posterior: BetaPosterior;
  /** Preserved sample size (== posterior.observations). */
  sample_size: number;
  /** Preserved time window (the batch's window merged with any prior window). */
  window: TimeWindow;
  /** Numeric outputs are UNCALIBRATED unless calibration evidence is attached. */
  calibrated: boolean;
  /** The attached calibration evidence ref, or null. */
  calibration_ref: string | null;
}

/** The result of a Dirichlet update over K outcome categories. */
export interface DirichletUpdateResult {
  /** Posterior concentration per category (prior + counts). */
  posterior_alphas: number[];
  /** Posterior mean per category (sums to 1). */
  means: number[];
  /** Posterior variance per category. */
  variances: number[];
  /** Total observed counts across categories. */
  total_counts: number;
  /** Total posterior concentration (sum of alphas). */
  concentration: number;
  /** Numeric outputs are UNCALIBRATED unless calibration evidence is attached. */
  calibrated: boolean;
  /** The attached calibration evidence ref, or null. */
  calibration_ref: string | null;
}

/** The result of updating an applicability estimate with a batch of outcomes. */
export interface EstimateUpdateResult {
  /** The updated estimate (see updateApplicabilityEstimate for the exact discipline). */
  estimate: ApplicabilityEstimate;
  /** The full numeric update (posterior, size, window, calibration status). */
  update: BetaUpdateResult;
  /** The sample size the original estimate carried. */
  previous_sample_size: number;
  /** The outcome counts added. */
  added: { successes: number; failures: number };
}

function assertValidBatch(batch: BetaOutcomeBatch): void {
  if (typeof batch !== 'object' || batch === null) {
    throw new RetrievalFacadeError(`outcome batch must be an object { successes, failures, window }, received: ${JSON.stringify(batch)}`);
  }
  const record = batch as unknown as Record<string, unknown>;
  if (Object.keys(record).length !== 3 || !('successes' in record) || !('failures' in record) || !('window' in record)) {
    throw new RetrievalFacadeError('outcome batch must have the exact field set { successes, failures, window }');
  }
  for (const field of ['successes', 'failures'] as const) {
    const value = record[field];
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
      throw new RetrievalFacadeError(`outcome batch ${field} must be a non-negative integer, received: ${JSON.stringify(value)}`);
    }
  }
  if ((record['successes'] as number) + (record['failures'] as number) < 1) {
    throw new RetrievalFacadeError('outcome batch requires at least one observed outcome — an empty batch is rejected');
  }
  try {
    assertValidTimeWindow(record['window']);
  } catch (cause) {
    throw new RetrievalFacadeError(`outcome batch window is invalid: ${(cause as Error).message}`);
  }
}

function assertValidPrior(prior: { alpha: number; beta: number }): void {
  if (
    typeof prior !== 'object' ||
    prior === null ||
    !Number.isFinite(prior.alpha) ||
    prior.alpha <= 0 ||
    !Number.isFinite(prior.beta) ||
    prior.beta <= 0
  ) {
    throw new RetrievalFacadeError(
      `prior must have finite alpha > 0 and beta > 0, received: ${JSON.stringify(prior)}`,
    );
  }
}

function assertValidCalibration(calibration: { calibration_ref: string } | undefined): string | null {
  if (calibration === undefined) {
    return null;
  }
  if (
    typeof calibration !== 'object' ||
    calibration === null ||
    Object.keys(calibration).length !== 1 ||
    !isArtifactId(calibration.calibration_ref)
  ) {
    throw new RetrievalFacadeError(
      `calibration evidence must be { calibration_ref } with a well-formed spine artifact id, received: ${JSON.stringify(calibration)}`,
    );
  }
  return calibration.calibration_ref;
}

/** The union of two windows (min start, max end); a null window yields the other side. */
export function mergeWindows(a: TimeWindow | null, b: TimeWindow | null): TimeWindow {
  if (a === null && b === null) {
    throw new RetrievalFacadeError('mergeWindows requires at least one non-null window');
  }
  if (a === null) {
    return { ...b! };
  }
  if (b === null) {
    return { ...a };
  }
  const start = rfc3339ToEpochMs(a.start) <= rfc3339ToEpochMs(b.start) ? a.start : b.start;
  const end = rfc3339ToEpochMs(a.end) >= rfc3339ToEpochMs(b.end) ? a.end : b.end;
  const merged: TimeWindow = { start, end };
  try {
    assertValidTimeWindow(merged);
  } catch (cause) {
    throw new RetrievalFacadeError(`merged window is invalid: ${(cause as Error).message}`);
  }
  return merged;
}

/**
 * The Beta-Binomial conjugate update: posterior = Beta(prior.alpha + s,
 * prior.beta + f). The posterior shape (mean, variance, 90% equal-tailed
 * credible interval) is computed with @sos-2/packages' betaQuantile — the
 * W6 Beta authority (with the default Beta(1,1) prior this is EXACTLY the
 * authority's betaPosterior). Sample size and window are preserved;
 * numeric outputs are marked UNCALIBRATED unless calibration evidence is
 * attached.
 */
export function betaUpdate(
  prior: { alpha: number; beta: number },
  batch: BetaOutcomeBatch,
  calibration?: { calibration_ref: string },
): BetaUpdateResult {
  assertValidPrior(prior);
  assertValidBatch(batch);
  const calibrationRef = assertValidCalibration(calibration);
  const alpha = prior.alpha + batch.successes;
  const beta = prior.beta + batch.failures;
  const posterior = posteriorOf(alpha, beta, batch.successes + batch.failures);
  return {
    posterior,
    sample_size: posterior.observations,
    window: { ...batch.window },
    calibrated: calibrationRef !== null,
    calibration_ref: calibrationRef,
  };
}

function posteriorOf(alpha: number, beta: number, observations: number): BetaPosterior {
  const mean = alpha / (alpha + beta);
  const variance = (alpha * beta) / ((alpha + beta) ** 2 * (alpha + beta + 1));
  const lo = betaQuantile(0.05, alpha, beta);
  const hi = betaQuantile(0.95, alpha, beta);
  return { alpha, beta, mean, variance, credible_interval_p90: [lo, hi], observations };
}

/**
 * The Dirichlet-multinomial conjugate update over K >= 2 outcome
 * categories: posterior alphas = prior + counts; means = alphas /
 * concentration. Deterministic, zero external dependencies. Numeric
 * outputs are marked UNCALIBRATED unless calibration evidence is attached.
 *
 * @param counts  non-negative integer outcome counts per category (K >= 2)
 * @param prior   either a symmetric concentration (> 0, applied to every
 *                category; default 1) or a vector of per-category
 *                concentrations (all > 0, same length as counts)
 */
export function dirichletUpdate(
  counts: readonly number[],
  prior: number | readonly number[] = 1,
  calibration?: { calibration_ref: string },
): DirichletUpdateResult {
  if (!Array.isArray(counts) || counts.length < 2) {
    throw new RetrievalFacadeError(
      `dirichlet update requires counts for at least 2 categories, received: ${JSON.stringify(counts)}`,
    );
  }
  for (const count of counts) {
    if (typeof count !== 'number' || !Number.isInteger(count) || count < 0) {
      throw new RetrievalFacadeError(`dirichlet counts must be non-negative integers, received: ${JSON.stringify(counts)}`);
    }
  }
  let priorVector: number[];
  if (typeof prior === 'number') {
    if (!Number.isFinite(prior) || prior <= 0) {
      throw new RetrievalFacadeError(`symmetric prior concentration must be > 0, received: ${JSON.stringify(prior)}`);
    }
    priorVector = counts.map(() => prior);
  } else {
    if (!Array.isArray(prior) || prior.length !== counts.length) {
      throw new RetrievalFacadeError(
        `prior vector length must match counts length (${counts.length}), received: ${JSON.stringify(prior)}`,
      );
    }
    for (const concentration of prior) {
      if (typeof concentration !== 'number' || !Number.isFinite(concentration) || concentration <= 0) {
        throw new RetrievalFacadeError(`prior concentrations must be finite > 0, received: ${JSON.stringify(prior)}`);
      }
    }
    priorVector = [...prior];
  }
  const calibrationRef = assertValidCalibration(calibration);
  const posteriorAlphas = counts.map((count, index) => priorVector[index]! + count);
  const concentration = posteriorAlphas.reduce((sum, value) => sum + value, 0);
  const means = posteriorAlphas.map((value) => value / concentration);
  const variances = posteriorAlphas.map(
    (value) => (value * (concentration - value)) / (concentration ** 2 * (concentration + 1)),
  );
  const totalCounts = counts.reduce((sum, value) => sum + value, 0);
  return {
    posterior_alphas: posteriorAlphas,
    means,
    variances,
    total_counts: totalCounts,
    concentration,
    calibrated: calibrationRef !== null,
    calibration_ref: calibrationRef,
  };
}

/**
 * Update an applicability estimate with a batch of binary outcomes — the
 * Bayesian learning path for context-conditioned applicability.
 *
 * DISCIPLINE (exact):
 *   - a CALIBRATED estimate (probability p, sample size n) enters as the
 *     prior Beta(p·n + 1, (1−p)·n + 1) — its implied counts over the same
 *     Beta(1,1) baseline the W6 authority uses; the updated estimate is
 *     CALIBRATED (probability = posterior mean, sample size = n + s + f,
 *     window = merged), carrying the ORIGINAL calibration ref (or a newly
 *     attached one);
 *   - a QUALITATIVE estimate contributes NO numeric prior (nothing is
 *     invented from a qualitative class — prior = Beta(1,1)); the updated
 *     estimate is QUALITATIVE (class carried, sample size accumulated,
 *     window merged) UNLESS new calibration evidence is attached, in which
 *     case a CALIBRATED estimate is minted from the posterior;
 *   - an UNCALIBRATED numeric posterior is NEVER minted as a CALIBRATED
 *     estimate — the numeric posterior lives in the result, marked
 *     `calibrated: false`.
 */
export function updateApplicabilityEstimate(
  estimate: ApplicabilityEstimate,
  batch: BetaOutcomeBatch,
  newCalibration?: { calibration_ref: string },
): EstimateUpdateResult {
  try {
    assertValidApplicability(estimate);
  } catch (cause) {
    throw new RetrievalFacadeError(`applicability estimate is invalid: ${(cause as Error).message}`);
  }
  assertValidBatch(batch);
  const attachedCalibrationRef = assertValidCalibration(newCalibration);
  const window = mergeWindows(estimate.window, batch.window);

  if (estimate.kind === 'CALIBRATED') {
    const impliedSuccesses = estimate.probability * estimate.sample_size;
    const impliedFailures = (1 - estimate.probability) * estimate.sample_size;
    const prior = {
      alpha: impliedSuccesses + DEFAULT_BETA_PRIOR.alpha,
      beta: impliedFailures + DEFAULT_BETA_PRIOR.beta,
    };
    const alpha = prior.alpha + batch.successes;
    const beta = prior.beta + batch.failures;
    const observations = batch.successes + batch.failures;
    const posterior = posteriorOf(alpha, beta, observations);
    const calibrationRef = attachedCalibrationRef ?? estimate.calibration_ref;
    const accumulatedSampleSize = estimate.sample_size + batch.successes + batch.failures;
    const updated: ApplicabilityEstimate = {
      kind: 'CALIBRATED',
      probability: posterior.mean,
      calibration_ref: calibrationRef,
      uncertainty_class: estimate.uncertainty_class,
      context: { ...estimate.context },
      sample_size: accumulatedSampleSize,
      window,
    };
    const update: BetaUpdateResult = {
      posterior,
      sample_size: observations,
      window: { ...window },
      calibrated: calibrationRef !== null,
      calibration_ref: calibrationRef,
    };
    return {
      estimate: updated,
      update,
      previous_sample_size: estimate.sample_size,
      added: { successes: batch.successes, failures: batch.failures },
    };
  }

  // QUALITATIVE estimate: no numeric prior is invented (Beta(1,1) baseline).
  const alpha = DEFAULT_BETA_PRIOR.alpha + batch.successes;
  const beta = DEFAULT_BETA_PRIOR.beta + batch.failures;
  const observations = batch.successes + batch.failures;
  const posterior = posteriorOf(alpha, beta, observations);
  const accumulatedSampleSize = estimate.sample_size + batch.successes + batch.failures;
  const updated: ApplicabilityEstimate =
    attachedCalibrationRef === null
      ? {
          kind: 'QUALITATIVE',
          uncertainty_class: estimate.uncertainty_class,
          context: { ...estimate.context },
          sample_size: accumulatedSampleSize,
          window,
        }
      : {
          kind: 'CALIBRATED',
          probability: posterior.mean,
          calibration_ref: attachedCalibrationRef,
          uncertainty_class: estimate.uncertainty_class,
          context: { ...estimate.context },
          sample_size: observations,
          window,
        };
  const update: BetaUpdateResult = {
    posterior,
    sample_size: observations,
    window: { ...window },
    calibrated: attachedCalibrationRef !== null,
    calibration_ref: attachedCalibrationRef,
  };
  return {
    estimate: updated,
    update,
    previous_sample_size: estimate.sample_size,
    added: { successes: batch.successes, failures: batch.failures },
  };
}
