/**
 * The FAIL-CLOSED body lease gate (Work Order P5).
 *
 * spec/productization-execution-architecture.md §1: "The body is normally
 * ephemeral. A task owns a body lease; the task, evidence and state
 * survive body replacement."
 *
 * AN EXPIRED, REVOKED OR RELEASED LEASE AUTHORIZES NOTHING. The gate
 * recomputes lease truth from the DURABLE lease record plus the INJECTED
 * clock — isLeaseExpiredAt is CONSUMED from @sos-2/live-store (never
 * re-implemented) — and answers a typed LeaseAuthorization:
 *
 *   authorized: true   the lease is ACTIVE, unexpired and bound to the
 *                      expected task (and body, when checked)
 *   authorized: false  a typed LeaseDenial — the operation NEVER runs
 *
 * Fail-closed ordering (every check denies, none defaults open):
 *   missing lease -> LEASE_NOT_FOUND
 *   non-ACTIVE durable state -> LEASE_INACTIVE (released/revoked/expired
 *                               are terminal in the P2 record itself)
 *   expired-at-now (record ACTIVE but clock past expiry) -> LEASE_EXPIRED
 *   wrong task -> LEASE_WRONG_TASK
 *   wrong body -> LEASE_BODY_MISMATCH
 */

import { isLeaseExpiredAt } from '@sos-2/live-store';
import type { BodyLeaseRecord, BodyLeaseRepository, BodyLeaseState } from '@sos-2/live-store';

/** The typed denial codes of the lease gate (fail-closed, frozen). */
export const LEASE_DENIAL_CODES = [
  'LEASE_NOT_FOUND',
  'LEASE_INACTIVE',
  'LEASE_EXPIRED',
  'LEASE_WRONG_TASK',
  'LEASE_BODY_MISMATCH',
] as const;

export type LeaseDenialCode = (typeof LEASE_DENIAL_CODES)[number];

/** A structured lease denial — WHY the operation cannot be authorized. */
export interface LeaseDenial {
  readonly code: LeaseDenialCode;
  readonly lease_id: string;
  /** The durable lease state at denial, when the lease was resolvable. */
  readonly lease_state: BodyLeaseState | null;
  /** Deterministic human-readable reason. */
  readonly reason: string;
}

/** The outcome of the lease gate. */
export type LeaseAuthorization =
  | { readonly authorized: true; readonly lease: BodyLeaseRecord }
  | { readonly authorized: false; readonly denial: LeaseDenial };

/** What the gate is asked to authorize. */
export interface LeaseAuthorizationRequest {
  /** The lease the task holds. */
  readonly lease_id: string;
  /** The task that owns the lease. */
  readonly task_ref: string;
  /** The expected bound body, or null to skip the body check. */
  readonly body_id: string | null;
  /** The evaluation instant (injected clock — never a hidden read). */
  readonly nowEpochMs: number;
}

function denial(code: LeaseDenialCode, leaseId: string, leaseState: BodyLeaseState | null, reason: string): LeaseAuthorization {
  return { authorized: false, denial: { code, lease_id: leaseId, lease_state: leaseState, reason } };
}

/**
 * The fail-closed gate. Every denial path answers a typed LeaseDenial;
 * only an ACTIVE, unexpired, correctly-bound lease authorizes.
 */
export async function authorizeLeaseOperation(
  leases: BodyLeaseRepository,
  request: LeaseAuthorizationRequest,
): Promise<LeaseAuthorization> {
  const lease = await leases.get(request.lease_id);
  if (lease === undefined) {
    return denial(
      'LEASE_NOT_FOUND',
      request.lease_id,
      null,
      `lease ${JSON.stringify(request.lease_id)} is not in the durable lease store — an unknown lease authorizes nothing`,
    );
  }
  if (lease.state !== 'ACTIVE') {
    return denial(
      'LEASE_INACTIVE',
      request.lease_id,
      lease.state,
      `lease ${JSON.stringify(request.lease_id)} is ${lease.state} (terminal in the durable record) — a released/revoked/expired lease authorizes nothing`,
    );
  }
  // Expiry truth is recomputed from the durable record + the injected
  // clock (consumed from the live-store — never re-implemented here).
  if (isLeaseExpiredAt(lease, request.nowEpochMs)) {
    return denial(
      'LEASE_EXPIRED',
      request.lease_id,
      lease.state,
      `lease ${JSON.stringify(request.lease_id)} expired at ${JSON.stringify(lease.expires_at)} — an expired lease authorizes nothing (fail closed)`,
    );
  }
  if (lease.task_ref !== request.task_ref) {
    return denial(
      'LEASE_WRONG_TASK',
      request.lease_id,
      lease.state,
      `lease ${JSON.stringify(request.lease_id)} is bound to task ${JSON.stringify(lease.task_ref)}, not ${JSON.stringify(request.task_ref)}`,
    );
  }
  if (request.body_id !== null && lease.body_id !== request.body_id) {
    return denial(
      'LEASE_BODY_MISMATCH',
      request.lease_id,
      lease.state,
      `lease ${JSON.stringify(request.lease_id)} is bound to body ${JSON.stringify(lease.body_id)}, not ${JSON.stringify(request.body_id)}`,
    );
  }
  return { authorized: true, lease };
}
