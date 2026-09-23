import { contentAddress } from '@sos-2/action-gateway';
import type { ActionFamily } from '@sos-2/action-gateway';
import { EVALUATION_TYPES } from '@sos-2/evaluator';
import type { EvaluationType } from '@sos-2/evaluator';

export const ANY_FAMILY = '*';
export const ANY_MISSION = '*';

export type FamilySelector = ActionFamily | typeof ANY_FAMILY;

export interface ApplicabilityRule {
  readonly families: readonly FamilySelector[];
  readonly missions: readonly string[] | typeof ANY_MISSION;
  readonly types: readonly EvaluationType[];
}

export interface EvaluationStep {
  readonly stepId: string;
  readonly type: EvaluationType;
  /** Probe invocation bound for retryable probe failures. */
  readonly maxAttempts: number;
}

/** Typed, durable (content-addressed) evaluation plan — the P6 task-graph discipline. */
export interface EvaluationPlan {
  readonly planId: string;
  readonly steps: readonly EvaluationStep[];
  readonly applicability: readonly ApplicabilityRule[];
  /** Bounded repair attempts before escalation to ASK. */
  readonly maxRepairAttempts: number;
}

export interface PlanInput {
  readonly steps: readonly EvaluationStep[];
  readonly applicability: readonly ApplicabilityRule[];
  readonly maxRepairAttempts: number;
}

export function buildPlan(input: PlanInput): EvaluationPlan {
  return {
    steps: input.steps,
    applicability: input.applicability,
    maxRepairAttempts: input.maxRepairAttempts,
    planId: contentAddress(
      { steps: input.steps, applicability: input.applicability, maxRepairAttempts: input.maxRepairAttempts },
      'evaluation-plan',
    ),
  };
}

export interface ApplicabilityContext {
  readonly family: ActionFamily | null;
  readonly mission: string | null;
}

export function applicableTypes(plan: EvaluationPlan, context: ApplicabilityContext): EvaluationType[] {
  const selected: EvaluationType[] = [];
  for (const rule of plan.applicability) {
    const familyOk = rule.families.includes(ANY_FAMILY) || (context.family !== null && rule.families.includes(context.family));
    const missionOk = rule.missions === ANY_MISSION || (context.mission !== null && rule.missions.includes(context.mission));
    if (!familyOk || !missionOk) continue;
    for (const type of rule.types) {
      if (!selected.includes(type)) selected.push(type);
    }
  }
  return selected;
}

/** Default policy: tests + static/contract checks always; deployment-affecting families add deployment/runtime/security; mission contexts add journeys + metrics. */
export function defaultApplicability(): ApplicabilityRule[] {
  return [
    { families: ['*'], missions: ANY_MISSION, types: ['tests', 'static-contract-checks'] },
    {
      families: ['deployment', 'promotion', 'rollback'],
      missions: ANY_MISSION,
      types: ['deployment-checks', 'runtime-verification', 'security-checks'],
    },
    { families: ['*'], missions: ['launch', 'release'], types: ['browser-journeys', 'mission-metrics'] },
  ];
}

export function defaultSteps(): EvaluationStep[] {
  return EVALUATION_TYPES.map((type, index) => ({ stepId: `step-${index}-${type}`, type, maxAttempts: 2 }));
}
