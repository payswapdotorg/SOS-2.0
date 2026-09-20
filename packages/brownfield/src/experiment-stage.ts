/**
 * Brownfield stage 6 — EXPERIMENT (W15).
 *
 * A deterministic, fixed-seed SIMULATED controlled experiment over the
 * candidate (@sos-2/experiments):
 *   - the design is TREATMENT_CONTROL with typed population/allocation,
 *     PRIMARY/SECONDARY/GUARDRAIL metrics and stopping + rollback criteria
 *     wired to the guardrail metric ids;
 *   - the lifecycle advances strictly SHADOW -> CANARY -> CONTROLLED_EXPERIMENT
 *     before creation (the ladder is retained in the stage record);
 *   - simulateExperiment runs with the FIXED seed (identical seed + input ->
 *     bit-identical results) and the outcome record is marked `simulated`;
 *   - THE MARKER IS MACHINE-CHECKED: a result without the simulated marker
 *     is a pipeline failure (assertSimulatedOutcome) — simulated outcomes
 *     are NEVER intervention evidence (the promotion gate rejects them
 *     loudly; pinned by negative tests).
 *
 * Links: the experiment's own VERIFIES/DERIVED_FROM links and the result's
 * VERIFIES/OBSERVES/CAUSED_BY links (minted by @sos-2/experiments).
 */

import { createExperiment, advanceExperimentStage, simulateExperiment, evaluateExperimentResult, experimentTraceLinks, resultTraceLinks } from '@sos-2/experiments';
import type { ExperimentArtifact, ExperimentContent, ExperimentResultRecord, ExperimentEvaluation, StageExposure } from '@sos-2/experiments';
import type { CandidateStateFixture } from '@sos-2/experiments';
import type { SystemStateArtifact } from '@sos-2/system-state';
import type { EvidenceTruthState } from '@sos-2/semantic-spine';
import { BrownfieldError } from './errors.js';
import type { BrownfieldLoopInput } from './input.js';
import type { ExperimentStageRecord } from './stages.js';

/** Everything stage 6 produces. */
export interface ExperimentStageOutput {
  record: ExperimentStageRecord;
  experiment: ExperimentArtifact;
  result: ExperimentResultRecord;
  evaluation: ExperimentEvaluation;
  lifecycle: StageExposure[];
}

/**
 * THE SIMULATION MARKER GUARD: a brownfield experiment outcome MUST be
 * marked simulated. Exported for negative tests and console surfacing.
 */
export function assertSimulatedOutcome(result: ExperimentResultRecord): void {
  if (result.simulated !== true) {
    throw new BrownfieldError(
      'SIMULATION_MARKER_MISSING',
      `experiment result ${result.id} is not marked simulated — brownfield loop outcomes are deterministic fixed-seed simulations and must never be presented as intervention evidence`,
    );
  }
}

const TRUTH_STATES = ['SUCCESS', 'FAILURE', 'UNKNOWN', 'UNAVAILABLE', 'UNSUPPORTED', 'PARTIAL'] as const;

function asTruthState(value: string): EvidenceTruthState {
  for (const state of TRUTH_STATES) {
    if (state === value) {
      return state;
    }
  }
  throw new BrownfieldError('PROMOTION_EVALUATION_FAILED', `experiment evaluation produced an unknown overall availability: ${JSON.stringify(value)}`);
}

/** Run the (simulated) experiment stage (deterministic, pure). */
export function runExperimentStage(input: BrownfieldLoopInput, candidateState: CandidateStateFixture, hypothesisId: string, _systemState: SystemStateArtifact): ExperimentStageOutput {
  const spec = input.experiment;
  const shadow: StageExposure = { phase: 'SHADOW', exposure_percent: 0 };
  let content: ExperimentContent = {
    design: {
      kind: 'TREATMENT_CONTROL',
      population: {
        description: spec.population_description,
        unit: spec.unit,
        context: { environment: input.goal.query_context['environment'] ?? 'production', system: input.snapshot.system_name },
      },
      allocation: {
        unit: spec.unit,
        assignment: 'RANDOM',
        arms: [
          { id: 'control', role: 'CONTROL', candidate_ref: null },
          { id: 'treatment', role: 'TREATMENT', candidate_ref: candidateState.envelope.id },
        ],
        ratios: [1, 1],
      },
      metrics: spec.metrics,
      stopping_criteria: spec.stopping_criteria,
      rollback_criteria: spec.rollback_criteria,
    },
    stage: shadow,
    canary_ladder: spec.canary_ladder,
    candidate_ref: candidateState.envelope.id,
    hypothesis_ref: hypothesisId,
    producer: input.producer,
  };
  const canary = advanceExperimentStage(content, { phase: 'CANARY', exposure_percent: spec.canary_exposure_percent });
  const controlled = advanceExperimentStage(canary, { phase: 'CONTROLLED_EXPERIMENT' });
  content = controlled;
  const lifecycle: StageExposure[] = [shadow, { phase: 'CANARY', exposure_percent: spec.canary_exposure_percent }, controlled.stage];

  let experiment: ExperimentArtifact;
  try {
    experiment = createExperiment({
      content,
      provenance: [...input.provenance, 'brownfield:simulated-experiment', `brownfield:candidate:${candidateState.envelope.id}`],
      created_at: input.now,
      authority_ref: input.authority_ref,
      status: 'ACTIVE',
    });
  } catch (cause) {
    throw new BrownfieldError('PROMOTION_EVALUATION_FAILED', `experiment creation failed: ${(cause as Error).message}`);
  }

  let result: ExperimentResultRecord;
  try {
    result = simulateExperiment({
      experiment,
      effects: spec.effects,
      seed: spec.seed,
      samples_per_arm: spec.samples_per_arm,
      observed_at: input.now,
      provenance: [...input.provenance, 'brownfield:fixed-seed-simulation'],
      producer: input.producer,
    });
  } catch (cause) {
    throw new BrownfieldError('PROMOTION_EVALUATION_FAILED', `experiment simulation failed: ${(cause as Error).message}`);
  }

  // THE SIMULATION MARKER INVARIANT (W15): outcomes are marked, never hidden.
  assertSimulatedOutcome(result);

  let evaluation: ExperimentEvaluation;
  try {
    evaluation = evaluateExperimentResult(experiment, result);
  } catch (cause) {
    throw new BrownfieldError('PROMOTION_EVALUATION_FAILED', `experiment evaluation failed: ${(cause as Error).message}`);
  }

  const links = [...experimentTraceLinks(experiment), ...resultTraceLinks(result)];

  const record: ExperimentStageRecord = {
    stage: 'EXPERIMENT',
    input_refs: [candidateState.envelope.id],
    output_refs: [experiment.envelope.id, result.id],
    links,
    experiment_id: experiment.envelope.id,
    result_id: result.id,
    simulated: true,
    seed: spec.seed,
    samples_per_arm: spec.samples_per_arm,
    lifecycle: lifecycle.map((stage) => ({ phase: stage.phase, exposure_percent: stage.exposure_percent })),
    overall_availability: asTruthState(evaluation.overall_availability),
    guardrails: evaluation.guardrails.map((guardrail) => ({
      metric_id: guardrail.metric_id,
      arm_id: guardrail.arm_id,
      status: guardrail.status,
    })),
    rollback_triggers: evaluation.rollback,
    stopping_triggers: evaluation.stopping,
  };

  return { record, experiment, result, evaluation, lifecycle };
}