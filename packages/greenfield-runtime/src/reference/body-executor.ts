/**
 * THE REFERENCE BODY TASK EXECUTOR (Work Order P13) — the deterministic
 * stand-in behind the TaskImplementationPort seam.
 *
 * Drives the broker-selected body's P8 HarnessContract through the §9
 * surface — exactly the merged body seams, never a bespoke API:
 *
 *   createTask({ task_ref, input: work program })
 *     -> workspace.write (every planned file)
 *     -> observations.emit (an honest body.progress observation)
 *
 * The executor holds NO authority (the contract carries none), mints no
 * identity and produces a TASK OUTPUT (typed files + provenance) — never
 * a completion claim. Defect injection is deterministic and honest: a
 * scripted defect corrupts the FIRST attempt's output of exactly one
 * task (the repair-loop fixture); later attempts produce the correct
 * files.
 */

import type { FileChange } from '@sos-2/action-gateway';
import type { BodyBroker } from '@sos-2/body-broker';
import { parseTaskWorkProgram } from '@sos-2/implementation-orchestrator';
import type { TaskImplementationOutcome, TaskImplementationRequest } from '../implementation.js';

/** Deterministic defect fixtures for the repair-loop acceptance paths. */
export interface ReferenceDefectSpec {
  /** The task id whose FIRST attempt is defective. */
  readonly taskId: string;
  /** How the output is corrupted (deterministic). */
  readonly mode: 'BUGGY_OUTPUT';
}

export interface ReferenceBodyTaskExecutorOptions {
  readonly broker: BodyBroker;
  /** Deterministic defect injection (empty by default — the happy path). */
  readonly defects?: readonly ReferenceDefectSpec[];
}

/** The deterministic corruption applied to a defective first attempt. */
export function corruptFileContents(contents: string): string {
  return contents.replace('return ', 'return /* BUG (injected defect) */ ');
}

export class ReferenceBodyTaskExecutor {
  private readonly broker: BodyBroker;
  private readonly defects: readonly ReferenceDefectSpec[];

  constructor(options: ReferenceBodyTaskExecutorOptions) {
    if (typeof options !== 'object' || options === null || typeof options.broker !== 'object' || options.broker === null) {
      throw new TypeError('ReferenceBodyTaskExecutor requires the P5 BodyBroker injected (the §9 body seams)');
    }
    this.broker = options.broker;
    this.defects = [...(options.defects ?? [])];
  }

  implement(request: TaskImplementationRequest): TaskImplementationOutcome {
    const harness = this.broker.harnessFor(request.bodyId);

    // §9 createTask — summon the body for the bounded task.
    const created = harness.createTask({ task_ref: request.node.task_id, input: request.node.steps });
    if (created.status === 'UNSUPPORTED') {
      return {
        kind: 'FAILED',
        failureKind: 'CAPABILITY_UNSUPPORTED',
        reason: `the body advertisement does not carry createTask: ${created.reason}`,
        retryable: false,
      };
    }
    if (created.status === 'FAILED') {
      return { kind: 'FAILED', failureKind: 'OPERATION_FAILURE', reason: `createTask ran and failed: ${created.error}`, retryable: true };
    }

    // The typed work program (validated — never trusted blindly).
    let program;
    try {
      program = parseTaskWorkProgram(request.node.steps);
    } catch (cause) {
      return { kind: 'FAILED', failureKind: 'OPERATION_FAILURE', reason: `the work program is malformed: ${(cause as Error).message}`, retryable: false };
    }

    const defective =
      request.attempt === 1 && this.defects.some((defect) => defect.taskId === request.node.task_id && defect.mode === 'BUGGY_OUTPUT');

    // §9 workspace.write — every planned file.
    const files: FileChange[] = [];
    for (const file of program.files) {
      const contents = defective ? corruptFileContents(file.contents) : file.contents;
      const written = harness.workspace.write({ task_ref: request.node.task_id, path: file.path, content: contents });
      if (written.status === 'UNSUPPORTED') {
        return {
          kind: 'FAILED',
          failureKind: 'CAPABILITY_UNSUPPORTED',
          reason: `the body advertisement does not carry workspace.write: ${written.reason}`,
          retryable: false,
        };
      }
      if (written.status === 'FAILED') {
        return { kind: 'FAILED', failureKind: 'OPERATION_FAILURE', reason: `workspace.write ran and failed: ${written.error}`, retryable: true };
      }
      files.push({ path: file.path, contents });
    }

    // §9 observations.emit — the body's honest progress observation
    // (pre-semantic input, NEVER authoritative evidence).
    harness.observations.emit({
      task_ref: request.node.task_id,
      observation_kind: 'body.progress',
      payload: {
        files_written: files.length,
        attempt: request.attempt,
        defective,
        note: 'body-side progress observation — pre-semantic input, never authoritative evidence',
      },
    });

    return {
      kind: 'IMPLEMENTED',
      files,
      bodyProvenance: { bodyId: request.bodyId, leaseRef: request.leaseRef, attempt: request.attempt },
    };
  }
}
