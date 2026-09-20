import { describe, expect, it } from 'vitest';
import { deriveDeterministicArtifactId } from '@sos-2/semantic-spine';
import {
  assertValidExperimentDesign,
  assertValidMetricOutcome,
  isAllocationUnit,
  isAssignmentMode,
  isExperimentDesignKind,
  validateExperimentDesign,
} from '../src/index.js';
import { sampleDesign } from './helpers.js';

describe('experiment design: typed population/allocation/treatment/control semantics', () => {
  it('accepts the golden TREATMENT_CONTROL design', () => {
    const design = sampleDesign();
    expect(() => assertValidExperimentDesign(design)).not.toThrow();
    expect(validateExperimentDesign(design)).toBe(true);
    expect(design.kind).toBe('TREATMENT_CONTROL');
  });

  it('requires the treatment arm to expose a candidate and the control to expose none', () => {
    const design = sampleDesign();
    const treatment = design.allocation.arms.find((arm) => arm.role === 'TREATMENT')!;
    const control = design.allocation.arms.find((arm) => arm.role === 'CONTROL')!;
    expect(treatment.candidate_ref).not.toBeNull();
    expect(control.candidate_ref).toBeNull();
  });

  it('rejects TREATMENT_CONTROL with a control arm exposing a candidate', () => {
    const design = sampleDesign();
    (design.allocation.arms[0] as { candidate_ref: string }).candidate_ref = deriveDeterministicArtifactId(
      'CandidateState',
      { note: 'w9 control-arm candidate probe' },
    );
    expect(() => assertValidExperimentDesign(design)).toThrow(/CONTROL arm carries the current\/baseline system/);
  });

  it('rejects allocation units that disagree with the population unit', () => {
    const design = sampleDesign();
    (design.allocation as { unit: 'REQUEST' | 'SESSION' }).unit = 'SESSION';
    expect(() => assertValidExperimentDesign(design)).toThrow(/must EQUAL the population unit/);
  });

  it('rejects non-positive allocation ratios', () => {
    const design = sampleDesign();
    design.allocation.ratios = [1, 0];
    expect(() => assertValidExperimentDesign(design)).toThrow(/positive integers/);
  });

  it('rejects designs without guardrail metrics (guardrails are mandatory)', () => {
    const design = sampleDesign();
    design.metrics = design.metrics.filter((metric) => metric.role !== 'GUARDRAIL');
    expect(() => assertValidExperimentDesign(design)).toThrow(/at least one GUARDRAIL metric/);
  });

  it('rejects guardrail metrics without an explicit threshold', () => {
    const design = sampleDesign();
    const guardrail = design.metrics.find((metric) => metric.role === 'GUARDRAIL')!;
    delete (guardrail as { guardrail_threshold?: number }).guardrail_threshold;
    expect(() => assertValidExperimentDesign(design)).toThrow(/requires an explicit guardrail_threshold/);
  });

  it('rejects guardrail_threshold on non-guardrail metrics', () => {
    const design = sampleDesign();
    (design.metrics[0] as { guardrail_threshold?: number }).guardrail_threshold = 1;
    expect(() => assertValidExperimentDesign(design)).toThrow(/reserved for GUARDRAIL metrics/);
  });

  it('rejects designs without primary metrics', () => {
    const design = sampleDesign();
    design.metrics = design.metrics.filter((metric) => metric.role !== 'PRIMARY');
    expect(() => assertValidExperimentDesign(design)).toThrow(/at least one PRIMARY metric/);
  });

  it('rejects designs without stopping criteria', () => {
    const design = sampleDesign();
    design.stopping_criteria = [];
    expect(() => assertValidExperimentDesign(design)).toThrow(/without stopping rules is rejected/);
  });

  it('rejects rollback criteria wired to non-guardrail metrics', () => {
    const design = sampleDesign();
    design.rollback_criteria[0]!.guardrail_metric_ids = ['p99-latency'];
    expect(() => assertValidExperimentDesign(design)).toThrow(/wired to GUARDRAIL metrics only/);
  });

  it('rejects rollback criteria wired to unknown metrics', () => {
    const design = sampleDesign();
    design.rollback_criteria[0]!.guardrail_metric_ids = ['no-such-metric'];
    expect(() => assertValidExperimentDesign(design)).toThrow(/unknown metric/);
  });

  it('rejects duplicate metric ids and duplicate arm ids', () => {
    const design = sampleDesign();
    (design.metrics[1] as { id: string }).id = 'p99-latency';
    expect(() => assertValidExperimentDesign(design)).toThrow(/duplicate metric id/);
    const design2 = sampleDesign();
    (design2.allocation.arms[1] as { id: string }).id = 'control';
    expect(() => assertValidExperimentDesign(design2)).toThrow(/duplicate arm id/);
  });

  it('rejects an empty population context (no applicability facts)', () => {
    const design = sampleDesign();
    (design.population as unknown as { context: Record<string, unknown> }).context = {};
    expect(() => assertValidExperimentDesign(design)).toThrow(/at least one fact/);
  });
});

describe('experiment design vocabularies', () => {
  it('exposes the typed allocation units and assignment modes', () => {
    expect(isAllocationUnit('REQUEST')).toBe(true);
    expect(isAllocationUnit('SESSION')).toBe(true);
    expect(isAllocationUnit('USER')).toBe(true);
    expect(isAllocationUnit('SERVICE_INSTANCE')).toBe(true);
    expect(isAllocationUnit('DEPLOYMENT')).toBe(true);
    expect(isAllocationUnit('COOKIE')).toBe(false);
    expect(isAssignmentMode('RANDOM')).toBe(true);
    expect(isAssignmentMode('DETERMINISTIC_HASH')).toBe(true);
    expect(isAssignmentMode('STICKY')).toBe(false);
    expect(isExperimentDesignKind('TREATMENT_CONTROL')).toBe(true);
    expect(isExperimentDesignKind('ALTERNATIVES')).toBe(true);
    expect(isExperimentDesignKind('AB')).toBe(false);
  });
});

describe('metric outcome truth-state discipline', () => {
  it('accepts SUCCESS outcomes with finite values', () => {
    expect(() => assertValidMetricOutcome({ metric_id: 'm', arm_id: 'a', value: 1.5, availability: 'SUCCESS' })).not.toThrow();
  });

  it('rejects UNKNOWN outcomes carrying a value (distinct states are never silently numeric)', () => {
    expect(() =>
      assertValidMetricOutcome({ metric_id: 'm', arm_id: 'a', value: 3, availability: 'UNKNOWN' }),
    ).toThrow(/cannot carry a value/);
    expect(() =>
      assertValidMetricOutcome({ metric_id: 'm', arm_id: 'a', value: 3, availability: 'UNAVAILABLE' }),
    ).toThrow(/cannot carry a value/);
  });

  it('rejects UNKNOWN outcomes without values re-coded as success-like states', () => {
    const outcome = { metric_id: 'm', arm_id: 'a', value: null, availability: 'UNKNOWN' as const };
    expect(() => assertValidMetricOutcome(outcome)).not.toThrow();
  });

  it('rejects non-finite values on SUCCESS', () => {
    expect(() =>
      assertValidMetricOutcome({ metric_id: 'm', arm_id: 'a', value: Number.NaN, availability: 'SUCCESS' }),
    ).toThrow(/finite numeric value/);
  });
});
