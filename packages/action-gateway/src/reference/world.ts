import { contentAddress } from '../types.js';
import type { ActionOperation, ExecutionResult, FileChange } from '../executors.js';

export const WORLD_BASE_SHA = 'seed-workspace-base';

export type BodyState = 'RUNNING' | 'PAUSED' | 'CANCELLED' | 'REPLACED';

export interface DeploymentState {
  readonly environment: string;
  readonly sourceSha: string;
  status: 'ACTIVE' | 'ROLLED_BACK';
}

/**
 * Deterministic in-memory world for the reference executors. No network, no
 * processes, no ambient time: every transition is a pure function of the
 * operation record and current state, with content-addressed revisions.
 * script() injects outcomes so any operation can be made to fail or diverge
 * on demand in tests (honest failure injection).
 */
export class ReferenceWorld {
  readonly heads = new Map<string, string>();
  readonly deployments = new Map<string, DeploymentState>();
  readonly activeByEnvironment = new Map<string, string>();
  readonly configuration = new Map<string, string>();
  readonly bodies = new Map<string, BodyState>();
  readonly pushes: Array<{ remote: string; ref: string; sha: string }> = [];
  readonly pullRequests: Array<{ pullRequestId: string; title: string; headBranch: string; baseBranch: string }> = [];
  readonly remediations: Array<{ findingId: string; strategy: string; targetSha: string }> = [];
  private readonly scripts = new Map<string, ExecutionResult>();

  constructor() {
    this.heads.set('workspace', WORLD_BASE_SHA);
  }

  /** Script an outcome for an exact op key ('git.commit') or a refined key ('deployment.apply:staging'). */
  script(key: string, result: ExecutionResult): void {
    this.scripts.set(key, result);
  }

  scriptFor(operation: ActionOperation): ExecutionResult | null {
    const secondary = secondaryKey(operation);
    if (secondary !== null) {
      const specific = this.scripts.get(`${operation.op}:${secondary}`);
      if (specific !== undefined) return specific;
    }
    return this.scripts.get(operation.op) ?? null;
  }

  commit(repo: string, baseSha: string, changes: readonly FileChange[]): ExecutionResult {
    const head = this.heads.get(repo) ?? null;
    if (head !== baseSha) {
      return {
        status: 'error',
        errorType: 'BASE_DIVERGED',
        message: `expected base ${baseSha} but head is ${head ?? 'unknown'}`,
        retryable: true,
      };
    }
    const newSha = contentAddress({ repo, baseSha, changes }, 'source');
    this.heads.set(repo, newSha);
    return { status: 'ok', output: { produced: { repo, newSha } } };
  }

  push(remote: string, ref: string, fromSha: string): ExecutionResult {
    this.pushes.push({ remote, ref, sha: fromSha });
    return { status: 'ok', output: { produced: { remote, ref, sha: fromSha } } };
  }

  openPullRequest(title: string, headBranch: string, baseBranch: string): ExecutionResult {
    const pullRequestId = contentAddress({ title, headBranch, baseBranch }, 'pull-request');
    this.pullRequests.push({ pullRequestId, title, headBranch, baseBranch });
    return { status: 'ok', output: { produced: { pullRequestId } } };
  }

  applyDeployment(environment: string, sourceSha: string): ExecutionResult {
    const deploymentId = contentAddress({ environment, sourceSha }, 'deployment');
    this.deployments.set(deploymentId, { environment, sourceSha, status: 'ACTIVE' });
    this.activeByEnvironment.set(environment, deploymentId);
    return { status: 'ok', output: { produced: { deploymentId, sourceSha } } };
  }

  applyConfiguration(key: string, value: string): ExecutionResult {
    this.configuration.set(key, value);
    return { status: 'ok', output: { produced: { key, value } } };
  }

  applyRemediation(findingId: string, strategy: string, targetSha: string): ExecutionResult {
    this.remediations.push({ findingId, strategy, targetSha });
    return { status: 'ok', output: { produced: { findingId, strategy } } };
  }

  applyPromotion(toEnvironment: string, sourceSha: string): ExecutionResult {
    return this.applyDeployment(toEnvironment, sourceSha);
  }

  applyRollback(deploymentId: string, toSourceSha: string): ExecutionResult {
    const current = this.deployments.get(deploymentId) ?? null;
    if (current === null) {
      return {
        status: 'error',
        errorType: 'UNKNOWN_DEPLOYMENT',
        message: `deployment ${deploymentId} is unknown`,
        retryable: false,
      };
    }
    current.status = 'ROLLED_BACK';
    const restoredId = contentAddress(
      { environment: current.environment, sourceSha: toSourceSha, rolledBackFrom: deploymentId },
      'deployment',
    );
    this.deployments.set(restoredId, { environment: current.environment, sourceSha: toSourceSha, status: 'ACTIVE' });
    this.activeByEnvironment.set(current.environment, restoredId);
    return { status: 'ok', output: { produced: { deploymentId: restoredId, sourceSha: toSourceSha } } };
  }

  bodyLifecycle(
    operation: 'body.start' | 'body.pause' | 'body.resume' | 'body.cancel' | 'body.replace',
    bodyId: string,
  ): ExecutionResult {
    if (operation === 'body.start') {
      this.bodies.set(bodyId, 'RUNNING');
      return bodyOk(bodyId, 'RUNNING');
    }
    const current = this.bodies.get(bodyId) ?? null;
    if (current === null) {
      return { status: 'error', errorType: 'UNKNOWN_BODY', message: `body ${bodyId} is unknown`, retryable: false };
    }
    if (operation === 'body.pause') {
      this.bodies.set(bodyId, 'PAUSED');
      return bodyOk(bodyId, 'PAUSED');
    }
    if (operation === 'body.resume') {
      this.bodies.set(bodyId, 'RUNNING');
      return bodyOk(bodyId, 'RUNNING');
    }
    if (operation === 'body.cancel') {
      this.bodies.set(bodyId, 'CANCELLED');
      return bodyOk(bodyId, 'CANCELLED');
    }
    this.bodies.set(bodyId, 'REPLACED');
    return bodyOk(bodyId, 'REPLACED');
  }
}

function bodyOk(bodyId: string, state: BodyState): ExecutionResult {
  return { status: 'ok', output: { produced: { bodyId, state } } };
}

function secondaryKey(operation: ActionOperation): string | null {
  if ('environment' in operation) return operation.environment;
  if ('ref' in operation) return operation.ref;
  if ('bodyId' in operation) return operation.bodyId;
  if ('key' in operation) return operation.key;
  return null;
}
