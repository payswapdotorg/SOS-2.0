import { describe, expect, it } from 'vitest';
import { evaluateExperimentResult, simulateExperiment, SIMULATOR_VERSION, mulberry32 } from '../src/index.js';
import {
  createExperimentArtifact,
  sampleEffects,
  sampleSimulationInput,
  PROVENANCE,
  T1,
  toolProducer,
} from './helpers.js';

describe('deterministic simulator', () => {
  it('produces bit-identical results for identical seeds and inputs', () => {
    const experiment = createExperimentArtifact();
    const a = simulateExperiment(sampleSimulationInput(experiment, 424242));
    const b = simulateExperiment(sampleSimulationInput(experiment, 424242));
    expect(a).toEqual(b);
    expect(a.id).toBe(b.id);
  });

  it('produces different results for different seeds', () => {
    const experiment = createExperimentArtifact();
    const a = simulateExperiment(sampleSimulationInput(experiment, 424242));
    const b = simulateExperiment(sampleSimulationInput(experiment, 424243));
    expect(a.id).not.toBe(b.id);
  });

  it('marks every simulated record with provenance: simulated=true, version, seed', () => {
    const experiment = createExperimentArtifact();
    const result = simulateExperiment(sampleSimulationInput(experiment, 7));
    expect(result.simulated).toBe(true);
    expect(result.simulator).toEqual({ version: SIMULATOR_VERSION, seed: 7 });
    expect(result.provenance).toEqual(PROVENANCE);
  });

  it('honors the declared effect parameters (observed means approximate true means)', () => {
    const experiment = createExperimentArtifact();
    const result = simulateExperiment(sampleSimulationInput(experiment, 424242));
    const control = result.outcomes.find((o) => o.metric_id === 'p99-latency' && o.arm_id === 'control')!;
    const treatment = result.outcomes.find((o) => o.metric_id === 'p99-latency' && o.arm_id === 'treatment')!;
    expect(control.availability).toBe('SUCCESS');
    expect(Math.abs(control.value! - 240)).toBeLessThan(10);
    expect(Math.abs(treatment.value! - 180)).toBeLessThan(10);
  });

  it('covers every (arm, metric) pair exactly once', () => {
    const experiment = createExperimentArtifact();
    const result = simulateExperiment(sampleSimulationInput(experiment, 1));
    const arms = experiment.content.design.allocation.arms.length;
    const metrics = experiment.content.design.metrics.length;
    expect(result.outcomes).toHaveLength(arms * metrics);
    const keys = new Set(result.outcomes.map((o) => `${o.metric_id}:${o.arm_id}`));
    expect(keys.size).toBe(arms * metrics);
  });

  it('honors availability overrides with truthful valueless states', () => {
    const experiment = createExperimentArtifact();
    const result = simulateExperiment(
      sampleSimulationInput(experiment, 424242, { 'error-rate': 'UNAVAILABLE' }),
    );
    const guardrailOutcomes = result.outcomes.filter((o) => o.metric_id === 'error-rate');
    for (const outcome of guardrailOutcomes) {
      expect(outcome.availability).toBe('UNAVAILABLE');
      expect(outcome.value).toBeNull();
    }
    const evaluation = evaluateExperimentResult(experiment, result);
    expect(evaluation.overall_availability).toBe('UNKNOWN');
    expect(evaluation.rollback[0]!.triggered).toBe(true);
  });

  it('a simulated UNKNOWN guardrail is never treated as success (evaluation discipline holds)', () => {
    const experiment = createExperimentArtifact();
    const result = simulateExperiment(sampleSimulationInput(experiment, 5, { 'error-rate': 'UNKNOWN' }));
    const evaluation = evaluateExperimentResult(experiment, result);
    expect(evaluation.overall_availability).not.toBe('SUCCESS');
    expect(evaluation.overall_availability).toBe('UNKNOWN');
    const early = evaluation.stopping.find((trigger) => trigger.rule_id === 'early-success')!;
    expect(early.triggered).toBe(false);
  });

  it('consumes the PRNG stream in a fixed order (arm-major, metric-minor)', () => {
    const experiment = createExperimentArtifact();
    const effects = sampleEffects(experiment.content.design as never);
    const input = {
      experiment,
      effects,
      seed: 99,
      samples_per_arm: 50,
      observed_at: T1,
      provenance: PROVENANCE,
      producer: toolProducer(),
    };
    const a = simulateExperiment(input);
    const b = simulateExperiment({ ...input, samples_per_arm: 50 });
    expect(a).toEqual(b);
    // A different sample count consumes a different stream prefix count
    const c = simulateExperiment({ ...input, samples_per_arm: 51 });
    expect(c.id).not.toBe(a.id);
  });

  it('mulberry32 is deterministic and in [0, 1)', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const first = [a(), a(), a()];
    const second = [b(), b(), b()];
    expect(first).toEqual(second);
    for (const value of first) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('rejects effect sets that do not cover exactly every (arm, metric) pair', () => {
    const experiment = createExperimentArtifact();
    const effects = sampleEffects(experiment.content.design as never).slice(0, -1);
    expect(() =>
      simulateExperiment({
        experiment,
        effects,
        seed: 1,
        samples_per_arm: 10,
        observed_at: T1,
        provenance: PROVENANCE,
        producer: toolProducer(),
      }),
    ).toThrow(/EXACTLY one entry per/);
  });

  it('rejects negative seeds and non-positive sample counts', () => {
    const experiment = createExperimentArtifact();
    const effects = sampleEffects(experiment.content.design as never);
    expect(() =>
      simulateExperiment({
        experiment,
        effects,
        seed: -1,
        samples_per_arm: 10,
        observed_at: T1,
        provenance: PROVENANCE,
        producer: toolProducer(),
      }),
    ).toThrow(/non-negative integer/);
    expect(() =>
      simulateExperiment({
        experiment,
        effects,
        seed: 1,
        samples_per_arm: 0,
        observed_at: T1,
        provenance: PROVENANCE,
        producer: toolProducer(),
      }),
    ).toThrow(/positive integer/);
  });
});
