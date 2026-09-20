/**
 * The search candidate (Work Order W7; requirement R11 "Multiple candidate
 * states").
 *
 * A SearchCandidate is the evaluation-ready projection of a retrieval
 * candidate (or a generated pattern/novel/synthesis candidate) carrying:
 *   - the typed §10 ALTITUDE (imported from @sos-2/registry through
 *     @sos-2/retrieval — never redefined);
 *   - the declared DIVERSITY family and dimension stances (verbatim);
 *   - ESTIMATED MEASURES on constraint axes — PREDICTIONS supplied with the
 *     candidate (caller- or generator-supplied), never evaluation results;
 *   - the candidate's UNCERTAINTY, MANDATORY and preserved end-to-end:
 *     the qualitative class, the sample size, the context-match basis, and
 *     the calibrated probability (with sample size, window and calibration
 *     ref) when the best estimate is calibrated — a candidate without
 *     uncertainty is rejected loudly (never stripped).
 */

import type { TimeWindow } from '@sos-2/provenance';
import { isUncertaintyClass } from '@sos-2/evidence';
import type { UncertaintyClass } from '@sos-2/evidence';
import { isArtifactId } from '@sos-2/semantic-spine';
import type { DiversityDimensionStance } from '@sos-2/packages';
import { RETRIEVAL_ALTITUDES } from '@sos-2/retrieval';
import type { ContextCandidate, RetrievalAltitude } from '@sos-2/retrieval';
import { SearchError } from './errors.js';

/** Where a candidate came from (the §10 ladder rungs below the registry's). */
export type CandidateOrigin =
  | 'REGISTRY'
  | 'ARCHITECTURE_PATTERN'
  | 'NOVEL_ARCHITECTURE'
  | 'LOW_LEVEL_SYNTHESIS';

/** The mandatory uncertainty of a search candidate (never stripped). */
export interface SearchUncertainty {
  /** Qualitative uncertainty class (vocabulary from @sos-2/evidence). */
  uncertainty_class: UncertaintyClass;
  /** Evidence-set size behind the best estimate (integer >= 0). */
  sample_size: number;
  /** How the uncertainty was determined (distinct bases never conflated). */
  context_match: 'MATCHED' | 'UNMATCHED' | 'NO_QUERY_CONTEXT';
  /** Present iff the best matching estimate is calibrated (§12 discipline). */
  calibrated?: {
    probability: number;
    sample_size: number;
    window: TimeWindow | null;
    calibration_ref: string;
  };
}

/** A candidate for evolution search. */
export interface SearchCandidate {
  /** Candidate id (non-empty; the spine id for registry candidates). */
  id: string;
  /** The semantic capability this candidate addresses. */
  capability: string;
  /** The typed §10 altitude (imported vocabulary). */
  altitude: RetrievalAltitude;
  /** Where the candidate came from. */
  origin: CandidateOrigin;
  /** Declared solution family (diversity grouping). */
  family: string;
  /** Declared behavioral dimension stances (verbatim). */
  dimensions: DiversityDimensionStance[];
  /** Estimated measures on constraint axes (predictions, NOT evaluation results). */
  estimates: Record<string, number>;
  /** The candidate's uncertainty (mandatory, preserved end-to-end). */
  uncertainty: SearchUncertainty;
  /** The full retrieval view when origin === 'REGISTRY' (verbatim). */
  retrieval?: ContextCandidate;
}

/**
 * Project a retrieval (registry) candidate into a search candidate,
 * preserving the uncertainty view VERBATIM (class, basis, sample size and
 * the calibrated probability with all its §12 companions).
 */
export function searchCandidateFromContext(candidate: ContextCandidate): SearchCandidate {
  // Sample size: the best matching estimate's; else the first estimate's
  // (the registry's no-context view); else honestly 0. Never invented.
  const sampleSize =
    candidate.best_estimate?.sample_size ?? candidate.applicability[0]?.sample_size ?? 0;
  const uncertainty: SearchUncertainty = {
    uncertainty_class: candidate.uncertainty.uncertainty_class,
    sample_size: sampleSize,
    context_match: candidate.retrieval.context_match,
  };
  if (candidate.uncertainty.probability !== undefined) {
    uncertainty.calibrated = {
      probability: candidate.uncertainty.probability.value,
      sample_size: candidate.uncertainty.probability.sample_size,
      window: candidate.uncertainty.probability.window,
      calibration_ref: candidate.uncertainty.probability.calibration_ref,
    };
  }
  return {
    id: candidate.id,
    capability: candidate.semantic_capability,
    altitude: candidate.altitude,
    origin: 'REGISTRY',
    family: candidate.family,
    dimensions: candidate.dimensions.map((stance) => ({ ...stance })),
    estimates: {},
    uncertainty,
    retrieval: candidate,
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Validate a search candidate (throws SearchError). */
export function assertValidSearchCandidate(value: unknown): asserts value is SearchCandidate {
  if (!isPlainObject(value)) {
    throw new SearchError(`search candidate must be an object, received: ${JSON.stringify(value)}`);
  }
  const record = value as Record<string, unknown>;
  const hasRetrieval = 'retrieval' in record;
  const baseKeys = ['id', 'capability', 'altitude', 'origin', 'family', 'dimensions', 'estimates', 'uncertainty'];
  const expectedKeys = hasRetrieval ? [...baseKeys, 'retrieval'] : baseKeys;
  const keys = Object.keys(record);
  if (keys.length !== expectedKeys.length || !expectedKeys.every((key) => keys.includes(key))) {
    throw new SearchError(
      `search candidate must have the exact field set { ${baseKeys.join(', ')} [, retrieval] }`,
    );
  }
  if (typeof record['id'] !== 'string' || record['id'].length === 0) {
    throw new SearchError(`search candidate id must be a non-empty string, received: ${JSON.stringify(record['id'])}`);
  }
  if (typeof record['capability'] !== 'string' || record['capability'].length === 0) {
    throw new SearchError(`search candidate ${JSON.stringify(record['id'])} capability must be a non-empty string`);
  }
  if (typeof record['altitude'] !== 'string' || !isRetrievalAltitude(record['altitude'])) {
    throw new SearchError(
      `search candidate ${JSON.stringify(record['id'])} altitude must be a §10 retrieval altitude, received: ${JSON.stringify(record['altitude'])}`,
    );
  }
  const origin = record['origin'];
  if (
    origin !== 'REGISTRY' &&
    origin !== 'ARCHITECTURE_PATTERN' &&
    origin !== 'NOVEL_ARCHITECTURE' &&
    origin !== 'LOW_LEVEL_SYNTHESIS'
  ) {
    throw new SearchError(`search candidate ${JSON.stringify(record['id'])} origin is invalid: ${JSON.stringify(origin)}`);
  }
  if (typeof record['family'] !== 'string' || record['family'].length === 0) {
    throw new SearchError(`search candidate ${JSON.stringify(record['id'])} family must be a non-empty string`);
  }
  if (!Array.isArray(record['dimensions'])) {
    throw new SearchError(`search candidate ${JSON.stringify(record['id'])} dimensions must be an array`);
  }
  if (!isPlainObject(record['estimates'])) {
    throw new SearchError(`search candidate ${JSON.stringify(record['id'])} estimates must be an object of axis -> finite number`);
  }
  for (const [axis, estimate] of Object.entries(record['estimates'])) {
    if (axis.length === 0 || typeof estimate !== 'number' || !Number.isFinite(estimate)) {
      throw new SearchError(
        `search candidate ${JSON.stringify(record['id'])} estimates must map non-empty axes to finite numbers, received ${JSON.stringify(estimate)} on ${JSON.stringify(axis)}`,
      );
    }
  }
  const uncertainty = record['uncertainty'];
  if (!isPlainObject(uncertainty)) {
    throw new SearchError(
      `search candidate ${JSON.stringify(record['id'])} must carry uncertainty — a candidate without uncertainty is rejected (uncertainty is preserved end-to-end)`,
    );
  }
  const uncertaintyKeys = Object.keys(uncertainty);
  const hasCalibrated = 'calibrated' in uncertainty;
  const expectedUncertaintyKeys = hasCalibrated ? 4 : 3;
  if (uncertaintyKeys.length !== expectedUncertaintyKeys) {
    throw new SearchError(
      `search candidate ${JSON.stringify(record['id'])} uncertainty must have the exact field set { uncertainty_class, sample_size, context_match [, calibrated] }`,
    );
  }
  if (typeof uncertainty['uncertainty_class'] !== 'string' || !isUncertaintyClass(uncertainty['uncertainty_class'])) {
    throw new SearchError(
      `search candidate ${JSON.stringify(record['id'])} uncertainty_class must be one of STRONG, MODERATE, WEAK, UNQUANTIFIED, received: ${JSON.stringify(uncertainty['uncertainty_class'])}`,
    );
  }
  if (typeof uncertainty['sample_size'] !== 'number' || !Number.isInteger(uncertainty['sample_size']) || uncertainty['sample_size'] < 0) {
    throw new SearchError(
      `search candidate ${JSON.stringify(record['id'])} uncertainty sample_size must be a non-negative integer, received: ${JSON.stringify(uncertainty['sample_size'])}`,
    );
  }
  if (
    uncertainty['context_match'] !== 'MATCHED' &&
    uncertainty['context_match'] !== 'UNMATCHED' &&
    uncertainty['context_match'] !== 'NO_QUERY_CONTEXT'
  ) {
    throw new SearchError(
      `search candidate ${JSON.stringify(record['id'])} uncertainty context_match must be MATCHED, UNMATCHED or NO_QUERY_CONTEXT, received: ${JSON.stringify(uncertainty['context_match'])}`,
    );
  }
  if (hasCalibrated) {
    const calibrated = uncertainty['calibrated'];
    if (!isPlainObject(calibrated) || Object.keys(calibrated).length !== 4) {
      throw new SearchError(
        `search candidate ${JSON.stringify(record['id'])} calibrated uncertainty must be { probability, sample_size, window, calibration_ref }`,
      );
    }
    if (
      typeof calibrated['probability'] !== 'number' ||
      !Number.isFinite(calibrated['probability']) ||
      calibrated['probability'] < 0 ||
      calibrated['probability'] > 1
    ) {
      throw new SearchError(
        `search candidate ${JSON.stringify(record['id'])} calibrated probability must be a finite number in [0, 1]`,
      );
    }
    if (typeof calibrated['sample_size'] !== 'number' || !Number.isInteger(calibrated['sample_size']) || calibrated['sample_size'] < 1) {
      throw new SearchError(
        `search candidate ${JSON.stringify(record['id'])} calibrated sample_size must be an integer >= 1`,
      );
    }
    if (typeof calibrated['calibration_ref'] !== 'string' || !isSpineArtifactId(calibrated['calibration_ref'])) {
      throw new SearchError(
        `search candidate ${JSON.stringify(record['id'])} calibrated uncertainty requires a well-formed spine calibration ref (numeric probability only where calibration exists)`,
      );
    }
  }
  if (hasRetrieval && record['retrieval'] === undefined) {
    throw new SearchError(`search candidate ${JSON.stringify(record['id'])} retrieval field must be a ContextCandidate when present`);
  }
}

// The vocabulary guards are IMPORTED (never duplicated): the §10 altitude
// ladder comes from @sos-2/registry (through @sos-2/retrieval), the
// uncertainty-class vocabulary from @sos-2/evidence, spine id checking from
// @sos-2/semantic-spine.
function isRetrievalAltitude(value: string): boolean {
  return (RETRIEVAL_ALTITUDES as readonly string[]).includes(value);
}

function isSpineArtifactId(value: string): boolean {
  return isArtifactId(value);
}
