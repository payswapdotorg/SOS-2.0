/**
 * THE REAL TASK-IMPLEMENTATION BINDING (Work Order P19) — the journey's
 * TaskImplementationPort seam bound to the REAL HostedCodingBody
 * (@sos-2/real-bodies, P5 HarnessContract): the body executes the work
 * programs through REAL OpenRouter completions (default model
 * qwen/qwen3-coder-flash, override env SOS_DOGFOOD_BODY_MODEL).
 *
 * THE SYNC-CONTRACT / ASYNC-ENGINE COMPOSITION (the frozen P8 seam
 * discipline, verbatim — the model port's documented composition): the
 * §9 surface and the TaskImplementationPort seam are SYNCHRONOUS by
 * frozen design while a real hosted model API is a network call.
 * Therefore the HARNESS OPERATOR drives the body's async engine
 * (createTask -> runWorkProgram — one bounded model call whose parsed
 * file edits are applied inside the task's bounded sandbox, with
 * honest engine retries) at the composition boundary, and THIS sync
 * seam answers EXACTLY the staged real run: the applied files are read
 * back through the §9 workspace.read surface (the genuine contract
 * surface, never a bespoke body API).
 *
 * The port's output is a TASK OUTPUT (typed files + body provenance) —
 * never a completion: the output becomes a repository artifact only
 * through project realization, and the node counts complete only
 * through the independent evaluation gate.
 */

import type { TaskImplementationPort } from '@sos-2/greenfield-runtime';
import type { TaskImplementationOutcome, TaskImplementationRequest } from '@sos-2/greenfield-runtime';
import type { BodyBroker } from '@sos-2/body-broker';
import { parseTaskWorkProgram } from '@sos-2/implementation-orchestrator';
import type { StagedBodyRun, DogfoodStaging } from './staging.js';
import { stagedBodyRunOutcome } from './staging.js';

export interface RealHostedBodyBindingOptions {
  /** The staging store (the composition-boundary engine runs). */
  readonly staging: DogfoodStaging;
  /** The P5 broker (the §9 body seams — the files are read back through harnessFor). */
  readonly broker: BodyBroker;
}

/**
 * Compose the goal sentence the model receives from the node's typed
 * work program: the intent PLUS the exact planned deliverable paths
 * (the plan's deterministic file set — the model authors the contents;
 * the paths are the plan's, so the realized structure is faithful to
 * the architecture hypothesis).
 */
export function composeWorkProgramGoal(intent: string, plannedPaths: readonly string[]): string {
  return [
    `${intent}.`,
    `Produce the complete deliverable files of this component at exactly these repository-relative paths: ${plannedPaths.join(', ')}.`,
    'Write complete file contents for every path (no diffs, no placeholders, no omissions).',
  ].join(' ');
}

/** Read the applied files of a staged run back through the §9 workspace surface. */
export function readStagedRunFiles(
  broker: BodyBroker,
  run: { readonly files: readonly { readonly path: string }[] },
  bodyId: string,
  taskId: string,
): { ok: true; files: { readonly path: string; readonly contents: string }[] } | { ok: false; reason: string } {
  const harness = broker.harnessFor(bodyId);
  const files: { path: string; contents: string }[] = [];
  for (const applied of run.files) {
    const read = harness.workspace.read({ task_ref: taskId, path: applied.path });
    if (read.status !== 'OK') {
      return { ok: false, reason: `the §9 workspace read of ${JSON.stringify(applied.path)} failed (${read.status}) — the honest answer is a typed failure, never a fabricated file` };
    }
    if (typeof read.value.content !== 'string') {
      return { ok: false, reason: `the §9 workspace read of ${JSON.stringify(applied.path)} produced no content` };
    }
    files.push({ path: applied.path, contents: read.value.content });
  }
  return { ok: true, files };
}

/** Parse a node's steps into the work program goal the body receives (typed, validated — never trusted blindly). */
export function goalForNode(steps: unknown): { readonly goal: string; readonly deliverablePath: string } {
  const program = parseTaskWorkProgram(steps as never);
  const paths = program.files.map((file) => file.path);
  const primary = program.files[0]?.path ?? '';
  return { goal: composeWorkProgramGoal(program.intent, paths), deliverablePath: primary };
}

/**
 * THE REAL HOSTED-BODY TASK-IMPLEMENTATION SEAM — answers EXACTLY the
 * staged real engine runs (the harness operator drove them through the
 * REAL OpenRouter-backed body); a task attempt that was never staged is
 * a typed honest failure (never a fabricated success).
 */
export class RealHostedBodyTaskImplementation implements TaskImplementationPort {
  private readonly staging: DogfoodStaging;

  constructor(options: RealHostedBodyBindingOptions) {
    if (typeof options !== 'object' || options === null || typeof options.staging !== 'object' || options.staging === null) {
      throw new Error('RealHostedBodyTaskImplementation requires the staging store injected');
    }
    if (typeof options.broker !== 'object' || options.broker === null) {
      throw new Error('RealHostedBodyTaskImplementation requires the P5 BodyBroker injected (the §9 body seams)');
    }
    this.staging = options.staging;
  }

  implement(request: TaskImplementationRequest): TaskImplementationOutcome {
    const staged = this.staging.bodyRunOf(request.node.task_id, request.attempt);
    return stagedBodyRunOutcome(request, staged);
  }
}

/** Construct the real hosted-body task-implementation seam. */
export function createRealHostedBodyTaskImplementation(options: RealHostedBodyBindingOptions): RealHostedBodyTaskImplementation {
  return new RealHostedBodyTaskImplementation(options);
}

/** The staged-run bookkeeping the harness operator records per engine attempt (audit). */
export interface RecordedEngineAttempt {
  readonly taskId: string;
  readonly nodeAttempt: number;
  readonly engineAttempt: number;
  readonly run: StagedBodyRun;
}
