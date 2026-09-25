/**
 * TASK IMPLEMENTATION (Work Order P13) — the "summon cloud body ->
 * implementation" stage seam.
 *
 * The journey assigns a node to a capability-selected body through the
 * P5 broker contracts; the ASSIGNED BODY then implements the node's work
 * program through THIS INJECTABLE PORT. The reference implementation
 * (./reference/body-executor.ts) drives the P8 HarnessContract of the
 * broker-selected body (§9 createTask -> workspace.write ->
 * observations.emit) — never a bespoke body API.
 *
 * The port's output is a TASK OUTPUT (typed files + body provenance),
 * NOT a completion: the output becomes a repository artifact only
 * through project realization (the P9 gateway), and the node counts
 * complete only through the independent evaluation gate. A FAILED
 * implementation is a typed failure with an explicit recovery decision.
 */

import type { FileChange } from '@sos-2/action-gateway';
import type { TaskFailureKind, TaskNode } from '@sos-2/task-graph';

/** One implementation request (the assigned node + its leased body). */
export interface TaskImplementationRequest {
  /** The assigned node (its steps field carries the typed work program). */
  readonly node: TaskNode;
  /** The broker-selected body id executing the node (lease provenance). */
  readonly bodyId: string;
  /** The lease binding the body to the task. */
  readonly leaseRef: string;
  /** 1-based implementation attempt (retries increment it). */
  readonly attempt: number;
}

/** The typed outcome of one task implementation. */
export type TaskImplementationOutcome =
  | {
      readonly kind: 'IMPLEMENTED';
      /** The task output as typed files (realized into the repository through the P9 gateway). */
      readonly files: readonly FileChange[];
      /** Body provenance of the output (runtime identity, never authority). */
      readonly bodyProvenance: { readonly bodyId: string; readonly leaseRef: string; readonly attempt: number };
    }
  | {
      readonly kind: 'FAILED';
      readonly failureKind: TaskFailureKind;
      readonly reason: string;
      readonly retryable: boolean;
    };

/**
 * The task-implementation seam. Implementations are replaceable
 * MECHANISMS over the body seams (the reference drives the P8
 * HarnessContract); their output is a task output, never a completion.
 */
export interface TaskImplementationPort {
  implement(request: TaskImplementationRequest): TaskImplementationOutcome;
}
