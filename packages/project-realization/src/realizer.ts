/**
 * THE REPOSITORY REALIZER (Work Order P13).
 *
 * Executes repository realization EXCLUSIVELY through the P9 action
 * gateway: workspace provisioning (the scaffold commit), per-task output
 * commits, branch push, pull request, deployment and rollback are all
 * ActionGateway.execute calls with
 *
 *   - action-time CURRENT authority re-evaluation (a revoked/expired/
 *     never-held grant is a typed DENIED — fail-closed, no retry-until-
 *     success),
 *   - client-supplied DETERMINISTIC idempotency keys (content-addressed
 *     over the payload — replays return the recorded original outcome),
 *   - evidence ids per action (the gateway's evidence chain),
 *   - the exact source revisions acted on (targetRevision is always the
 *     current workspace head the caller supplies).
 *
 * There is NO filesystem access, NO git CLI, NO deployment API and NO
 * ambient clock in this module: the executors and the clock are injected
 * through the gateway (the P9 executor seam); the composition root binds
 * the reference executors and real providers attach later without
 * contract change.
 */

import type {
  ActionGateway,
  ActionReceipt,
  ActorRef,
  Clock,
  GatewayOutcome,
} from '@sos-2/action-gateway';
import { canonicalJson, fnv1a64 } from '@sos-2/action-gateway';
import { InvalidRealizationCallError } from './errors.js';
import type {
  RealizationStepOutcome,
  RealizedCommit,
  RealizedDeployment,
  RealizedPullRequest,
  RealizedPush,
  RealizedRollback,
  RepositoryRealizationPlan,
  TaskCommitPlan,
} from './types.js';

/** Realizer dependencies — every port injected. */
export interface RepositoryRealizerDeps {
  /** The P9 action gateway — the ONLY consequential-action surface. */
  readonly gateway: ActionGateway;
  /**
   * The acting principal the realization actions are requested under.
   * Bodies are ephemeral; this runtime principal is stable across body
   * replacement (the P9 authority plane evaluates it at action time).
   */
  readonly actor: ActorRef;
  /** The injected clock (gateway-envelope requestedAt; no hidden time). */
  readonly clock: Clock;
  /** The initial workspace base revision (the empty-repository seed). */
  readonly workspaceBaseSha: string;
}

/** The mutable workspace head the realizer tracks from gateway receipts. */
export interface WorkspaceHeadTracker {
  currentHead(): string;
}

/**
 * THE REPOSITORY REALIZER. One instance tracks the workspace head from
 * the receipts of its own successful commits (evidence-backed — the head
 * is what the gateway acted on, never a local guess).
 */
export class RepositoryRealizer implements WorkspaceHeadTracker {
  private readonly gateway: ActionGateway;
  private readonly actor: ActorRef;
  private readonly clock: Clock;
  private head: string;

  constructor(deps: RepositoryRealizerDeps) {
    if (typeof deps !== 'object' || deps === null || typeof deps.gateway !== 'object' || deps.gateway === null) {
      throw new InvalidRealizationCallError('RepositoryRealizer requires the P9 ActionGateway injected (the only consequential-action surface)');
    }
    if (typeof deps.actor !== 'object' || deps.actor === null || typeof deps.actor.id !== 'string' || deps.actor.id.length === 0) {
      throw new InvalidRealizationCallError('RepositoryRealizer requires the acting principal { kind, id }');
    }
    if (typeof deps.clock !== 'object' || deps.clock === null || typeof deps.clock.now !== 'function') {
      throw new InvalidRealizationCallError('RepositoryRealizer requires an injected clock (no hidden time)');
    }
    if (typeof deps.workspaceBaseSha !== 'string' || deps.workspaceBaseSha.length === 0) {
      throw new InvalidRealizationCallError('RepositoryRealizer requires the initial workspace base revision (the empty-repository seed)');
    }
    this.gateway = deps.gateway;
    this.actor = { ...deps.actor };
    this.clock = deps.clock;
    this.head = deps.workspaceBaseSha;
  }

  /** The current workspace head (tracked from gateway receipts). */
  currentHead(): string {
    return this.head;
  }

  /**
   * Workspace provisioning / repository initialization: commit the
   * scaffold at the current head through the gateway.
   */
  async provisionWorkspace(plan: RepositoryRealizationPlan): Promise<RealizationStepOutcome<RealizedCommit>> {
    return this.commit(plan.scaffoldMessage, null, plan.scaffold, 'scaffold');
  }

  /**
   * Realize one task's output as a repository commit through the
   * gateway (project structure realization — files become repository
   * artifacts only here).
   */
  async commitTaskOutput(commit: TaskCommitPlan): Promise<RealizationStepOutcome<RealizedCommit>> {
    return this.commit(commit.message, commit.taskId, commit.changes, `task:${commit.taskId}`);
  }

  /** Push the implementation branch through the gateway. */
  async pushBranch(input: { remote: string; ref: string }): Promise<RealizationStepOutcome<RealizedPush>> {
    const receipt = await this.execute('push', { push: { remote: input.remote, ref: input.ref, fromSha: this.head } }, { remote: input.remote, ref: input.ref });
    if (!isExecuted(receipt)) return denialOf(receipt);
    if (receipt.status === 'DENIED') return denialOf(receipt);
    if (receipt.status !== 'SUCCEEDED') return failureOf(receipt);
    const produced = receipt.output && 'produced' in receipt.output ? receipt.output.produced : {};
    const result: RealizedPush = {
      actionId: receipt.actionId,
      remote: String(produced['remote'] ?? input.remote),
      ref: String(produced['ref'] ?? input.ref),
      sha: String(produced['sha'] ?? this.head),
      evidenceIds: [...receipt.evidenceIds],
    };
    return { kind: 'REALIZED', result };
  }

  /** Open the pull request through the gateway. */
  async openPullRequest(input: {
    title: string;
    headBranch: string;
    baseBranch: string;
    description: string;
  }): Promise<RealizationStepOutcome<RealizedPullRequest>> {
    const receipt = await this.execute(
      'pull-request',
      { pullRequest: { title: input.title, headBranch: input.headBranch, baseBranch: input.baseBranch, description: input.description } },
      { headBranch: input.headBranch },
    );
    if (!isExecuted(receipt)) return denialOf(receipt);
    if (receipt.status === 'DENIED') return denialOf(receipt);
    if (receipt.status !== 'SUCCEEDED') return failureOf(receipt);
    const produced = receipt.output && 'produced' in receipt.output ? receipt.output.produced : {};
    const result: RealizedPullRequest = {
      actionId: receipt.actionId,
      pullRequestId: String(produced['pullRequestId'] ?? ''),
      headBranch: input.headBranch,
      baseBranch: input.baseBranch,
      evidenceIds: [...receipt.evidenceIds],
    };
    return { kind: 'REALIZED', result };
  }

  /** Deploy the realized system through the gateway. */
  async deploy(input: { environment: string; sourceSha?: string }): Promise<RealizationStepOutcome<RealizedDeployment>> {
    const sourceSha = input.sourceSha ?? this.head;
    const receipt = await this.execute('deployment', { deployment: { environment: input.environment, sourceSha } }, { environment: input.environment });
    if (!isExecuted(receipt)) return denialOf(receipt);
    if (receipt.status === 'DENIED') return denialOf(receipt);
    if (receipt.status !== 'SUCCEEDED') return failureOf(receipt);
    const produced = receipt.output && 'produced' in receipt.output ? receipt.output.produced : {};
    const result: RealizedDeployment = {
      actionId: receipt.actionId,
      deploymentId: String(produced['deploymentId'] ?? ''),
      environment: input.environment,
      sourceSha: String(produced['sourceSha'] ?? sourceSha),
      evidenceIds: [...receipt.evidenceIds],
    };
    return { kind: 'REALIZED', result };
  }

  /** Roll back a deployment through the gateway (typed reason, verification evidence). */
  async rollback(input: {
    deploymentId: string;
    fromSourceSha: string;
    toSourceSha: string;
    reason: { code: 'FAILED_VERIFICATION' | 'INCIDENT' | 'MANUAL_DIRECTIVE'; detail: string };
  }): Promise<RealizationStepOutcome<RealizedRollback>> {
    const receipt = await this.execute(
      'rollback',
      { rollback: { deploymentId: input.deploymentId, fromSourceSha: input.fromSourceSha, toSourceSha: input.toSourceSha, reason: input.reason } },
      { deploymentId: input.deploymentId },
    );
    if (!isExecuted(receipt)) return denialOf(receipt);
    if (receipt.status === 'DENIED') return denialOf(receipt);
    if (receipt.status !== 'SUCCEEDED') return failureOf(receipt);
    const produced = receipt.output && 'produced' in receipt.output ? receipt.output.produced : {};
    const result: RealizedRollback = {
      actionId: receipt.actionId,
      restoredDeploymentId: String(produced['deploymentId'] ?? ''),
      toSourceSha: String(produced['sourceSha'] ?? input.toSourceSha),
      rollbackVerificationVerdict: receipt.rollbackVerification?.verdict ?? 'UNKNOWN',
      evidenceIds: [...receipt.evidenceIds],
    };
    return { kind: 'REALIZED', result };
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private async commit(
    message: string,
    taskId: string | null,
    changes: readonly { path: string; contents: string }[],
    discriminator: string,
  ): Promise<RealizationStepOutcome<RealizedCommit>> {
    const baseSha = this.head;
    const receipt = await this.execute('commit', { commit: { message, changes: [...changes], expectedBaseSha: baseSha } }, { discriminator, baseSha });
    if (!isExecuted(receipt)) return denialOf(receipt);
    if (receipt.status === 'DENIED') return denialOf(receipt);
    if (receipt.status !== 'SUCCEEDED') return failureOf(receipt);
    const produced = receipt.output && 'produced' in receipt.output ? receipt.output.produced : {};
    const newSha = produced['newSha'];
    if (typeof newSha !== 'string' || newSha.length === 0) {
      return {
        kind: 'FAILED',
        failure: { operation: 'git.commit', errorType: 'NO_REVISION_PRODUCED', message: 'the executor succeeded but produced no new source revision', retryable: true },
      };
    }
    this.head = newSha;
    const result: RealizedCommit = {
      taskId,
      actionId: receipt.actionId,
      sha: newSha,
      evidenceIds: [...receipt.evidenceIds],
    };
    return { kind: 'REALIZED', result };
  }

  /**
   * One gateway call: deterministic action id + idempotency key
   * (content-addressed over the family, payload and target revision —
   * replays are honored by the gateway's replay protection).
   */
  private async execute(
    family: 'commit' | 'push' | 'pull-request' | 'deployment' | 'rollback',
    payloadFields: Record<string, unknown>,
    discriminator: Record<string, unknown>,
  ): Promise<ActionReceipt | { readonly replayedRejected: true; readonly rejection: { readonly code: string; readonly field: string; readonly detail: string } }> {
    const digest = fnv1a64(canonicalJson({ family, payloadFields, head: this.head, discriminator }));
    const request = {
      actionId: `p13-act-${family}-${digest}`,
      idempotencyKey: `p13-idem-${family}-${digest}`,
      family,
      actor: this.actor,
      requestedAt: this.clock.now(),
      targetRevision: { kind: 'source' as const, sha: this.head },
      payload: { family, ...payloadFields } as Record<string, unknown>,
    };
    const outcome: GatewayOutcome = this.gateway.execute(request);
    if (outcome.kind === 'rejected') {
      return { replayedRejected: true, rejection: outcome.rejection };
    }
    return outcome.receipt;
  }
}

function isExecuted(
  receipt: ActionReceipt | { readonly replayedRejected: true; readonly rejection: { readonly code: string; readonly field: string; readonly detail: string } },
): receipt is ActionReceipt {
  return (receipt as ActionReceipt).status !== undefined;
}

function denialOf(
  receipt: ActionReceipt | { readonly replayedRejected: true; readonly rejection: { readonly code: string; readonly field: string; readonly detail: string } },
): RealizationStepOutcome<never> {
  if ('replayedRejected' in receipt && receipt.replayedRejected) {
    return {
      kind: 'FAILED',
      failure: {
        operation: 'gateway.envelope',
        errorType: `ENVELOPE_REJECTED:${receipt.rejection.code}`,
        message: receipt.rejection.detail,
        retryable: false,
      },
    };
  }
  const actionReceipt = receipt as ActionReceipt;
  return {
    kind: 'DENIED',
    reason: 'ACTION_AUTHORITY_DENIED',
    detail: actionReceipt.denial?.detail ?? 'the action was denied',
    grantReason: actionReceipt.denial?.authority?.reason ?? 'GRANT_NEVER_HELD',
  };
}

function failureOf(receipt: ActionReceipt): RealizationStepOutcome<never> {
  return {
    kind: 'FAILED',
    failure: {
      operation: receipt.failure?.operation ?? 'unknown',
      errorType: receipt.failure?.errorType ?? 'UNKNOWN_FAILURE',
      message: receipt.failure?.message ?? 'the action failed without a failure block',
      retryable: receipt.failure?.retryable ?? true,
    },
  };
}
