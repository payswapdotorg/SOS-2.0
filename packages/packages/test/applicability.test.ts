import { describe, expect, it } from 'vitest';
import {
  assertValidApplicability,
  bestEstimateForContext,
  calibratedApplicabilityFromOutcomes,
  calibratedProbability,
  createCalibratedApplicability,
  createQualitativeApplicability,
  estimateMatchesContext,
  isValidApplicability,
  matchesCondition,
  sameCondition,
  contextSpecificity,
  assertValidApplicabilitySet,
} from '../src/index.js';
import type { ApplicabilityEstimate } from '../src/index.js';
import { CALIBRATION, SUBJECT_R1, W0, W1, makeEvidence } from './helpers.js';

const CONTEXT_PROD = { environment: 'production', region: 'eu' };
const CONTEXT_PROD_US = { environment: 'production', region: 'us' };
const CONTEXT_CANARY = { environment: 'canary' };

describe('applicability estimates (positive)', () => {
  it('qualitative estimates are the default and carry the uncertainty class + context', () => {
    const estimate = createQualitativeApplicability({
      uncertainty_class: 'WEAK',
      context: CONTEXT_PROD,
      sample_size: 3,
      window: W0,
    });
    expect(estimate.kind).toBe('QUALITATIVE');
    expect(estimate.uncertainty_class).toBe('WEAK');
    expect(estimate.context).toEqual(CONTEXT_PROD);
    expect(isValidApplicability(estimate)).toBe(true);
    expect(calibratedProbability(estimate)).toBeUndefined();
  });

  it('calibrated estimates carry probability + calibration ref + sample size + window + context', () => {
    const estimate = createCalibratedApplicability({
      probability: 0.83,
      calibration_ref: CALIBRATION,
      uncertainty_class: 'MODERATE',
      context: CONTEXT_PROD,
      sample_size: 42,
      window: W0,
    });
    expect(estimate.kind).toBe('CALIBRATED');
    expect(estimate.probability).toBeCloseTo(0.83);
    expect(estimate.calibration_ref).toBe(CALIBRATION);
    expect(estimate.sample_size).toBe(42);
    expect(estimate.window).toEqual(W0);
    expect(calibratedProbability(estimate)).toBeCloseTo(0.83);
  });

  it('calibratedApplicabilityFromOutcomes uses the Beta-posterior mean with honest sample size', () => {
    const { estimate, posterior } = calibratedApplicabilityFromOutcomes({
      successes: 8,
      failures: 2,
      calibration_ref: CALIBRATION,
      uncertainty_class: 'MODERATE',
      context: CONTEXT_PROD,
      window: W1,
    });
    expect(estimate.probability).toBeCloseTo(posterior.mean, 15);
    expect(estimate.probability).toBeCloseTo(0.75, 12);
    expect(estimate.sample_size).toBe(10);
    expect(posterior.credible_interval_p90[0]).toBeLessThan(0.75);
    expect(posterior.credible_interval_p90[1]).toBeGreaterThan(0.75);
  });

  it('context matching is sub-map (estimate context keys must all match the query)', () => {
    const estimate = createQualitativeApplicability({
      uncertainty_class: 'UNQUANTIFIED',
      context: CONTEXT_PROD,
    });
    expect(estimateMatchesContext(estimate, { ...CONTEXT_PROD, tier: 'hot' })).toBe(true);
    expect(estimateMatchesContext(estimate, CONTEXT_PROD_US)).toBe(false);
    expect(estimateMatchesContext(estimate, CONTEXT_CANARY)).toBe(false);
    expect(matchesCondition({ a: '1' }, { a: '1', b: '2' })).toBe(true);
    expect(matchesCondition({ a: '1', b: '2' }, { a: '1' })).toBe(false);
    expect(contextSpecificity({ a: '1', b: '2', c: '3' })).toBe(3);
    expect(sameCondition({ a: '1', b: '2' }, { b: '2', a: '1' })).toBe(true);
    expect(sameCondition({ a: '1' }, { a: '2' })).toBe(false);
  });

  it('bestEstimateForContext picks most specific, then calibrated, then strongest class — deterministically', () => {
    const qualitative = createQualitativeApplicability({
      uncertainty_class: 'STRONG',
      context: CONTEXT_PROD,
    });
    const calibratedBroad = createCalibratedApplicability({
      probability: 0.7,
      calibration_ref: CALIBRATION,
      uncertainty_class: 'WEAK',
      context: { environment: 'production' },
      sample_size: 30,
      window: W0,
    });
    const calibratedSpecific = createCalibratedApplicability({
      probability: 0.81,
      calibration_ref: CALIBRATION,
      uncertainty_class: 'MODERATE',
      context: CONTEXT_PROD,
      sample_size: 42,
      window: W0,
    });
    const estimates: ApplicabilityEstimate[] = [qualitative, calibratedBroad, calibratedSpecific];
    const best = bestEstimateForContext(estimates, { ...CONTEXT_PROD, region: 'eu' });
    expect(best).not.toBeNull();
    expect(best?.kind).toBe('CALIBRATED');
    expect((best as { context: Record<string, string> }).context).toEqual(CONTEXT_PROD);
    // No match -> null (honest absence, distinct from any estimate)
    expect(bestEstimateForContext(estimates, CONTEXT_CANARY)).toBeNull();
  });
});

describe('applicability discipline (negative — never a universal score, never uncalibrated numerics)', () => {
  it('REJECTS an empty context condition (a universal score)', () => {
    expect(() =>
      createQualitativeApplicability({ uncertainty_class: 'WEAK', context: {} }),
    ).toThrow(/universal score/);
    expect(() =>
      createCalibratedApplicability({
        probability: 0.9,
        calibration_ref: CALIBRATION,
        uncertainty_class: 'WEAK',
        context: {},
        sample_size: 5,
        window: W0,
      }),
    ).toThrow(/universal score/);
    expect(() => assertValidApplicability({ kind: 'QUALITATIVE', uncertainty_class: 'WEAK', context: {}, sample_size: 0, window: null })).toThrow(
      /universal score/,
    );
  });

  it('REJECTS numeric probability without calibration (uncalibrated applicability)', () => {
    expect(() =>
      assertValidApplicability({
        kind: 'CALIBRATED',
        probability: 0.9,
        calibration_ref: 'not-a-sos-id',
        uncertainty_class: 'WEAK',
        context: CONTEXT_PROD,
        sample_size: 5,
        window: W0,
      }),
    ).toThrow(/calibration/);
    expect(() =>
      assertValidApplicability({
        kind: 'CALIBRATED',
        probability: 0.9,
        calibration_ref: SUBJECT_R1, // well-formed id, but not the point: sample/window below
        uncertainty_class: 'WEAK',
        context: CONTEXT_PROD,
        sample_size: 0,
        window: W0,
      }),
    ).toThrow(/sample_size/);
    expect(() =>
      assertValidApplicability({
        kind: 'CALIBRATED',
        probability: 0.9,
        calibration_ref: SUBJECT_R1,
        uncertainty_class: 'WEAK',
        context: CONTEXT_PROD,
        sample_size: 5,
        window: null,
      }),
    ).toThrow(/time window/);
  });

  it('REJECTS probabilities outside [0,1] and unknown uncertainty classes', () => {
    expect(() =>
      createCalibratedApplicability({
        probability: 1.2,
        calibration_ref: CALIBRATION,
        uncertainty_class: 'WEAK',
        context: CONTEXT_PROD,
        sample_size: 5,
        window: W0,
      }),
    ).toThrow(/\[0, 1\]/);
    expect(() =>
      createQualitativeApplicability({
        uncertainty_class: 'GUT_FEELING' as never,
        context: CONTEXT_PROD,
      }),
    ).toThrow(/UNCERTAINTY_CLASSES|STRONG/);
  });

  it('REJECTS calibratedApplicabilityFromOutcomes with zero observations (no evidence-free probabilities)', () => {
    expect(() =>
      calibratedApplicabilityFromOutcomes({
        successes: 0,
        failures: 0,
        calibration_ref: CALIBRATION,
        uncertainty_class: 'WEAK',
        context: CONTEXT_PROD,
        window: W0,
      }),
    ).toThrow(/at least one observed outcome/);
  });

  it('REJECTS an estimate set without any estimate and conflicting same-context estimates', () => {
    expect(() => assertValidApplicabilitySet([])).toThrow(/at least one applicability estimate/);
    const a = createQualitativeApplicability({ uncertainty_class: 'WEAK', context: CONTEXT_PROD });
    const b = createQualitativeApplicability({ uncertainty_class: 'STRONG', context: { region: 'eu', environment: 'production' } });
    // Same context (key order irrelevant), different classes -> ambiguous.
    expect(() => assertValidApplicabilitySet([a, b])).toThrow(/same context/);
    const c = createQualitativeApplicability({ uncertainty_class: 'MODERATE', context: CONTEXT_PROD_US });
    expect(() => assertValidApplicabilitySet([a, c])).not.toThrow();
  });

  it('ALLOWS a calibrated + qualitative pair for the same context (the refinement flow) and REJECTS double calibration', () => {
    const qualitative = createQualitativeApplicability({ uncertainty_class: 'WEAK', context: CONTEXT_PROD });
    const calibrated = createCalibratedApplicability({
      probability: 0.8,
      calibration_ref: CALIBRATION,
      uncertainty_class: 'MODERATE',
      context: CONTEXT_PROD,
      sample_size: 10,
      window: W0,
    });
    expect(() => assertValidApplicabilitySet([qualitative, calibrated])).not.toThrow();
    const second = createCalibratedApplicability({
      probability: 0.9,
      calibration_ref: CALIBRATION,
      uncertainty_class: 'MODERATE',
      context: CONTEXT_PROD,
      sample_size: 12,
      window: W1,
    });
    expect(() => assertValidApplicabilitySet([calibrated, second])).toThrow(/conflicting calibrated measurements/);
  });

  it('isValidApplicability is the honest predicate (no throw)', () => {
    expect(isValidApplicability(null)).toBe(false);
    expect(isValidApplicability('x')).toBe(false);
    expect(isValidApplicability({ kind: 'WRONG' })).toBe(false);
    expect(
      isValidApplicability({
        kind: 'QUALITATIVE',
        uncertainty_class: 'WEAK',
        context: CONTEXT_PROD,
        sample_size: 0,
        window: null,
      }),
    ).toBe(true);
  });

  it('window validation is delegated to @sos-2/provenance (bad windows rejected)', () => {
    expect(() =>
      assertValidApplicability({
        kind: 'QUALITATIVE',
        uncertainty_class: 'WEAK',
        context: CONTEXT_PROD,
        sample_size: 0,
        window: { start: W1.end, end: W1.start } as never,
      }),
    ).toThrow(/window/);
  });

  it('dangling subject sanity: evidence helper ids are well-formed spine ids', () => {
    const record = makeEvidence();
    expect(record.id).toMatch(/^sos:\/\/Evidence\/[0-9a-f]{32}$/);
  });
});
