/**
 * THE EVIDENCE-BACKED COMPLETION REPORT (Work Order P13) — §11's final
 * stage. The report carries:
 *
 *   - the EXACT SOURCE REVISIONS acted on (workspace head, pushed ref,
 *     pull request, deployment, the imported repository base);
 *   - the EVALUATION RESULTS with RETAINED UNCERTAINTY (verdict refs,
 *     pass/fail/unknown counts, the open uncertainties verbatim);
 *   - the REMAINING UNCERTAINTY (journey-level honest statements —
 *     reference-mode limitations never masquerade as live claims);
 *   - the per-task verification records (which independent gate
 *     certified each node, at which revision);
 *   - the REPRODUCIBLE COMPLETION RECORD: the whole report is
 *     content-addressed (completionId); recomputeCompletionId()
 *     re-derives it bit-exactly from the record's own content —
 *     identical journeys produce identical records.
 *
 * The report is DATA (persisted + inspected), never an assertion of
 * mission success beyond what the independent evaluation granted.
 */

import { contentAddress } from '@sos-2/action-gateway';
import type { ActorRef } from '@sos-2/action-gateway';
import type { EvaluationSummary } from '@sos-2/evaluation-orchestration';
import type { VerdictRef } from '@sos-2/evaluation-orchestration';
import type { JourneyImportedRevision, JourneyRepositoryId } from './github-port.js';
import type {
  RealizedCommit,
  RealizedDeployment,
  RealizedPullRequest,
  RealizedPush,
} from '@sos-2/project-realization';
import type { AuthorityGrantSummary, GreenfieldJourneyStage } from './types.js';
import { InvalidCompletionReportError } from './errors.js';

/** The per-task verification summary carried by the report. */
export interface CompletedTaskSummary {
  readonly taskId: string;
  readonly title: string;
  readonly state: string;
  readonly verificationRef: string | null;
  readonly sourceRevision: string | null;
  readonly bodyId: string | null;
  readonly leaseRef: string | null;
  readonly retries: number;
}

/** The evidence-backed completion report (§11's final stage). */
export interface CompletionReport {
  /** Content-derived deterministic id — the reproducible completion record. */
  readonly completionId: string;
  readonly journeyId: string;
  readonly missionRef: string;
  readonly authority: AuthorityGrantSummary | null;
  readonly stage: GreenfieldJourneyStage;
  /** The EXACT source revisions (never approximate, never omitted). */
  readonly sourceRevisions: {
    readonly workspaceHead: string;
    readonly commits: readonly { readonly taskId: string | null; readonly sha: string; readonly actionId: string }[];
    readonly push: { readonly ref: string; readonly sha: string; readonly remote: string } | null;
    readonly pullRequest: { readonly pullRequestId: string; readonly headBranch: string; readonly baseBranch: string } | null;
    readonly deployment: { readonly deploymentId: string; readonly environment: string; readonly sourceSha: string } | null;
    readonly importedBase: { readonly repository: JourneyRepositoryId; readonly branch: string; readonly revision: string } | null;
  };
  /** The evaluation results WITH RETAINED UNCERTAINTY. */
  readonly evaluation: {
    readonly certificationId: string;
    readonly verdictRefs: readonly VerdictRef[];
    readonly passed: number;
    readonly failed: number;
    readonly unknown: number;
    readonly uncertainties: readonly string[];
  };
  /** Journey-level remaining uncertainty (honest, retained). */
  readonly remainingUncertainty: readonly string[];
  readonly tasks: readonly CompletedTaskSummary[];
  /** Who produced the output (the acting principal — runtime identity). */
  readonly producedBy: ActorRef;
  /** Who requested the certification (the pipeline system actor — never the body). */
  readonly certifiedUponRequestBy: ActorRef;
  readonly completedAt: string;
  /** Honest provider statuses (reference/simulated markers, never live claims). */
  readonly providerStatuses: readonly { readonly name: string; readonly status: string; readonly detail: string }[];
}

/** The report body the completion id is derived from (everything but the id). */
export type CompletionReportBody = Omit<CompletionReport, 'completionId'>;

/** Derive the reproducible completion record id from the report body. */
export function completionRecordId(body: CompletionReportBody): string {
  return contentAddress(
    {
      journeyId: body.journeyId,
      missionRef: body.missionRef,
      authority: body.authority,
      stage: body.stage,
      sourceRevisions: body.sourceRevisions,
      evaluation: body.evaluation,
      remainingUncertainty: body.remainingUncertainty,
      tasks: body.tasks,
      producedBy: body.producedBy,
      certifiedUponRequestBy: body.certifiedUponRequestBy,
      completedAt: body.completedAt,
      providerStatuses: body.providerStatuses,
    },
    'p13-completion-record',
  );
}

/** Assemble the completion report (the id is derived, never caller-supplied). */
export function buildCompletionReport(body: CompletionReportBody): CompletionReport {
  const report: CompletionReport = { ...body, completionId: completionRecordId(body) };
  assertValidCompletionReport(report);
  return report;
}

/** Re-derive the completion id of a report (the reproduction pin). */
export function recomputeCompletionId(report: CompletionReport): string {
  const { completionId: _ignored, ...body } = report;
  void _ignored;
  return completionRecordId(body as CompletionReportBody);
}

/** Validate a completion report (throws InvalidCompletionReportError). */
export function assertValidCompletionReport(value: unknown): asserts value is CompletionReport {
  if (typeof value !== 'object' || value === null) {
    throw new InvalidCompletionReportError('a completion report must be an object');
  }
  const report = value as Record<string, unknown>;
  for (const field of ['completionId', 'journeyId', 'missionRef', 'stage', 'sourceRevisions', 'evaluation', 'remainingUncertainty', 'tasks', 'producedBy', 'certifiedUponRequestBy', 'completedAt', 'providerStatuses']) {
    if (!(field in report)) {
      throw new InvalidCompletionReportError(`the completion report is missing ${JSON.stringify(field)}`);
    }
  }
  if (typeof report['completionId'] !== 'string' || (report['completionId'] as string).length === 0) {
    throw new InvalidCompletionReportError('completionId must be a non-empty string');
  }
  if (report['completionId'] !== recomputeCompletionId(value as CompletionReport)) {
    throw new InvalidCompletionReportError(
      'the completion record does not reproduce — the content-derived id does not match the record content (the completion record is reproducible or it is not a completion record)',
    );
  }
  const sourceRevisions = report['sourceRevisions'] as Record<string, unknown>;
  if (typeof sourceRevisions !== 'object' || sourceRevisions === null || typeof sourceRevisions['workspaceHead'] !== 'string') {
    throw new InvalidCompletionReportError('sourceRevisions.workspaceHead must carry the exact final source revision');
  }
  const evaluation = report['evaluation'] as Record<string, unknown>;
  if (typeof evaluation !== 'object' || evaluation === null || typeof evaluation['certificationId'] !== 'string') {
    throw new InvalidCompletionReportError('evaluation.certificationId must reference the independent certification');
  }
  if ((evaluation['unknown'] as number) > 0 && report['stage'] === 'COMPLETED') {
    throw new InvalidCompletionReportError(
      'a COMPLETED report retains its unknown counts honestly in evaluation.uncertainties — but a completion with unknown verdicts must never reach stage COMPLETED',
    );
  }
}

/** Build the evaluation summary slice of the report from a P9 summary. */
export function evaluationSliceOf(summary: EvaluationSummary, certificationId: string): CompletionReport['evaluation'] {
  return {
    certificationId,
    verdictRefs: [...summary.verdictRefs],
    passed: summary.passed,
    failed: summary.failed,
    unknown: summary.unknown,
    uncertainties: [...summary.openUncertainties],
  };
}

/** Build the source-revision slice of the report from the realized records. */
export function sourceRevisionsOf(input: {
  workspaceHead: string;
  commits: readonly RealizedCommit[];
  push: RealizedPush | null;
  pullRequest: RealizedPullRequest | null;
  deployment: RealizedDeployment | null;
  imported: JourneyImportedRevision | null;
}): CompletionReport['sourceRevisions'] {
  return {
    workspaceHead: input.workspaceHead,
    commits: input.commits.map((commit) => ({ taskId: commit.taskId, sha: commit.sha, actionId: commit.actionId })),
    push: input.push === null ? null : { ref: input.push.ref, sha: input.push.sha, remote: input.push.remote },
    pullRequest:
      input.pullRequest === null
        ? null
        : { pullRequestId: input.pullRequest.pullRequestId, headBranch: input.pullRequest.headBranch, baseBranch: input.pullRequest.baseBranch },
    deployment:
      input.deployment === null
        ? null
        : { deploymentId: input.deployment.deploymentId, environment: input.deployment.environment, sourceSha: input.deployment.sourceSha },
    importedBase:
      input.imported === null
        ? null
        : {
            repository: input.imported.repository,
            branch: input.imported.branch,
            revision: input.imported.revision.value,
          },
  };
}
