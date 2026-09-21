/**
 * THE WORKER RUNTIME HOST (Work Order P8) — the local reference of the
 * external worker topology.
 *
 * One bounded task, one lease, one honest run:
 *
 *   1. §7 DEVICE GATE — a work order whose body requirements demand
 *      placement "user-device" QUEUES while the device is offline
 *      (local tasks queue safely); cloud/remote bodies run regardless
 *      of device presence (the task continues while the user's computer
 *      is off — pinned by tests with the device reported offline).
 *   2. LEASE — createBoundedTask through the execution fabric (the
 *      authority gate -> capability-based body selection -> single-use
 *      lease -> contract createTask -> durable §6 record).
 *   3. EXECUTE — each step of the work order dispatches through the
 *      fabric's uniform gate pipeline (TASK -> LEASE -> AUTHORITY ->
 *      ADVERTISEMENT -> DISPATCH); observations and artifacts land in
 *      the typed boundaries automatically.
 *   4. RELEASE — completeTask with the Spirit-side verification record
 *      built from the step outcomes (§10: evidence refs = observation
 *      ids + captured artifact ids); a denied/unsupported/failed step
 *      stops the program and completes the task with verified:false —
 *      honest, never fabricated. The lease is released by completion.
 *
 * NO long-running work inside any request lifetime: the host runs on
 * the injected tick/command source (poll-driven, testable offline).
 *
 * Determinism: no Date.now / Math.random / fetch / process.env in this
 * module — the clock, fabric and command source are injected.
 */

import { InvalidHostInputError } from './errors.js';
import type { BoundedWorkOrder, CommandSource, UserDevicePresence, WorkerCommand } from './commands.js';
import { assertValidWorkerCommand } from './commands.js';
import type { ExecutionFabric, FabricDenial, FabricOperation } from '@sos-2/execution-fabric';
import type { TaskRecord } from '@sos-2/live-store';
import { formatRfc3339 } from '@sos-2/live-store';
import type { Clock } from '@sos-2/live-store';

/** Host dependencies: the fabric, the clock, the device presence and the command source — ALL INJECTED. */
export interface WorkerRuntimeHostDeps {
  readonly fabric: ExecutionFabric;
  readonly clock: Clock;
  readonly devicePresence: UserDevicePresence;
  readonly commandSource: CommandSource;
}

/** The outcome of one executed step. */
export interface StepOutcome {
  /** 1-based step position in the work order. */
  readonly step: number;
  readonly operation: FabricOperation['kind'];
  /** EXECUTED (ran), DENIED (never ran — typed denial), UNSUPPORTED (never ran — advertisement), SKIPPED (after a stopping outcome). */
  readonly status: 'EXECUTED' | 'DENIED' | 'UNSUPPORTED' | 'SKIPPED' | 'CONFLICT';
  /** Truthful availability for EXECUTED steps (SUCCESS | FAILURE). */
  readonly availability: 'SUCCESS' | 'FAILURE' | null;
  readonly observation_id: string | null;
  readonly error: string | null;
  /** The typed denial code for DENIED steps. */
  readonly denial_code: string | null;
}

/** The typed outcome of one processed command. */
export type HostCommandOutcome =
  | {
      readonly status: 'COMPLETED';
      readonly task: TaskRecord;
      readonly steps: readonly StepOutcome[];
      /** The evidence refs of the verification record (observation ids + captured artifact ids). */
      readonly evidence_refs: readonly string[];
      readonly verified: boolean;
      readonly summary: string;
    }
  | {
      /** The §7 device gate parked a LOCAL work order while the device is offline. */
      readonly status: 'QUEUED';
      readonly task_id: string;
      readonly reason: string;
    }
  | { readonly status: 'DENIED'; readonly denial: FabricDenial }
  | { readonly status: 'FAILED'; readonly error: string }
  | {
      readonly status: 'REPLACED';
      readonly task: TaskRecord;
      readonly ended_lease_id: string;
      readonly new_lease_id: string;
      readonly new_body_id: string;
    }
  | { readonly status: 'TRANSITIONED'; readonly task: TaskRecord; readonly observation_id: string };

/** The outcome of one host tick. */
export interface TickOutcome {
  /** Outcomes processed on this tick (a queued retry, then at most one new command). */
  readonly processed: readonly HostCommandOutcome[];
  /** True when the command source is drained AND no queued local work remains. */
  readonly idle: boolean;
}

/**
 * THE WORKER RUNTIME HOST.
 */
export class WorkerRuntimeHost {
  private readonly fabric: ExecutionFabric;
  private readonly clock: Clock;
  private readonly devicePresence: UserDevicePresence;
  private readonly commandSource: CommandSource;
  private readonly parkedLocalOrders: { order: BoundedWorkOrder }[] = [];

  constructor(deps: WorkerRuntimeHostDeps) {
    if (typeof deps !== 'object' || deps === null || typeof deps.fabric !== 'object' || deps.fabric === null) {
      throw new InvalidHostInputError('the worker runtime host requires an injected ExecutionFabric');
    }
    if (typeof deps.clock !== 'object' || deps.clock === null || typeof deps.clock.nowEpochMs !== 'function') {
      throw new InvalidHostInputError('the worker runtime host requires an injected clock (no hidden time)');
    }
    if (typeof deps.devicePresence !== 'object' || deps.devicePresence === null || typeof deps.devicePresence.isDeviceOnline !== 'function') {
      throw new InvalidHostInputError('the worker runtime host requires an injected user-device presence port');
    }
    if (typeof deps.commandSource !== 'object' || deps.commandSource === null || typeof deps.commandSource.poll !== 'function') {
      throw new InvalidHostInputError('the worker runtime host requires an injected command source (no ambient timers)');
    }
    this.fabric = deps.fabric;
    this.clock = deps.clock;
    this.devicePresence = deps.devicePresence;
    this.commandSource = deps.commandSource;
  }

  /**
   * One tick: first retry §7-queued LOCAL work when the device is back
   * online, then process at most one new command from the source.
   */
  async tick(): Promise<TickOutcome> {
    const processed: HostCommandOutcome[] = [];
    // The §7 device gate: parked local orders run when the device returns.
    while (this.parkedLocalOrders.length > 0 && this.devicePresence.isDeviceOnline()) {
      const parked = this.parkedLocalOrders.shift()!;
      processed.push(await this.runBoundedTask(parked.order));
    }
    const command = this.commandSource.poll();
    if (command !== null) {
      processed.push(await this.runCommand(command));
    }
    return { processed, idle: this.parkedLocalOrders.length === 0 && this.commandSource.poll() === null };
  }

  /** Process commands until the source is drained and no parked local work remains. */
  async drain(): Promise<readonly HostCommandOutcome[]> {
    const outcomes: HostCommandOutcome[] = [];
    // A bounded drain: the command source is finite by contract (a poll
    // loop with no progress guard would be an ambient loop — refuse it).
    for (let guard = 0; guard < 10_000; guard += 1) {
      const tick = await this.tick();
      outcomes.push(...tick.processed);
      if (tick.idle) {
        return outcomes;
      }
    }
    throw new InvalidHostInputError('the drain guard tripped — the command source never drained (10 000 ticks); refusing an ambient loop');
  }

  /** Process one command (the poll-free entry point — the same code path tick uses). */
  async runCommand(command: WorkerCommand): Promise<HostCommandOutcome> {
    assertValidWorkerCommand(command);
    switch (command.kind) {
      case 'run-bounded-task':
        return this.runBoundedTask(command.order);
      case 'replace-body':
        return this.replaceBody(command.task_id, command.reason);
      case 'pause-task':
        return this.transitionTask(command.task_id, 'pause');
      case 'resume-task':
        return this.transitionTask(command.task_id, 'resume');
      case 'cancel-task':
        return this.transitionTask(command.task_id, 'cancel');
    }
  }

  // -------------------------------------------------------------------------
  // Bounded task execution
  // -------------------------------------------------------------------------

  private async runBoundedTask(order: BoundedWorkOrder): Promise<HostCommandOutcome> {
    // §7 DEVICE GATE — local bodies queue while the device is offline;
    // cloud/remote bodies never consult device presence for scheduling.
    if (order.requirements.placement === 'user-device' && !this.devicePresence.isDeviceOnline()) {
      this.parkedLocalOrders.push({ order });
      return {
        status: 'QUEUED',
        task_id: order.task_id,
        reason: `the work order requires a user-device body and the user's device is offline — local tasks queue safely while the device is offline (§7) and run when it returns`,
      };
    }

    const created = await this.fabric.createBoundedTask({
      task_id: order.task_id,
      mission_ref: order.mission_ref,
      plan: order.plan,
      grant_refs: [...order.grant_refs],
      requirements: order.requirements,
      holder: order.holder,
      expires_at: order.expires_at,
    });
    if (created.status === 'DENIED') {
      return { status: 'DENIED', denial: created.denial };
    }
    if (created.status === 'FAILED') {
      return { status: 'FAILED', error: `body createTask ran and failed: ${created.error}` };
    }

    // Execute the step program through the uniform gate pipeline.
    const steps: StepOutcome[] = [];
    const evidenceRefs: string[] = [];
    let stopped = false;
    let verified = true;
    let stopSummary = '';
    for (let index = 0; index < order.steps.length; index += 1) {
      const operation = order.steps[index]!;
      if (stopped) {
        steps.push({ step: index + 1, operation: operation.kind, status: 'SKIPPED', availability: null, observation_id: null, error: null, denial_code: null });
        continue;
      }
      const result = await this.fabric.execute(order.task_id, operation);
      if (result.status === 'CONFLICT') {
        // The durable write lost a CAS race — a truthful, retryable outcome.
        steps.push({ step: index + 1, operation: operation.kind, status: 'CONFLICT', availability: null, observation_id: null, error: result.reason, denial_code: null });
        verified = false;
        stopSummary = `step ${index + 1} (${operation.kind}) lost the durable write race`;
        stopped = true;
        continue;
      }
      if (result.status === 'DENIED') {
        steps.push({ step: index + 1, operation: operation.kind, status: 'DENIED', availability: null, observation_id: result.observation_id, error: result.denial.reason, denial_code: result.denial.code });
        evidenceRefs.push(result.observation_id ?? '');
        verified = false;
        stopSummary = `step ${index + 1} (${operation.kind}) was denied: ${result.denial.code}`;
        stopped = true;
        continue;
      }
      if (result.status === 'UNSUPPORTED') {
        steps.push({ step: index + 1, operation: operation.kind, status: 'UNSUPPORTED', availability: null, observation_id: result.observation_id, error: result.reason, denial_code: null });
        evidenceRefs.push(result.observation_id ?? '');
        verified = false;
        stopSummary = `step ${index + 1} (${operation.kind}) is not carried by the body advertisement`;
        stopped = true;
        continue;
      }
      steps.push({
        step: index + 1,
        operation: operation.kind,
        status: 'EXECUTED',
        availability: result.availability,
        observation_id: result.observation_id,
        error: result.error,
        denial_code: null,
      });
      evidenceRefs.push(result.observation_id);
      if (result.availability === 'FAILURE') {
        verified = false;
        stopSummary = `step ${index + 1} (${operation.kind}) ran and failed: ${result.error ?? 'failure'}`;
        stopped = true;
        continue;
      }
      // Capture artifact ids from artifacts.capture step outputs (typed evidence refs).
      if (operation.kind === 'artifacts.capture' && result.output !== null && typeof result.output === 'object' && 'artifact_id' in (result.output as Record<string, unknown>)) {
        const artifactId = (result.output as Record<string, unknown>)['artifact_id'];
        if (typeof artifactId === 'string' && artifactId.length > 0) {
          evidenceRefs.push(artifactId);
        }
      }
    }

    // §10 COMPLETION — the Spirit-side verification record, honest:
    // verified only when every step ran and succeeded.
    const executedCount = steps.filter((step) => step.status === 'EXECUTED' && step.availability === 'SUCCESS').length;
    const summary =
      verified && order.steps.length > 0
        ? `all ${order.steps.length} step(s) executed successfully on the leased body; ${evidenceRefs.length} evidence ref(s) recorded`
        : stopSummary.length > 0
          ? `${stopSummary} — the task completes with verified:false (honest: never fabricated)`
          : `the work order carried no steps — nothing was executed (verified:${verified ? 'true' : 'false'})`;
    const completion = await this.fabric.completeTask(order.task_id, {
      verified,
      recorded_at: formatRfc3339(this.clock.nowEpochMs()),
      evidence_refs: evidenceRefs.filter((ref) => ref.length > 0),
      summary,
    });
    if (completion.status === 'DENIED') {
      return { status: 'DENIED', denial: completion.denial };
    }
    if (completion.status === 'FAILED') {
      return { status: 'FAILED', error: completion.error };
    }
    return {
      status: 'COMPLETED',
      task: completion.task,
      steps,
      evidence_refs: evidenceRefs.filter((ref) => ref.length > 0),
      verified,
      summary,
    };
  }

  // -------------------------------------------------------------------------
  // Body replacement + lifecycle commands
  // -------------------------------------------------------------------------

  private async replaceBody(taskId: string, reason: string): Promise<HostCommandOutcome> {
    const replacement = await this.fabric.replaceBodyForTask(taskId, reason);
    if (replacement.status === 'DENIED') {
      return { status: 'DENIED', denial: replacement.denial };
    }
    return {
      status: 'REPLACED',
      task: replacement.task,
      ended_lease_id: replacement.ended_lease.lease_id,
      new_lease_id: replacement.new_lease.lease_id,
      new_body_id: replacement.body_id,
    };
  }

  private async transitionTask(taskId: string, kind: 'pause' | 'resume' | 'cancel'): Promise<HostCommandOutcome> {
    const transition =
      kind === 'pause' ? await this.fabric.pauseTask(taskId) : kind === 'resume' ? await this.fabric.resumeTask(taskId) : await this.fabric.cancelTask(taskId);
    if (transition.status === 'DENIED') {
      return { status: 'DENIED', denial: transition.denial };
    }
    if (transition.status === 'FAILED') {
      return { status: 'FAILED', error: transition.error };
    }
    return { status: 'TRANSITIONED', task: transition.task, observation_id: transition.observation_id ?? '' };
  }
}
