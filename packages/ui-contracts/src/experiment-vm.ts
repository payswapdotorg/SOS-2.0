/**
 * ExperimentVM — the experiment-monitoring view model (Work Order W11;
 * spec/architecture.md §5 Experiment, §14 experimentation).
 *
 * A pure projection of an @sos-2/experiments ExperimentArtifact, its latest
 * result record and the W9 evaluation (guardrails, primary/secondary
 * metrics, stopping/rollback triggers). Every vocabulary — design kinds,
 * phases, staged exposure, metric roles, guardrail statuses, trigger
 * records, the 6 truth states — is IMPORTED from @sos-2/experiments and
 * @sos-2/semantic-spine; nothing is redefined here.
 *
 * TRUTH DISCIPLINE: the overall availability of the run is one of the 6
 * frozen truth states and is displayed EXACTLY as the W9 evaluation
 * derived it (SUCCESS is never inferred from silence; UNKNOWN stays
 * UNKNOWN).
 */

import { isArtifactId, isArtifactStatus, isEvidenceTruthState } from '@sos-2/semantic-spine';
import type { ArtifactStatus, EvidenceTruthState } from '@sos-2/semantic-spine';
import type {
  Allocation,
  ExperimentArtifact,
  ExperimentDesignKind,
  ExperimentEvaluation,
  ExperimentMetric,
  ExperimentResultRecord,
  GuardrailEvaluation,
  MetricEvaluation,
  Population,
  RollbackCriterion,
  StageExposure,
  StoppingCriterion,
  TriggerRecord,
} from '@sos-2/experiments';
import { EXPERIMENT_PHASES, assertValidExperiment } from '@sos-2/experiments';
import { UIContractError } from './errors.js';
import { assertValidRationaleChain } from './rationale.js';
import type { RationaleChain } from './rationale.js';

/** The experiment monitoring view model. */
export interface ExperimentVM {
  id: string;
  version: number;
  status: ArtifactStatus;
  created_at: string;
  design_kind: ExperimentDesignKind;
  population: Population;
  allocation: Allocation;
  metrics: ExperimentMetric[];
  stage: StageExposure;
  canary_ladder: number[];
  candidate_ref: string;
  hypothesis_ref: string;
  stopping_criteria: StoppingCriterion[];
  rollback_criteria: RollbackCriterion[];
  /** The observed run (latest result), or null when none is presented. */
  result: {
    id: string;
    observed_at: string;
    sample_size: number;
    /** The honest overall availability (one of the 6 frozen truth states). */
    overall_availability: EvidenceTruthState;
    simulated: boolean;
  } | null;
  /** Guardrail evaluations (SATISFIED | BREACHED | NOT_ESTABLISHED — imported). */
  guardrails: GuardrailEvaluation[];
  primary: MetricEvaluation[];
  secondary: MetricEvaluation[];
  /** Typed stopping trigger records with exact conditions. */
  stopping: TriggerRecord[];
  /** Typed rollback trigger records wired to guardrails. */
  rollback: TriggerRecord[];
  /** Upstream/downstream rationale + evidence (W11 acceptance). */
  rationale: RationaleChain;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

export interface ProjectExperimentInput {
  experiment: ExperimentArtifact;
  /** The latest result record, or null. */
  result: ExperimentResultRecord | null;
  /** The W9 evaluation of (experiment, result), or null. */
  evaluation: ExperimentEvaluation | null;
  rationale: RationaleChain;
}

/** Project an experiment (+ result + evaluation) onto the monitoring view model. */
export function projectExperiment(input: ProjectExperimentInput): ExperimentVM {
  assertValidExperiment(input.experiment);
  if (input.result !== null && input.result.experiment_id !== input.experiment.envelope.id) {
    throw new UIContractError(
      `result belongs to experiment ${input.result.experiment_id}, not ${input.experiment.envelope.id}`,
    );
  }
  if (input.rationale.subject_id !== input.experiment.envelope.id) {
    throw new UIContractError(
      `rationale chain subject ${JSON.stringify(input.rationale.subject_id)} does not match the experiment id ${JSON.stringify(input.experiment.envelope.id)}`,
    );
  }
  assertValidRationaleChain(input.rationale);

  const evaluation = input.evaluation;
  const vm: ExperimentVM = {
    id: input.experiment.envelope.id,
    version: input.experiment.envelope.version,
    status: input.experiment.envelope.status,
    created_at: input.experiment.envelope.created_at,
    design_kind: input.experiment.content.design.kind,
    population: structuredClone(input.experiment.content.design.population),
    allocation: structuredClone(input.experiment.content.design.allocation),
    metrics: structuredClone(input.experiment.content.design.metrics),
    stage: { ...input.experiment.content.stage },
    canary_ladder: [...input.experiment.content.canary_ladder],
    candidate_ref: input.experiment.content.candidate_ref,
    hypothesis_ref: input.experiment.content.hypothesis_ref,
    stopping_criteria: structuredClone(input.experiment.content.design.stopping_criteria),
    rollback_criteria: structuredClone(input.experiment.content.design.rollback_criteria),
    result:
      input.result === null
        ? null
        : {
            id: input.result.id,
            observed_at: input.result.observed_at,
            sample_size: input.result.sample_size,
            overall_availability:
              evaluation === null ? 'UNKNOWN' : (evaluation.overall_availability as EvidenceTruthState),
            simulated: input.result.simulated,
          },
    guardrails: evaluation === null ? [] : structuredClone(evaluation.guardrails),
    primary: evaluation === null ? [] : structuredClone(evaluation.primary),
    secondary: evaluation === null ? [] : structuredClone(evaluation.secondary),
    stopping: evaluation === null ? [] : structuredClone(evaluation.stopping),
    rollback: evaluation === null ? [] : structuredClone(evaluation.rollback),
    rationale: input.rationale,
  };
  assertValidExperimentVM(vm);
  return vm;
}

/** Validate an ExperimentVM (throws UIContractError). */
export function assertValidExperimentVM(value: unknown): asserts value is ExperimentVM {
  if (!isPlainObject(value)) {
    throw new UIContractError(`experiment view model must be an object, received: ${JSON.stringify(value)}`);
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  const expected = new Set([
    'id',
    'version',
    'status',
    'created_at',
    'design_kind',
    'population',
    'allocation',
    'metrics',
    'stage',
    'canary_ladder',
    'candidate_ref',
    'hypothesis_ref',
    'stopping_criteria',
    'rollback_criteria',
    'result',
    'guardrails',
    'primary',
    'secondary',
    'stopping',
    'rollback',
    'rationale',
  ]);
  if (keys.length !== expected.size || !keys.every((key) => expected.has(key))) {
    throw new UIContractError('experiment view model must have the exact W11 field set (design + lifecycle + evaluation + rationale)');
  }
  if (!isNonEmptyString(record['id']) || !isArtifactId(record['id'])) {
    throw new UIContractError('experiment view model id must be a well-formed spine artifact id');
  }
  if (!isArtifactStatus(record['status'])) {
    throw new UIContractError('experiment view model status must be from the frozen envelope vocabulary');
  }
  if (record['design_kind'] !== 'TREATMENT_CONTROL' && record['design_kind'] !== 'ALTERNATIVES') {
    throw new UIContractError('experiment view model design_kind must be TREATMENT_CONTROL or ALTERNATIVES');
  }
  const stage = record['stage'];
  if (
    !isPlainObject(stage) ||
    Object.keys(stage).length !== 2 ||
    !EXPERIMENT_PHASES.includes((stage as Record<string, unknown>)['phase'] as never)
  ) {
    throw new UIContractError('experiment view model stage must be { phase, exposure_percent } with a frozen phase');
  }
  for (const collection of [
    'metrics',
    'stopping_criteria',
    'rollback_criteria',
    'guardrails',
    'primary',
    'secondary',
    'stopping',
    'rollback',
  ] as const) {
    if (!Array.isArray(record[collection])) {
      throw new UIContractError(`experiment view model ${collection} must be an array`);
    }
  }
  if ((record['stopping_criteria'] as unknown[]).length === 0) {
    throw new UIContractError('experiment view model must carry its stopping criteria (experiments without stopping rules are rejected upstream)');
  }
  if ((record['rollback_criteria'] as unknown[]).length === 0) {
    throw new UIContractError('experiment view model must carry its rollback criteria (wired to guardrails)');
  }
  for (const guardrail of record['guardrails'] as GuardrailEvaluation[]) {
    if (guardrail.status !== 'SATISFIED' && guardrail.status !== 'BREACHED' && guardrail.status !== 'NOT_ESTABLISHED') {
      throw new UIContractError(
        `guardrail status must be SATISFIED, BREACHED or NOT_ESTABLISHED (fail-closed), received: ${JSON.stringify(guardrail.status)}`,
      );
    }
  }
  if (record['result'] !== null) {
    const result = record['result'] as Record<string, unknown>;
    if (!isPlainObject(result) || Object.keys(result).length !== 5) {
      throw new UIContractError('experiment result summary must have the exact field set { id, observed_at, sample_size, overall_availability, simulated }');
    }
    if (!isEvidenceTruthState(result['overall_availability'])) {
      throw new UIContractError(
        `experiment overall availability must be one of the 6 frozen truth states, received: ${JSON.stringify(result['overall_availability'])}`,
      );
    }
  }
  try {
    assertValidRationaleChain(record['rationale']);
  } catch (cause) {
    throw new UIContractError(`experiment view model rationale is invalid: ${(cause as Error).message}`);
  }
  const rationale = record['rationale'] as RationaleChain;
  if (rationale.subject_id !== record['id']) {
    throw new UIContractError('experiment view model rationale must bind this experiment id');
  }
  if (rationale.evidence_refs.length === 0) {
    throw new UIContractError(
      'experiment view model rationale must cite evidence (promotion is evidence gated — a run without evidence records is not yet evidence)',
    );
  }
}

/** Predicate form of assertValidExperimentVM. */
export function validateExperimentVM(value: unknown): value is ExperimentVM {
  try {
    assertValidExperimentVM(value);
    return true;
  } catch {
    return false;
  }
}
