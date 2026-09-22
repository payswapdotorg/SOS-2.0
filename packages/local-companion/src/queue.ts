/**
 * OFFLINE QUEUEING (Work Order P11) — spec/productization-execution-
 * architecture.md §7: "Local tasks queue when the device is offline."
 *
 * LOCAL-ONLY WORK ORDERS QUEUE while the device reports offline and run
 * when it reconnects; CLOUD TASKS NEVER REQUIRE THE COMPANION (the cloud
 * body path runs with zero companion presence — pinned independently in
 * tests/local-bridges). The queue is the MECHANISM; the companion host
 * (apps/companion) owns the §7 device gate that decides when orders
 * enqueue and when they release.
 *
 * The queue is durable-by-port: the reference implementation is
 * deterministic in-memory; a real desktop companion backs it with
 * on-device durable storage through the same shapes. Every queue
 * transition emits a provenance-labelled local observation — while the
 * device is offline these accumulate in the local event log as the
 * pending replay suffix reconciled on reconnect.
 *
 * Determinism: no clock, no randomness, no network — the queue is pure
 * ordered state.
 */

import type { JsonValue } from '@sos-2/semantic-spine';

/** One step of a local work order — EXACTLY the §9 operations the companion body advertises. */
export type LocalWorkOrderStep =
  | { readonly kind: 'workspace.read'; readonly path: string }
  | { readonly kind: 'workspace.write'; readonly path: string; readonly content: string }
  | { readonly kind: 'shell.exec'; readonly command: string; readonly args: readonly string[]; readonly cwd: string | null }
  | { readonly kind: 'artifacts.capture'; readonly name: string; readonly content: string }
  | { readonly kind: 'observations.emit'; readonly observation_kind: string; readonly payload: JsonValue };

/**
 * ONE LOCAL-ONLY WORK ORDER — a bounded task destined for the user's
 * device. Execution runs through the P5 Execution Fabric's uniform gate
 * pipeline (TASK -> LEASE -> AUTHORITY -> ADVERTISEMENT -> DISPATCH) with
 * the companion body leased — the same discipline as every bounded task;
 * only the PLACEMENT is user-device, which is why the order queues while
 * the device is offline.
 */
export interface LocalWorkOrder {
  /** Task identity — an EXECUTION-FABRIC id (never a SOS semantic identity). */
  readonly task_id: string;
  /** Mission artifact id (sos://Mission/...), or null while unlinked. */
  readonly mission_ref: string | null;
  /** The bounded task plan/work graph (canonical JSON). */
  readonly plan: JsonValue;
  /** The authority grant references the task acts under (non-empty; resolved from the durable store). */
  readonly grant_refs: readonly string[];
  /** The acquiring principal (recorded on the lease). */
  readonly holder: string;
  /** Lease expiry instant (RFC3339), or null for a non-expiring lease. */
  readonly expires_at: string | null;
  /** The ordered step program (§9 operations the companion body advertises). */
  readonly steps: readonly LocalWorkOrderStep[];
}

/** The typed outcome of one enqueue. */
export interface QueuedLocalOrder {
  /** The 1-based queue position at enqueue time. */
  readonly position: number;
  readonly order: LocalWorkOrder;
}

/**
 * THE OFFLINE WORK QUEUE — local-only work orders queue while the device
 * reports offline and release (FIFO, nothing lost, nothing duplicated)
 * when it reconnects.
 */
export class OfflineWorkQueue {
  private readonly queue: LocalWorkOrder[] = [];
  private enqueuedTotal = 0;

  /** Enqueue one local work order (the order queues while the device is offline). */
  enqueue(order: LocalWorkOrder): QueuedLocalOrder {
    this.assertOrder(order);
    this.enqueuedTotal += 1;
    this.queue.push(order);
    return { position: this.queue.length, order };
  }

  /** Release every queued order (reconnect — FIFO order, nothing lost). */
  releaseAll(): readonly LocalWorkOrder[] {
    return this.queue.splice(0, this.queue.length);
  }

  /** Peek without releasing (audit). */
  pending(): readonly LocalWorkOrder[] {
    return this.queue.map((order) => structuredClone(order));
  }

  /** How many orders remain queued. */
  get size(): number {
    return this.queue.length;
  }

  /** How many orders were EVER enqueued (audit — the loss/duplication check). */
  get total(): number {
    return this.enqueuedTotal;
  }

  private assertOrder(order: LocalWorkOrder): void {
    if (typeof order !== 'object' || order === null) {
      throw new Error('a local work order must be an object');
    }
    if (typeof order.task_id !== 'string' || order.task_id.length === 0 || order.task_id.includes('sos://')) {
      throw new Error(`a local work order task_id must be a non-empty RUNTIME identifier, received: ${JSON.stringify(order.task_id)}`);
    }
    if (!Array.isArray(order.grant_refs) || order.grant_refs.length === 0 || !order.grant_refs.every((ref) => typeof ref === 'string' && ref.length > 0)) {
      throw new Error('a local work order must carry non-empty grant_refs (bounded tasks run under explicit authority)');
    }
    if (typeof order.holder !== 'string' || order.holder.length === 0) {
      throw new Error('a local work order must carry a non-empty holder');
    }
    if (order.expires_at !== null && typeof order.expires_at !== 'string') {
      throw new Error('a local work order expires_at must be null or an RFC3339 string');
    }
    if (!Array.isArray(order.steps) || !order.steps.every((step) => typeof step === 'object' && step !== null && typeof (step as { kind?: unknown }).kind === 'string')) {
      throw new Error('a local work order must carry a step array of §9 operation records');
    }
  }
}
