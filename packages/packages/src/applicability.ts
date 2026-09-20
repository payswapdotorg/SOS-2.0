/**
 * Applicability — context-conditioned outcome estimates for packages
 * (spec/architecture.md §5, §12; spec/meta-model.md; R26).
 *
 * TWO ESTIMATE KINDS, mirroring the confidence discipline of @sos-2/evidence
 * (whose UncertaintyClass vocabulary is imported — never redefined):
 *
 *   QUALITATIVE (the DEFAULT): an uncertainty class (STRONG, MODERATE, WEAK,
 *   UNQUANTIFIED) conditioned on a non-empty context. Used whenever
 *   calibration does not exist.
 *
 *   CALIBRATED: a numeric probability in [0, 1] that is valid ONLY together
 *   with ALL of (spec/meta-model.md "Numeric confidence is valid only where
 *   calibration exists" + docs/probabilistic-learning.md "Store: model,
 *   evidence set, sample size, context, time window, calibration status and
 *   uncertainty"):
 *     - calibration_ref  a well-formed Semantic Spine artifact id of the
 *                       calibration artifact (e.g. an Evaluation);
 *     - sample_size     integer >= 1 (the evidence set size behind the
 *                       estimate);
 *     - window          the observation time window (non-null;
 *                       @sos-2/provenance TimeWindow);
 *     - context         a non-empty ContextCondition (never a universal
 *                       score).
 *   There is NO code path that mints a numeric applicability probability
 *   without all four — an uncalibrated numeric applicability is rejected
 *   loudly.
 */

import { canonicalSerialize, isArtifactId } from '@sos-2/semantic-spine';
import { isUncertaintyClass, UNCERTAINTY_CLASSES } from '@sos-2/evidence';
import type { UncertaintyClass } from '@sos-2/evidence';
import { assertValidTimeWindow } from '@sos-2/provenance';
import type { TimeWindow } from '@sos-2/provenance';
import { betaPosterior } from './beta.js';
import type { BetaPosterior } from './beta.js';
import { assertValidContextCondition, matchesCondition, sameCondition } from './context.js';
import type { ContextCondition } from './context.js';
import { PackageError } from './errors.js';

/** Qualitative applicability — the default estimate kind. */
export interface QualitativeApplicability {
  kind: 'QUALITATIVE';
  /** Qualitative uncertainty class (vocabulary imported from @sos-2/evidence). */
  uncertainty_class: UncertaintyClass;
  /** Non-empty context condition (never a universal score). */
  context: ContextCondition;
  /** Evidence set size behind the estimate (informational; >= 0). */
  sample_size: number;
  /** Observation time window, or null. */
  window: TimeWindow | null;
}

/** Calibrated numeric applicability — valid ONLY with calibration + sample size + window + context. */
export interface CalibratedApplicability {
  kind: 'CALIBRATED';
  /** Calibrated context-conditioned success probability in [0, 1]. */
  probability: number;
  /** Well-formed spine artifact id of the calibration artifact. REQUIRED. */
  calibration_ref: string;
  /** Qualitative uncertainty class STILL carried (calibration does not erase uncertainty). */
  uncertainty_class: UncertaintyClass;
  /** Non-empty context condition (never a universal score). */
  context: ContextCondition;
  /** Evidence set size behind the estimate. REQUIRED integer >= 1. */
  sample_size: number;
  /** Observation time window. REQUIRED (non-null). */
  window: TimeWindow;
}

export type ApplicabilityEstimate = QualitativeApplicability | CalibratedApplicability;

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/** Validate an applicability estimate (throws PackageError). */
export function assertValidApplicability(value: unknown): asserts value is ApplicabilityEstimate {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new PackageError('applicability estimate must be an object');
  }
  const record = value as Record<string, unknown>;
  const kind = record['kind'];
  if (kind !== 'QUALITATIVE' && kind !== 'CALIBRATED') {
    throw new PackageError(`applicability estimate kind must be QUALITATIVE or CALIBRATED, received: ${JSON.stringify(kind)}`);
  }
  if (!isUncertaintyClass(record['uncertainty_class'])) {
    throw new PackageError(
      `uncertainty_class must be one of ${UNCERTAINTY_CLASSES.join(', ')} (imported from @sos-2/evidence), received: ${JSON.stringify(record['uncertainty_class'])}`,
    );
  }
  assertValidContextCondition(record['context'], 'applicability estimate context');
  const sampleSize = record['sample_size'];
  if (!isNonNegativeInteger(sampleSize)) {
    throw new PackageError(`applicability sample_size must be a non-negative integer, received: ${JSON.stringify(sampleSize)}`);
  }
  if (kind === 'QUALITATIVE') {
    const window = record['window'];
    if (window !== null) {
      try {
        assertValidTimeWindow(window);
      } catch (cause) {
        throw new PackageError(`qualitative applicability window is invalid: ${(cause as Error).message}`);
      }
    }
    return;
  }
  // CALIBRATED — the four mandatory companions of a numeric probability.
  const probability = record['probability'];
  if (typeof probability !== 'number' || !Number.isFinite(probability) || probability < 0 || probability > 1) {
    throw new PackageError(
      `calibrated applicability probability must be a finite number in [0, 1], received: ${JSON.stringify(probability)}`,
    );
  }
  if (!isArtifactId(record['calibration_ref'])) {
    throw new PackageError(
      `calibrated applicability requires a well-formed calibration artifact id, received: ${JSON.stringify(record['calibration_ref'])} ` +
        '(numeric applicability is valid only where calibration exists)',
    );
  }
  if (!Number.isInteger(sampleSize) || sampleSize < 1) {
    throw new PackageError(
      `calibrated applicability requires sample_size >= 1, received: ${JSON.stringify(sampleSize)} ` +
        '(numeric applicability must carry its evidence set size)',
    );
  }
  const window = record['window'];
  if (window === null || window === undefined) {
    throw new PackageError(
      'calibrated applicability requires a non-null observation time window ' +
        '(numeric applicability must carry its time window)',
    );
  }
  try {
    assertValidTimeWindow(window);
  } catch (cause) {
    throw new PackageError(`calibrated applicability window is invalid: ${(cause as Error).message}`);
  }
}

/** Predicate form of assertValidApplicability. */
export function isValidApplicability(value: unknown): value is ApplicabilityEstimate {
  try {
    assertValidApplicability(value);
    return true;
  } catch {
    return false;
  }
}

/** Create a qualitative (default) applicability estimate. */
export function createQualitativeApplicability(input: {
  uncertainty_class: UncertaintyClass;
  context: ContextCondition;
  sample_size?: number;
  window?: TimeWindow | null;
}): QualitativeApplicability {
  const estimate: QualitativeApplicability = {
    kind: 'QUALITATIVE',
    uncertainty_class: input.uncertainty_class,
    context: { ...input.context },
    sample_size: input.sample_size ?? 0,
    window: input.window ?? null,
  };
  assertValidApplicability(estimate);
  return estimate;
}

/**
 * Create a calibrated numeric applicability estimate. Calibration ref,
 * sample size >= 1, time window and non-empty context are ALL mandatory —
 * the uncalibrated-numeric path does not exist.
 */
export function createCalibratedApplicability(input: {
  probability: number;
  calibration_ref: string;
  uncertainty_class: UncertaintyClass;
  context: ContextCondition;
  sample_size: number;
  window: TimeWindow;
}): CalibratedApplicability {
  const estimate: CalibratedApplicability = {
    kind: 'CALIBRATED',
    probability: input.probability,
    calibration_ref: input.calibration_ref,
    uncertainty_class: input.uncertainty_class,
    context: { ...input.context },
    sample_size: input.sample_size,
    window: input.window,
  };
  assertValidApplicability(estimate);
  return estimate;
}

/**
 * Calibrated applicability from binary outcomes via the Beta-posterior
 * baseline (docs/probabilistic-learning.md): probability = posterior mean,
 * sample_size = successes + failures. The posterior (with its credible
 * interval) is returned alongside — uncertainty is never hidden behind the
 * mean. Requires at least one observation.
 */
export function calibratedApplicabilityFromOutcomes(input: {
  successes: number;
  failures: number;
  calibration_ref: string;
  uncertainty_class: UncertaintyClass;
  context: ContextCondition;
  window: TimeWindow;
  prior?: { alpha: number; beta: number };
}): { estimate: CalibratedApplicability; posterior: BetaPosterior } {
  const posterior = betaPosterior(input.successes, input.failures, input.prior);
  if (posterior.observations < 1) {
    throw new PackageError(
      'calibrated applicability requires at least one observed outcome — an evidence-free probability is never minted',
    );
  }
  const estimate = createCalibratedApplicability({
    probability: posterior.mean,
    calibration_ref: input.calibration_ref,
    uncertainty_class: input.uncertainty_class,
    context: input.context,
    sample_size: posterior.observations,
    window: input.window,
  });
  return { estimate, posterior };
}

/**
 * The numeric probability of an estimate, or undefined for qualitative
 * estimates (distinct from 0 — never conflate "no calibrated number" with a
 * numeric value).
 */
export function calibratedProbability(estimate: ApplicabilityEstimate): number | undefined {
  return estimate.kind === 'CALIBRATED' ? estimate.probability : undefined;
}

/** Does the estimate's condition match (is a sub-map of) the query context? */
export function estimateMatchesContext(estimate: ApplicabilityEstimate, query: ContextCondition): boolean {
  return matchesCondition(estimate.context, query);
}

/**
 * Select the best estimate for a query context, deterministically:
 * matching estimates only; most specific first (most conditioned keys);
 * then CALIBRATED before QUALITATIVE; then strongest uncertainty class
 * (STRONG > MODERATE > WEAK > UNQUANTIFIED); then canonical order.
 */
export function bestEstimateForContext(
  estimates: readonly ApplicabilityEstimate[],
  query: ContextCondition,
): ApplicabilityEstimate | null {
  const matching = estimates.filter((estimate) => estimateMatchesContext(estimate, query));
  if (matching.length === 0) {
    return null;
  }
  const classRank: Record<UncertaintyClass, number> = { STRONG: 0, MODERATE: 1, WEAK: 2, UNQUANTIFIED: 3 };
  const sorted = [...matching].sort((a, b) => {
    const specificityDelta = Object.keys(b.context).length - Object.keys(a.context).length;
    if (specificityDelta !== 0) {
      return specificityDelta;
    }
    if (a.kind !== b.kind) {
      return a.kind === 'CALIBRATED' ? -1 : 1;
    }
    const classDelta = classRank[a.uncertainty_class] - classRank[b.uncertainty_class];
    if (classDelta !== 0) {
      return classDelta;
    }
    return canonicalEstimateText(a) < canonicalEstimateText(b) ? -1 : 1;
  });
  return sorted[0] ?? null;
}

/** Canonical text of an estimate (spine canonical serialization; deterministic). */
export function canonicalEstimateText(estimate: ApplicabilityEstimate): string {
  return canonicalSerialize(estimate);
}

/**
 * Validate a set of estimates on one artifact: at least one estimate
 * (packages without applicability are rejected — ARCHITECT_START_HERE),
 * and no CONFLICTING estimates for the SAME context condition:
 *   - two CALIBRATED estimates for the same context (two different
 *     calibrated numbers for one context are conflicting measurements);
 *   - two QUALITATIVE estimates for the same context with different
 *     uncertainty classes.
 * A CALIBRATED + QUALITATIVE pair for the same context is ALLOWED — that is
 * the natural refinement flow (a qualitative estimate recorded at FORMING,
 * a calibrated estimate recorded once calibration exists; the calibrated
 * estimate dominates deterministic best-estimate selection).
 */
export function assertValidApplicabilitySet(estimates: readonly unknown[]): asserts estimates is ApplicabilityEstimate[] {
  if (!Array.isArray(estimates) || estimates.length === 0) {
    throw new PackageError(
      'at least one applicability estimate is required — packages without applicability are rejected',
    );
  }
  for (const estimate of estimates) {
    assertValidApplicability(estimate);
  }
  for (let i = 0; i < estimates.length; i += 1) {
    for (let j = i + 1; j < estimates.length; j += 1) {
      const a = estimates[i] as ApplicabilityEstimate;
      const b = estimates[j] as ApplicabilityEstimate;
      if (!sameCondition(a.context, b.context)) {
        continue;
      }
      if (a.kind === 'CALIBRATED' && b.kind === 'CALIBRATED') {
        throw new PackageError(
          'two CALIBRATED applicability estimates condition on the same context — conflicting calibrated ' +
            'measurements for one context are rejected; keep exactly one',
        );
      }
      if (
        a.kind === 'QUALITATIVE' &&
        b.kind === 'QUALITATIVE' &&
        a.uncertainty_class !== b.uncertainty_class
      ) {
        throw new PackageError(
          'two QUALITATIVE applicability estimates condition on the same context with different uncertainty ' +
            'classes — conflicting estimates for an identical context are rejected; refine the context conditions instead',
        );
      }
    }
  }
}
