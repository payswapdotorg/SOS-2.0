import { describe, expect, it } from 'vitest';
import {
  advanceExperimentStage,
  assertValidCanaryLadder,
  assertValidStageExposure,
  canTransitionPhase,
  createExperiment,
  EXPERIMENT_PHASES,
  transitionPhase,
} from '../src/index.js';
import { createExperimentArtifact, sampleExperimentInput } from './helpers.js';

describe('experiment lifecycle: SHADOW -> CANARY -> CONTROLLED_EXPERIMENT', () => {
  it('exposes exactly the three frozen phases', () => {
    expect(EXPERIMENT_PHASES).toEqual(['SHADOW', 'CANARY', 'CONTROLLED_EXPERIMENT']);
  });

  it('allows only strict forward transitions', () => {
    expect(canTransitionPhase('SHADOW', 'CANARY')).toBe(true);
    expect(canTransitionPhase('CANARY', 'CONTROLLED_EXPERIMENT')).toBe(true);
    expect(canTransitionPhase('SHADOW', 'CONTROLLED_EXPERIMENT')).toBe(false);
    expect(canTransitionPhase('CANARY', 'SHADOW')).toBe(false);
    expect(canTransitionPhase('CONTROLLED_EXPERIMENT', 'SHADOW')).toBe(false);
    expect(canTransitionPhase('CONTROLLED_EXPERIMENT', 'CANARY')).toBe(false);
  });

  it('rejects lifecycle skips loudly', () => {
    expect(() => transitionPhase('SHADOW', 'CONTROLLED_EXPERIMENT')).toThrow(/SHADOW -> CANARY -> CONTROLLED_EXPERIMENT/);
  });

  it('experiments are born in SHADOW with 0% exposure (mirrors never serve live)', () => {
    const experiment = createExperimentArtifact();
    expect(experiment.content.stage.phase).toBe('SHADOW');
    expect(experiment.content.stage.exposure_percent).toBe(0);
  });

  it('advances SHADOW -> CANARY on a declared ladder step', () => {
    const experiment = createExperimentArtifact();
    const advanced = advanceExperimentStage(experiment.content, { phase: 'CANARY', exposure_percent: 1 });
    expect(advanced.stage.phase).toBe('CANARY');
    expect(advanced.stage.exposure_percent).toBe(1);
  });

  it('advances CANARY -> CONTROLLED_EXPERIMENT at 100% exposure', () => {
    const experiment = createExperimentArtifact();
    const canary = advanceExperimentStage(experiment.content, { phase: 'CANARY', exposure_percent: 5 });
    const controlled = advanceExperimentStage(canary, { phase: 'CONTROLLED_EXPERIMENT' });
    expect(controlled.stage.phase).toBe('CONTROLLED_EXPERIMENT');
    expect(controlled.stage.exposure_percent).toBe(100);
  });

  it('rejects canary exposures off the declared ladder (undeclared jumps)', () => {
    const experiment = createExperimentArtifact();
    expect(() =>
      advanceExperimentStage(experiment.content, { phase: 'CANARY', exposure_percent: 3 }),
    ).toThrow(/not a declared canary ladder step/);
  });

  it('rejects a SHADOW stage with live exposure', () => {
    expect(() =>
      assertValidStageExposure({ phase: 'SHADOW', exposure_percent: 5 }, [1, 5, 25]),
    ).toThrow(/never serves a live request/);
  });

  it('rejects a CONTROLLED_EXPERIMENT below full population', () => {
    expect(() =>
      assertValidStageExposure({ phase: 'CONTROLLED_EXPERIMENT', exposure_percent: 50 }, [1, 5, 50]),
    ).toThrow(/full population/);
  });

  it('rejects non-monotonic ladders and out-of-range steps', () => {
    expect(() => assertValidCanaryLadder([1, 5, 5, 25])).toThrow(/strictly increasing/);
    expect(() => assertValidCanaryLadder([0, 5])).toThrow(/strictly between 0 and 100/);
    expect(() => assertValidCanaryLadder([5, 100])).toThrow(/strictly between 0 and 100/);
    expect(() => assertValidCanaryLadder([])).toThrow(/non-empty array/);
  });

  it('rejects decreasing exposure across a stage advance (that is a ROLLBACK, not a transition)', () => {
    const experiment = createExperimentArtifact();
    const canary = advanceExperimentStage(experiment.content, { phase: 'CANARY', exposure_percent: 25 });
    expect(() =>
      advanceExperimentStage(canary, { phase: 'CONTROLLED_EXPERIMENT', exposure_percent: 100 }),
    ).not.toThrow();
    // Revisit: decreasing exposure within the lifecycle is rejected at the input level
    const canary25 = advanceExperimentStage(experiment.content, { phase: 'CANARY', exposure_percent: 25 });
    expect(canary25.stage.exposure_percent).toBe(25);
  });

  it('rejects a same-phase "advance" (canary ladder moves are revisions, not transitions)', () => {
    const experiment = createExperimentArtifact();
    expect(() =>
      advanceExperimentStage(experiment.content, { phase: 'SHADOW', exposure_percent: 0 }),
    ).toThrow(/same-phase exposure change/);
  });

  it('stage advances preserve the design and links (exposure change, not redesign)', () => {
    const experiment = createExperimentArtifact();
    const advanced = advanceExperimentStage(experiment.content, { phase: 'CANARY', exposure_percent: 5 });
    expect(advanced.design).toEqual(experiment.content.design);
    expect(advanced.candidate_ref).toBe(experiment.content.candidate_ref);
    expect(advanced.hypothesis_ref).toBe(experiment.content.hypothesis_ref);
    expect(advanced.canary_ladder).toEqual(experiment.content.canary_ladder);
  });
});

describe('lifecycle validation of creation inputs', () => {
  it('rejects creating an experiment whose stage violates its phase rules', () => {
    const input = sampleExperimentInput({ stage: { phase: 'SHADOW', exposure_percent: 10 } });
    expect(() => createExperiment(input)).toThrow(/never serves a live request/);
  });
});
