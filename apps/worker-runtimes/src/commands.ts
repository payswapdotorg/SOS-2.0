/**
 * The worker command surface (Work Order P8) — the injected tick/command
 * source the runtime host runs on.
 *
 * NO long-running work inside any request lifetime: the host POLLS the
 * command source on tick() (never an ambient timer). Tests and the
 * composition root drive the ticks; an external worker topology (a
 * queue consumer, a scheduler loop) attaches the same port later
 * without contract change.
 *
 * The §7 user-device model lives on the requirements: a work order for
 * a "user-device" body queues while the device is offline; cloud and
 * remote bodies run regardless (the task continues while the user's
 * computer is off).
 */

import type { BodySelectionRequirements } from '@sos-2/body-broker';
import type { FabricOperation } from '@sos-2/execution-fabric';
import type { JsonValue } from '@sos-2/semantic-spine';

/** The §7 user-device presence port (injected — never ambient). */
export interface UserDevicePresence {
  /** Is the user's device online right now? (Cloud/remote work never consults this for scheduling.) */
  isDeviceOnline(): boolean;
}

/** A deterministic recording device-presence probe (tests/local development). */
export class RecordingDevicePresence implements UserDevicePresence {
  private online: boolean;
  private probeCount = 0;

  constructor(initialOnline: boolean) {
    this.online = initialOnline;
  }

  isDeviceOnline(): boolean {
    this.probeCount += 1;
    return this.online;
  }

  /** How many presence probes the scheduler performed (audit). */
  get probes(): number {
    return this.probeCount;
  }

  /** Flip the device's reachability (the §7 device goes offline/online). */
  setOnline(online: boolean): void {
    this.online = online;
  }
}

/** One bounded work order: the task contract + the ordered step program. */
export interface BoundedWorkOrder {
  /** Task identity — an EXECUTION-FABRIC id (never a SOS semantic identity). */
  readonly task_id: string;
  /** Mission artifact id (sos://Mission/...), or null while unlinked. */
  readonly mission_ref: string | null;
  /** The bounded task plan/work graph (canonical JSON). */
  readonly plan: JsonValue;
  /** The authority grant references the task acts under (resolved from the durable store). */
  readonly grant_refs: readonly string[];
  /** Requirements for the executing body (capability-based selection; placement drives the §7 device gate). */
  readonly requirements: BodySelectionRequirements;
  /** The acquiring principal (recorded on the lease). */
  readonly holder: string;
  /** Lease expiry instant (RFC3339), or null for a non-expiring lease. */
  readonly expires_at: string | null;
  /** The ordered §9 step program executed through the fabric. */
  readonly steps: readonly FabricOperation[];
}

/** The commands the runtime host processes (poll-driven, on tick). */
export type WorkerCommand =
  | { readonly kind: 'run-bounded-task'; readonly order: BoundedWorkOrder }
  | {
      readonly kind: 'replace-body';
      readonly task_id: string;
      readonly reason: string;
      /** Requirements for the replacement body; null defaults to the current advertisement. */
      readonly requirements?: BodySelectionRequirements | null;
    }
  | { readonly kind: 'pause-task'; readonly task_id: string }
  | { readonly kind: 'resume-task'; readonly task_id: string }
  | { readonly kind: 'cancel-task'; readonly task_id: string };

/**
 * THE COMMAND SOURCE — the injected tick/command seam. An external
 * worker topology (queue consumer, scheduler) implements this port;
 * tests use the ArrayCommandSource.
 */
export interface CommandSource {
  /** The next command, or null when drained. */
  poll(): WorkerCommand | null;
}

/** A deterministic in-memory command queue (tests + local development). */
export class ArrayCommandSource implements CommandSource {
  private readonly queue: WorkerCommand[] = [];

  /** Enqueue one command (FIFO). */
  push(command: WorkerCommand): void {
    this.queue.push(command);
  }

  poll(): WorkerCommand | null {
    return this.queue.shift() ?? null;
  }

  /** How many commands remain queued. */
  get size(): number {
    return this.queue.length;
  }
}

/** Validate a worker command shape (throws loudly on malformed input). */
export function assertValidWorkerCommand(value: unknown): asserts value is WorkerCommand {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`a worker command must be an object, received: ${JSON.stringify(value)}`);
  }
  const record = value as Record<string, unknown>;
  switch (record['kind']) {
    case 'run-bounded-task': {
      const order = record['order'];
      if (typeof order !== 'object' || order === null) {
        throw new Error('run-bounded-task requires a bounded work order');
      }
      const orderRecord = order as Record<string, unknown>;
      if (
        typeof orderRecord['task_id'] !== 'string' ||
        orderRecord['task_id'].length === 0 ||
        !Array.isArray(orderRecord['grant_refs']) ||
        orderRecord['grant_refs'].length === 0 ||
        typeof orderRecord['requirements'] !== 'object' ||
        orderRecord['requirements'] === null ||
        typeof orderRecord['holder'] !== 'string' ||
        orderRecord['holder'].length === 0 ||
        !Array.isArray(orderRecord['steps'])
      ) {
        throw new Error('the bounded work order must carry { task_id, mission_ref, plan, grant_refs, requirements, holder, expires_at, steps }');
      }
      return;
    }
    case 'replace-body':
      if (typeof record['task_id'] !== 'string' || record['task_id'].length === 0 || typeof record['reason'] !== 'string' || record['reason'].length === 0) {
        throw new Error('replace-body requires { task_id, reason }');
      }
      return;
    case 'pause-task':
    case 'resume-task':
    case 'cancel-task':
      if (typeof record['task_id'] !== 'string' || record['task_id'].length === 0) {
        throw new Error(`${String(record['kind'])} requires a task_id`);
      }
      return;
    default:
      throw new Error(`unknown worker command kind: ${JSON.stringify(record['kind'])}`);
  }
}
