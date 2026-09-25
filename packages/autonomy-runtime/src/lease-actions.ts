/**
 * Lease lifecycle actions through the P9 action gateway (Work Order P12).
 *
 * Leases are granted / renewed / revoked THROUGH the authority-gated
 * action surface: every lease lifecycle transition is a `body-lifecycle`
 * family action executed by the P9 ActionGateway with action-time
 * CURRENT authority re-evaluation. A revoked / expired / never-held
 * grant is a typed ACTION_AUTHORITY_DENIED denial — the durable lease
 * write NEVER happens, executors never run, and execution stops (fail
 * closed; pinned by tests). This module is the LEASE side of that
 * contract; it is never a bypass.
 *
 * Renewal follows the P2 single-use lease-id design ("a replacement body
 * takes a NEW lease id" — so does a renewal): renew = release the
 * current lease + acquire a fresh single-use lease binding the same
 * body, gated by its own gateway action.
 */

import type { ActionGateway, ActorRef, ActionExecutor, ActionReceipt, ActionDenial, ActionFailure, BodyLifecycleOperation, ActionOperation, ExecutionContext, ExecutionResult } from '@sos-2/action-gateway';
import type { BodyLeaseRecord, BodyLeaseRepository, Clock } from '@sos-2/live-store';

/** Injectable body-availability port (the broker's read side). */
export interface BodyAvailabilityPort {
  /** Is the body registered and available for leasing? Returns detail when not. */
  bodyAvailable(bodyId: string): { available: boolean; detail: string };
}

/**
 * The executor seam for body-lifecycle actions: checks body availability
 * (typed error when the body is gone) and confirms the operation. The
 * DURABLE lease write is performed by LeaseActionService only after a
 * granted receipt (no lease write ever precedes the authority gate).
 */
export class LeaseLifecycleExecutor implements ActionExecutor {
  readonly families: readonly ('body-lifecycle')[] = ['body-lifecycle'];

  constructor(private readonly bodies: BodyAvailabilityPort) {}

  execute(operation: ActionOperation, context: ExecutionContext): ExecutionResult {
    if (!('bodyId' in operation)) {
      return { status: 'error', errorType: 'NOT_A_BODY_OPERATION', message: `the lease lifecycle executor only handles body.* operations, received ${JSON.stringify(operation.op)}`, retryable: false };
    }
    const body = this.bodies.bodyAvailable(operation.bodyId);
    if (!body.available) {
      return { status: 'error', errorType: 'BODY_NOT_AVAILABLE', message: body.detail, retryable: true };
    }
    return {
      status: 'ok',
      output: { produced: { action_id: context.actionId, body_id: operation.bodyId, operation: operation.op } },
    };
  }
}

/** The typed outcome of a lease lifecycle action. */
export type LeaseActionOutcome =
  | { readonly status: 'GRANTED'; readonly receipt: ActionReceipt; readonly lease: BodyLeaseRecord }
  | { readonly status: 'DENIED'; readonly receipt: ActionReceipt; readonly denial: ActionDenial }
  | { readonly status: 'FAILED'; readonly receipt: ActionReceipt; readonly failure: ActionFailure };

export interface LeaseActionServiceDeps {
  readonly gateway: ActionGateway;
  readonly clock: Clock;
  readonly leases: BodyLeaseRepository;
}

/** Input for a lease action (the task/body pair the lease concerns). */
export interface LeaseActionInput {
  readonly task_id: string;
  readonly body_id: string;
  /** The acquiring/acting principal (recorded on the lease + the action actor). */
  readonly actor: ActorRef;
  /** The source revision the action targets (the task's pinned revision, or the runtime's stable base). */
  readonly targetSha: string;
  /** Lease expiry instant (RFC3339), or null for a non-expiring lease. */
  readonly expires_at?: string | null;
  /** Monotonic action sequence supplied by the caller (idempotency keys are single-use). */
  readonly sequence: number;
}

/**
 * The lease-side of the P9 body-lifecycle contract: grant / renew /
 * revoke leases only through granted gateway actions.
 */
export class LeaseActionService {
  constructor(private readonly deps: LeaseActionServiceDeps) {}

  /** Grant a lease (body.start): acquire after the authority gate passes. */
  async grantLease(input: LeaseActionInput): Promise<LeaseActionOutcome> {
    const receipt = this.executeAction(input, 'start');
    if (receipt.status === 'DENIED') return { status: 'DENIED', receipt, denial: receipt.denial! };
    if (receipt.status === 'FAILED') return { status: 'FAILED', receipt, failure: receipt.failure! };
    const leaseId = await this.freshLeaseId(input.task_id);
    const acquired = await this.deps.leases.acquire({
      lease_id: leaseId,
      task_ref: input.task_id,
      holder: input.actor.id,
      body_id: input.body_id,
      expires_at: input.expires_at ?? null,
    });
    if (acquired.kind !== 'STORED') {
      return {
        status: 'FAILED',
        receipt,
        failure: { operation: 'lease.acquire', errorType: 'LEASE_WRITE_REFUSED', message: `the durable lease store refused the acquire (${acquired.kind})`, retryable: false },
      };
    }
    return { status: 'GRANTED', receipt, lease: acquired.record };
  }

  /** Renew (body.start on the held lease's body): release current + acquire fresh (single-use ids). */
  async renewLease(input: LeaseActionInput & { readonly current_lease_id: string }): Promise<LeaseActionOutcome> {
    const receipt = this.executeAction(input, 'start');
    if (receipt.status === 'DENIED') return { status: 'DENIED', receipt, denial: receipt.denial! };
    if (receipt.status === 'FAILED') return { status: 'FAILED', receipt, failure: receipt.failure! };
    const released = await this.deps.leases.release(input.current_lease_id, {
      reason: 'renewal: single-use lease ids — the renewal takes a fresh lease',
    });
    if (released.kind !== 'STORED') {
      return {
        status: 'FAILED',
        receipt,
        failure: { operation: 'lease.release', errorType: 'LEASE_WRITE_REFUSED', message: `the durable lease store refused the renewal release (${released.kind})`, retryable: false },
      };
    }
    const leaseId = await this.freshLeaseId(input.task_id);
    const acquired = await this.deps.leases.acquire({
      lease_id: leaseId,
      task_ref: input.task_id,
      holder: input.actor.id,
      body_id: input.body_id,
      expires_at: input.expires_at ?? null,
    });
    if (acquired.kind !== 'STORED') {
      return {
        status: 'FAILED',
        receipt,
        failure: { operation: 'lease.acquire', errorType: 'LEASE_WRITE_REFUSED', message: `the durable lease store refused the renewal acquire (${acquired.kind})`, retryable: false },
      };
    }
    return { status: 'GRANTED', receipt, lease: acquired.record };
  }

  /** Revoke a lease (body.cancel): revoke after the authority gate passes. */
  async revokeLease(input: LeaseActionInput & { readonly lease_id: string; readonly reason: string }): Promise<LeaseActionOutcome> {
    const receipt = this.executeAction(input, 'cancel');
    if (receipt.status === 'DENIED') return { status: 'DENIED', receipt, denial: receipt.denial! };
    if (receipt.status === 'FAILED') return { status: 'FAILED', receipt, failure: receipt.failure! };
    const revoked = await this.deps.leases.revoke(input.lease_id, { reason: input.reason });
    if (revoked.kind !== 'STORED') {
      return {
        status: 'FAILED',
        receipt,
        failure: { operation: 'lease.revoke', errorType: 'LEASE_WRITE_REFUSED', message: `the durable lease store refused the revoke (${revoked.kind})`, retryable: false },
      };
    }
    return { status: 'GRANTED', receipt, lease: revoked.record };
  }

  private executeAction(input: LeaseActionInput, operation: BodyLifecycleOperation): ActionReceipt {
    const outcome = this.deps.gateway.execute({
      actionId: `lease-action:${input.task_id}:${input.body_id}:${operation}:${input.sequence}`,
      idempotencyKey: `lease-action:${input.task_id}:${input.body_id}:${operation}:${input.sequence}`,
      family: 'body-lifecycle',
      actor: input.actor,
      requestedAt: this.deps.clock.nowEpochMs(),
      targetRevision: { kind: 'source', sha: input.targetSha },
      payload: { family: 'body-lifecycle', bodyLifecycle: { bodyId: input.body_id, operation } },
    });
    if (outcome.kind === 'rejected') {
      throw new Error(`lease action rejected by the gateway envelope validation: ${outcome.rejection.code} (${outcome.rejection.field})`);
    }
    return outcome.receipt;
  }

  /** Deterministic single-use lease id: lease-<task>-<n>. */
  private async freshLeaseId(taskId: string): Promise<string> {
    const listed = await this.deps.leases.list({ limit: null });
    const prior = listed.items.filter((lease) => lease.task_ref === taskId).length;
    return `lease-${taskId}-${prior + 1}`;
  }
}
