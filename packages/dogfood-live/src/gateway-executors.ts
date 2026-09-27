/**
 * THE REAL GITHUB GATEWAY EXECUTOR (Work Order P19) — the commit /
 * push / pull-request realization families behind the frozen P9
 * ActionExecutor seam, over the STAGED real outcomes of the
 * @sos-2/real-github provider (the async REAL API calls are driven by
 * the harness operator at the composition boundary; this sync executor
 * answers EXACTLY the staged real outcomes — the github-bridge
 * staged-outcome pattern, verbatim):
 *
 *   - git.commit          answers the staged REAL commit (the provider's
 *                          contents-API initial commit on the empty
 *                          repository, or the Git Data API single-commit
 *                          path) — produced.newSha = the EXACT provider
 *                          sha;
 *   - git.push            answers the staged REAL branch-ref read (the
 *                          remote implementation branch is observed at
 *                          the exact pushed sha — the binding is
 *                          verified against the REAL ref, never assumed);
 *   - git.openPullRequest answers the staged REAL pull request
 *                          (POST /repos/<slug>/pulls) — produced
 *                          .pullRequestId = the real PR number.
 *
 * DOGFOOD SCOPE PIN: the executor is constructed bound to the ONE
 * repository of its run; the push remote must be
 * github.com/<owner>/<name> of that repository (any other remote is a
 * typed failure — the executors cannot act outside the pre-approved
 * repo scope).
 */

import type { ActionExecutor, ActionFamily, ActionOperation, ExecutionContext, ExecutionResult } from '@sos-2/action-gateway';
import type { DogfoodStaging } from './staging.js';
import { notPreparedFailure } from './staging.js';

export interface RealGitHubGatewayExecutorOptions {
  /** The staging store (the composition-boundary outcomes). */
  readonly staging: DogfoodStaging;
  /** The ONE repository this executor is scoped to (the dogfood repo of the run). */
  readonly repository: { readonly owner: string; readonly name: string };
}

export class RealGitHubGatewayExecutor implements ActionExecutor {
  readonly families: readonly ActionFamily[] = ['commit', 'push', 'pull-request'];
  private readonly staging: DogfoodStaging;
  private readonly repository: { readonly owner: string; readonly name: string };

  constructor(options: RealGitHubGatewayExecutorOptions) {
    if (typeof options !== 'object' || options === null || typeof options.staging !== 'object' || options.staging === null) {
      throw new Error('RealGitHubGatewayExecutor requires the staging store injected (the composition-boundary outcomes)');
    }
    this.staging = options.staging;
    this.repository = options.repository;
  }

  execute(operation: ActionOperation, context: ExecutionContext): ExecutionResult {
    switch (operation.op) {
      case 'git.commit': {
        this.staging.noteInvocation('commit', operation.op, this.staging.commitStage(operation) !== null);
        const staged = this.staging.commitStage(operation);
        if (staged === null) {
          return notPreparedFailure('git.commit', `${this.repository.owner}/${this.repository.name}:${operation.baseSha}`);
        }
        return {
          status: 'ok',
          output: { produced: { newSha: staged.newSha, committedAt: staged.committedAt, providerNote: staged.providerNote } },
        };
      }
      case 'git.push': {
        // The dogfood scope pin: the push remote must be THIS run's repository.
        const expectedRemote = `github.com/${this.repository.owner}/${this.repository.name}`;
        if (!operation.remote.endsWith(expectedRemote)) {
          this.staging.noteInvocation('push', operation.op, false);
          return {
            status: 'error',
            errorType: 'REPOSITORY_SCOPE_EXCEEDED',
            message: `the push remote ${JSON.stringify(operation.remote)} is outside the dogfood scope (${expectedRemote}) — the real executors are bound to the pre-approved repository of this run and cannot act on any other repository`,
            retryable: false,
          };
        }
        this.staging.noteInvocation('push', operation.op, this.staging.pushStage(operation) !== null);
        const staged = this.staging.pushStage(operation);
        if (staged === null) {
          return notPreparedFailure('git.push', `${operation.remote}:${operation.ref}`);
        }
        if (!staged.bindingVerified) {
          return {
            status: 'error',
            errorType: 'REMOTE_REF_MISMATCH',
            message: `the REAL remote ref ${operation.ref} was observed at ${staged.observedSha} but the push carried ${operation.fromSha} — the honest answer is this typed failure (the binding is verified against the REAL ref, never assumed)`,
            retryable: true,
          };
        }
        return { status: 'ok', output: { produced: { remote: operation.remote, ref: operation.ref, sha: staged.observedSha, refReadAt: staged.refReadAt } } };
      }
      case 'git.openPullRequest': {
        this.staging.noteInvocation('pull-request', operation.op, this.staging.pullRequestStage(operation) !== null);
        const staged = this.staging.pullRequestStage(operation);
        if (staged === null) {
          return notPreparedFailure('git.openPullRequest', `${this.repository.owner}/${this.repository.name}:${operation.headBranch}`);
        }
        return {
          status: 'ok',
          output: { produced: { pullRequestId: String(staged.number), pullRequestUrl: staged.url, headSha: staged.headSha, state: staged.state, createdAt: staged.createdAt } },
        };
      }
      default:
        return {
          status: 'error',
          errorType: 'OPERATION_UNSUPPORTED',
          message: `the real GitHub executor does not carry the ${operation.op} operation (families: commit, push, pull-request)`,
          retryable: false,
        };
    }
  }
}

/** Construct the real GitHub gateway executor (staged real outcomes only). */
export function createRealGitHubGatewayExecutor(options: RealGitHubGatewayExecutorOptions): RealGitHubGatewayExecutor {
  return new RealGitHubGatewayExecutor(options);
}

export interface RealVercelGatewayExecutorOptions {
  /** The staging store (the composition-boundary outcomes). */
  readonly staging: DogfoodStaging;
  /** The Vercel project name this executor is scoped to (the dogfood project of the run). */
  readonly projectName: string;
}

/**
 * THE REAL VERCEL GATEWAY EXECUTOR (Work Order P19) — the deployment
 * realization family behind the frozen P9 ActionExecutor seam, over
 * the STAGED real deployment outcome (the harness operator created the
 * fresh Vercel project — gitRepository link + ssoProtection null — and
 * drove the production deployment of the EXACT head revision to
 * readyState READY before this seam answers). produced.deploymentId is
 * the REAL dpl_ id; the sourceSha binding is the operator's verified
 * exact-revision protocol.
 */
export class RealVercelGatewayExecutor implements ActionExecutor {
  readonly families: readonly ActionFamily[] = ['deployment'];
  private readonly staging: DogfoodStaging;
  private readonly projectName: string;

  constructor(options: RealVercelGatewayExecutorOptions) {
    if (typeof options !== 'object' || options === null || typeof options.staging !== 'object' || options.staging === null) {
      throw new Error('RealVercelGatewayExecutor requires the staging store injected (the composition-boundary outcomes)');
    }
    this.staging = options.staging;
    this.projectName = options.projectName;
  }

  execute(operation: ActionOperation, _context: ExecutionContext): ExecutionResult {
    if (operation.op !== 'deployment.apply') {
      this.staging.noteInvocation('deployment', operation.op, false);
      return {
        status: 'error',
        errorType: 'OPERATION_UNSUPPORTED',
        message: `the real Vercel executor does not carry the ${operation.op} operation (family: deployment)`,
        retryable: false,
      };
    }
    this.staging.noteInvocation('deployment', operation.op, this.staging.deploymentStage(operation) !== null);
    const staged = this.staging.deploymentStage(operation);
    if (staged === null) {
      return notPreparedFailure('deployment.apply', `${this.projectName}@${operation.sourceSha}`);
    }
    if (staged.readyState !== 'READY') {
      return {
        status: 'error',
        errorType: 'DEPLOYMENT_NOT_READY',
        message: `the REAL deployment ${staged.deploymentId} answered readyState ${staged.readyState} — the honest answer is this typed failure (never a fabricated READY)`,
        retryable: true,
      };
    }
    return {
      status: 'ok',
      output: { produced: { deploymentId: staged.deploymentId, sourceSha: staged.commitSha ?? operation.sourceSha, url: staged.url ?? '', readyState: staged.readyState } },
    };
  }
}

/** Construct the real Vercel gateway executor (staged real outcomes only). */
export function createRealVercelGatewayExecutor(options: RealVercelGatewayExecutorOptions): RealVercelGatewayExecutor {
  return new RealVercelGatewayExecutor(options);
}
