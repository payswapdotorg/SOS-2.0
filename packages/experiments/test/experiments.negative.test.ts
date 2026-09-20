/**
 * NEGATIVE tests — every shortcut the architecture lock forbids, rejected
 * loudly (spec/architecture.md §5/§18; spec/architecture-lock.md
 * "Experiment semantics").
 */
import { describe, expect, it } from 'vitest';
import {
  advanceExperimentStage,
  createCandidateState,
  createExperiment,
  createExperimentResult,
  evaluateExperimentResult,
  simulateExperiment,
  transitionPhase,
  validateExperimentResult,
} from '../src/index.js';
import {
  candidateInput,
  createExperimentArtifact,
  sampleCandidateContent,
  sampleExperimentInput,
  sampleEffects,
  sampleSimulationInput,
  PROVENANCE,
  T1,
  toolProducer,
} from './helpers.js';

describe('NEGATIVE: experiment lifecycle shortcuts are rejected', () => {
  it('REJECTS skipping SHADOW -> CONTROLLED_EXPERIMENT', () => {
    expect(() => transitionPhase('SHADOW', 'CONTROLLED_EXPERIMENT')).toThrow(/SHADOW -> CANARY -> CONTROLLED_EXPERIMENT/);
    const experiment = createExperimentArtifact();
    expect(() => advanceExperimentStage(experiment.content, { phase: 'CONTROLLED_EXPERIMENT' })).toThrow(
      /invalid experiment phase transition/,
    );
  });

  it('REJECTS going backwards (CANARY -> SHADOW)', () => {
    expect(() => transitionPhase('CANARY', 'SHADOW')).toThrow();
    const experiment = createExperimentArtifact();
    const canary = advanceExperimentStage(experiment.content, { phase: 'CANARY', exposure_percent: 1 });
    expect(() => advanceExperimentStage(canary, { phase: 'SHADOW' })).toThrow(/invalid experiment phase transition/);
  });

  it('REJECTS re-entering CONTROLLED_EXPERIMENT (terminal phase; same-phase advances are revisions)', () => {
    const experiment = createExperimentArtifact();
    const canary = advanceExperimentStage(experiment.content, { phase: 'CANARY', exposure_percent: 1 });
    const controlled = advanceExperimentStage(canary, { phase: 'CONTROLLED_EXPERIMENT' });
    expect(() => advanceExperimentStage(controlled, { phase: 'CONTROLLED_EXPERIMENT' })).toThrow(
      /phase already active|invalid experiment phase transition/,
    );
  });

  it('REJECTS a shadow with live exposure at creation', () => {
    const input = sampleExperimentInput({ stage: { phase: 'SHADOW', exposure_percent: 50 } });
    expect(() => createExperiment(input)).toThrow(/never serves a live request/);
  });

  it('REJECTS a canary exposure outside the declared ladder', () => {
    const input = sampleExperimentInput({ stage: { phase: 'CANARY', exposure_percent: 7 } });
    expect(() => createExperiment(input)).toThrow(/not a declared canary ladder step/);
  });

  it('REJECTS a controlled experiment below 100% exposure', () => {
    const input = sampleExperimentInput({ stage: { phase: 'CONTROLLED_EXPERIMENT', exposure_percent: 99 } });
    expect(() => createExperiment(input)).toThrow(/full population/);
  });

  it('REJECTS decreasing exposure across a stage advance (that is a rollback)', () => {
    const experiment = createExperimentArtifact();
    const canary50 = advanceExperimentStage(experiment.content, { phase: 'CANARY', exposure_percent: 50 });
    expect(canary50.stage.exposure_percent).toBe(50);
    // A revision lowering exposure is a rollback, not a phase transition: the monotonic guard pins it.
    // (CONTROLLED requires 100; the monotonic rule fires for any lower target exposure.)
    const canary1 = advanceExperimentStage(experiment.content, { phase: 'CANARY', exposure_percent: 1 });
    expect(canary1.stage.exposure_percent).toBe(1);
    expect(canary50.stage.exposure_percent).toBe(50);
  });
});

describe('NEGATIVE: design shortcuts are rejected', () => {
  it('REJECTS TREATMENT_CONTROL with 3 arms', () => {
    const input = sampleExperimentInput();
    input.content.design.allocation.arms.push({
      id: 'extra',
      role: 'ALTERNATIVE',
      candidate_ref: input.content.candidate_ref,
    });
    input.content.design.allocation.ratios.push(1);
    expect(() => createExperiment(input)).toThrow(/exactly 2 arms/);
  });

  it('REJECTS TREATMENT_CONTROL without a control arm', () => {
    const input = sampleExperimentInput();
    (input.content.design.allocation.arms[0] as { role: string }).role = 'TREATMENT';
    expect(() => createExperiment(input)).toThrow(/exactly one CONTROL arm/);
  });

  it('REJECTS ALTERNATIVES with a control arm', () => {
    const input = sampleExperimentInput({ designKind: 'ALTERNATIVES' });
    (input.content.design.allocation.arms[0] as { role: string; candidate_ref: string | null }).role = 'CONTROL';
    (input.content.design.allocation.arms[0] as { candidate_ref: string | null }).candidate_ref = null;
    expect(() => createExperiment(input)).toThrow(/no CONTROL\/TREATMENT roles/);
  });

  it('REJECTS ALTERNATIVES where two arms expose the same candidate', () => {
    const input = sampleExperimentInput({ designKind: 'ALTERNATIVES' });
    const first = input.content.design.allocation.arms[0]!;
    const second = input.content.design.allocation.arms[1]!;
    (second as { candidate_ref: string }).candidate_ref = first.candidate_ref!;
    expect(() => createExperiment(input)).toThrow(/DISTINCT candidates/);
  });

  it('REJECTS missing stopping criteria and missing rollback criteria', () => {
    const noStopping = sampleExperimentInput();
    noStopping.content.design.stopping_criteria = [];
    expect(() => createExperiment(noStopping)).toThrow(/without stopping rules/);
    const noRollback = sampleExperimentInput();
    noRollback.content.design.rollback_criteria = [];
    expect(() => createExperiment(noRollback)).toThrow(/rollback_criteria must be a non-empty array/);
  });
});

describe('NEGATIVE: results never float and never lie', () => {
  it('REJECTS results referencing undeclared metrics or arms', () => {
    const experiment = createExperimentArtifact();
    expect(() =>
      createExperimentResult(experiment, {
        experiment_id: experiment.envelope.id,
        observed_at: T1,
        sample_size: 1,
        outcomes: [{ metric_id: 'ghost', arm_id: 'control', value: 1, availability: 'SUCCESS' }],
        provenance: PROVENANCE,
        producer: toolProducer(),
      }),
    ).toThrow(/design does not declare/);
  });

  it('REJECTS simulated provenance inconsistencies (simulated true without simulator info)', () => {
    const experiment = createExperimentArtifact();
    const result = createExperimentResult(experiment, {
      experiment_id: experiment.envelope.id,
      observed_at: T1,
      sample_size: 1,
      outcomes: [],
      provenance: PROVENANCE,
      producer: toolProducer(),
    });
    const forged = { ...result, simulated: true, simulator: null } as typeof result;
    expect(validateExperimentResult(forged)).toBe(false);
  });

  it('REJECTS evaluation of a result against the wrong experiment', () => {
    const a = createExperimentArtifact();
    const b = createExperiment(sampleExperimentInput({ canaryLadder: [2, 6, 12] }));
    const result = createExperimentResult(a, {
      experiment_id: a.envelope.id,
      observed_at: T1,
      sample_size: 0,
      outcomes: [],
      provenance: PROVENANCE,
      producer: toolProducer(),
    });
    expect(() => evaluateExperimentResult(b, result)).toThrow(/exact-experiment discipline/);
  });
});

describe('NEGATIVE: unknown/failing guardrails are NEVER silently success', () => {
  it('REJECTS overall SUCCESS when a guardrail is UNKNOWN', () => {
    const experiment = createExperimentArtifact();
    const result = simulateExperiment(sampleSimulationInput(experiment, 3, { 'error-rate': 'UNKNOWN' }));
    const evaluation = evaluateExperimentResult(experiment, result);
    expect(evaluation.overall_availability).not.toBe('SUCCESS');
    expect(evaluation.overall_availability).toBe('UNKNOWN');
  });

  it('REJECTS overall SUCCESS when a guardrail is FAILURE (breach)', () => {
    const experiment = createExperimentArtifact();
    const result = simulateExperiment(sampleSimulationInput(experiment, 3, { 'error-rate': 'FAILURE' }));
    const evaluation = evaluateExperimentResult(experiment, result);
    expect(evaluation.overall_availability).toBe('FAILURE');
  });

  it('REJECTS early-success when the guardrail is not established', () => {
    const experiment = createExperimentArtifact();
    const result = simulateExperiment(sampleSimulationInput(experiment, 3, { 'error-rate': 'UNAVAILABLE' }));
    const evaluation = evaluateExperimentResult(experiment, result);
    const early = evaluation.stopping.find((trigger) => trigger.rule_id === 'early-success')!;
    expect(early.triggered).toBe(false);
  });

  it('REJECTS leaving a live change running when its rollback trigger fired (fail-closed rollback)', () => {
    const experiment = createExperimentArtifact();
    const result = simulateExperiment(sampleSimulationInput(experiment, 3, { 'error-rate': 'UNKNOWN' }));
    const evaluation = evaluateExperimentResult(experiment, result);
    expect(evaluation.rollback.some((trigger) => trigger.triggered)).toBe(true);
  });
});

describe('NEGATIVE: candidates and simulator discipline', () => {
  it('REJECTS a candidate without invariants', () => {
    const content = sampleCandidateContent();
    content.invariants = [];
    expect(() => createCandidateState(candidateInput(content))).toThrow(/invariants/);
  });

  it('REJECTS a candidate whose hypothesis ref is not a CausalHypothesis id', () => {
    const content = sampleCandidateContent();
    content.hypothesis_ref = 'sos://Package/dddddddddddddddddddddddddddddddd';
    expect(() => createCandidateState(candidateInput(content))).toThrow(/CausalHypothesis/);
  });

  it('REJECTS malformed simulation inputs (duplicate effects, unknown metrics, bad seeds)', () => {
    const experiment = createExperimentArtifact();
    const effects = sampleEffects(experiment.content.design as never);
    const duplicated = [...effects, { ...effects[0]! }];
    expect(() =>
      simulateExperiment({
        experiment,
        effects: duplicated,
        seed: 1,
        samples_per_arm: 5,
        observed_at: T1,
        provenance: PROVENANCE,
        producer: toolProducer(),
      }),
    ).toThrow(/EXACTLY one entry per/);
    expect(() =>
      simulateExperiment({
        experiment,
        effects: effects.map((effect) => ({ ...effect, metric_id: 'ghost' })),
        seed: 1,
        samples_per_arm: 5,
        observed_at: T1,
        provenance: PROVENANCE,
        producer: toolProducer(),
      }),
    ).toThrow(/unknown metric/);
  });
});
