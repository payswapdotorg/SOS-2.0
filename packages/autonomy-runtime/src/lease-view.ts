/**
 * Lease supervision state (Work Order P12).
 *
 * The P2 durable lease record carries the LEASE's own lifecycle
 * (ACTIVE -> RELEASED | REVOKED | EXPIRED — terminal, single-use ids).
 * This module is the SUPERVISION vocabulary layered over it: how the
 * runtime views the HEALTH of the body bound to an ACTIVE lease.
 *
 *   HEALTHY   — a fresh worker beat exists within the missed-beat window.
 *   SUSPECTED — the beat window was missed: TRUTHFUL UNKNOWN (the body
 *               may be alive; death is never inferred from silence).
 *   LOST      — a VERIFIED failure observation of the bound body exists
 *               (never fabricated; only reachable WITH a verification).
 *   NOT_HELD  — the durable lease is terminal (released/revoked/expired)
 *               or absent — there is nothing to supervise.
 *
 * Transitions are pure functions of (durable lease record, beat source,
 * failure verification source, clock) — no hidden state, no side
 * effects; the supervisor (supervisor.ts) owns emission of the
 * corresponding observation events.
 */

import type { BodyLeaseRecord } from '@sos-2/live-store';

export const LEASE_SUPERVISION_STATES = ['HEALTHY', 'SUSPECTED', 'LOST', 'NOT_HELD'] as const;

export type LeaseSupervisionState = (typeof LEASE_SUPERVISION_STATES)[number];

/** The typed supervision view of one durable lease. */
export interface LeaseSupervisionView {
  /** The durable lease under supervision. */
  readonly lease: BodyLeaseRecord;
  /** The supervision state. */
  readonly state: LeaseSupervisionState;
  /** The last observed beat of the bound body (epoch ms), or null. */
  readonly lastBeatAt: number | null;
  /** Milliseconds since the last beat when a beat exists, else null. */
  readonly beatAgeMs: number | null;
  /** The verified failure backing a LOST verdict, else null. */
  readonly verifiedFailure: { readonly observationId: string; readonly observedAt: string; readonly detail: string } | null;
  /** Truthful human-readable status detail (never fabricated liveness). */
  readonly detail: string;
}

/** Is the durable lease supervisable (ACTIVE)? */
export function isSupervisableLease(lease: BodyLeaseRecord): boolean {
  return lease.state === 'ACTIVE';
}

/**
 * Classify the supervision state of one lease (pure).
 *
 * Evaluation order (pinned):
 *   1. lease terminal/absent          -> NOT_HELD
 *   2. verified failure of the body   -> LOST (regardless of beats — a
 *      verified failure wins even if a stale beat exists; the body's
 *      own attested failure is authoritative about the BODY)
 *   3. beat fresh within the window   -> HEALTHY
 *   4. beat missed (or never beat)    -> SUSPECTED (UNKNOWN)
 */
export function classifyLease(input: {
  readonly lease: BodyLeaseRecord;
  readonly lastBeatAt: number | null;
  readonly verifiedFailure: { readonly observationId: string; readonly observedAt: string; readonly detail: string } | null;
  readonly nowEpochMs: number;
  readonly missedBeatWindowMs: number;
}): LeaseSupervisionView {
  const { lease, lastBeatAt, verifiedFailure, nowEpochMs, missedBeatWindowMs } = input;
  if (lease.state !== 'ACTIVE') {
    return {
      lease,
      state: 'NOT_HELD',
      lastBeatAt,
      beatAgeMs: null,
      verifiedFailure: null,
      detail: `lease ${JSON.stringify(lease.lease_id)} is ${lease.state} — nothing to supervise`,
    };
  }
  if (lease.body_id === null) {
    return {
      lease,
      state: 'SUSPECTED',
      lastBeatAt,
      beatAgeMs: null,
      verifiedFailure: null,
      detail: `lease ${JSON.stringify(lease.lease_id)} binds no body — liveness is UNKNOWN until a body binds`,
    };
  }
  if (verifiedFailure !== null) {
    return {
      lease,
      state: 'LOST',
      lastBeatAt,
      beatAgeMs: lastBeatAt === null ? null : Math.max(0, nowEpochMs - lastBeatAt),
      verifiedFailure,
      detail: `body ${JSON.stringify(lease.body_id)} verifiably failed (${verifiedFailure.observationId}): ${verifiedFailure.detail}`,
    };
  }
  if (lastBeatAt === null) {
    return {
      lease,
      state: 'SUSPECTED',
      lastBeatAt: null,
      beatAgeMs: null,
      verifiedFailure: null,
      detail: `body ${JSON.stringify(lease.body_id)} has never beaten — liveness is UNKNOWN (never fabricated)`,
    };
  }
  const age = Math.max(0, nowEpochMs - lastBeatAt);
  if (age > missedBeatWindowMs) {
    return {
      lease,
      state: 'SUSPECTED',
      lastBeatAt,
      beatAgeMs: age,
      verifiedFailure: null,
      detail: `body ${JSON.stringify(lease.body_id)} last beat ${age}ms ago (window ${missedBeatWindowMs}ms) — SUSPECTED, truthful UNKNOWN`,
    };
  }
  return {
    lease,
    state: 'HEALTHY',
    lastBeatAt,
    beatAgeMs: age,
    verifiedFailure: null,
    detail: `body ${JSON.stringify(lease.body_id)} beat ${age}ms ago (within the ${missedBeatWindowMs}ms window)`,
  };
}
