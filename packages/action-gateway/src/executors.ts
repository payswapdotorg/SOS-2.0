import type { ActionFamily, ActionRequest, FileChange, RollbackReason } from './actions.js';
export type { FileChange } from './actions.js';
import type { ActorRef, SourceRevisionRef, Timestamp } from './types.js';

/** Typed operation records (the harness git.* shape discipline, §9). */
export type ActionOperation =
  | { readonly op: 'git.commit'; readonly repo: string; readonly message: string; readonly baseSha: string; readonly changes: readonly FileChange[] }
  | { readonly op: 'git.push'; readonly remote: string; readonly ref: string; readonly fromSha: string }
  | { readonly op: 'git.openPullRequest'; readonly title: string; readonly headBranch: string; readonly baseBranch: string; readonly description: string }
  | { readonly op: 'deployment.apply'; readonly environment: string; readonly sourceSha: string }
  | { readonly op: 'configuration.apply'; readonly key: string; readonly value: string }
  | { readonly op: 'remediation.apply'; readonly findingId: string; readonly strategy: string; readonly targetSha: string }
  | { readonly op: 'promotion.apply'; readonly fromEnvironment: string; readonly toEnvironment: string; readonly sourceSha: string }
  | { readonly op: 'rollback.apply'; readonly deploymentId: string; readonly fromSourceSha: string; readonly toSourceSha: string; readonly reason: RollbackReason }
  | { readonly op: 'body.start'; readonly bodyId: string }
  | { readonly op: 'body.pause'; readonly bodyId: string }
  | { readonly op: 'body.resume'; readonly bodyId: string }
  | { readonly op: 'body.cancel'; readonly bodyId: string }
  | { readonly op: 'body.replace'; readonly bodyId: string };

export interface ExecutionContext {
  readonly actionId: string;
  readonly idempotencyKey: string;
  readonly actor: ActorRef;
  readonly targetRevision: SourceRevisionRef;
  readonly at: Timestamp;
}

export type OperationOutput =
  | { readonly produced: Readonly<Record<string, string>> }
  | { readonly noop: true; readonly detail: string };

export type ExecutionResult =
  | { readonly status: 'ok'; readonly output: OperationOutput }
  | { readonly status: 'error'; readonly errorType: string; readonly message: string; readonly retryable: boolean };

/**
 * Injectable action-executor seam (the P8 reference-body discipline): typed
 * operation records in, typed results out. Library code contains zero real
 * network/process calls; real providers (github adapter, deployment targets)
 * attach later as ADAPTERS behind this seam, never as authorities.
 */
export interface ActionExecutor {
  readonly families: readonly ActionFamily[];
  execute(operation: ActionOperation, context: ExecutionContext): ExecutionResult;
}

const DEPLOYMENT_FAMILIES: readonly ActionFamily[] = ['deployment', 'promotion', 'rollback'];

export function isDeploymentFamily(family: ActionFamily): boolean {
  return DEPLOYMENT_FAMILIES.includes(family);
}

export function operationsFor(request: ActionRequest): readonly ActionOperation[] {
  switch (request.payload.family) {
    case 'commit':
      return [
        {
          op: 'git.commit',
          repo: 'workspace',
          message: request.payload.commit.message,
          baseSha: request.payload.commit.expectedBaseSha,
          changes: request.payload.commit.changes,
        },
      ];
    case 'push':
      return [{ op: 'git.push', remote: request.payload.push.remote, ref: request.payload.push.ref, fromSha: request.payload.push.fromSha }];
    case 'pull-request':
      return [
        {
          op: 'git.openPullRequest',
          title: request.payload.pullRequest.title,
          headBranch: request.payload.pullRequest.headBranch,
          baseBranch: request.payload.pullRequest.baseBranch,
          description: request.payload.pullRequest.description,
        },
      ];
    case 'deployment':
      return [{ op: 'deployment.apply', environment: request.payload.deployment.environment, sourceSha: request.payload.deployment.sourceSha }];
    case 'configuration':
      return [{ op: 'configuration.apply', key: request.payload.configuration.key, value: request.payload.configuration.value }];
    case 'remediation':
      return [
        {
          op: 'remediation.apply',
          findingId: request.payload.remediation.findingId,
          strategy: request.payload.remediation.strategy,
          targetSha: request.payload.remediation.targetSha,
        },
      ];
    case 'promotion':
      return [
        {
          op: 'promotion.apply',
          fromEnvironment: request.payload.promotion.fromEnvironment,
          toEnvironment: request.payload.promotion.toEnvironment,
          sourceSha: request.payload.promotion.sourceSha,
        },
      ];
    case 'rollback':
      return [
        {
          op: 'rollback.apply',
          deploymentId: request.payload.rollback.deploymentId,
          fromSourceSha: request.payload.rollback.fromSourceSha,
          toSourceSha: request.payload.rollback.toSourceSha,
          reason: request.payload.rollback.reason,
        },
      ];
    case 'body-lifecycle':
      return [{ op: `body.${request.payload.bodyLifecycle.operation}`, bodyId: request.payload.bodyLifecycle.bodyId }];
  }
}
