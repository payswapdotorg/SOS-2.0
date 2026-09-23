import { contentAddress } from '@sos-2/action-gateway';
import type { Clock } from '@sos-2/action-gateway';
import type { StructuredFailure } from '@sos-2/evaluator';
import type { EvaluationTarget } from '@sos-2/evaluator';
import { recordAdvisory } from './advisory.js';
import type { AdvisoryEntry, ReasoningPort } from './advisory.js';
import { aggregate } from './aggregate.js';
import type { EvaluationSummary } from './aggregate.js';
import type { EvaluationOrchestrator, SuiteContext, SuiteRunRecord } from './suite.js';

export type RepairAskKind = 'EVALUATION_REPAIR_EXHAUSTED' | 'REPAIR_UNAVAILABLE';

/** Typed ASK shape (@sos-2/ask discipline): everything a decision authority needs. */
export interface RepairAsk {
  readonly askId: string;
  readonly kind: RepairAskKind;
  readonly sourceRevision: string;
  readonly deploymentRevision: string | null;
  readonly failedChecks: readonly StructuredFailure[];
  readonly openUncertainties: readonly string[];
  readonly attempts: number;
  readonly summaryDigest: string;
  readonly detail: string;
}

export interface AskReceipt {
  readonly askId: string;
  readonly accepted: boolean;
}

export interface AskPort {
  submitAsk(ask: RepairAsk): AskReceipt;
}

export interface RepairExecutorResult {
  readonly newSourceRevision: string | null;
  readonly detail: string;
}

export interface RepairExecutor {
  repair(input: {
    readonly failures: readonly StructuredFailure[];
    readonly currentRevision: string;
    readonly attempt: number;
  }): RepairExecutorResult;
}

export type RepairLoopOutcomeKind = 'ALL_VERDICTS_PASS' | 'ASK_SUBMITTED';

export interface RepairLoopResult {
  readonly kind: RepairLoopOutcomeKind;
  readonly runs: readonly SuiteRunRecord[];
  readonly summaries: readonly EvaluationSummary[];
  readonly advisories: readonly AdvisoryEntry[];
  readonly ask: RepairAsk | null;
}

/**
 * Bounded repair loop: run the full applicable suite; if everything passes,
 * stop; otherwise repair into a NEW revision and re-run the FULL suite
 * against that revision (verdicts never carry over); after the bounded
 * attempts, escalate to ASK instead of retrying silently forever.
 */
export class RepairLoop {
  constructor(
    private readonly orchestration: EvaluationOrchestrator,
    private readonly repairExecutor: RepairExecutor,
    private readonly askPort: AskPort,
    private readonly reasoning: ReasoningPort | null,
    private readonly clock: Clock,
  ) {}

  drive(context: SuiteContext): RepairLoopResult {
    const runs: SuiteRunRecord[] = [];
    const summaries: EvaluationSummary[] = [];
    const advisories: AdvisoryEntry[] = [];
    let target = context.target;
    for (let attempt = 0; ; attempt += 1) {
      const run = this.orchestration.runSuite({ ...context, target });
      runs.push(run);
      const summary = aggregate(run);
      summaries.push(summary);
      if (this.reasoning !== null) {
        advisories.push(recordAdvisory(this.reasoning.triage({ failures: summary.failures, summary }), this.clock.now()));
      }
      if (summary.failed === 0 && summary.unknown === 0 && summary.denied === 0 && summary.notEvaluated === 0) {
        return { kind: 'ALL_VERDICTS_PASS', runs, summaries, advisories, ask: null };
      }
      if (attempt >= context.plan.maxRepairAttempts) {
        const ask = this.buildAsk(context, target, summary, attempt + 1, 'EVALUATION_REPAIR_EXHAUSTED', `repair bound of ${context.plan.maxRepairAttempts} exhausted`);
        this.askPort.submitAsk(ask);
        return { kind: 'ASK_SUBMITTED', runs, summaries, advisories, ask };
      }
      const repair = this.repairExecutor.repair({
        failures: summary.failures,
        currentRevision: target.sourceRevision,
        attempt: attempt + 1,
      });
      if (repair.newSourceRevision === null) {
        const ask = this.buildAsk(context, target, summary, attempt + 1, 'REPAIR_UNAVAILABLE', repair.detail);
        this.askPort.submitAsk(ask);
        return { kind: 'ASK_SUBMITTED', runs, summaries, advisories, ask };
      }
      target = { ...target, sourceRevision: repair.newSourceRevision, deploymentRevision: null };
    }
  }

  private buildAsk(
    context: SuiteContext,
    target: EvaluationTarget,
    summary: EvaluationSummary,
    attempts: number,
    kind: RepairAskKind,
    detail: string,
  ): RepairAsk {
    return {
      askId: contentAddress(
        { kind, sourceRevision: target.sourceRevision, deploymentRevision: target.deploymentRevision, failures: summary.failures, attempts },
        'repair-ask',
      ),
      kind,
      sourceRevision: target.sourceRevision,
      deploymentRevision: target.deploymentRevision,
      failedChecks: summary.failures,
      openUncertainties: summary.openUncertainties,
      attempts,
      summaryDigest: summary.summaryDigest,
      detail,
    };
  }
}
