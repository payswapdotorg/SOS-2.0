/**
 * THE LOCAL COMPANION HOST (Work Order P11) — the plain Node + TypeScript
 * host of the authenticated local companion.
 *
 * One honest run per work order through the SAME P5 discipline as every
 * bounded task (the fabric's uniform gate pipeline: TASK -> LEASE ->
 * AUTHORITY -> ADVERTISEMENT -> DISPATCH), with the §7 user-device model
 * enforced at the scheduling gate:
 *
 *   1. §7 DEVICE GATE — a work order whose body requirements demand
 *      placement "user-device" (LOCAL-ONLY work) QUEUES while the device
 *      reports offline and runs when it reconnects; cloud/remote work
 *      orders run REGARDLESS of device presence (the task continues
 *      while the user's computer is off — cloud tasks never require the
 *      companion, pinned by tests with zero device probes for cloud
 *      orders).
 *   2. RECONNECT — when queued local work exists and the device is back
 *      online, the host FIRST reconciles the companion's durable local
 *      event log against the P2 live-store (idempotent, replay-protected
 *      ingestion — exactly-once, gap-free), THEN releases and runs every
 *      queued local work order (nothing lost, nothing duplicated).
 *   3. EXECUTE — each step dispatches through the fabric; observations
 *      and artifacts land in the typed boundaries automatically; local
 *      observations land in the companion's provenance-labelled local
 *      event log.
 *   4. RELEASE — completeTask with the Spirit-side verification record
 *      built from the step outcomes (§10); a denied, unsupported or
 *      failed step completes the task with verified:false — honest,
 *      never fabricated. The lease is released by completion.
 *
 * NO long-running work inside any request lifetime: the host runs on
 * the injected tick/command source (poll-driven, testable offline).
 *
 * Determinism: no Date.now / Math.random / fetch / process.env in this
 * module — the clock, fabric, companion and command source are injected.
 */

import { InvalidCompanionHostInputError } from './errors.js';
import type { CompanionCommand, CompanionWorkOrder, CommandSource, UserDevicePresence } from './commands.js';
import { assertValidCompanionCommand } from './commands.js';
import type { ExecutionFabric, FabricDenial, FabricOperation } from '@sos-2/execution-fabric';
import type { LocalCompanion, LocalWorkOrder, LocalWorkOrderStep, OfflineWorkQueue, ReconciliationReport } from '@sos-2/local-companion';
import { reconcileLocalEventLog } from '@sos-2/local-companion';
import type { Clock, ObservationEventRepository, TaskRecord } from '@sos-2/live-store';
import { formatRfc3339 } from '@sos-2/live-store';

/** Host dependencies: the fabric, the clock, the device presence, the command source, the companion — ALL INJECTED. */
export interface CompanionRuntimeHostDeps {
  readonly fabric: ExecutionFabric;
  readonly clock: Clock;
  readonly devicePresence: UserDevicePresence;
  readonly commandSource: CommandSource;
  readonly companion: LocalCompanion;
  readonly queue: OfflineWorkQueue;
  readonly observationEvents: ObservationEventRepository;
}

/** The outcome of one executed step (mirrors the worker-host discipline). */
export interface CompanionStepOutcome {
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
export type CompanionHostOutcome =
  | {
      readonly status: 'COMPLETED';
      readonly task: TaskRecord;
      readonly steps: readonly CompanionStepOutcome[];
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
  | { readonly status: 'PAIRED'; readonly session_id: string; readonly token_name: string }
  | { readonly status: 'PAIRING_DENIED'; readonly reason: string }
  | { readonly status: 'RECONCILED'; readonly report: ReconciliationReport };

/** The outcome of one host tick. */
export interface CompanionTickOutcome {
  readonly processed: readonly CompanionHostOutcome[];
  /** True when the command source is drained AND no queued local work remains. */
  readonly idle: boolean;
}

/** The default local-body requirements of the companion body (the §7 user-device placement). */
export const LOCAL_BODY_REQUIREMENTS = { requiredCapabilities: ['terminal', 'filesystem'] as const, placement: 'user-device' as const };

/** The §9 operation kinds the companion body advertises (the local step subset). */
const LOCAL_STEP_KINDS: ReadonlySet<string> = new Set(['workspace.read', 'workspace.write', 'shell.exec', 'artifacts.capture', 'observations.emit']);

/** Narrow one fabric step to the local step subset (null when the kind is not a companion-body operation). */
function asLocalWorkOrderStep(step: FabricOperation): LocalWorkOrderStep | null {
  return LOCAL_STEP_KINDS.has(step.kind) ? (step as LocalWorkOrderStep) : null;
}

/**
 * THE LOCAL COMPANION HOST.
 */
export class CompanionRuntimeHost {
  private readonly fabric: ExecutionFabric;
  private readonly clock: Clock;
  private readonly devicePresence: UserDevicePresence;
  private readonly commandSource: CommandSource;
  private readonly companion: LocalCompanion;
  private readonly queue: OfflineWorkQueue;
  private readonly observationEvents: ObservationEventRepository;

  constructor(deps: CompanionRuntimeHostDeps) {
    if (typeof deps !== 'object' || deps === null || typeof deps.fabric !== 'object' || deps.fabric === null) {
      throw new InvalidCompanionHostInputError('the companion runtime host requires an injected ExecutionFabric');
    }
    if (typeof deps.clock !== 'object' || deps.clock === null || typeof deps.clock.nowEpochMs !== 'function') {
      throw new InvalidCompanionHostInputError('the companion runtime host requires an injected clock (no hidden time)');
    }
    if (typeof deps.devicePresence !== 'object' || deps.devicePresence === null || typeof deps.devicePresence.isDeviceOnline !== 'function') {
      throw new InvalidCompanionHostInputError('the companion runtime host requires an injected user-device presence port');
    }
    if (typeof deps.commandSource !== 'object' || deps.commandSource === null || typeof deps.commandSource.poll !== 'function' || typeof deps.commandSource.peek !== 'function') {
      throw new InvalidCompanionHostInputError('the companion runtime host requires an injected command source (no ambient timers)');
    }
    if (typeof deps.companion !== 'object' || deps.companion === null || typeof deps.companion.pair !== 'function') {
      throw new InvalidCompanionHostInputError('the companion runtime host requires the injected LocalCompanion core');
    }
    if (typeof deps.queue !== 'object' || deps.queue === null || typeof deps.queue.enqueue !== 'function') {
      throw new InvalidCompanionHostInputError('the companion runtime host requires an injected OfflineWorkQueue');
    }
    if (typeof deps.observationEvents !== 'object' || deps.observationEvents === null || typeof deps.observationEvents.ingest !== 'function') {
      throw new InvalidCompanionHostInputError('the companion runtime host requires the injected P2 observation-event repository (the reconciliation boundary)');
    }
    this.fabric = deps.fabric;
    this.clock = deps.clock;
    this.devicePresence = deps.devicePresence;
    this.commandSource = deps.commandSource;
    this.companion = deps.companion;
    this.queue = deps.queue;
    this.observationEvents = deps.observationEvents;
  }

  /**
   * One tick: first retry §7-queued LOCAL work when the device is back
   * online (reconcile BEFORE release — the reconnect discipline), then
   * process at most one new command from the source. Device presence is
   * consulted ONLY when local work is queued or a local order arrives —
   * cloud/remote orders never probe (§7 independence).
   *
   * IDLE means no further progress is possible without external change:
   * the source is drained AND either no local work is queued or the
   * device is offline (queued local work is the STABLE §7 state — it
   * waits for reconnect; drain() returns, never looping).
   */
  async tick(): Promise<CompanionTickOutcome> {
    const processed: CompanionHostOutcome[] = [];
    if (this.queue.size > 0 && this.devicePresence.isDeviceOnline()) {
      // RECONNECT: reconcile the durable local event log against the P2
      // live-store FIRST (idempotent, replay-protected — exactly-once).
      processed.push(await this.reconcile());
      for (const order of this.queue.releaseAll()) {
        this.companion.emitObservation({ source: 'local-companion:queue', kind: 'local.queue.released', payload: { task_id: order.task_id } });
        processed.push(await this.runLocalWorkOrder(order));
      }
    }
    const command = this.commandSource.poll();
    if (command !== null) {
      processed.push(await this.runCommand(command));
    }
    const sourceDrained = this.commandSource.peek() === null;
    const idle = sourceDrained && (this.queue.size === 0 || !this.devicePresence.isDeviceOnline());
    return { processed, idle };
  }

  /** Process commands until the source is drained and no queued local work remains. */
  async drain(): Promise<readonly CompanionHostOutcome[]> {
    const outcomes: CompanionHostOutcome[] = [];
    // A bounded drain: the command source is finite by contract (a poll
    // loop with no progress guard would be an ambient loop — refuse it).
    for (let guard = 0; guard < 10_000; guard += 1) {
      const tick = await this.tick();
      outcomes.push(...tick.processed);
      if (tick.idle) {
        return outcomes;
      }
    }
    throw new InvalidCompanionHostInputError('the drain guard tripped — the command source never drained (10 000 ticks); refusing an ambient loop');
  }

  /** Process one command (the poll-free entry point — the same code path tick uses). */
  async runCommand(command: CompanionCommand): Promise<CompanionHostOutcome> {
    assertValidCompanionCommand(command);
    switch (command.kind) {
      case 'run-work-order': {
        const order = command.order;
        // §7 DEVICE GATE — LOCAL-ONLY work queues while the device is
        // offline; cloud/remote work orders NEVER consult device presence.
        if (order.requirements.placement === 'user-device' && !this.devicePresence.isDeviceOnline()) {
          // The local queue carries EXACTLY the companion-body operations:
          // a step outside the advertised subset is malformed for the local
          // queue (it would answer typed UNSUPPORTED at dispatch anyway) —
          // refused loudly at enqueue, never silently dropped.
          const localSteps: LocalWorkOrderStep[] = [];
          for (const step of order.steps) {
            const localStep = asLocalWorkOrderStep(step);
            if (localStep === null) {
              return {
                status: 'FAILED',
                error: `the local work order carries step ${JSON.stringify(step.kind)} which is not a companion-body operation (the local queue carries exactly the advertised terminal/filesystem/evidence operations) — refused at enqueue, never silently dropped`,
              };
            }
            localSteps.push(localStep);
          }
          const local: LocalWorkOrder = {
            task_id: order.task_id,
            mission_ref: order.mission_ref,
            plan: order.plan,
            grant_refs: [...order.grant_refs],
            holder: order.holder,
            expires_at: order.expires_at,
            steps: localSteps,
          };
          this.queue.enqueue(local);
          this.companion.emitObservation({ source: 'local-companion:queue', kind: 'local.queue.queued', payload: { task_id: order.task_id } });
          return {
            status: 'QUEUED',
            task_id: order.task_id,
            reason: `the work order requires a user-device body and the device is offline — local tasks queue safely while the device is offline (§7) and run when it returns`,
          };
        }
        return this.runWorkOrder(order);
      }
      case 'pair-companion': {
        const outcome = this.companion.pair({
          pairing_code: command.pairing_code,
          device_id: command.device_id,
          device_label: command.device_label,
        });
        if (outcome.status === 'PAIRED') {
          return { status: 'PAIRED', session_id: outcome.session.session_id, token_name: outcome.session.token_name };
        }
        return { status: 'PAIRING_DENIED', reason: outcome.reason };
      }
      case 'reconcile':
        return this.reconcile();
    }
  }

  /** Reconcile the durable local event log against the P2 live-store (idempotent, exactly-once, gap-free). */
  async reconcile(): Promise<CompanionHostOutcome> {
    const report = await reconcileLocalEventLog({ log: this.companion.eventLog, observationEvents: this.observationEvents });
    return { status: 'RECONCILED', report };
  }

  /** Run one queued LOCAL work order with the companion body's requirements (released on reconnect). */
  private async runLocalWorkOrder(order: LocalWorkOrder): Promise<CompanionHostOutcome> {
    return this.runWorkOrder({
      task_id: order.task_id,
      mission_ref: order.mission_ref,
      plan: order.plan,
      grant_refs: [...order.grant_refs],
      requirements: { requiredCapabilities: [...LOCAL_BODY_REQUIREMENTS.requiredCapabilities], placement: LOCAL_BODY_REQUIREMENTS.placement },
      holder: order.holder,
      expires_at: order.expires_at,
      steps: [...order.steps],
    });
  }

  // -------------------------------------------------------------------------
  // Bounded task execution (the fabric's uniform gate pipeline)
  // -------------------------------------------------------------------------

  private async runWorkOrder(order: CompanionWorkOrder): Promise<CompanionHostOutcome> {
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
    const steps: CompanionStepOutcome[] = [];
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
}
