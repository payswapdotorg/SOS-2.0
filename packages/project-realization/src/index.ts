/**
 * @sos-2/project-realization — repository realization through the P9
 * action gateway (Work Order P13).
 *
 * Typed realization plans + the realizer that executes them EXCLUSIVELY
 * through ActionGateway families (commit, push, pull-request, deployment,
 * rollback) with action-time authority re-evaluation, deterministic
 * idempotency keys and evidence per action. Library code contains zero
 * direct filesystem/git/deployment calls; the composition root injects
 * the P9 reference executors and real providers attach later as adapters
 * behind the same seam.
 *
 * Determinism: no Date.now / Math.random / fetch / process.env / ambient
 * timers / child_process in this package's src — the gateway's injected
 * clock stamps every action.
 */

export { ProjectRealizationError, InvalidRealizationPlanError, InvalidRealizationCallError } from './errors.js';

export {
  assertValidRepositoryTarget,
  assertValidRepositoryRealizationPlan,
  buildRepositoryRealizationPlan,
  realizationPlanId,
} from './types.js';
export type {
  RepositoryTarget,
  TaskCommitPlan,
  RepositoryRealizationPlan,
  RealizedCommit,
  RealizedPush,
  RealizedPullRequest,
  RealizedDeployment,
  RealizedRollback,
  RealizationStepOutcome,
} from './types.js';

export { RepositoryRealizer } from './realizer.js';
export type { RepositoryRealizerDeps, WorkspaceHeadTracker } from './realizer.js';
