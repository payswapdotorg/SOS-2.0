/**
 * The workspace isolation contract (Work Order P14).
 *
 * PINNED: an access request for project A's workspace under project B's
 * task context is a typed ISOLATION denial, fail-closed — the request is
 * never silently granted, never retried, never folded into an ALLOW. The
 * denial (like every policy decision) is auditable through the audit
 * trail (see ../audit/audit.ts).
 *
 * The vocabulary mirrors the merged P2/P6 task-durability discipline as
 * an INDEPENDENT typed vocabulary (task identity, mission link, project
 * scope, executing body) — document-alignment only, no import from the
 * owning packages (the lockfile identity rule; the P3 body-provider
 * precedent). Real enforcement (platform-level workspace filesystem
 * quotas, per-project container namespaces) attaches later as adapters
 * behind the same typed decision; this module is the deterministic
 * reference implementation.
 *
 * Determinism: pure functions over injected data; no ambient anything.
 */

import { WorkspaceIsolationError } from '../errors.js';

/** Who is asking: the durable task context a request executes under. */
export interface TaskExecutionContext {
  /** The durable task identity (P2 task record link). */
  readonly taskId: string;
  /** The owning mission, when known (P2 task-durability shape). */
  readonly missionId: string | null;
  /** The project whose task graph owns this context. */
  readonly projectId: string;
  /** The executing body, when a body lease is held (P8 body seam). */
  readonly bodyId: string | null;
}

/** A workspace owned by exactly one project. */
export interface WorkspaceRef {
  readonly projectId: string;
  readonly workspaceId: string;
}

export const WORKSPACE_OPERATIONS = ['read', 'write', 'list', 'execute'] as const;
export type WorkspaceOperation = (typeof WORKSPACE_OPERATIONS)[number];

/** One workspace access request entering the isolation gate. */
export interface WorkspaceAccessRequest {
  readonly context: TaskExecutionContext;
  readonly target: WorkspaceRef;
  readonly operation: WorkspaceOperation;
}

/**
 * The typed isolation decision. ISOLATION_DENIED is fail-closed and
 * terminal for the request: there is no override field, no retry hint,
 * and no path that upgrades it to ALLOW inside this contract.
 */
export type WorkspaceIsolationDecision =
  | {
      readonly kind: 'WORKSPACE_ACCESS_ALLOWED';
      readonly request: WorkspaceAccessRequest;
      readonly reason: 'SAME_PROJECT_WORKSPACE';
    }
  | {
      readonly kind: 'ISOLATION_DENIED';
      readonly request: WorkspaceAccessRequest;
      readonly reason: 'CROSS_PROJECT_WORKSPACE_ACCESS';
      readonly detail: string;
    };

/**
 * The typed policy record asserting that no cross-project workspace
 * access exists. A policy is INJECTED DATA — a mechanism, never an
 * authority (ARCHITECT_START_HERE: enforcement never mints authority).
 */
export interface WorkspaceIsolationPolicy {
  readonly policyId: string;
  readonly enforced: true;
  readonly rule: 'NO_CROSS_PROJECT_WORKSPACE_ACCESS';
}

/** The one policy this contract can represent (deny-by-default on mismatch). */
export const WORKSPACE_ISOLATION_POLICY: WorkspaceIsolationPolicy = {
  policyId: 'workspace-isolation/default',
  enforced: true,
  rule: 'NO_CROSS_PROJECT_WORKSPACE_ACCESS',
};

/**
 * Evaluate a workspace access request against the isolation policy.
 *
 * Fail-closed semantics:
 *   - the request MUST be structurally well-formed (typed rejection
 *     otherwise — malformed is never granted);
 *   - target project MUST equal the task context's project;
 *   - ANY mismatch is a typed ISOLATION_DENIED naming both identities
 *     (never the workspace contents — those are never read here).
 */
export function evaluateWorkspaceIsolation(request: WorkspaceAccessRequest): WorkspaceIsolationDecision {
  assertWellFormed(request);
  if (request.context.projectId !== request.target.projectId) {
    return {
      kind: 'ISOLATION_DENIED',
      request,
      reason: 'CROSS_PROJECT_WORKSPACE_ACCESS',
      detail:
        `task ${request.context.taskId} of project ${request.context.projectId} ` +
        `requested ${request.operation} on workspace ${request.target.workspaceId} ` +
        `of project ${request.target.projectId}: workspaces are isolated per project — ` +
        `cross-project workspace access is denied (fail-closed)`,
    };
  }
  return { kind: 'WORKSPACE_ACCESS_ALLOWED', request, reason: 'SAME_PROJECT_WORKSPACE' };
}

/**
 * The throwing composition seam: same evaluation, typed error on denial.
 * Used where a caller needs an exception-shaped boundary (adapter wiring);
 * the DECISION-shaped API above remains the primary surface.
 */
export function assertWorkspaceIsolation(request: WorkspaceAccessRequest): void {
  const decision = evaluateWorkspaceIsolation(request);
  if (decision.kind === 'ISOLATION_DENIED') {
    throw new WorkspaceIsolationError(decision.detail);
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function assertWellFormed(request: WorkspaceAccessRequest): void {
  const problems: string[] = [];
  if (!isNonEmptyString(request.context.taskId)) problems.push('context.taskId');
  if (request.context.missionId !== null && !isNonEmptyString(request.context.missionId)) problems.push('context.missionId');
  if (!isNonEmptyString(request.context.projectId)) problems.push('context.projectId');
  if (request.context.bodyId !== null && !isNonEmptyString(request.context.bodyId)) problems.push('context.bodyId');
  if (!isNonEmptyString(request.target.projectId)) problems.push('target.projectId');
  if (!isNonEmptyString(request.target.workspaceId)) problems.push('target.workspaceId');
  if (!(WORKSPACE_OPERATIONS as readonly string[]).includes(request.operation)) problems.push('operation');
  if (problems.length > 0) {
    throw new WorkspaceIsolationError(
      `malformed workspace access request (fields: ${problems.join(', ')}) — a malformed request is never granted`,
    );
  }
}
