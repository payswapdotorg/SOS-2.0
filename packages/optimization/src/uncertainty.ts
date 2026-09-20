/**
 * Carried uncertainty — the §12 discipline of "uncertainty preserved
 * end-to-end" (Work Order W7 brief: "candidates carry their applicability
 * estimates + sample sizes + qualitative uncertainty through evaluation;
 * results never collapse to point scores alone").
 *
 * EVERY candidate entering Pareto evaluation or the Quality-Diversity
 * repertoire MUST carry one of these. There is no code path that admits an
 * uncertainty-stripped candidate — a candidate without a payload is
 * rejected loudly (negative-tested), and a numeric probability without its
 * calibration ref is rejected with it (spec/meta-model.md: "Numeric
 * confidence is valid only where calibration exists"; mirrors the
 * calibrated-applicability discipline of @sos-2/packages).
 *
 * The vocabulary is IMPORTED, never redefined: UncertaintyClass comes from
 * @sos-2/evidence (re-exported by @sos-2/packages); spine id checking comes
 * from @sos-2/semantic-spine (calibration refs are well-formed spine
 * artifact ids, exactly as in @sos-2/packages applicability estimates).
 */

import { isArtifactId } from '@sos-2/semantic-spine';
import { isUncertaintyClass, UNCERTAINTY_CLASSES } from '@sos-2/evidence';
import type { UncertaintyClass } from '@sos-2/evidence';
import { OptimizationError } from './errors.js';

/** The uncertainty a candidate carries through evaluation (never stripped). */
export interface CarriedUncertainty {
  /** Qualitative uncertainty class (vocabulary from @sos-2/evidence). */
  uncertainty_class: UncertaintyClass;
  /** Evidence-set size behind the estimate (integer >= 0). */
  sample_size: number;
  /**
   * Calibrated success probability in [0, 1]. Valid ONLY together with
   * `calibration_ref` — an uncalibrated numeric probability is rejected.
   */
  calibrated_probability?: number;
  /** Well-formed spine artifact id of the calibration evidence. REQUIRED with calibrated_probability. */
  calibration_ref?: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Validate a carried-uncertainty payload (throws OptimizationError). */
export function assertValidCarriedUncertainty(value: unknown): asserts value is CarriedUncertainty {
  if (!isPlainObject(value)) {
    throw new OptimizationError(`carried uncertainty must be an object, received: ${JSON.stringify(value)}`);
  }
  const record = value as Record<string, unknown>;
  const allowedKeys = new Set(['uncertainty_class', 'sample_size', 'calibrated_probability', 'calibration_ref']);
  const keys = Object.keys(record);
  if (keys.some((key) => !allowedKeys.has(key))) {
    throw new OptimizationError(
      'carried uncertainty must have the exact field set { uncertainty_class, sample_size ' +
        '[, calibrated_probability, calibration_ref] } — uncertainty is never stripped from candidates',
    );
  }
  const hasProbability = 'calibrated_probability' in record;
  const hasCalibrationRef = 'calibration_ref' in record;
  if (!isUncertaintyClass(record['uncertainty_class'])) {
    throw new OptimizationError(
      `uncertainty_class must be one of ${UNCERTAINTY_CLASSES.join(', ')} (imported from @sos-2/evidence), ` +
        `received: ${JSON.stringify(record['uncertainty_class'])}`,
    );
  }
  const sampleSize = record['sample_size'];
  if (typeof sampleSize !== 'number' || !Number.isInteger(sampleSize) || sampleSize < 0) {
    throw new OptimizationError(
      `carried uncertainty sample_size must be a non-negative integer, received: ${JSON.stringify(sampleSize)}`,
    );
  }
  if (!hasProbability && !hasCalibrationRef) {
    return;
  }
  if (hasProbability !== hasCalibrationRef) {
    throw new OptimizationError(
      'calibrated_probability and calibration_ref must be supplied together — a numeric probability is valid ' +
        'only where calibration exists (spec/meta-model.md; spec/architecture.md §12)',
    );
  }
  const probability = record['calibrated_probability'];
  if (typeof probability !== 'number' || !Number.isFinite(probability) || probability < 0 || probability > 1) {
    throw new OptimizationError(
      `calibrated_probability must be a finite number in [0, 1], received: ${JSON.stringify(probability)}`,
    );
  }
  if (!isArtifactId(record['calibration_ref'])) {
    throw new OptimizationError(
      `calibration_ref must be a well-formed spine artifact id, received: ${JSON.stringify(record['calibration_ref'])}`,
    );
  }
}

/** Predicate form of assertValidCarriedUncertainty. */
export function isValidCarriedUncertainty(value: unknown): value is CarriedUncertainty {
  try {
    assertValidCarriedUncertainty(value);
    return true;
  } catch {
    return false;
  }
}
