import { ACTION_FAMILIES } from '../actions.js';
import type { ActionExecutor, ActionOperation, ExecutionContext, ExecutionResult } from '../executors.js';
import type { ActionFamily } from '../actions.js';
import type { ReferenceWorld } from './world.js';

/**
 * Deterministic reference executors over the in-memory world. They satisfy
 * the executor seam shapes so real providers (github adapter, deployment
 * targets, body runtimes) can attach later as adapters without contract
 * change. Scripted world outcomes take precedence, enabling honest failure
 * injection in tests.
 */
export class ReferenceExecutor implements ActionExecutor {
  readonly families: readonly ActionFamily[];
  readonly calls: Array<{ readonly operation: ActionOperation; readonly context: ExecutionContext }> = [];

  constructor(
    private readonly world: ReferenceWorld,
    families: readonly ActionFamily[] | null = null,
  ) {
    this.families = families ?? [...ACTION_FAMILIES];
  }

  execute(operation: ActionOperation, context: ExecutionContext): ExecutionResult {
    this.calls.push({ operation, context });
    const scripted = this.world.scriptFor(operation);
    if (scripted !== null) return scripted;
    switch (operation.op) {
      case 'git.commit':
        return this.world.commit(operation.repo, operation.baseSha, operation.changes);
      case 'git.push':
        return this.world.push(operation.remote, operation.ref, operation.fromSha);
      case 'git.openPullRequest':
        return this.world.openPullRequest(operation.title, operation.headBranch, operation.baseBranch);
      case 'deployment.apply':
        return this.world.applyDeployment(operation.environment, operation.sourceSha);
      case 'configuration.apply':
        return this.world.applyConfiguration(operation.key, operation.value);
      case 'remediation.apply':
        return this.world.applyRemediation(operation.findingId, operation.strategy, operation.targetSha);
      case 'promotion.apply':
        return this.world.applyPromotion(operation.toEnvironment, operation.sourceSha);
      case 'rollback.apply':
        return this.world.applyRollback(operation.deploymentId, operation.toSourceSha);
      default:
        return this.world.bodyLifecycle(operation.op, operation.bodyId);
    }
  }
}
