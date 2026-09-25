/**
 * REPOSITORY REALIZATION CONTRACTS (Work Order P13).
 *
 * Typed plans for what the realized repository must contain, and the
 * typed records of what was realized — every consequential operation
 * went through the P9 action gateway (see realizer.ts; this file is the
 * DATA side).
 *
 * THE PLAN IS DATA: branches, commits, pull request and deployment
 * integration as inspectable records; the realizer executes them through
 * the gateway and returns evidence-carrying receipts.
 */

import { contentAddress } from '@sos-2/action-gateway';
import type { FileChange } from '@sos-2/action-gateway';
import { InvalidRealizationPlanError } from './errors.js';

/** The repository the journey realizes into. */
export interface RepositoryTarget {
  readonly owner: string;
  readonly name: string;
  /** The base branch pull requests merge into (e.g. 'main'). */
  readonly defaultBranch: string;
  /** The implementation branch the journey commits onto and pushes. */
  readonly implementationBranch: string;
}

/** One per-task output commit of the realization plan. */
export interface TaskCommitPlan {
  /** The task whose output this commit realizes. */
  readonly taskId: string;
  readonly message: string;
  readonly changes: readonly FileChange[];
}

/** The typed repository realization plan. */
export interface RepositoryRealizationPlan {
  /** Content-derived deterministic id. */
  readonly planId: string;
  readonly repository: RepositoryTarget;
  /** The workspace-provisioning commit message (repository initialization). */
  readonly scaffoldMessage: string;
  /** The scaffold files (repository initialization / workspace provisioning). */
  readonly scaffold: readonly FileChange[];
  /** The per-task output commits, in plan order. */
  readonly taskCommits: readonly TaskCommitPlan[];
  readonly pullRequestTitle: string;
  readonly pullRequestDescription: string;
  /** The deployment environment the realized system integrates with. */
  readonly deploymentEnvironment: string;
}

/** A realized commit (gateway receipt evidence). */
export interface RealizedCommit {
  /** The task whose output was committed (null for the scaffold). */
  readonly taskId: string | null;
  readonly actionId: string;
  /** The exact new source revision. */
  readonly sha: string;
  readonly evidenceIds: readonly string[];
}

/** A realized push (gateway receipt evidence). */
export interface RealizedPush {
  readonly actionId: string;
  readonly remote: string;
  readonly ref: string;
  readonly sha: string;
  readonly evidenceIds: readonly string[];
}

/** A realized pull request (gateway receipt evidence). */
export interface RealizedPullRequest {
  readonly actionId: string;
  readonly pullRequestId: string;
  readonly headBranch: string;
  readonly baseBranch: string;
  readonly evidenceIds: readonly string[];
}

/** A realized deployment (gateway receipt evidence). */
export interface RealizedDeployment {
  readonly actionId: string;
  readonly deploymentId: string;
  readonly environment: string;
  readonly sourceSha: string;
  readonly evidenceIds: readonly string[];
}

/** A realized rollback (gateway receipt evidence + verification observation). */
export interface RealizedRollback {
  readonly actionId: string;
  /** The restored (rolled-back-to) deployment id. */
  readonly restoredDeploymentId: string;
  readonly toSourceSha: string;
  /** Honest rollback verification verdict (VERIFIED | FAILED | UNKNOWN). */
  readonly rollbackVerificationVerdict: 'VERIFIED' | 'FAILED' | 'UNKNOWN';
  readonly evidenceIds: readonly string[];
}

/** Everything the gateway can answer for a realization step. */
export type RealizationStepOutcome<T> =
  | { readonly kind: 'REALIZED'; readonly result: T }
  | {
      readonly kind: 'DENIED';
      readonly reason: 'ACTION_AUTHORITY_DENIED';
      readonly detail: string;
      readonly grantReason: string;
    }
  | {
      readonly kind: 'FAILED';
      readonly failure: { readonly operation: string; readonly errorType: string; readonly message: string; readonly retryable: boolean };
    };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isFileChange(value: unknown): value is FileChange {
  return isPlainObject(value) && isNonEmptyString(value['path']) && typeof value['contents'] === 'string';
}

function isBranchName(value: unknown): value is string {
  return isNonEmptyString(value) && /^[A-Za-z0-9._/-]+$/.test(value) && !value.includes('..') && !value.startsWith('/');
}

/** Validate a repository target (throws InvalidRealizationPlanError). */
export function assertValidRepositoryTarget(value: unknown): asserts value is RepositoryTarget {
  if (!isPlainObject(value)) {
    throw new InvalidRealizationPlanError('repository target must be an object');
  }
  const keys = Object.keys(value);
  if (keys.length !== 4 || !keys.includes('owner') || !keys.includes('name') || !keys.includes('defaultBranch') || !keys.includes('implementationBranch')) {
    throw new InvalidRealizationPlanError('repository target must have the exact field set { owner, name, defaultBranch, implementationBranch }');
  }
  for (const field of ['owner', 'name'] as const) {
    if (!isNonEmptyString(value[field]) || !/^[A-Za-z0-9_.-]+$/.test(value[field])) {
      throw new InvalidRealizationPlanError(`repository ${field} must be [A-Za-z0-9_.-], received: ${JSON.stringify(value[field])}`);
    }
  }
  if (!isBranchName(value['defaultBranch'])) {
    throw new InvalidRealizationPlanError(`defaultBranch must be a branch name, received: ${JSON.stringify(value['defaultBranch'])}`);
  }
  if (!isBranchName(value['implementationBranch'])) {
    throw new InvalidRealizationPlanError(`implementationBranch must be a branch name, received: ${JSON.stringify(value['implementationBranch'])}`);
  }
  if (value['defaultBranch'] === value['implementationBranch']) {
    throw new InvalidRealizationPlanError(
      `the implementation branch ${JSON.stringify(value['implementationBranch'])} must differ from the default branch ${JSON.stringify(value['defaultBranch'])} — the journey realizes through a pull request`,
    );
  }
}

/** Validate a realization plan (throws InvalidRealizationPlanError). */
export function assertValidRepositoryRealizationPlan(value: unknown): asserts value is RepositoryRealizationPlan {
  if (!isPlainObject(value)) {
    throw new InvalidRealizationPlanError('repository realization plan must be an object');
  }
  const keys = Object.keys(value);
  const expected = [
    'planId',
    'repository',
    'scaffoldMessage',
    'scaffold',
    'taskCommits',
    'pullRequestTitle',
    'pullRequestDescription',
    'deploymentEnvironment',
  ];
  if (keys.length !== expected.length || !expected.every((key) => Object.prototype.hasOwnProperty.call(value, key))) {
    throw new InvalidRealizationPlanError(`repository realization plan must have the exact field set { ${expected.join(', ')} }`);
  }
  assertValidRepositoryTarget(value['repository']);
  if (!isNonEmptyString(value['planId'])) {
    throw new InvalidRealizationPlanError('planId must be a non-empty string');
  }
  if (!isNonEmptyString(value['scaffoldMessage'])) {
    throw new InvalidRealizationPlanError('scaffoldMessage must be a non-empty string');
  }
  if (!Array.isArray(value['scaffold']) || value['scaffold'].length === 0 || !value['scaffold'].every(isFileChange)) {
    throw new InvalidRealizationPlanError('scaffold must be a non-empty array of { path, contents } — repository initialization always provisions a base');
  }
  const commits = value['taskCommits'];
  if (!Array.isArray(commits)) {
    throw new InvalidRealizationPlanError('taskCommits must be an array (possibly empty until decomposition)');
  }
  const seenTasks = new Set<string>();
  for (const commit of commits) {
    if (!isPlainObject(commit) || !isNonEmptyString(commit['taskId']) || !isNonEmptyString(commit['message'])) {
      throw new InvalidRealizationPlanError('each task commit must be { taskId, message, changes }');
    }
    if (seenTasks.has(commit['taskId'])) {
      throw new InvalidRealizationPlanError(`duplicate task commit for task ${JSON.stringify(commit['taskId'])} — one commit per task output`);
    }
    seenTasks.add(commit['taskId']);
    if (!Array.isArray(commit['changes']) || commit['changes'].length === 0 || !commit['changes'].every(isFileChange)) {
      throw new InvalidRealizationPlanError(`task commit for ${JSON.stringify(commit['taskId'])} must carry a non-empty changes array`);
    }
  }
  if (!isNonEmptyString(value['pullRequestTitle'])) {
    throw new InvalidRealizationPlanError('pullRequestTitle must be a non-empty string');
  }
  if (!isNonEmptyString(value['pullRequestDescription'])) {
    throw new InvalidRealizationPlanError('pullRequestDescription must be a non-empty string');
  }
  if (!isNonEmptyString(value['deploymentEnvironment'])) {
    throw new InvalidRealizationPlanError('deploymentEnvironment must be a non-empty string');
  }
}

/** Derive the deterministic realization plan id for a plan body. */
export function realizationPlanId(input: Omit<RepositoryRealizationPlan, 'planId'>): string {
  return contentAddress(
    {
      repository: input.repository,
      scaffoldMessage: input.scaffoldMessage,
      scaffold: input.scaffold,
      taskCommits: input.taskCommits,
      pullRequestTitle: input.pullRequestTitle,
      pullRequestDescription: input.pullRequestDescription,
      deploymentEnvironment: input.deploymentEnvironment,
    },
    'repository-realization-plan',
  );
}

/** Assemble + validate a realization plan (the id is derived, never caller-supplied). */
export function buildRepositoryRealizationPlan(input: Omit<RepositoryRealizationPlan, 'planId'>): RepositoryRealizationPlan {
  const plan: RepositoryRealizationPlan = { ...input, planId: realizationPlanId(input) };
  assertValidRepositoryRealizationPlan(plan);
  return plan;
}
