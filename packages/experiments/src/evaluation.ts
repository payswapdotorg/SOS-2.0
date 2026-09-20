/**
 * Experiment EVALUATION — guardrails, primary metrics, overall availability
 * and typed stopping/rollback triggers (Work Order W9; spec/architecture.md
 * §5, §18; docs/assurance-model.md; docs/probabilistic-learning.md).
 *
 * THE FAIL-CLOSED GUARDRAIL RULE (locked semantics, pinned by tests):
 * a guardrail outcome is exactly one of three DISTINCT statuses:
 *
 *   SATISFIED        availability SUCCESS and the observed value is within
 *                   the declared threshold (INCREASE: value >= threshold;
 *                   DECREASE: value <= threshold)
 *   BREACHED         availability SUCCESS and the value violates the
 *                   threshold — OR availability FAILURE (a FAILING
 *                   guardrail is a breach, never a pass)
 *   NOT_ESTABLISHED  availability UNKNOWN / UNAVAILABLE / UNSUPPORTED /
 *                   PARTIAL, or no outcome observed at all (safety cannot
 *                   be certified — and is NEVER silently treated as
 *                   success)
 *
 * ROLLBACK TRIGGERS ARE FAIL-CLOSED: a rollback criterion fires when any of
 * its referenced guardrails is BREACHED **or** NOT_ESTABLISHED. An
 * unestablishable guardrail on a live change rolls the change back — the
 * conservative, honest reading of "a FAILING or UNKNOWN guardrail is never
 * silently treated as success" (spec §18: unknown, failed, unavailable and
 * unsupported remain distinct; each distinct non-success guardrail state
 * fails closed).
 *
 * OVERALL AVAILABILITY of a result (one of the 6 frozen truth states):
 *   FAILURE   any guardrail BREACHED, or any primary metric NOT_SATISFIED
 *             (established failure)
 *   UNKNOWN   no established failure, but some guardrail NOT_ESTABLISHED or
 *             some primary metric NOT_ESTABLISHED
 *   PARTIAL   primaries and guardrails all green, but some SECONDARY metric
 *             is established NOT_SATISFIED
 *   SUCCESS   every primary metric SATISFIED and every guardrail SATISFIED
 *             — SUCCESS requires ALL of them, never a silent pass
 *
 * Stopping rules evaluate with EXACT CONDITIONS (every condition listed
 * with its satisfied flag — auditable, deterministic, total).
 */

import { ExperimentError } from './errors.js';
import type { ExperimentArtifact } from './artifact.js';
import type { ExperimentMetric, MetricDirection, StoppingCriterion } from './design.js';
import type { ExperimentResultRecord, MetricOutcome } from './results.js';

// ---------------------------------------------------------------------------
// Guardrail evaluation
// ---------------------------------------------------------------------------

export const GUARDRAIL_STATUSES = ['SATISFIED', 'BREACHED', 'NOT_ESTABLISHED'] as const;

export type GuardrailStatus = (typeof GUARDRAIL_STATUSES)[number];

/** The evaluation of one guardrail metric against its declared threshold. */
export interface GuardrailEvaluation {
  metric_id: string;
  /** The arm whose outcome was evaluated (the candidate/treatment arm). */
  arm_id: string;
  status: GuardrailStatus;
  /** The exact truth state of the underlying outcome (distinct, never folded). */
  availability: string;
  /** The observed value (null when the outcome carries none). */
  observed_value: number | null;
  /** The declared breach threshold. */
  threshold: number;
  direction: MetricDirection;
  reason: string;
}

function outcomeFor(outcomes: readonly MetricOutcome[], metricId: string, armId: string): MetricOutcome | null {
  return outcomes.find((outcome) => outcome.metric_id === metricId && outcome.arm_id === armId) ?? null;
}

function thresholdBreached(value: number, threshold: number, direction: MetricDirection): boolean {
  return direction === 'INCREASE' ? value < threshold : value > threshold;
}

/** Evaluate ONE guardrail metric on the candidate arm (fail-closed). */
export function evaluateGuardrail(
  experiment: ExperimentArtifact,
  result: ExperimentResultRecord,
  metric: ExperimentMetric,
): GuardrailEvaluation {
  if (metric.role !== 'GUARDRAIL') {
    throw new ExperimentError(`evaluateGuardrail requires a GUARDRAIL metric, received role ${JSON.stringify(metric.role)}`);
  }
  if (metric.guardrail_threshold === undefined) {
    throw new ExperimentError(
      `guardrail metric ${JSON.stringify(metric.id)} has no threshold (validated at construction — unreachable)`,
    );
  }
  const armId = experiment.content.design.allocation.arms.find(
    (arm) => arm.candidate_ref === experiment.content.candidate_ref,
  )?.id;
  if (armId === undefined) {
    throw new ExperimentError('candidate arm not found (validated at construction — unreachable)');
  }
  const outcome = outcomeFor(result.outcomes, metric.id, armId);
  if (outcome === null) {
    return {
      metric_id: metric.id,
      arm_id: armId,
      status: 'NOT_ESTABLISHED',
      availability: 'UNAVAILABLE',
      observed_value: null,
      threshold: metric.guardrail_threshold,
      direction: metric.direction,
      reason: `guardrail ${metric.id} has no outcome on the candidate arm ${armId} — safety cannot be established`,
    };
  }
  if (outcome.availability === 'SUCCESS') {
    const value = outcome.value as number;
    if (thresholdBreached(value, metric.guardrail_threshold, metric.direction)) {
      return {
        metric_id: metric.id,
        arm_id: armId,
        status: 'BREACHED',
        availability: outcome.availability,
        observed_value: value,
        threshold: metric.guardrail_threshold,
        direction: metric.direction,
        reason: `guardrail ${metric.id} observed ${value} on arm ${armId}, breaching threshold ${metric.guardrail_threshold} (direction ${metric.direction})`,
      };
    }
    return {
      metric_id: metric.id,
      arm_id: armId,
      status: 'SATISFIED',
      availability: outcome.availability,
      observed_value: value,
      threshold: metric.guardrail_threshold,
      direction: metric.direction,
      reason: `guardrail ${metric.id} observed ${value} on arm ${armId}, within threshold ${metric.guardrail_threshold} (direction ${metric.direction})`,
    };
  }
  if (outcome.availability === 'FAILURE') {
    // A FAILING guardrail is a breach — never a pass, never "unknown".
    return {
      metric_id: metric.id,
      arm_id: armId,
      status: 'BREACHED',
      availability: outcome.availability,
      observed_value: outcome.value,
      threshold: metric.guardrail_threshold,
      direction: metric.direction,
      reason: `guardrail ${metric.id} reported FAILURE on arm ${armId} — a failing guardrail is a breach (fail-closed)`,
    };
  }
  return {
    metric_id: metric.id,
    arm_id: armId,
    status: 'NOT_ESTABLISHED',
    availability: outcome.availability,
    observed_value: null,
    threshold: metric.guardrail_threshold,
    direction: metric.direction,
    reason: `guardrail ${metric.id} is ${outcome.availability} on arm ${armId} — safety cannot be established (never silently treated as success)`,
  };
}

// ---------------------------------------------------------------------------
// Primary / secondary metric evaluation (treatment vs control / alternatives)
// ---------------------------------------------------------------------------

export const METRIC_EVALUATION_STATUSES = ['SATISFIED', 'NOT_SATISFIED', 'NOT_ESTABLISHED'] as const;

export type MetricEvaluationStatus = (typeof METRIC_EVALUATION_STATUSES)[number];

/** The evaluation of one non-guardrail metric against the design's comparison semantics. */
export interface MetricEvaluation {
  metric_id: string;
  status: MetricEvaluationStatus;
  /** The exact truth state classification driving the status. */
  classification: string;
  candidate_arm_id: string;
  candidate_value: number | null;
  /** Comparison values per competing arm (control for TREATMENT_CONTROL; all others for ALTERNATIVES). */
  comparison: { arm_id: string; value: number | null }[];
  direction: MetricDirection;
  reason: string;
}

function comparisonArmIds(experiment: ExperimentArtifact): string[] {
  const arms = experiment.content.design.allocation.arms;
  if (experiment.content.design.kind === 'TREATMENT_CONTROL') {
    return arms.filter((arm) => arm.role === 'CONTROL').map((arm) => arm.id);
  }
  return arms.filter((arm) => arm.candidate_ref !== experiment.content.candidate_ref).map((arm) => arm.id);
}

function valueImproves(direction: MetricDirection, candidate: number, other: number): boolean {
  return direction === 'INCREASE' ? candidate > other : candidate < other;
}

function valueWeaklyOptimal(direction: MetricDirection, candidate: number, others: readonly number[]): boolean {
  return others.every((other) => (direction === 'INCREASE' ? candidate >= other : candidate <= other));
}

/** Evaluate one PRIMARY or SECONDARY metric (comparison per design kind). */
export function evaluateMetric(
  experiment: ExperimentArtifact,
  result: ExperimentResultRecord,
  metric: ExperimentMetric,
): MetricEvaluation {
  if (metric.role === 'GUARDRAIL') {
    throw new ExperimentError(
      `evaluateMetric requires a PRIMARY or SECONDARY metric, received role ${JSON.stringify(metric.role)} (guardrails are evaluated by evaluateGuardrail)`,
    );
  }
  const candidateArm = experiment.content.design.allocation.arms.find(
    (arm) => arm.candidate_ref === experiment.content.candidate_ref,
  );
  if (candidateArm === undefined) {
    throw new ExperimentError('candidate arm not found (validated at construction — unreachable)');
  }
  const candidateOutcome = outcomeFor(result.outcomes, metric.id, candidateArm.id);
  if (candidateOutcome === null) {
    return {
      metric_id: metric.id,
      status: 'NOT_ESTABLISHED',
      classification: 'NO_OUTCOME',
      candidate_arm_id: candidateArm.id,
      candidate_value: null,
      comparison: [],
      direction: metric.direction,
      reason: `metric ${metric.id} has no outcome on the candidate arm ${candidateArm.id}`,
    };
  }
  const comparators = comparisonArmIds(experiment).map((armId) => ({
    armId,
    outcome: outcomeFor(result.outcomes, metric.id, armId),
  }));
  const comparison = comparators.map(({ armId, outcome }) => ({
    arm_id: armId,
    value: outcome === null ? null : outcome.value,
  }));
  const anyMissing = comparators.some(({ outcome }) => outcome === null);
  if (anyMissing || candidateOutcome.availability !== 'SUCCESS') {
    return {
      metric_id: metric.id,
      status: 'NOT_ESTABLISHED',
      classification: candidateOutcome.availability !== 'SUCCESS' ? candidateOutcome.availability : 'NO_OUTCOME',
      candidate_arm_id: candidateArm.id,
      candidate_value: candidateOutcome.value,
      comparison,
      direction: metric.direction,
      reason: `metric ${metric.id} cannot be compared: candidate outcome is ${candidateOutcome.availability} or a comparison arm has no outcome`,
    };
  }
  for (const { outcome } of comparators) {
    if (outcome === null) {
      // unreachable after anyMissing check; kept for noUncheckedIndexedAccess discipline
      continue;
    }
    if (outcome.availability !== 'SUCCESS') {
      return {
        metric_id: metric.id,
        status: 'NOT_ESTABLISHED',
        classification: outcome.availability,
        candidate_arm_id: candidateArm.id,
        candidate_value: candidateOutcome.value,
        comparison,
        direction: metric.direction,
        reason: `metric ${metric.id} cannot be compared: comparison outcome is ${outcome.availability}`,
      };
    }
  }
  const candidateValue = candidateOutcome.value as number;
  const designKind = experiment.content.design.kind;
  let satisfied: boolean;
  let reason: string;
  if (designKind === 'TREATMENT_CONTROL') {
    const control = comparators[0]!;
    const controlValue = control.outcome!.value as number;
    satisfied = valueImproves(metric.direction, candidateValue, controlValue);
    reason = `metric ${metric.id}: candidate arm ${candidateArm.id} observed ${candidateValue} vs control ${control.armId} observed ${controlValue} (direction ${metric.direction})`;
  } else {
    const otherValues = comparators.map(({ outcome }) => outcome!.value as number);
    satisfied = valueWeaklyOptimal(metric.direction, candidateValue, otherValues);
    reason = `metric ${metric.id}: candidate arm ${candidateArm.id} observed ${candidateValue} vs alternatives ${JSON.stringify(otherValues)} (weak optimality, direction ${metric.direction})`;
  }
  return {
    metric_id: metric.id,
    status: satisfied ? 'SATISFIED' : 'NOT_SATISFIED',
    classification: 'ESTABLISHED',
    candidate_arm_id: candidateArm.id,
    candidate_value: candidateValue,
    comparison,
    direction: metric.direction,
    reason,
  };
}

// ---------------------------------------------------------------------------
// Typed trigger records
// ---------------------------------------------------------------------------

export const TRIGGER_KINDS = ['STOPPING', 'ROLLBACK'] as const;

export type TriggerKind = (typeof TRIGGER_KINDS)[number];

/** One exact condition check inside a trigger evaluation. */
export interface ConditionCheck {
  /** The condition, stated exactly (non-empty). */
  condition: string;
  /** Whether the condition held. */
  satisfied: boolean;
}

/**
 * A typed trigger record with EXACT conditions: what rule fired (or did
 * not), why, and every condition that was evaluated with its truth value.
 */
export interface TriggerRecord {
  kind: TriggerKind;
  /** The rule/criterion id (stopping kind name or rollback criterion id). */
  rule_id: string;
  /** What the rule says (non-empty). */
  description: string;
  /** Whether the trigger fired. */
  triggered: boolean;
  /** Why it did or did not fire (non-empty). */
  reason: string;
  /** The exact conditions evaluated (possibly empty for pure-count rules). */
  conditions: ConditionCheck[];
}

// ---------------------------------------------------------------------------
// Overall evaluation
// ---------------------------------------------------------------------------

/** The complete evaluation of one result against one experiment. */
export interface ExperimentEvaluation {
  /** The honest overall availability (one of the 6 frozen truth states). */
  overall_availability: string;
  guardrails: GuardrailEvaluation[];
  primary: MetricEvaluation[];
  secondary: MetricEvaluation[];
  stopping: TriggerRecord[];
  rollback: TriggerRecord[];
}

function rfc3339ToEpochMs(timestamp: string): number {
  const millis = Date.parse(timestamp);
  if (Number.isNaN(millis)) {
    throw new ExperimentError(`unparseable RFC3339 timestamp: ${JSON.stringify(timestamp)}`);
  }
  return millis;
}

/**
 * Evaluate a full result: guardrails, primaries, secondaries, overall
 * availability, stopping triggers and rollback triggers. Deterministic and
 * total for every valid (experiment, result) pair.
 */
export function evaluateExperimentResult(
  experiment: ExperimentArtifact,
  result: ExperimentResultRecord,
): ExperimentEvaluation {
  if (result.experiment_id !== experiment.envelope.id) {
    throw new ExperimentError(
      `result belongs to experiment ${result.experiment_id}, not ${experiment.envelope.id} (exact-experiment discipline)`,
    );
  }
  const design = experiment.content.design;
  const guardrails = design.metrics
    .filter((metric) => metric.role === 'GUARDRAIL')
    .map((metric) => evaluateGuardrail(experiment, result, metric));
  const primary = design.metrics
    .filter((metric) => metric.role === 'PRIMARY')
    .map((metric) => evaluateMetric(experiment, result, metric));
  const secondary = design.metrics
    .filter((metric) => metric.role === 'SECONDARY')
    .map((metric) => evaluateMetric(experiment, result, metric));

  const stopping = evaluateStoppingCriteria(experiment, result, guardrails, primary);
  const rollback = evaluateRollbackCriteria(experiment, guardrails);

  let overall: string;
  const anyGuardrailBreached = guardrails.some((evaluation) => evaluation.status === 'BREACHED');
  const anyPrimaryNotSatisfied = primary.some((evaluation) => evaluation.status === 'NOT_SATISFIED');
  const anyGuardrailNotEstablished = guardrails.some((evaluation) => evaluation.status === 'NOT_ESTABLISHED');
  const anyPrimaryNotEstablished = primary.some((evaluation) => evaluation.status === 'NOT_ESTABLISHED');
  const anySecondaryNotSatisfied = secondary.some((evaluation) => evaluation.status === 'NOT_SATISFIED');
  if (anyGuardrailBreached || anyPrimaryNotSatisfied) {
    overall = 'FAILURE';
  } else if (anyGuardrailNotEstablished || anyPrimaryNotEstablished) {
    overall = 'UNKNOWN';
  } else if (anySecondaryNotSatisfied) {
    overall = 'PARTIAL';
  } else {
    overall = 'SUCCESS';
  }

  return {
    overall_availability: overall,
    guardrails,
    primary,
    secondary,
    stopping,
    rollback,
  };
}

// ---------------------------------------------------------------------------
// Stopping criteria (typed rules with exact conditions)
// ---------------------------------------------------------------------------

function evaluateStoppingCriteria(
  experiment: ExperimentArtifact,
  result: ExperimentResultRecord,
  guardrails: readonly GuardrailEvaluation[],
  primary: readonly MetricEvaluation[],
): TriggerRecord[] {
  const records: TriggerRecord[] = [];
  for (const criterion of experiment.content.design.stopping_criteria) {
    records.push(evaluateStoppingCriterion(experiment, result, criterion, guardrails, primary));
  }
  return records;
}

function evaluateStoppingCriterion(
  experiment: ExperimentArtifact,
  result: ExperimentResultRecord,
  criterion: StoppingCriterion,
  guardrails: readonly GuardrailEvaluation[],
  primary: readonly MetricEvaluation[],
): TriggerRecord {
  if (criterion.kind === 'MAX_SAMPLES') {
    const triggered = result.sample_size >= criterion.max_samples;
    return {
      kind: 'STOPPING',
      rule_id: 'max-samples',
      description: `stop when the observed sample size reaches ${criterion.max_samples} allocation units`,
      triggered,
      reason: `observed sample size ${result.sample_size} ${triggered ? 'reached' : 'has not reached'} ${criterion.max_samples}`,
      conditions: [
        { condition: `sample_size (${result.sample_size}) >= ${criterion.max_samples}`, satisfied: triggered },
      ],
    };
  }
  if (criterion.kind === 'MAX_DURATION_SECONDS') {
    const elapsedMs = rfc3339ToEpochMs(result.observed_at) - rfc3339ToEpochMs(experiment.envelope.created_at);
    const elapsedSeconds = elapsedMs / 1000;
    const triggered = elapsedSeconds >= criterion.max_duration_seconds;
    return {
      kind: 'STOPPING',
      rule_id: 'max-duration-seconds',
      description: `stop when the experiment has run for ${criterion.max_duration_seconds} seconds`,
      triggered,
      reason: `elapsed ${elapsedSeconds.toFixed(3)}s ${triggered ? 'reached' : 'has not reached'} ${criterion.max_duration_seconds}s`,
      conditions: [
        {
          condition: `elapsed_seconds (${elapsedSeconds.toFixed(3)}) >= ${criterion.max_duration_seconds}`,
          satisfied: triggered,
        },
      ],
    };
  }
  if (criterion.kind === 'EARLY_SUCCESS') {
    const primaryConditions: ConditionCheck[] = primary.map((evaluation) => ({
      condition: `primary metric ${evaluation.metric_id} is SATISFIED`,
      satisfied: evaluation.status === 'SATISFIED',
    }));
    const guardrailConditions: ConditionCheck[] = guardrails.map((evaluation) => ({
      condition: `guardrail ${evaluation.metric_id} is SATISFIED`,
      satisfied: evaluation.status === 'SATISFIED',
    }));
    const conditions = [...primaryConditions, ...guardrailConditions];
    const triggered = conditions.every((condition) => condition.satisfied);
    return {
      kind: 'STOPPING',
      rule_id: 'early-success',
      description: criterion.description,
      triggered,
      reason: triggered
        ? 'every primary metric is satisfied and every guardrail is satisfied'
        : 'early success requires every primary metric AND every guardrail satisfied — at least one is not',
      conditions,
    };
  }
  // SAFETY
  const guardrailConditions: ConditionCheck[] = guardrails.map((evaluation) => ({
    condition: `guardrail ${evaluation.metric_id} is ${evaluation.status}`,
    satisfied: evaluation.status !== 'SATISFIED',
  }));
  const triggered = guardrailConditions.some((condition) => condition.satisfied);
  return {
    kind: 'STOPPING',
    rule_id: 'safety',
    description: criterion.description,
    triggered,
    reason: triggered
      ? 'at least one guardrail is not SATISFIED — the experiment stops for safety (fail-closed)'
      : 'every guardrail is SATISFIED',
    conditions: guardrailConditions,
  };
}

// ---------------------------------------------------------------------------
// Rollback criteria (fail-closed, wired to guardrail records)
// ---------------------------------------------------------------------------

function evaluateRollbackCriteria(
  experiment: ExperimentArtifact,
  guardrails: readonly GuardrailEvaluation[],
): TriggerRecord[] {
  const records: TriggerRecord[] = [];
  for (const criterion of experiment.content.design.rollback_criteria) {
    const conditions: ConditionCheck[] = criterion.guardrail_metric_ids.map((metricId) => {
      const evaluation = guardrails.find((entry) => entry.metric_id === metricId);
      if (evaluation === undefined) {
        return {
          condition: `guardrail ${metricId} has no evaluation`,
          satisfied: true,
        };
      }
      return {
        condition: `guardrail ${metricId} is ${evaluation.status} (availability ${evaluation.availability})`,
        satisfied: evaluation.status === 'BREACHED' || evaluation.status === 'NOT_ESTABLISHED',
      };
    });
    const triggered = conditions.some((condition) => condition.satisfied);
    records.push({
      kind: 'ROLLBACK',
      rule_id: criterion.id,
      description: criterion.description,
      triggered,
      reason: triggered
        ? `a referenced guardrail is BREACHED or NOT_ESTABLISHED — the live change rolls back (fail-closed: unknown is never success)`
        : 'every referenced guardrail is SATISFIED',
      conditions,
    });
  }
  return records;
}

/** Convenience: did ANY rollback trigger fire for this result? */
export function anyRollbackTriggered(evaluation: ExperimentEvaluation): boolean {
  return evaluation.rollback.some((trigger) => trigger.triggered);
}

/** Convenience: did ANY stopping trigger fire for this result? */
export function anyStoppingTriggered(evaluation: ExperimentEvaluation): boolean {
  return evaluation.stopping.some((trigger) => trigger.triggered);
}
