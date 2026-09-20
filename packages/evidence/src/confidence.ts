/**
 * Confidence and calibration discipline (Work Order W3; spec/meta-model.md):
 *
 *   "Numeric confidence is valid only where calibration exists. Otherwise use
 *    a qualitative uncertainty class. Never treat an LLM self-reported
 *    confidence value as calibrated truth."
 *
 * Realization:
 *   - A CALIBRATED confidence is a numeric probability in [0, 1] that MUST
 *     carry `calibration_ref`: a well-formed Semantic Spine artifact id of
 *     the calibration artifact (e.g. an Evaluation). There is NO code path
 *     that mints numeric confidence without one.
 *   - A QUALITATIVE confidence is one of this package's uncertainty classes:
 *     STRONG, MODERATE, WEAK, UNQUANTIFIED. This is the default; it is the
 *     only kind of confidence evidence may carry when no calibration exists.
 *   - LLM-produced evidence (producer.model !== null) can NEVER carry
 *     calibrated numeric confidence — an LLM self-reported confidence value
 *     is never calibrated truth (enforced in record.ts / ingest.ts, pinned by
 *     tests).
 */

import { isArtifactId } from '@sos-2/semantic-spine';
import { EvidenceError } from './errors.js';

/** The qualitative uncertainty classes of this package (frozen vocabulary). */
export const UNCERTAINTY_CLASSES = ['STRONG', 'MODERATE', 'WEAK', 'UNQUANTIFIED'] as const;

export type UncertaintyClass = (typeof UNCERTAINTY_CLASSES)[number];

const UNCERTAINTY_CLASS_SET: ReadonlySet<string> = new Set(UNCERTAINTY_CLASSES);

/** Structural check: is this one of the qualitative uncertainty classes? */
export function isUncertaintyClass(value: unknown): value is UncertaintyClass {
  return typeof value === 'string' && UNCERTAINTY_CLASS_SET.has(value);
}

/** Numeric confidence — valid ONLY together with a calibration artifact ref. */
export interface CalibratedConfidence {
  kind: 'CALIBRATED';
  /** Calibrated probability in [0, 1]. */
  value: number;
  /** Well-formed spine artifact id of the calibration artifact. REQUIRED. */
  calibration_ref: string;
}

/** Qualitative confidence — used whenever calibration does not exist. */
export interface QualitativeConfidence {
  kind: 'QUALITATIVE';
  uncertainty_class: UncertaintyClass;
}

export type Confidence = CalibratedConfidence | QualitativeConfidence;

/** Create a calibrated numeric confidence. Calibration is MANDATORY. */
export function createCalibratedConfidence(value: number, calibrationRef: string): CalibratedConfidence {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new EvidenceError(
      `calibrated confidence value must be a finite number in [0, 1], received: ${JSON.stringify(value)}`,
    );
  }
  if (!isArtifactId(calibrationRef)) {
    throw new EvidenceError(
      `calibrated confidence requires a well-formed calibration artifact id, received: ${JSON.stringify(calibrationRef)} ` +
        '(numeric confidence is valid only where calibration exists)',
    );
  }
  return { kind: 'CALIBRATED', value, calibration_ref: calibrationRef };
}

/** Create a qualitative confidence from an uncertainty class. */
export function createQualitativeConfidence(uncertaintyClass: UncertaintyClass): QualitativeConfidence {
  if (!isUncertaintyClass(uncertaintyClass)) {
    throw new EvidenceError(
      `uncertainty class must be one of ${UNCERTAINTY_CLASSES.join(', ')}, received: ${JSON.stringify(uncertaintyClass)}`,
    );
  }
  return { kind: 'QUALITATIVE', uncertainty_class: uncertaintyClass };
}

/** The default confidence when nothing is known: qualitative UNQUANTIFIED. */
export function unquantifiedConfidence(): QualitativeConfidence {
  return createQualitativeConfidence('UNQUANTIFIED');
}

/** Structural check for a confidence mark. */
export function isConfidence(value: unknown): value is Confidence {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (record['kind'] === 'CALIBRATED') {
    return (
      typeof record['value'] === 'number' &&
      Number.isFinite(record['value']) &&
      record['value'] >= 0 &&
      record['value'] <= 1 &&
      typeof record['calibration_ref'] === 'string' &&
      isArtifactId(record['calibration_ref'])
    );
  }
  if (record['kind'] === 'QUALITATIVE') {
    return isUncertaintyClass(record['uncertainty_class']);
  }
  return false;
}

/** Full validation with a specific error message (throws EvidenceError). */
export function assertValidConfidence(value: unknown): asserts value is Confidence {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new EvidenceError('confidence must be a CALIBRATED or QUALITATIVE mark object');
  }
  const record = value as Record<string, unknown>;
  if (record['kind'] === 'CALIBRATED') {
    if (Object.keys(record).length !== 3 || !('value' in record) || !('calibration_ref' in record)) {
      throw new EvidenceError('calibrated confidence must have the exact field set { kind, value, calibration_ref }');
    }
    if (
      typeof record['value'] !== 'number' ||
      !Number.isFinite(record['value']) ||
      record['value'] < 0 ||
      record['value'] > 1
    ) {
      throw new EvidenceError(
        `calibrated confidence value must be a finite number in [0, 1], received: ${JSON.stringify(record['value'])}`,
      );
    }
    if (!isArtifactId(record['calibration_ref'])) {
      throw new EvidenceError(
        `calibrated confidence requires a well-formed calibration artifact id, received: ${JSON.stringify(record['calibration_ref'])} ` +
          '(numeric confidence is valid only where calibration exists)',
      );
    }
    return;
  }
  if (record['kind'] === 'QUALITATIVE') {
    if (Object.keys(record).length !== 2 || !('uncertainty_class' in record)) {
      throw new EvidenceError('qualitative confidence must have the exact field set { kind, uncertainty_class }');
    }
    if (!isUncertaintyClass(record['uncertainty_class'])) {
      throw new EvidenceError(
        `uncertainty class must be one of ${UNCERTAINTY_CLASSES.join(', ')}, received: ${JSON.stringify(record['uncertainty_class'])}`,
      );
    }
    return;
  }
  throw new EvidenceError(
    `confidence kind must be CALIBRATED or QUALITATIVE, received: ${JSON.stringify(record['kind'])}`,
  );
}

/** Predicate form of assertValidConfidence. */
export function validateConfidence(value: unknown): value is Confidence {
  try {
    assertValidConfidence(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Guard used at evidence creation/ingestion: an LLM producer may never carry
 * calibrated numeric confidence. An LLM self-reported confidence value is
 * never calibrated truth (spec/meta-model.md).
 */
export function assertConfidenceAllowedForProducer(
  confidence: Confidence,
  isLlmProducer: boolean,
): void {
  if (confidence.kind === 'CALIBRATED' && isLlmProducer) {
    throw new EvidenceError(
      'LLM-produced evidence cannot carry calibrated numeric confidence: an LLM self-reported confidence value ' +
        'is never calibrated truth (spec/meta-model.md); use a qualitative uncertainty class',
    );
  }
}
