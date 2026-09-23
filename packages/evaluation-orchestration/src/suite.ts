import { contentAddress } from '@sos-2/action-gateway';
import type { ActionFamily, Clock } from '@sos-2/action-gateway';
import { IndependentEvaluationService, RETRYABLE_PROBE_FAILURE } from '@sos-2/evaluator';
import type {
  EvaluationActorRef,
  EvaluationDenial,
  EvaluationRequest,
  EvaluationTarget,
  EvaluationType,
  EvaluationVerdict,
} from '@sos-2/evaluator';
import { applicableTypes } from './plan.js';
import type { EvaluationPlan } from './plan.js';

export type StepOutcome =
  | { readonly kind: 'verdict'; readonly verdict: EvaluationVerdict; readonly attempts: number }
  | { readonly kind: 'denied'; readonly denial: EvaluationDenial }
  | { readonly kind: 'not-evaluated'; readonly type: EvaluationType; readonly detail: string };

export interface StepResult {
  readonly stepId: string;
  readonly type: EvaluationType;
  readonly outcome: StepOutcome;
}

export interface SuiteRunRecord {
  readonly runId: string;
  readonly target: EvaluationTarget;
  readonly requestedBy: EvaluationActorRef;
  readonly results: readonly StepResult[];
  readonly at: number;
}

export interface SuiteContext {
  readonly plan: EvaluationPlan;
  readonly target: EvaluationTarget;
  readonly requestedBy: EvaluationActorRef;
  readonly family: ActionFamily | null;
  readonly mission: string | null;
}

/**
 * Schedules the applicable evaluator suite against ONE target revision.
 * Verdicts are never carried across revisions: every run issues fresh
 * evaluation requests bound to the exact target. staleVerdictIds() is the
 * pinned guard.
 */
export class EvaluationOrchestrator {
  constructor(
    private readonly evaluation: IndependentEvaluationService,
    private readonly clock: Clock,
  ) {}

  runSuite(context: SuiteContext): SuiteRunRecord {
    const types = applicableTypes(context.plan, { family: context.family, mission: context.mission });
    const steps = context.plan.steps.filter((step) => types.includes(step.type));
    const results: StepResult[] = [];
    for (const step of steps) {
      const bound = Math.max(1, step.maxAttempts);
      let attempts = 0;
      let outcome: StepOutcome | null = null;
      while (attempts < bound && outcome === null) {
        attempts += 1;
        const request: EvaluationRequest = {
          evaluationId: contentAddress(
            { planId: context.plan.planId, stepId: step.stepId, target: context.target, requestedBy: context.requestedBy, attempt: attempts },
            'evaluation-request',
          ),
          type: step.type,
          target: context.target,
          requestedBy: context.requestedBy,
        };
        const result = this.evaluation.evaluate(request);
        if (result.kind === 'denied') {
          outcome = { kind: 'denied', denial: result.denial };
          break;
        }
        const retryable =
          result.verdict.verdict === 'UNKNOWN' && result.verdict.uncertainty.includes(RETRYABLE_PROBE_FAILURE);
        if (!retryable || attempts >= bound) {
          outcome = { kind: 'verdict', verdict: result.verdict, attempts };
        }
      }
      results.push({
        stepId: step.stepId,
        type: step.type,
        outcome: outcome ?? { kind: 'not-evaluated', type: step.type, detail: 'unreachable: bound exhausted without outcome' },
      });
    }
    return {
      runId: contentAddress({ planId: context.plan.planId, target: context.target, results }, 'suite-run'),
      target: context.target,
      requestedBy: context.requestedBy,
      results,
      at: this.clock.now(),
    };
  }
}

/** Verdicts from a DIFFERENT revision than `targetSourceRevision` are stale by construction. */
export function staleVerdictIds(run: SuiteRunRecord, targetSourceRevision: string): string[] {
  const stale: string[] = [];
  for (const step of run.results) {
    if (step.outcome.kind === 'verdict' && step.outcome.verdict.target.sourceRevision !== targetSourceRevision) {
      stale.push(step.outcome.verdict.verdictId);
    }
  }
  return stale;
}
