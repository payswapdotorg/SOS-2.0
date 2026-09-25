/**
 * The task runtime (Work Order P12): durable task state + resumable
 * execution over the merged P5 execution fabric and P6 task graph.
 *
 *   - startTask: graph node + gateway-gated lease + assignment (the
 *     SAME P6 graph — this runtime resumes it, it never invents a
 *     second one).
 *   - captureCheckpoint: a content-addressed durable snapshot (exact
 *     graph step index, accumulated step outputs, workspace revision,
 *     authority context, unresolved uncertainty) recorded through the
 *     P5 fabric and chained into the P6 graph.
 *   - resumeFromCheckpoint: integrity-verified (fail closed on
 *     CHECKPOINT_INVALID) resume of the SAME work graph from the
 *     checkpoint's step — never a silent restart, never a skipped
 *     verification.
 *   - cancelTask: first-class durable cancellation through the P9
 *     action surface (evidence chain) + the fabric's terminal
 *     transition; a cancelled task STAYS cancelled across body
 *     replacement.
 *   - executeRecoveryPlan: body replacement through the fabric
 *     (identity preserved); the replacement inherits the checkpoint.
 *   - runProgram: the resumable step engine (typed worker step
 *     program); an injected interrupt seam models mid-task body loss;
 *     DENIED operations stop execution fail-closed.
 *
 * NO SELF-APPROVAL: the engine never certifies completion — the caller
 * supplies the independent verification record (completeTask).
 */

import type { ExecutionFabric, FabricOperationResult } from '@sos-2/execution-fabric';
import type { TaskGraph, TaskNode, TaskNodeInput, TaskLane } from '@sos-2/task-graph';
import type { TaskRecord, TaskStateRepository, TaskCheckpoint, TaskVerificationRecord, Clock, BodyLeaseRepository } from '@sos-2/live-store';
import { formatRfc3339 } from '@sos-2/live-store';
import type { WorkerStep, WorkerStepProgram } from '@sos-2/worker-runtime';
import { assertValidWorkerStepProgram } from '@sos-2/worker-runtime';
import type { ActorRef } from '@sos-2/action-gateway';
import type { JsonValue } from '@sos-2/semantic-spine';
import type { BodyBroker } from '@sos-2/body-broker';
import type { LeaseActionService, RecoveryPlan } from '@sos-2/autonomy-runtime';
import { InMemoryCheckpointIntegrity, assertCheckpointVerifiable } from './integrity.js';
import type { CheckpointIntegrityStore } from './integrity.js';
import { TaskRuntimeError } from './errors.js';

/** The typed resumable checkpoint state (the work-graph snapshot). */
export interface CheckpointState {
  /** The 0-based step index the checkpoint resumes FROM (already-completed steps before it). */
  readonly step_index: number;
  /** The accumulated step outputs BEFORE step_index (the deterministic resume evidence). */
  readonly step_outputs: readonly StepOutcome[];
}

/** One step's typed outcome (the engine's transcript entry). */
export interface StepOutcome {
  /** The 0-based step index. */
  readonly index: number;
  /** The step kind. */
  readonly kind: WorkerStep['kind'];
  /** 'OK' | 'DENIED' | 'FAILED' | 'UNSUPPORTED' | 'CHECKPOINTED' | 'ASK_PARKED' (per kind). */
  readonly outcome: string;
  /** The operation's output payload (canonical JSON) when the step produced one. */
  readonly output: JsonValue | null;
  /** The observation event id the durable surfaces recorded, when any. */
  readonly observation_id: string | null;
}

/** The execution transcript of one run segment. */
export interface ExecutionTranscript {
  readonly task_id: string;
  /** Outcomes of THIS segment (resume segments start at their checkpoint index). */
  readonly outcomes: readonly StepOutcome[];
  /** Index the run stopped at (null when it ran to the end). */
  readonly stopped_at: number | null;
  /** 'COMPLETED' | 'DENIED' | 'FAILED' | 'UNSUPPORTED' | 'ASK_PARKED' | 'INTERRUPTED'. */
  readonly stop_reason: string;
  /** Checkpoint ids captured during this segment. */
  readonly checkpoints: readonly string[];
}

export interface TaskRuntimeDeps {
  readonly fabric: ExecutionFabric;
  /** The body broker: the §9 session establishment surface (createTask / resumeTask). */
  readonly broker: BodyBroker;
  readonly graph: TaskGraph;
  readonly tasks: TaskStateRepository;
  readonly leases: BodyLeaseRepository;
  readonly leaseActions: LeaseActionService;
  readonly clock: Clock;
  /** The checkpoint integrity store (content-addressed, fail-closed). */
  readonly integrity?: CheckpointIntegrityStore;
}

/** Input for starting a durable task (graph node + lease + assignment). */
export interface StartTaskInput {
  readonly node: Omit<TaskNodeInput, 'steps'>;
  /** The typed work program (P6 vocabulary — the SAME work graph). */
  readonly program: WorkerStepProgram;
  /** The body to lease for execution (registered with the broker). */
  readonly body_id: string;
  /** The actor the lease action runs as (authority-gated at action time). */
  readonly actor: ActorRef;
  /** The source revision the lease action targets. */
  readonly targetSha: string;
  /** The worker lane to assign (1-3; default 1). */
  readonly lane?: TaskLane;
  /** Lease expiry (RFC3339) or null. */
  readonly expires_at?: string | null;
}

export type StartTaskOutcome =
  | { readonly status: 'STARTED'; readonly task_id: string; readonly lease_id: string; readonly node: TaskNode }
  | { readonly status: 'DENIED'; readonly task_id: string; readonly reason: string };

/** The typed resume outcome. */
export type ResumeOutcome =
  | { readonly status: 'RESUMED'; readonly task_id: string; readonly resume_from_step: number; readonly checkpoint_id: string }
  | { readonly status: 'ALREADY_RUNNING'; readonly task_id: string }
  | { readonly status: 'REFUSED'; readonly task_id: string; readonly reason: string };

/** The typed recovery execution outcome. */
export type RecoveryOutcome =
  | { readonly status: 'REPLACED'; readonly task_id: string; readonly replacement_body_id: string; readonly new_lease_id: string; readonly ended_lease_id: string; readonly resume_from_checkpoint: string | null }
  | { readonly status: 'DENIED'; readonly task_id: string; readonly reason: string };

/** The interrupt seam: 'CONTINUE' or 'KILL' (mid-task body loss) per step. */
export type InterruptHook = (index: number) => 'CONTINUE' | 'KILL';

export interface RunOptions {
  /** Resume from a stored checkpoint id (verified; fail-closed). */
  readonly fromCheckpoint?: string;
  /** The interrupt seam (deterministic test wiring for mid-task body loss). */
  readonly interrupt?: InterruptHook;
}

/**
 * THE TASK RUNTIME. One instance per composition root; state lives in
 * the durable records (this object holds no task state).
 */
export class TaskRuntime {
  private readonly integrity: CheckpointIntegrityStore;
  private cancelSequence = 0;

  constructor(private readonly deps: TaskRuntimeDeps) {
    this.integrity = deps.integrity ?? new InMemoryCheckpointIntegrity();
  }

  /** Start a durable task: graph node -> gateway-gated lease -> assignment (RUNNING). */
  async startTask(input: StartTaskInput): Promise<StartTaskOutcome> {
    const nodeInput: TaskNodeInput = { ...input.node, steps: input.program as unknown as JsonValue };
    let node: TaskNode;
    try {
      assertValidWorkerStepProgram(input.program);
    } catch (cause) {
      throw new TaskRuntimeError('INVALID_INPUT', `the work program is not a typed step program: ${(cause as Error).message}`);
    }
    node = await this.deps.graph.addNode(nodeInput);
    const granted = await this.deps.leaseActions.grantLease({
      task_id: node.task_id,
      body_id: input.body_id,
      actor: input.actor,
      targetSha: input.targetSha,
      expires_at: input.expires_at ?? null,
      sequence: 1,
    });
    if (granted.status === 'DENIED') {
      return { status: 'DENIED', task_id: node.task_id, reason: `lease action denied: ${granted.denial.reason} — ${granted.denial.detail}` };
    }
    if (granted.status === 'FAILED') {
      return { status: 'DENIED', task_id: node.task_id, reason: `lease action failed: ${granted.failure.errorType} — ${granted.failure.message}` };
    }
    const assigned = await this.deps.graph.assign(node.task_id, {
      lane: input.lane ?? 1,
      worker_ref: input.body_id,
      lease_ref: granted.lease.lease_id,
      note: 'task-runtime start (gateway-gated lease)',
    });
    // §9 SESSION ESTABLISHMENT (the worker-runtime contract precedent):
    // createTask on a first run; resumeTask adopts on a replacement body.
    const session = this.deps.broker.harnessFor(input.body_id).createTask({
      task_ref: node.task_id,
      input: { work_program_steps: input.program.steps.length },
    });
    if (session.status === 'UNSUPPORTED') {
      return { status: 'DENIED', task_id: node.task_id, reason: `body advertisement does not carry createTask: ${session.reason}` };
    }
    if (session.status === 'FAILED') {
      return { status: 'DENIED', task_id: node.task_id, reason: `body createTask ran and failed: ${session.error}` };
    }
    return { status: 'STARTED', task_id: node.task_id, lease_id: granted.lease.lease_id, node: assigned };
  }

  /** Capture a content-addressed checkpoint on a RUNNING/PAUSED task. */
  async captureCheckpoint(taskId: string, state: CheckpointState, label: string | null = null): Promise<TaskCheckpoint> {
    const record = await this.requireRecord(taskId);
    if (record.status !== 'RUNNING' && record.status !== 'PAUSED') {
      throw new TaskRuntimeError('TASK_RUNTIME', `task ${JSON.stringify(taskId)} is ${record.status} — checkpoints capture on RUNNING or PAUSED tasks`);
    }
    const node = await this.deps.graph.node(taskId);
    const workGraphState: JsonValue = {
      step_index: state.step_index,
      step_outputs: state.step_outputs.map((outcome) => ({
        index: outcome.index,
        kind: outcome.kind,
        outcome: outcome.outcome,
        output: outcome.output,
        observation_id: outcome.observation_id,
      })),
      workspace_revision: {
        source_revision: record.owned_revision.source_revision,
        deployment_revision: record.owned_revision.deployment_revision,
      },
      authority_context: {
        grant_refs: [...record.authority_context.grant_refs],
        notes: record.authority_context.notes,
      },
      unresolved_uncertainty: [...record.unresolved_uncertainty],
      checkpoint_state_version: 1,
    };
    const transition = await this.deps.fabric.recordCheckpoint(taskId, {
      label,
      work_graph_state: workGraphState,
      notes: `resumable snapshot at step ${state.step_index}`,
    });
    if (transition.status !== 'TRANSITIONED') {
      throw new TaskRuntimeError('TASK_RUNTIME', `the fabric refused the checkpoint on task ${JSON.stringify(taskId)}: ${'denial' in transition ? transition.denial.reason : transition.error}`);
    }
    const updated = transition.task;
    const checkpoint = updated.checkpoints[updated.checkpoints.length - 1];
    if (checkpoint === undefined) {
      throw new TaskRuntimeError('TASK_RUNTIME', `the fabric recorded no checkpoint on task ${JSON.stringify(taskId)} — a structural defect`);
    }
    this.integrity.record(checkpoint);
    if (node !== undefined) {
      await this.deps.graph.recordCheckpointRef(taskId, { checkpoint_id: checkpoint.checkpoint_id, step_index: state.step_index, recorded_at: checkpoint.recorded_at });
    }
    return checkpoint;
  }

  /** Integrity-verified resume from a stored checkpoint (fail closed). */
  async resumeFromCheckpoint(taskId: string, checkpointId: string): Promise<ResumeOutcome> {
    const record = await this.requireRecord(taskId);
    const checkpoint = record.checkpoints.find((entry) => entry.checkpoint_id === checkpointId);
    if (checkpoint === undefined) {
      throw new TaskRuntimeError('RESUME_REFUSED', `checkpoint ${JSON.stringify(checkpointId)} is not in the durable record of task ${JSON.stringify(taskId)} — resume binds to durable checkpoints only`);
    }
    assertCheckpointVerifiable(this.integrity, checkpoint);
    if (record.status === 'CANCELLED' || record.status === 'COMPLETED' || record.status === 'FAILED') {
      return { status: 'REFUSED', task_id: taskId, reason: `task is ${record.status} — cancellation is durable and completed work never silently resumes` };
    }
    if (record.status === 'RUNNING') {
      return { status: 'ALREADY_RUNNING', task_id: taskId };
    }
    const state = parseCheckpointState(checkpoint);
    const resumed = await this.deps.fabric.resumeTask(taskId);
    if (resumed.status !== 'TRANSITIONED') {
      return { status: 'REFUSED', task_id: taskId, reason: `the fabric refused the resume: ${'denial' in resumed ? resumed.denial.reason : resumed.error}` };
    }
    const prior = await this.deps.graph.node(taskId);
    if (prior !== undefined) {
      await this.deps.graph.adoptFabricTransition(taskId, prior);
    }
    return { status: 'RESUMED', task_id: taskId, resume_from_step: state.step_index, checkpoint_id: checkpointId };
  }

  /** Durable cancellation through the P9 action surface (evidence chain) + fabric terminal write. */
  async cancelTask(taskId: string, input: { readonly actor: ActorRef; readonly targetSha: string; readonly reason: string }): Promise<{ readonly status: 'CANCELLED' | 'DENIED'; readonly task: TaskRecord | null; readonly reason: string }> {
    const record = await this.requireRecord(taskId);
    if (record.status === 'CANCELLED') {
      return { status: 'CANCELLED', task: record, reason: 'already cancelled — cancellation is durable' };
    }
    const leaseId = record.body_lease_ref;
    const bodyId = await this.bodyOf(taskId);
    if (leaseId === null || bodyId === null) {
      return { status: 'DENIED', task: record, reason: `task ${JSON.stringify(taskId)} holds no lease/body to cancel through the action surface` };
    }
    this.cancelSequence += 1;
    const revoked = await this.deps.leaseActions.revokeLease({
      task_id: taskId,
      body_id: bodyId,
      actor: input.actor,
      targetSha: input.targetSha,
      sequence: (record.observations.length + 1) * 100 + this.cancelSequence,
      lease_id: leaseId,
      reason: input.reason,
    });
    if (revoked.status === 'DENIED') {
      return { status: 'DENIED', task: record, reason: `the cancellation action was denied (fail closed — no bypass of the action surface): ${revoked.denial.reason}` };
    }
    if (revoked.status === 'FAILED') {
      return { status: 'DENIED', task: record, reason: `the cancellation action failed: ${revoked.failure.errorType} — ${revoked.failure.message}` };
    }
    const cancelled = await this.deps.fabric.cancelTask(taskId);
    if (cancelled.status !== 'TRANSITIONED') {
      return { status: 'DENIED', task: record, reason: `the fabric refused the cancellation: ${'denial' in cancelled ? cancelled.denial.reason : cancelled.error}` };
    }
    const prior = await this.deps.graph.node(taskId);
    if (prior !== undefined) {
      await this.deps.graph.adoptFabricTransition(taskId, prior);
    }
    return { status: 'CANCELLED', task: cancelled.task, reason: input.reason };
  }

  /**
   * Execute a recovery plan: replace the body through the fabric (identity
   * preserved), then walk the CANONICAL P6 graph recovery — record the
   * typed BODY_LOST failure (assignment cleared; the fabric's new lease
   * binding preserved), re-queue (retry), and RE-ASSIGN the replacement
   * body under its new lease (the handoff carries the authority context
   * and workspace revision). The task ends RUNNING with the replacement
   * lease correctly bound; the caller continues with runProgram({ fromCheckpoint }).
   */
  async executeRecoveryPlan(plan: RecoveryPlan, reason: string): Promise<RecoveryOutcome> {
    const record = await this.requireRecord(plan.task_id);
    if (record.status !== 'RUNNING' && record.status !== 'PAUSED') {
      return { status: 'DENIED', task_id: plan.task_id, reason: `task is ${record.status} — recovery replaces bodies of active tasks only` };
    }
    const prior = await this.deps.graph.node(plan.task_id);
    const lane = prior?.assignment?.lane ?? 1;
    const replacement = await this.deps.fabric.replaceBodyForTask(plan.task_id, reason);
    if (replacement.status === 'DENIED') {
      return { status: 'DENIED', task_id: plan.task_id, reason: `body replacement denied: ${replacement.denial.reason}` };
    }
    if (prior !== undefined) {
      // The typed body-loss failure (RUNNING/PAUSED -> FAILED, assignment cleared).
      await this.deps.graph.recordFailure(plan.task_id, {
        failure_kind: 'BODY_LOST',
        reason: `verified body loss: ${reason}`,
        recovery: 'RETRYABLE',
      });
      // Re-queue (FAILED -> PENDING) — the retry notes the resume checkpoint.
      await this.deps.graph.retry(plan.task_id);
      // Re-assign the replacement body under its NEW lease (PENDING -> RUNNING).
      await this.deps.graph.assign(plan.task_id, {
        lane,
        worker_ref: replacement.body_id,
        lease_ref: replacement.new_lease.lease_id,
        note: `body-loss recovery: replacement ${JSON.stringify(replacement.body_id)} inherits identity + checkpoint (resume from ${plan.inheritance.resume_from_checkpoint?.checkpoint_id ?? 'start'})`,
      });
      // §9 SESSION ADOPTION: the replacement body ADOPTS the task with a
      // fresh bounded environment (resumeTask; body-side state did not
      // survive — the durable record is the truth).
      const adopted = this.deps.broker.harnessFor(replacement.body_id).resumeTask({
        task_ref: plan.task_id,
        input: { resumed_from_checkpoint: plan.inheritance.resume_from_checkpoint?.checkpoint_id ?? null },
      });
      if (adopted.status === 'UNSUPPORTED') {
        return { status: 'DENIED', task_id: plan.task_id, reason: `replacement body advertisement does not carry resumeTask: ${adopted.reason}` };
      }
      if (adopted.status === 'FAILED') {
        return { status: 'DENIED', task_id: plan.task_id, reason: `replacement body resumeTask ran and failed: ${adopted.error}` };
      }
    }
    return {
      status: 'REPLACED',
      task_id: plan.task_id,
      replacement_body_id: replacement.body_id,
      new_lease_id: replacement.new_lease.lease_id,
      ended_lease_id: replacement.ended_lease.lease_id,
      resume_from_checkpoint: plan.inheritance.resume_from_checkpoint?.checkpoint_id ?? null,
    };
  }

  /**
   * The resumable step engine: runs the typed work program from a
   * checkpoint's step index (or zero), recording a content-addressed
   * checkpoint at every 'checkpoint' step. DENIED operations stop the
   * run fail-closed; the injected interrupt seam models mid-task body
   * loss; ASK steps park the task (ASK is a success state).
   */
  async runProgram(taskId: string, options: RunOptions = {}): Promise<ExecutionTranscript> {
    const record = await this.requireRecord(taskId);
    const program = this.programOf(record);
    let startIndex = 0;
    let priorOutcomes: StepOutcome[] = [];
    if (options.fromCheckpoint !== undefined) {
      const checkpoint = record.checkpoints.find((entry) => entry.checkpoint_id === options.fromCheckpoint);
      if (checkpoint === undefined) {
        throw new TaskRuntimeError('RESUME_REFUSED', `checkpoint ${JSON.stringify(options.fromCheckpoint)} is not in the durable record of task ${JSON.stringify(taskId)}`);
      }
      assertCheckpointVerifiable(this.integrity, checkpoint);
      const state = parseCheckpointState(checkpoint);
      startIndex = state.step_index;
      priorOutcomes = [...state.step_outputs];
    }
    const outcomes: StepOutcome[] = [];
    const checkpoints: string[] = [];
    const steps = [...program.steps];
    for (let index = startIndex; index < steps.length; index += 1) {
      if (options.interrupt !== undefined && options.interrupt(index) === 'KILL') {
        return { task_id: taskId, outcomes, stopped_at: index, stop_reason: 'INTERRUPTED', checkpoints };
      }
      const step = steps[index]!;
      if (step.kind === 'operation') {
        const result: FabricOperationResult = await this.deps.fabric.execute(taskId, step.operation);
        if (result.status === 'DENIED') {
          outcomes.push({ index, kind: step.kind, outcome: 'DENIED', output: null, observation_id: result.observation_id });
          return { task_id: taskId, outcomes, stopped_at: index, stop_reason: 'DENIED', checkpoints };
        }
        if (result.status === 'UNSUPPORTED') {
          outcomes.push({ index, kind: step.kind, outcome: 'UNSUPPORTED', output: null, observation_id: result.observation_id });
          return { task_id: taskId, outcomes, stopped_at: index, stop_reason: 'UNSUPPORTED', checkpoints };
        }
        if (result.status === 'CONFLICT') {
          outcomes.push({ index, kind: step.kind, outcome: 'CONFLICT', output: null, observation_id: null });
          return { task_id: taskId, outcomes, stopped_at: index, stop_reason: 'CONFLICT', checkpoints };
        }
        if (result.availability === 'FAILURE') {
          // The operation RAN and failed truthfully (the durable task keeps
          // its status) — execution stops with the typed failure.
          outcomes.push({ index, kind: step.kind, outcome: 'FAILED', output: null, observation_id: result.observation_id });
          return { task_id: taskId, outcomes, stopped_at: index, stop_reason: 'FAILED', checkpoints };
        }
        outcomes.push({ index, kind: step.kind, outcome: 'OK', output: result.output, observation_id: result.observation_id });
        continue;
      }
      if (step.kind === 'checkpoint') {
        // The checkpoint's OWN transcript entry is part of the snapshot it
        // captures (the resumed segment continues AFTER it, and the combined
        // evidence must equal the uninterrupted run's step-for-step).
        outcomes.push({ index, kind: step.kind, outcome: 'CHECKPOINTED', output: null, observation_id: null });
        const nextState: CheckpointState = { step_index: index + 1, step_outputs: [...priorOutcomes, ...outcomes] };
        const checkpoint = await this.captureCheckpoint(taskId, nextState, step.label);
        checkpoints.push(checkpoint.checkpoint_id);
        continue;
      }
      if (step.kind === 'uncertainty') {
        await this.appendUncertainty(taskId, step.statement);
        outcomes.push({ index, kind: step.kind, outcome: 'RECORDED', output: null, observation_id: null });
        continue;
      }
      if (step.kind === 'ask') {
        // ASK IS A SUCCESS STATE: the graph parks the task PAUSED behind a
        // first-class pending ask (no error, no fabricated progress).
        await this.deps.graph.recordAsk(taskId, `ask:${taskId}:${index}`, step.statement);
        outcomes.push({ index, kind: step.kind, outcome: 'ASK_PARKED', output: null, observation_id: null });
        return { task_id: taskId, outcomes, stopped_at: index, stop_reason: 'ASK_PARKED', checkpoints };
      }
    }
    return { task_id: taskId, outcomes, stopped_at: null, stop_reason: 'COMPLETED', checkpoints };
  }

  /** Complete the task with an INDEPENDENT verification record (no self-approval — the caller verifies). */
  async completeTask(taskId: string, verification: TaskVerificationRecord, verificationRef: string): Promise<TaskRecord> {
    const transition = await this.deps.fabric.completeTask(taskId, verification);
    if (transition.status !== 'TRANSITIONED') {
      throw new TaskRuntimeError('TASK_RUNTIME', `the fabric refused completion of task ${JSON.stringify(taskId)}: ${'denial' in transition ? transition.denial.reason : transition.error}`);
    }
    const prior = await this.deps.graph.node(taskId);
    if (prior !== undefined) {
      await this.deps.graph.adoptFabricTransition(taskId, prior);
      await this.deps.graph.recordVerificationRef(taskId, verificationRef);
    }
    return transition.task;
  }

  /** The full completion evidence of a run (prior + current segment outputs — the deterministic evidence). */
  async completionEvidenceOf(taskId: string, fromCheckpoint?: string): Promise<readonly StepOutcome[]> {
    const record = await this.requireRecord(taskId);
    let prior: StepOutcome[] = [];
    if (fromCheckpoint !== undefined) {
      const checkpoint = record.checkpoints.find((entry) => entry.checkpoint_id === fromCheckpoint);
      if (checkpoint !== undefined) {
        prior = [...parseCheckpointState(checkpoint).step_outputs];
      }
    }
    return prior;
  }

  private async requireRecord(taskId: string): Promise<TaskRecord> {
    if (typeof taskId !== 'string' || taskId.length === 0) {
      throw new TaskRuntimeError('INVALID_INPUT', `taskId must be a non-empty string, received: ${JSON.stringify(taskId)}`);
    }
    const record = await this.deps.tasks.get(taskId);
    if (record === undefined) {
      throw new TaskRuntimeError('TASK_RUNTIME', `task ${JSON.stringify(taskId)} is not in the durable store — killing a body never loses the task`);
    }
    return record;
  }

  private programOf(record: TaskRecord): WorkerStepProgram {
    // The durable node snapshot (record.plan) carries the WHOLE typed work
    // program in its `steps` field (the P6 opaque-plan convention: the
    // graph stores the program verbatim; this module is its typed reader).
    const snapshot = record.plan as { steps?: unknown };
    const program: unknown = snapshot['steps'];
    assertValidWorkerStepProgram(program);
    return program;
  }

  private async bodyOf(taskId: string): Promise<string | null> {
    const leaseId = (await this.requireRecord(taskId)).body_lease_ref;
    if (leaseId === null) return null;
    const lease = await this.deps.leases.get(leaseId);
    return lease?.body_id ?? null;
  }

  private async appendUncertainty(taskId: string, statement: string): Promise<void> {
    const record = await this.requireRecord(taskId);
    if (record.unresolved_uncertainty.includes(statement)) return;
    const updated: TaskRecord = {
      ...structuredClone(record),
      unresolved_uncertainty: [...record.unresolved_uncertainty, statement],
      updated_at: formatRfc3339(this.deps.clock.nowEpochMs()),
      revision: record.revision + 1,
    };
    const put = await this.deps.tasks.put(updated, { expected_revision: record.revision });
    if (put.kind !== 'STORED' && put.kind !== 'IDENTICAL') {
      throw new TaskRuntimeError('TASK_RUNTIME', `uncertainty append lost the CAS race on task ${JSON.stringify(taskId)} (${put.kind}) — re-read and retry`);
    }
  }
}

/** Parse a stored checkpoint's work_graph_state into the typed resume state. */
export function parseCheckpointState(checkpoint: TaskCheckpoint): CheckpointState {
  const raw = checkpoint.work_graph_state as { step_index?: unknown; step_outputs?: unknown };
  if (typeof raw !== 'object' || raw === null || typeof raw['step_index'] !== 'number' || !Array.isArray(raw['step_outputs'])) {
    throw new TaskRuntimeError('CHECKPOINT_INVALID', `checkpoint ${JSON.stringify(checkpoint.checkpoint_id)} carries a malformed resume state — expected { step_index, step_outputs }`);
  }
  return { step_index: raw['step_index'], step_outputs: raw['step_outputs'] as readonly StepOutcome[] };
}
