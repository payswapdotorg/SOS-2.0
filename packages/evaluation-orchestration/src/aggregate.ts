import { contentAddress } from '@sos-2/action-gateway';
import type { StructuredFailure } from '@sos-2/evaluator';
import type { SuiteRunRecord } from './suite.js';

export interface VerdictRef {
  readonly verdictId: string;
  readonly type: string;
  readonly targetSourceRevision: string;
  readonly targetDeploymentRevision: string | null;
}

/**
 * Aggregation is EVIDENCE COMBINATION ONLY. The summary deliberately carries
 * certification: 'NOT_ASSERTED' — mission-success certification belongs to
 * the frozen completion discipline (spec §10), never to this package.
 */
export interface EvaluationSummary {
  readonly summaryDigest: string;
  readonly passed: number;
  readonly failed: number;
  readonly unknown: number;
  readonly denied: number;
  readonly notEvaluated: number;
  readonly failures: readonly StructuredFailure[];
  readonly openUncertainties: readonly string[];
  readonly verdictRefs: readonly VerdictRef[];
  readonly certification: 'NOT_ASSERTED';
}

export function aggregate(run: SuiteRunRecord): EvaluationSummary {
  let passed = 0;
  let failed = 0;
  let unknown = 0;
  let denied = 0;
  let notEvaluated = 0;
  const failures: StructuredFailure[] = [];
  const openUncertainties: string[] = [];
  const verdictRefs: VerdictRef[] = [];
  for (const step of run.results) {
    const outcome = step.outcome;
    if (outcome.kind === 'verdict') {
      const verdict = outcome.verdict;
      verdictRefs.push({
        verdictId: verdict.verdictId,
        type: verdict.type,
        targetSourceRevision: verdict.target.sourceRevision,
        targetDeploymentRevision: verdict.target.deploymentRevision,
      });
      if (verdict.verdict === 'PASS') {
        passed += 1;
      } else if (verdict.verdict === 'FAIL') {
        failed += 1;
        failures.push(...verdict.failureEvidence);
      } else {
        unknown += 1;
        openUncertainties.push(`${verdict.type}: ${verdict.uncertainty.join('; ')}`);
      }
    } else if (outcome.kind === 'denied') {
      denied += 1;
      openUncertainties.push(`${step.type}: ${outcome.denial.code}`);
    } else {
      notEvaluated += 1;
    }
  }
  return {
    summaryDigest: contentAddress(
      { runId: run.runId, passed, failed, unknown, denied, notEvaluated, failures, verdictRefs },
      'evaluation-summary',
    ),
    passed,
    failed,
    unknown,
    denied,
    notEvaluated,
    failures,
    openUncertainties,
    verdictRefs,
    certification: 'NOT_ASSERTED',
  };
}
