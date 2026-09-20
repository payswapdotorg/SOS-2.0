import { describe, expect, it } from 'vitest';
import {
  anyRollbackTriggered,
  anyStoppingTriggered,
  createExperiment,
  createExperimentResult,
  evaluateExperimentResult,
  evaluateGuardrail,
  evaluateMetric,
  GUARDRAIL_STATUSES,
} from '../src/index.js';
import {
  createExperimentArtifact,
  sampleExperimentInput,
  PROVENANCE,
  T1,
  toolProducer,
} from './helpers.js';

function resultWithOutcomes(outcomes: Array<{ metric_id: string; arm_id: string; value: number | null; availability: string }>) {
  const experiment = createExperimentArtifact();
  const result = createExperimentResult(experiment, {
    experiment_id: experiment.envelope.id,
    observed_at: T1,
    sample_size: 5000,
    outcomes: outcomes.map((outcome) => ({
      metric_id: outcome.metric_id,
      arm_id: outcome.arm_id,
      value: outcome.value,
      availability: outcome.availability as 'SUCCESS' | 'FAILURE' | 'UNKNOWN' | 'UNAVAILABLE' | 'UNSUPPORTED' | 'PARTIAL',
    })),
    provenance: PROVENANCE,
    producer: toolProducer(),
  });
  return { experiment, result };
}

describe('guardrail evaluation (fail-closed)', () => {
  it('SATISFIED: SUCCESS availability within threshold', () => {
    const { experiment, result } = resultWithOutcomes([
      { metric_id: 'error-rate', arm_id: 'control', value: 0.005, availability: 'SUCCESS' },
      { metric_id: 'error-rate', arm_id: 'treatment', value: 0.006, availability: 'SUCCESS' },
      { metric_id: 'p99-latency', arm_id: 'control', value: 240, availability: 'SUCCESS' },
      { metric_id: 'p99-latency', arm_id: 'treatment', value: 180, availability: 'SUCCESS' },
    ]);
    const guardrail = experiment.content.design.metrics.find((metric) => metric.role === 'GUARDRAIL')!;
    const evaluation = evaluateGuardrail(experiment, result, guardrail);
    expect(evaluation.status).toBe('SATISFIED');
  });

  it('BREACHED: SUCCESS availability violating the threshold', () => {
    const { experiment, result } = resultWithOutcomes([
      { metric_id: 'error-rate', arm_id: 'control', value: 0.005, availability: 'SUCCESS' },
      { metric_id: 'error-rate', arm_id: 'treatment', value: 0.05, availability: 'SUCCESS' },
      { metric_id: 'p99-latency', arm_id: 'control', value: 240, availability: 'SUCCESS' },
      { metric_id: 'p99-latency', arm_id: 'treatment', value: 180, availability: 'SUCCESS' },
    ]);
    const guardrail = experiment.content.design.metrics.find((metric) => metric.role === 'GUARDRAIL')!;
    const evaluation = evaluateGuardrail(experiment, result, guardrail);
    expect(evaluation.status).toBe('BREACHED');
  });

  it('BREACHED: a FAILING guardrail is a breach, never a pass', () => {
    const { experiment, result } = resultWithOutcomes([
      { metric_id: 'error-rate', arm_id: 'control', value: 0.005, availability: 'SUCCESS' },
      { metric_id: 'error-rate', arm_id: 'treatment', value: 0.006, availability: 'FAILURE' },
      { metric_id: 'p99-latency', arm_id: 'control', value: 240, availability: 'SUCCESS' },
      { metric_id: 'p99-latency', arm_id: 'treatment', value: 180, availability: 'SUCCESS' },
    ]);
    const guardrail = experiment.content.design.metrics.find((metric) => metric.role === 'GUARDRAIL')!;
    const evaluation = evaluateGuardrail(experiment, result, guardrail);
    expect(evaluation.status).toBe('BREACHED');
  });

  it('NOT_ESTABLISHED: an UNKNOWN guardrail is never silently success', () => {
    const { experiment, result } = resultWithOutcomes([
      { metric_id: 'error-rate', arm_id: 'control', value: 0.005, availability: 'SUCCESS' },
      { metric_id: 'error-rate', arm_id: 'treatment', value: null, availability: 'UNKNOWN' },
      { metric_id: 'p99-latency', arm_id: 'control', value: 240, availability: 'SUCCESS' },
      { metric_id: 'p99-latency', arm_id: 'treatment', value: 180, availability: 'SUCCESS' },
    ]);
    const guardrail = experiment.content.design.metrics.find((metric) => metric.role === 'GUARDRAIL')!;
    const evaluation = evaluateGuardrail(experiment, result, guardrail);
    expect(evaluation.status).toBe('NOT_ESTABLISHED');
    expect(evaluation.availability).toBe('UNKNOWN');
    expect(evaluation.observed_value).toBeNull();
  });

  it('NOT_ESTABLISHED: a missing guardrail outcome is not established', () => {
    const { experiment, result } = resultWithOutcomes([
      { metric_id: 'p99-latency', arm_id: 'control', value: 240, availability: 'SUCCESS' },
      { metric_id: 'p99-latency', arm_id: 'treatment', value: 180, availability: 'SUCCESS' },
    ]);
    const guardrail = experiment.content.design.metrics.find((metric) => metric.role === 'GUARDRAIL')!;
    const evaluation = evaluateGuardrail(experiment, result, guardrail);
    expect(evaluation.status).toBe('NOT_ESTABLISHED');
  });

  it('the three guardrail statuses are exactly the frozen vocabulary', () => {
    expect(GUARDRAIL_STATUSES).toEqual(['SATISFIED', 'BREACHED', 'NOT_ESTABLISHED']);
  });
});

describe('primary metric evaluation (treatment vs control)', () => {
  it('SATISFIED when the treatment improves per direction', () => {
    const { experiment, result } = resultWithOutcomes([
      { metric_id: 'error-rate', arm_id: 'control', value: 0.005, availability: 'SUCCESS' },
      { metric_id: 'error-rate', arm_id: 'treatment', value: 0.006, availability: 'SUCCESS' },
      { metric_id: 'p99-latency', arm_id: 'control', value: 240, availability: 'SUCCESS' },
      { metric_id: 'p99-latency', arm_id: 'treatment', value: 180, availability: 'SUCCESS' },
    ]);
    const primary = experiment.content.design.metrics.find((metric) => metric.role === 'PRIMARY')!;
    const evaluation = evaluateMetric(experiment, result, primary);
    expect(evaluation.status).toBe('SATISFIED');
  });

  it('NOT_SATISFIED when the treatment regresses', () => {
    const { experiment, result } = resultWithOutcomes([
      { metric_id: 'error-rate', arm_id: 'control', value: 0.005, availability: 'SUCCESS' },
      { metric_id: 'error-rate', arm_id: 'treatment', value: 0.006, availability: 'SUCCESS' },
      { metric_id: 'p99-latency', arm_id: 'control', value: 180, availability: 'SUCCESS' },
      { metric_id: 'p99-latency', arm_id: 'treatment', value: 240, availability: 'SUCCESS' },
    ]);
    const primary = experiment.content.design.metrics.find((metric) => metric.role === 'PRIMARY')!;
    const evaluation = evaluateMetric(experiment, result, primary);
    expect(evaluation.status).toBe('NOT_SATISFIED');
  });

  it('NOT_ESTABLISHED when a comparison arm outcome is missing', () => {
    const { experiment, result } = resultWithOutcomes([
      { metric_id: 'error-rate', arm_id: 'control', value: 0.005, availability: 'SUCCESS' },
      { metric_id: 'error-rate', arm_id: 'treatment', value: 0.006, availability: 'SUCCESS' },
      { metric_id: 'p99-latency', arm_id: 'treatment', value: 180, availability: 'SUCCESS' },
    ]);
    const primary = experiment.content.design.metrics.find((metric) => metric.role === 'PRIMARY')!;
    const evaluation = evaluateMetric(experiment, result, primary);
    expect(evaluation.status).toBe('NOT_ESTABLISHED');
  });
});

describe('overall availability (the 6 frozen truth states, honestly mapped)', () => {
  it('SUCCESS only when every primary is satisfied AND every guardrail is satisfied', () => {
    const { experiment, result } = resultWithOutcomes([
      { metric_id: 'p99-latency', arm_id: 'control', value: 240, availability: 'SUCCESS' },
      { metric_id: 'p99-latency', arm_id: 'treatment', value: 180, availability: 'SUCCESS' },
      { metric_id: 'db-read-qps', arm_id: 'control', value: 5000, availability: 'SUCCESS' },
      { metric_id: 'db-read-qps', arm_id: 'treatment', value: 3200, availability: 'SUCCESS' },
      { metric_id: 'error-rate', arm_id: 'control', value: 0.005, availability: 'SUCCESS' },
      { metric_id: 'error-rate', arm_id: 'treatment', value: 0.006, availability: 'SUCCESS' },
    ]);
    const evaluation = evaluateExperimentResult(experiment, result);
    expect(evaluation.overall_availability).toBe('SUCCESS');
  });

  it('FAILURE when a guardrail is breached', () => {
    const { experiment, result } = resultWithOutcomes([
      { metric_id: 'p99-latency', arm_id: 'control', value: 240, availability: 'SUCCESS' },
      { metric_id: 'p99-latency', arm_id: 'treatment', value: 180, availability: 'SUCCESS' },
      { metric_id: 'db-read-qps', arm_id: 'control', value: 5000, availability: 'SUCCESS' },
      { metric_id: 'db-read-qps', arm_id: 'treatment', value: 3200, availability: 'SUCCESS' },
      { metric_id: 'error-rate', arm_id: 'control', value: 0.005, availability: 'SUCCESS' },
      { metric_id: 'error-rate', arm_id: 'treatment', value: 0.05, availability: 'SUCCESS' },
    ]);
    const evaluation = evaluateExperimentResult(experiment, result);
    expect(evaluation.overall_availability).toBe('FAILURE');
  });

  it('UNKNOWN when a guardrail is UNKNOWN (never silently success)', () => {
    const { experiment, result } = resultWithOutcomes([
      { metric_id: 'p99-latency', arm_id: 'control', value: 240, availability: 'SUCCESS' },
      { metric_id: 'p99-latency', arm_id: 'treatment', value: 180, availability: 'SUCCESS' },
      { metric_id: 'db-read-qps', arm_id: 'control', value: 5000, availability: 'SUCCESS' },
      { metric_id: 'db-read-qps', arm_id: 'treatment', value: 3200, availability: 'SUCCESS' },
      { metric_id: 'error-rate', arm_id: 'control', value: 0.005, availability: 'SUCCESS' },
      { metric_id: 'error-rate', arm_id: 'treatment', value: null, availability: 'UNKNOWN' },
    ]);
    const evaluation = evaluateExperimentResult(experiment, result);
    expect(evaluation.overall_availability).toBe('UNKNOWN');
  });

  it('PARTIAL when primaries+guardrails hold but a secondary regresses', () => {
    const { experiment, result } = resultWithOutcomes([
      { metric_id: 'p99-latency', arm_id: 'control', value: 240, availability: 'SUCCESS' },
      { metric_id: 'p99-latency', arm_id: 'treatment', value: 180, availability: 'SUCCESS' },
      { metric_id: 'db-read-qps', arm_id: 'control', value: 3200, availability: 'SUCCESS' },
      { metric_id: 'db-read-qps', arm_id: 'treatment', value: 5000, availability: 'SUCCESS' },
      { metric_id: 'error-rate', arm_id: 'control', value: 0.005, availability: 'SUCCESS' },
      { metric_id: 'error-rate', arm_id: 'treatment', value: 0.006, availability: 'SUCCESS' },
    ]);
    const evaluation = evaluateExperimentResult(experiment, result);
    expect(evaluation.overall_availability).toBe('PARTIAL');
  });
});

describe('stopping and rollback triggers (typed records with exact conditions)', () => {
  it('early-success fires only when primaries AND guardrails are all satisfied', () => {
    const good = resultWithOutcomes([
      { metric_id: 'p99-latency', arm_id: 'control', value: 240, availability: 'SUCCESS' },
      { metric_id: 'p99-latency', arm_id: 'treatment', value: 180, availability: 'SUCCESS' },
      { metric_id: 'db-read-qps', arm_id: 'control', value: 5000, availability: 'SUCCESS' },
      { metric_id: 'db-read-qps', arm_id: 'treatment', value: 3200, availability: 'SUCCESS' },
      { metric_id: 'error-rate', arm_id: 'control', value: 0.005, availability: 'SUCCESS' },
      { metric_id: 'error-rate', arm_id: 'treatment', value: 0.006, availability: 'SUCCESS' },
    ]);
    const goodEvaluation = evaluateExperimentResult(good.experiment, good.result);
    const early = goodEvaluation.stopping.find((trigger) => trigger.rule_id === 'early-success')!;
    expect(early.triggered).toBe(true);
    expect(early.conditions.length).toBe(2); // 1 primary + 1 guardrail
    expect(early.conditions.every((condition) => condition.satisfied)).toBe(true);

    const unknownGuardrail = resultWithOutcomes([
      { metric_id: 'p99-latency', arm_id: 'control', value: 240, availability: 'SUCCESS' },
      { metric_id: 'p99-latency', arm_id: 'treatment', value: 180, availability: 'SUCCESS' },
      { metric_id: 'db-read-qps', arm_id: 'control', value: 5000, availability: 'SUCCESS' },
      { metric_id: 'db-read-qps', arm_id: 'treatment', value: 3200, availability: 'SUCCESS' },
      { metric_id: 'error-rate', arm_id: 'control', value: 0.005, availability: 'SUCCESS' },
      { metric_id: 'error-rate', arm_id: 'treatment', value: null, availability: 'UNKNOWN' },
    ]);
    const blocked = evaluateExperimentResult(unknownGuardrail.experiment, unknownGuardrail.result);
    const blockedEarly = blocked.stopping.find((trigger) => trigger.rule_id === 'early-success')!;
    expect(blockedEarly.triggered).toBe(false);
    expect(blockedEarly.conditions.some((condition) => !condition.satisfied)).toBe(true);
  });

  it('the SAFETY stopping rule fires on any non-satisfied guardrail (including UNKNOWN)', () => {
    const unknownGuardrail = resultWithOutcomes([
      { metric_id: 'p99-latency', arm_id: 'control', value: 240, availability: 'SUCCESS' },
      { metric_id: 'p99-latency', arm_id: 'treatment', value: 180, availability: 'SUCCESS' },
      { metric_id: 'db-read-qps', arm_id: 'control', value: 5000, availability: 'SUCCESS' },
      { metric_id: 'db-read-qps', arm_id: 'treatment', value: 3200, availability: 'SUCCESS' },
      { metric_id: 'error-rate', arm_id: 'control', value: 0.005, availability: 'SUCCESS' },
      { metric_id: 'error-rate', arm_id: 'treatment', value: null, availability: 'UNKNOWN' },
    ]);
    const evaluation = evaluateExperimentResult(unknownGuardrail.experiment, unknownGuardrail.result);
    const safety = evaluation.stopping.find((trigger) => trigger.rule_id === 'safety')!;
    expect(safety.triggered).toBe(true);
    expect(safety.conditions).toHaveLength(1);
    expect(safety.conditions[0]!.condition).toContain('NOT_ESTABLISHED');
  });

  it('MAX_SAMPLES fires at the threshold (exact condition recorded)', () => {
    const { experiment, result } = resultWithOutcomes([
      { metric_id: 'p99-latency', arm_id: 'control', value: 240, availability: 'SUCCESS' },
      { metric_id: 'p99-latency', arm_id: 'treatment', value: 180, availability: 'SUCCESS' },
      { metric_id: 'error-rate', arm_id: 'control', value: 0.005, availability: 'SUCCESS' },
      { metric_id: 'error-rate', arm_id: 'treatment', value: 0.006, availability: 'SUCCESS' },
    ]);
    const evaluation = evaluateExperimentResult(experiment, result);
    const maxSamples = evaluation.stopping.find((trigger) => trigger.rule_id === 'max-samples')!;
    expect(maxSamples.triggered).toBe(false); // 5000 < 10000
    expect(maxSamples.conditions[0]!.condition).toContain('5000');
  });

  it('MAX_DURATION fires when observed_at passes the bound (duration from envelope.created_at)', () => {
    const { experiment, result } = resultWithOutcomes([
      { metric_id: 'p99-latency', arm_id: 'control', value: 240, availability: 'SUCCESS' },
      { metric_id: 'p99-latency', arm_id: 'treatment', value: 180, availability: 'SUCCESS' },
      { metric_id: 'error-rate', arm_id: 'control', value: 0.005, availability: 'SUCCESS' },
      { metric_id: 'error-rate', arm_id: 'treatment', value: 0.006, availability: 'SUCCESS' },
    ]);
    // created_at T0 = 2025-01-01, observed T1 = 2025-01-02 -> 86400s exactly: >= fires
    const evaluation = evaluateExperimentResult(experiment, result);
    const maxDuration = evaluation.stopping.find((trigger) => trigger.rule_id === 'max-duration-seconds')!;
    expect(maxDuration.triggered).toBe(true);
  });

  it('rollback triggers fire on BREACHED and on NOT_ESTABLISHED (fail-closed: unknown is never success)', () => {
    const breached = resultWithOutcomes([
      { metric_id: 'p99-latency', arm_id: 'control', value: 240, availability: 'SUCCESS' },
      { metric_id: 'p99-latency', arm_id: 'treatment', value: 180, availability: 'SUCCESS' },
      { metric_id: 'error-rate', arm_id: 'control', value: 0.005, availability: 'SUCCESS' },
      { metric_id: 'error-rate', arm_id: 'treatment', value: 0.05, availability: 'SUCCESS' },
    ]);
    const breachedEvaluation = evaluateExperimentResult(breached.experiment, breached.result);
    expect(breachedEvaluation.rollback[0]!.kind).toBe('ROLLBACK');
    expect(breachedEvaluation.rollback[0]!.rule_id).toBe('error-budget');
    expect(breachedEvaluation.rollback[0]!.triggered).toBe(true);
    expect(anyRollbackTriggered(breachedEvaluation)).toBe(true);

    const unknown = resultWithOutcomes([
      { metric_id: 'p99-latency', arm_id: 'control', value: 240, availability: 'SUCCESS' },
      { metric_id: 'p99-latency', arm_id: 'treatment', value: 180, availability: 'SUCCESS' },
      { metric_id: 'error-rate', arm_id: 'control', value: 0.005, availability: 'SUCCESS' },
      { metric_id: 'error-rate', arm_id: 'treatment', value: null, availability: 'UNAVAILABLE' },
    ]);
    const unknownEvaluation = evaluateExperimentResult(unknown.experiment, unknown.result);
    expect(unknownEvaluation.rollback[0]!.triggered).toBe(true);
    expect(unknownEvaluation.rollback[0]!.conditions[0]!.condition).toContain('NOT_ESTABLISHED');
  });

  it('rollback triggers do NOT fire when every referenced guardrail is satisfied', () => {
    const good = resultWithOutcomes([
      { metric_id: 'p99-latency', arm_id: 'control', value: 240, availability: 'SUCCESS' },
      { metric_id: 'p99-latency', arm_id: 'treatment', value: 180, availability: 'SUCCESS' },
      { metric_id: 'error-rate', arm_id: 'control', value: 0.005, availability: 'SUCCESS' },
      { metric_id: 'error-rate', arm_id: 'treatment', value: 0.006, availability: 'SUCCESS' },
    ]);
    const evaluation = evaluateExperimentResult(good.experiment, good.result);
    expect(evaluation.rollback[0]!.triggered).toBe(false);
    expect(anyRollbackTriggered(evaluation)).toBe(false);
    expect(anyStoppingTriggered(evaluation)).toBe(true); // early-success
  });

  it('rejects evaluating a result against a different experiment', () => {
    const first = createExperimentArtifact();
    const second = createExperiment(sampleExperimentInput({ canaryLadder: [2, 4, 8] }));
    const result = createExperimentResult(first, {
      experiment_id: first.envelope.id,
      observed_at: T1,
      sample_size: 10,
      outcomes: [],
      provenance: PROVENANCE,
      producer: toolProducer(),
    });
    expect(() => evaluateExperimentResult(second, result)).toThrow(/exact-experiment discipline/);
  });
});
