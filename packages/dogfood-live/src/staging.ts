/**
 * THE STAGED-OUTCOME COMPOSITION BOUNDARY (Work Order P19) — the
 * documented P8 sync-seam discipline applied to the frozen P9 gateway:
 * the ActionExecutor / TaskImplementationPort / EvaluatorProbe seams are
 * SYNCHRONOUS by frozen design, while the REAL GitHub/Vercel/OpenRouter
 * operations are async network calls. Therefore the async REAL API
 * calls are driven by the HARNESS OPERATOR at the composition boundary
 * (exactly the way RealGitHubRepositoryOperations.prepare* stages real
 * outcomes for the P8 sync seam, and exactly the way the model port's
 * documented composition drives runWorkProgram), and the sync seams
 * answer EXACTLY the staged real outcomes:
 *
 *   - dispatching an operation that was never prepared answers a typed
 *     honest failure (never a fabricated success, never a silent
 *     pass-through) — the github-bridge notPrepared pattern, verbatim;
 *   - every staged outcome carries the EXACT revision it produced (the
 *     receipts the gateway mints bind to it);
 *   - the staging is keyed by the deterministic operation digest (the
 *     same canonical-JSON discipline the realizer's idempotency keys
 *     use), so a staged outcome can only ever answer the operation it
 *     was actually prepared for.
 */

import { canonicalJson, fnv1a64 } from '@sos-2/action-gateway';
import type { ActionReceipt } from '@sos-2/action-gateway';
import type { FileChange } from '@sos-2/action-gateway';
import type { ExecutionResult } from '@sos-2/action-gateway';
import type { TaskImplementationOutcome } from '@sos-2/greenfield-runtime';

/** The deterministic digest of one gateway operation (the staging key). */
export function operationDigest(operation: unknown): string {
  return fnv1a64(canonicalJson(operation));
}

/** One staged REAL commit outcome (the provider's CommitRef mapped to the executor result). */
export interface StagedCommit {
  /** The EXACT new source revision the REAL provider produced. */
  readonly newSha: string;
  /** The provider-reported committer date (real evidence, not a hidden clock). */
  readonly committedAt: string;
  readonly providerNote: string;
}

/** One staged REAL push verification (the observed remote branch ref). */
export interface StagedPush {
  /** The EXACT sha the remote branch ref pointed at (the real read). */
  readonly observedSha: string;
  /** True when the observed ref equals the pushed fromSha (the real binding). */
  readonly bindingVerified: boolean;
  readonly refReadAt: string;
}

/** One staged REAL pull-request outcome. */
export interface StagedPullRequest {
  readonly number: number;
  readonly url: string;
  readonly headSha: string;
  readonly state: string;
  readonly createdAt: string;
}

/** One staged REAL deployment outcome (the dogfood Vercel deployment). */
export interface StagedDeployment {
  readonly deploymentId: string;
  readonly url: string | null;
  readonly readyState: string;
  /** The EXACT commit sha the deployment was built from (binding proof). */
  readonly commitSha: string | null;
  readonly projectId: string;
  readonly projectName: string;
  readonly target: string;
}

/** The REAL repository facts at one exact revision (the evaluator-probe evidence). */
export interface StagedRepoFacts {
  readonly revision: string;
  readonly branch: string;
  /** The full file tree at the revision (real GitHub tree read). */
  readonly paths: readonly string[];
  /** The fetched contents of the planned paths (real GitHub content reads). */
  readonly contents: Readonly<Record<string, string>>;
  /** The component's planned paths (the check context). */
  readonly plannedPaths: readonly string[];
  readonly componentId: string | null;
  /** The commit's html URL (evidence reference). */
  readonly commitUrl: string | null;
  /** The branch head sha observed when the facts were staged. */
  readonly stagedAt: string;
}

/** The REAL deployment facts (the evaluator-probe evidence). */
export interface StagedDeploymentFacts {
  readonly deploymentId: string;
  readonly url: string | null;
  readonly readyState: string;
  readonly commitSha: string | null;
  readonly projectId: string;
  readonly projectName: string;
  readonly target: string | null;
  readonly pollAttempts: number;
  readonly waitedMs: number;
}

/** The REAL runtime-verification facts (HTTP GETs of the deployed URL). */
export interface StagedRuntimeFacts {
  readonly rootStatus: number | null;
  readonly rootBodyExcerpt: string | null;
  readonly readmeStatus: number | null;
  readonly readmeBody: string | null;
  /** The README content at the EXACT deployed revision (fetched from the repository — the binding basis). */
  readonly readmeAtRevision: string | null;
  readonly deploymentUrl: string;
  readonly deployedRevision: string;
  readonly fetchedAt: string;
}

/** One staged REAL body run (the model-driven engine output for one node attempt). */
export interface StagedBodyRun {
  readonly ok: boolean;
  /** The files the run applied (read back through the §9 workspace surface). */
  readonly files: readonly FileChange[];
  readonly model: string | null;
  readonly responseId: string | null;
  readonly usage: { readonly prompt_tokens: number | null; readonly completion_tokens: number | null; readonly total_tokens: number | null } | null;
  readonly summary: string | null;
  readonly error: string | null;
  readonly engineAttempt: number;
}

/**
 * THE STAGING STORE — the one place the async composition boundary and
 * the sync frozen seams meet. Every staged entry was produced by a REAL
 * provider call driven by the harness operator; the sync seams answer
 * exactly these entries (typed honest failures otherwise).
 */
export class DogfoodStaging {
  private readonly commits = new Map<string, StagedCommit>();
  private readonly pushes = new Map<string, StagedPush>();
  private readonly pullRequests = new Map<string, StagedPullRequest>();
  private readonly deployments = new Map<string, StagedDeployment>();
  private readonly repoFacts = new Map<string, StagedRepoFacts>();
  private deploymentFacts: StagedDeploymentFacts | null = null;
  private runtimeFacts: StagedRuntimeFacts | null = null;
  private readonly bodyRuns = new Map<string, StagedBodyRun>();
  /** The gateway receipts observed by the executors (in execution order). */
  private readonly observedReceipts: ActionReceipt[] = [];
  /** The executor invocations (audit: what the sync seam actually answered). */
  private readonly executorInvocations: { readonly family: string; readonly operation: string; readonly prepared: boolean }[] = [];

  // ------------------------------------------------------------- commit

  stageCommit(operation: { readonly message: string; readonly baseSha: string; readonly changes: readonly FileChange[] }, staged: StagedCommit): void {
    this.commits.set(this.commitKey(operation), staged);
  }

  commitStage(operation: { readonly message: string; readonly baseSha: string; readonly changes: readonly FileChange[] }): StagedCommit | null {
    return this.commits.get(this.commitKey(operation)) ?? null;
  }

  private commitKey(operation: { readonly message: string; readonly baseSha: string; readonly changes: readonly FileChange[] }): string {
    return operationDigest({
      op: 'git.commit',
      message: operation.message,
      baseSha: operation.baseSha,
      changes: operation.changes.map((change) => ({ path: change.path, contents: change.contents })),
    });
  }

  // --------------------------------------------------------------- push

  stagePush(operation: { readonly remote: string; readonly ref: string; readonly fromSha: string }, staged: StagedPush): void {
    this.pushes.set(operationDigest({ op: 'git.push', ...operation }), staged);
  }

  pushStage(operation: { readonly remote: string; readonly ref: string; readonly fromSha: string }): StagedPush | null {
    return this.pushes.get(operationDigest({ op: 'git.push', ...operation })) ?? null;
  }

  // -------------------------------------------------------- pull request

  stagePullRequest(
    operation: { readonly title: string; readonly headBranch: string; readonly baseBranch: string; readonly description: string },
    staged: StagedPullRequest,
  ): void {
    this.pullRequests.set(operationDigest({ op: 'git.openPullRequest', ...operation }), staged);
  }

  pullRequestStage(operation: { readonly title: string; readonly headBranch: string; readonly baseBranch: string; readonly description: string }): StagedPullRequest | null {
    return this.pullRequests.get(operationDigest({ op: 'git.openPullRequest', ...operation })) ?? null;
  }

  // ----------------------------------------------------------- deployment

  stageDeployment(operation: { readonly environment: string; readonly sourceSha: string }, staged: StagedDeployment): void {
    this.deployments.set(operationDigest({ op: 'deployment.apply', environment: operation.environment, sourceSha: operation.sourceSha }), staged);
  }

  deploymentStage(operation: { readonly environment: string; readonly sourceSha: string }): StagedDeployment | null {
    return this.deployments.get(operationDigest({ op: 'deployment.apply', environment: operation.environment, sourceSha: operation.sourceSha })) ?? null;
  }

  // -------------------------------------------------- evaluator facts

  stageRepoFacts(facts: StagedRepoFacts): void {
    this.repoFacts.set(facts.revision, facts);
  }

  repoFactsAt(revision: string): StagedRepoFacts | null {
    return this.repoFacts.get(revision) ?? null;
  }

  stageDeploymentFacts(facts: StagedDeploymentFacts): void {
    this.deploymentFacts = facts;
  }

  deploymentFactsSnapshot(): StagedDeploymentFacts | null {
    return this.deploymentFacts;
  }

  stageRuntimeFacts(facts: StagedRuntimeFacts): void {
    this.runtimeFacts = facts;
  }

  runtimeFactsSnapshot(): StagedRuntimeFacts | null {
    return this.runtimeFacts;
  }

  // ---------------------------------------------------------- body runs

  stageBodyRun(taskId: string, attempt: number, run: StagedBodyRun): void {
    this.bodyRuns.set(`${taskId}:${String(attempt)}`, run);
  }

  bodyRunOf(taskId: string, attempt: number): StagedBodyRun | null {
    return this.bodyRuns.get(`${taskId}:${String(attempt)}`) ?? null;
  }

  // -------------------------------------------------------------- audit

  /** Record one gateway receipt observed by an executor (the audit trail). */
  observeReceipt(receipt: ActionReceipt): void {
    this.observedReceipts.push(receipt);
  }

  observedReceiptList(): readonly ActionReceipt[] {
    return [...this.observedReceipts];
  }

  /** Record one sync-seam invocation (what the executor actually answered). */
  noteInvocation(family: string, operation: string, prepared: boolean): void {
    this.executorInvocations.push({ family, operation, prepared });
  }

  invocationList(): readonly { readonly family: string; readonly operation: string; readonly prepared: boolean }[] {
    return [...this.executorInvocations];
  }

  /** The staged-entry counts (the honest staging audit — never a fabricated preparation). */
  counts(): { commits: number; pushes: number; pullRequests: number; deployments: number; repoFacts: number; bodyRuns: number } {
    return {
      commits: this.commits.size,
      pushes: this.pushes.size,
      pullRequests: this.pullRequests.size,
      deployments: this.deployments.size,
      repoFacts: this.repoFacts.size,
      bodyRuns: this.bodyRuns.size,
    };
  }
}

/** The typed honest failure for an operation that was never prepared at the composition boundary. */
export function notPreparedFailure(operation: string, context: string): ExecutionResult {
  return {
    status: 'error',
    errorType: 'REAL_OPERATION_NOT_PREPARED',
    message: `the real ${operation} was never driven on ${context} — the async REAL API call must be prepared by the harness operator at the composition boundary before the synchronous gateway seam can answer it (the honest answer is this typed failure, never a fabricated success)`,
    retryable: false,
  };
}

/** Map a staged body run to the TaskImplementationPort outcome (the sync seam answer). */
export function stagedBodyRunOutcome(request: { readonly bodyId: string; readonly leaseRef: string; readonly attempt: number }, run: StagedBodyRun | null): TaskImplementationOutcome {
  if (run === null) {
    return {
      kind: 'FAILED',
      failureKind: 'OPERATION_FAILURE',
      reason:
        'the real hosted-body engine run for this task attempt was never prepared at the composition boundary (the operator drives runWorkProgram asynchronously; the §9 seam answers exactly the staged real outcome — never a fabricated success)',
      retryable: false,
    };
  }
  if (!run.ok) {
    return {
      kind: 'FAILED',
      failureKind: 'OPERATION_FAILURE',
      reason: run.error ?? 'the real model-driven engine run failed (the honest recorded failure)',
      retryable: true,
    };
  }
  return {
    kind: 'IMPLEMENTED',
    files: [...run.files],
    bodyProvenance: { bodyId: request.bodyId, leaseRef: request.leaseRef, attempt: request.attempt },
  };
}
