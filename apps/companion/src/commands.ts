/**
 * The companion host command surface (Work Order P11) — the injected
 * tick/command source the local companion host runs on.
 *
 * NO long-running work inside any request lifetime: the host POLLS the
 * command source on tick() (never an ambient timer — the apps/
 * worker-runtimes precedent). Tests and the composition root drive the
 * ticks; the real desktop companion's inbound channel (a local IPC
 * listener, a cloud pull channel) attaches the same port later without
 * contract change.
 *
 * The §7 user-device model lives on the requirements: a work order for
 * a "user-device" body queues while the device is offline; cloud and
 * remote bodies run regardless (the task continues while the user's
 * computer is off — cloud tasks never require the companion).
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
export class RecordingUserDevicePresence implements UserDevicePresence {
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

/** One work order for the companion host: the task contract + the ordered step program. */
export interface CompanionWorkOrder {
  /** Task identity — an EXECUTION-FABRIC id (never a SOS semantic identity). */
  readonly task_id: string;
  /** Mission artifact id (sos://Mission/...), or null while unlinked. */
  readonly mission_ref: string | null;
  /** The bounded task plan/work graph (canonical JSON). */
  readonly plan: JsonValue;
  /** The authority grant references the task acts under (resolved from the durable store). */
  readonly grant_refs: readonly string[];
  /** Requirements for the executing body (placement drives the §7 device gate). */
  readonly requirements: BodySelectionRequirements;
  /** The acquiring principal (recorded on the lease). */
  readonly holder: string;
  /** Lease expiry instant (RFC3339), or null for a non-expiring lease. */
  readonly expires_at: string | null;
  /** The ordered §9 step program executed through the fabric. */
  readonly steps: readonly FabricOperation[];
}

/** The commands the companion host processes (poll-driven, on tick). */
export type CompanionCommand =
  | { readonly kind: 'run-work-order'; readonly order: CompanionWorkOrder }
  | {
      /** Pair the companion through the injected pairing authority. */
      readonly kind: 'pair-companion';
      readonly pairing_code: string;
      readonly device_id: string;
      readonly device_label: string;
    }
  | {
      /** Reconcile the durable local event log against the P2 live-store NOW. */
      readonly kind: 'reconcile';
    };

/**
 * THE COMMAND SOURCE — the injected tick/command seam. The real desktop
 * companion's inbound channel implements this port; tests use the
 * ArrayCommandSource.
 */
export interface CommandSource {
  /** The next command, or null when drained (destructive — consumed by runCommand). */
  poll(): CompanionCommand | null;
  /** The next command WITHOUT consuming it (the idle check — never destructive). */
  peek(): CompanionCommand | null;
}

/** A deterministic in-memory command queue (tests + local development). */
export class ArrayCommandSource implements CommandSource {
  private readonly queue: CompanionCommand[] = [];

  /** Enqueue one command (FIFO). */
  push(command: CompanionCommand): void {
    this.queue.push(command);
  }

  poll(): CompanionCommand | null {
    return this.queue.shift() ?? null;
  }

  peek(): CompanionCommand | null {
    return this.queue[0] ?? null;
  }

  /** How many commands remain queued. */
  get size(): number {
    return this.queue.length;
  }
}

/** Validate a companion command shape (throws loudly on malformed input). */
export function assertValidCompanionCommand(value: unknown): asserts value is CompanionCommand {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`a companion command must be an object, received: ${JSON.stringify(value)}`);
  }
  const record = value as Record<string, unknown>;
  switch (record['kind']) {
    case 'run-work-order': {
      const order = record['order'];
      if (typeof order !== 'object' || order === null) {
        throw new Error('run-work-order requires a companion work order');
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
        throw new Error('the companion work order must carry { task_id, mission_ref, plan, grant_refs, requirements, holder, expires_at, steps }');
      }
      return;
    }
    case 'pair-companion':
      if (
        typeof record['pairing_code'] !== 'string' ||
        record['pairing_code'].length === 0 ||
        typeof record['device_id'] !== 'string' ||
        record['device_id'].length === 0 ||
        typeof record['device_label'] !== 'string' ||
        record['device_label'].length === 0
      ) {
        throw new Error('pair-companion requires { pairing_code, device_id, device_label }');
      }
      return;
    case 'reconcile':
      return;
    default:
      throw new Error(`unknown companion command kind: ${JSON.stringify(record['kind'])}`);
  }
}
