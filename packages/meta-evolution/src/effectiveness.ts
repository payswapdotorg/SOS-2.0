/**
 * Meta-evolution stage 4 — ADAPTATION EFFECTIVENESS (W16).
 *
 * Each guard-passing MetaChange is TRIAL-APPLIED to the process (a DRAFT
 * revision — evaluation-grade application, never live; activation happens
 * only through an ACT decision in stage 5) and MEASURED: before/after
 * objective values on the frozen §11 axes through the @sos-2/experiments
 * fixed-seed simulator (control arm = the current process parameters,
 * treatment arm = the trial parameters). The measurement is SIMULATED and
 * MACHINE-MARKED (assertSimulatedMeasurement — a measurement without the
 * simulated marker is a pipeline failure); simulated outcomes are NEVER
 * intervention evidence (the decision and promotion stages never receive
 * the simulated record — pinned by negative tests).
 *
 * The candidate fixture for the change is minted here (the W9
 * CandidateState contract) with the causal hypothesis — the decision and
 * promotion stages consume it.
 *
 * Links: candidate --DERIVED_FROM--> change; hypothesis --DERIVED_FROM-->
 * change; trial revision --DERIVED_FROM--> change; plus the experiment's
 * own VERIFIES/DERIVED_FROM links and the result's
 * VERIFIES/OBSERVES/CAUSED_BY links (minted by @sos-2/experiments).
 */

import {
  advanceExperimentStage,
  createExperiment,
  evaluateExperimentResult,
  experimentTraceLinks,
  resultTraceLinks,
  simulateExperiment,
  createCandidateState,
} from '@sos-2/experiments';
import type {
  CandidateStateFixture,
  ExperimentArtifact,
  ExperimentContent,
  ExperimentEvaluation,
  ExperimentResultRecord,
  StageExposure,
} from '@sos-2/experiments';
import { createQualitativeConfidence } from '@sos-2/evidence';
import type { EvidenceTruthState } from '@sos-2/semantic-spine';
import { deriveDeterministicArtifactId } from '@sos-2/semantic-spine';
import { GOVERNANCE_GUARD } from './guard.js';
import { GOVERNANCE_INVARIANT_IDS } from './guard.js';
import { MetaEvolutionError } from './errors.js';
import type { MetaEvolutionInput, MetaChangeSpec } from './input.js';
import type { EffectivenessStageRecord } from './stages.js';
import { metaTraceLink } from './trace.js';
import { applyMetaChange } from './process.js';
import type { MetaProcessArtifact, MetaProcessStore } from './process.js';
import type { MetaChangeArtifact } from './change.js';

export interface EffectivenessMeasurement {
  record: EffectivenessStageRecord['measurements'][number];
  change: MetaChangeArtifact;
  spec: MetaChangeSpec;
  candidate: CandidateStateFixture;
  hypothesisId: string;
  trial: MetaProcessArtifact;
  experiment: ExperimentArtifact;
  result: ExperimentResultRecord;
  evaluation: ExperimentEvaluation;
}

export interface EffectivenessStageOutput {
  record: EffectivenessStageRecord;
  measurements: EffectivenessMeasurement[];
  /** Guard-rejected changes never reach measurement (retained by the guard record). */
}

/**
 * THE SIMULATION MARKER GUARD: a meta effectiveness measurement MUST be
 * marked simulated. Exported for negative tests and console surfacing.
 */
export function assertSimulatedMeasurement(result: ExperimentResultRecord): void {
  if (result.simulated !== true) {
    throw new MetaEvolutionError(
      'SIMULATION_MARKER_MISSING',
      `effectiveness result ${result.id} is not marked simulated — meta measurements are deterministic fixed-seed simulations and must never be presented as intervention evidence`,
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
  throw new MetaEvolutionError('EFFECTIVENESS_UNMEASURED', `experiment evaluation produced an unknown overall availability: ${JSON.stringify(value)}`);
}

/** The governance invariant statements carried by every meta candidate. */
export function metaCandidateInvariants(): string[] {
  return [
    ...GOVERNANCE_INVARIANT_IDS.map(
      (invariant) => `the governance invariant ${invariant} remains enforced (the guard is outside the evolvable surface)`,
    ),
    'the change patches only the frozen evolvable parameter surface of the MetaProcess',
  ];
}

/** Mint the candidate fixture + causal hypothesis for one meta change. */
function mintCandidate(
  input: MetaEvolutionInput,
  change: MetaChangeArtifact,
  spec: MetaChangeSpec,
  process: MetaProcessArtifact,
): { candidate: CandidateStateFixture; hypothesisId: string } {
  const hypothesisId = deriveDeterministicArtifactId('CausalHypothesis', {
    statement: spec.hypothesis_statement,
    change: change.envelope.id,
    process: process.envelope.id,
  });
  const candidate = createCandidateState({
    content: {
      invariants: metaCandidateInvariants(),
      predicted_effects: [...spec.predicted_effects],
      causal_claim: true,
      confidence: createQualitativeConfidence('MODERATE'),
      base_subject_revision: `${process.envelope.id}@v${process.envelope.version}`,
      hypothesis_ref: hypothesisId,
      bounded_subgraph_ref: null,
      context: {
        domain: 'sos-meta',
        lane: 'META',
        change_key: spec.key,
        process: process.envelope.id,
      },
    },
    provenance: [...input.provenance, 'meta-evolution:candidate', `meta-evolution:spec:${spec.key}`],
    created_at: input.now,
    authority_ref: input.authority_ref,
    status: 'ACTIVE',
  });
  return { candidate, hypothesisId };
}

/** Run the effectiveness stage for one guard-passing change (deterministic, pure). */
export function measureChange(
  input: MetaEvolutionInput,
  change: MetaChangeArtifact,
  spec: MetaChangeSpec,
  head: MetaProcessArtifact,
  processStore: MetaProcessStore,
): EffectivenessMeasurement {
  const spec_ = input.effectiveness;

  // 1. The candidate fixture + causal hypothesis.
  const { candidate, hypothesisId } = mintCandidate(input, change, spec, head);

  // 2. The TRIAL application (DRAFT revision — evaluation-grade; the guard
  //    RE-RUNS inside applyMetaChange: bypass-impossible; the change may
  //    rebase onto a later revision of its target chain).
  const { trial } = applyMetaChange(head, change, GOVERNANCE_GUARD, {
    provenance: [...input.provenance, 'meta-evolution:trial-application'],
    created_at: input.now,
    authority_ref: input.authority_ref,
    notes: `trial application of meta change ${spec.key} (${change.envelope.id}) for effectiveness measurement`,
    targetInChain: (targetId: string): boolean => {
      try {
        return processStore.history(head.envelope.id).some((revision) => revision.envelope.id === targetId);
      } catch {
        return false;
      }
    },
  });
  processStore.put(trial);

  // 3. The §11-axis experiment: control (current parameters) vs treatment
  //    (trial parameters), advanced SHADOW -> CANARY -> CONTROLLED_EXPERIMENT.
  const shadow: StageExposure = { phase: 'SHADOW', exposure_percent: 0 };
  let content: ExperimentContent = {
    design: {
      kind: 'TREATMENT_CONTROL',
      population: {
        description: spec_.population_description,
        unit: spec_.unit,
        context: { domain: 'sos-meta', process: head.envelope.id, change: change.envelope.id },
      },
      allocation: {
        unit: spec_.unit,
        assignment: 'RANDOM',
        arms: [
          { id: 'control', role: 'CONTROL', candidate_ref: null },
          { id: 'treatment', role: 'TREATMENT', candidate_ref: candidate.envelope.id },
        ],
        ratios: [1, 1],
      },
      metrics: spec_.metrics,
      stopping_criteria: spec_.stopping_criteria,
      rollback_criteria: spec_.rollback_criteria,
    },
    stage: shadow,
    canary_ladder: spec_.canary_ladder,
    candidate_ref: candidate.envelope.id,
    hypothesis_ref: hypothesisId,
    producer: input.producer,
  };
  const canary = advanceExperimentStage(content, { phase: 'CANARY', exposure_percent: spec_.canary_exposure_percent });
  const controlled = advanceExperimentStage(canary, { phase: 'CONTROLLED_EXPERIMENT' });
  content = controlled;

  let experiment: ExperimentArtifact;
  try {
    experiment = createExperiment({
      content,
      provenance: [...input.provenance, 'meta-evolution:simulated-effectiveness', `meta-evolution:change:${change.envelope.id}`],
      created_at: input.now,
      authority_ref: input.authority_ref,
      status: 'ACTIVE',
    });
  } catch (cause) {
    throw new MetaEvolutionError('EFFECTIVENESS_UNMEASURED', `effectiveness experiment creation failed: ${(cause as Error).message}`);
  }

  // 4. The fixed-seed simulation (identical seed + input -> bit-identical).
  let result: ExperimentResultRecord;
  try {
    result = simulateExperiment({
      experiment,
      effects: spec.effects,
      seed: spec_.seed,
      samples_per_arm: spec_.samples_per_arm,
      observed_at: input.now,
      provenance: [...input.provenance, 'meta-evolution:fixed-seed-simulation'],
      producer: input.producer,
    });
  } catch (cause) {
    throw new MetaEvolutionError('EFFECTIVENESS_UNMEASURED', `effectiveness simulation failed: ${(cause as Error).message}`);
  }

  // THE SIMULATION MARKER INVARIANT: outcomes are marked, never hidden.
  assertSimulatedMeasurement(result);

  let evaluation: ExperimentEvaluation;
  try {
    evaluation = evaluateExperimentResult(experiment, result);
  } catch (cause) {
    throw new MetaEvolutionError('EFFECTIVENESS_UNMEASURED', `effectiveness evaluation failed: ${(cause as Error).message}`);
  }

  // 5. The before/after objective values (control = before, treatment = after).
  const metricIds = spec_.metrics.map((metric) => metric.id);
  const outcomeOf = (armId: string, metricId: string): number | null => {
    const outcome = result.outcomes.find((entry) => entry.arm_id === armId && entry.metric_id === metricId);
    return outcome === undefined ? null : outcome.value;
  };
  const before: Record<string, number> = {};
  const after: Record<string, number> = {};
  const deltas: Record<string, number> = {};
  for (const metricId of metricIds) {
    const controlValue = outcomeOf('control', metricId);
    const treatmentValue = outcomeOf('treatment', metricId);
    if (controlValue !== null) {
      before[metricId] = controlValue;
    }
    if (treatmentValue !== null) {
      after[metricId] = treatmentValue;
    }
    if (controlValue !== null && treatmentValue !== null) {
      deltas[metricId] = treatmentValue - controlValue;
    }
  }

  const rollbackFired = evaluation.rollback.some((trigger) => trigger.triggered);
  const effective = !rollbackFired && evaluation.overall_availability === 'SUCCESS';

  const record: EffectivenessStageRecord['measurements'][number] = {
    change_id: change.envelope.id,
    candidate_id: candidate.envelope.id,
    trial_revision_id: trial.envelope.id,
    experiment_id: experiment.envelope.id,
    result_id: result.id,
    simulated: true,
    seed: spec_.seed,
    before,
    after,
    deltas,
    guardrails: evaluation.guardrails.map((guardrail) => ({
      metric_id: guardrail.metric_id,
      arm_id: guardrail.arm_id,
      status: guardrail.status,
    })),
    rollback_triggers_fired: evaluation.rollback.filter((trigger) => trigger.triggered).length,
    overall_availability: asTruthState(evaluation.overall_availability),
    effective,
  };

  return { record, change, spec, candidate, hypothesisId, trial, experiment, result, evaluation };
}

/** Assemble the full stage record over the measured changes. */
export function assembleEffectivenessRecord(
  input: MetaEvolutionInput,
  measurements: readonly EffectivenessMeasurement[],
): EffectivenessStageRecord {
  const links = measurements.flatMap((measurement) => [
    metaTraceLink({
      source: measurement.candidate.envelope.id,
      target: measurement.change.envelope.id,
      type: 'DERIVED_FROM',
      provenance: [...input.provenance, 'meta-evolution:stage:effectiveness', `meta-evolution:spec:${measurement.spec.key}`],
    }),
    metaTraceLink({
      source: measurement.hypothesisId,
      target: measurement.change.envelope.id,
      type: 'DERIVED_FROM',
      provenance: [...input.provenance, 'meta-evolution:stage:effectiveness', `meta-evolution:hypothesis:${measurement.hypothesisId}`],
    }),
    metaTraceLink({
      source: measurement.trial.envelope.id,
      target: measurement.change.envelope.id,
      type: 'DERIVED_FROM',
      provenance: [...input.provenance, 'meta-evolution:stage:effectiveness', `meta-evolution:trial:${measurement.trial.envelope.id}`],
    }),
    ...experimentTraceLinks(measurement.experiment),
    ...resultTraceLinks(measurement.result),
  ]);
  return {
    stage: 'EFFECTIVENESS',
    input_refs: measurements.map((measurement) => measurement.change.envelope.id),
    output_refs: measurements.flatMap((measurement) => [
      measurement.candidate.envelope.id,
      measurement.hypothesisId,
      measurement.trial.envelope.id,
      measurement.experiment.envelope.id,
      measurement.result.id,
    ]),
    links,
    measurements: measurements.map((measurement) => measurement.record),
  };
}
