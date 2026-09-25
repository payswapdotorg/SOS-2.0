/**
 * The lease supervisor (Work Order P12).
 *
 * Supervises the ACTIVE body leases of the durable store: classifies
 * each lease's supervision state (HEALTHY / SUSPECTED / LOST / NOT_HELD
 * — see lease-view.ts) and EMITS durable, replay-protected observation
 * events for every SUSPECTED and LOST verdict (the P7 discipline:
 * heartbeats and recovery events are observations, replay-safe,
 * truthful stale/UNKNOWN).
 *
 * The supervisor NEVER writes lease records and NEVER transitions
 * execution state — it is the observation side of body lifecycle; lease
 * transitions flow through the action gateway (lease-actions.ts) and
 * the execution fabric. Death is never fabricated: LOST requires a
 * verified failure observation (verification.ts).
 */

import type { BodyLeaseRecord, ObservationEventRepository, Clock } from '@sos-2/live-store';
import { formatRfc3339 } from '@sos-2/live-store';
import type { JsonValue } from '@sos-2/semantic-spine';
import { classifyLease } from './lease-view.js';
import type { LeaseSupervisionView } from './lease-view.js';
import type { BeatSource } from './beat.js';
import type { FailureVerificationSource } from './verification.js';
import { AutonomyRuntimeError } from './errors.js';

export const LEASE_WATCH_SOURCE = 'autonomy-lease-watch';

export interface LeaseSupervisorDeps {
  /** The durable body-lease store (read-side; the supervisor never writes leases). */
  readonly leases: { get(id: string): Promise<BodyLeaseRecord | undefined> };
  /** The typed observation boundary (durable, replay-protected — P2 port). */
  readonly observationEvents: ObservationEventRepository;
  /** The injected clock. */
  readonly clock: Clock;
  /** The worker heartbeat source (injectable). */
  readonly beats: BeatSource;
  /** The verified-failure source (injectable; the ONLY path to LOST). */
  readonly failures: FailureVerificationSource;
  /** The missed-beat window in ms (SUSPECTED threshold). */
  readonly missedBeatWindowMs: number;
}

/**
 * The resident lease supervisor. One instance per composition root; the
 * event sequence per lease is monotonic and replay-protected by the
 * observation store (duplicate ingestion is a typed no-op).
 */
export class LeaseSupervisor {
  private readonly sequence = new Map<string, number>();

  constructor(private readonly deps: LeaseSupervisorDeps) {
    if (typeof deps.missedBeatWindowMs !== 'number' || !Number.isFinite(deps.missedBeatWindowMs) || deps.missedBeatWindowMs <= 0) {
      throw new AutonomyRuntimeError('INVALID_INPUT', `missedBeatWindowMs must be a positive finite number, received: ${JSON.stringify(deps.missedBeatWindowMs)}`);
    }
  }

  /** Supervise one lease by id: classify + emit the durable observation. */
  async supervise(leaseId: string): Promise<LeaseSupervisionView> {
    if (typeof leaseId !== 'string' || leaseId.length === 0) {
      throw new AutonomyRuntimeError('INVALID_INPUT', `leaseId must be a non-empty string, received: ${JSON.stringify(leaseId)}`);
    }
    const lease = await this.deps.leases.get(leaseId);
    if (lease === undefined) {
      throw new AutonomyRuntimeError('LEASE_SUPERVISION', `lease ${JSON.stringify(leaseId)} is not in the durable lease store`);
    }
    const bodyId = lease.body_id;
    const lastBeatAt = bodyId === null ? null : this.deps.beats.lastBeatAt(bodyId);
    const verification = bodyId === null ? null : this.deps.failures.verifiedFailureOf(bodyId);
    const view = classifyLease({
      lease,
      lastBeatAt,
      verifiedFailure: verification === null ? null : { observationId: verification.observationId, observedAt: verification.observedAt, detail: verification.detail },
      nowEpochMs: this.deps.clock.nowEpochMs(),
      missedBeatWindowMs: this.deps.missedBeatWindowMs,
    });
    if (view.state === 'SUSPECTED' || view.state === 'LOST') {
      await this.emitVerdict(lease, view);
    }
    return view;
  }

  private async emitVerdict(lease: BodyLeaseRecord, view: LeaseSupervisionView): Promise<void> {
    const prior = this.sequence.get(lease.lease_id) ?? 0;
    const next = prior + 1;
    this.sequence.set(lease.lease_id, next);
    const eventId = `lease-watch:${lease.lease_id}:${String(next).padStart(6, '0')}`;
    const payload: JsonValue = {
      lease_id: lease.lease_id,
      task_ref: lease.task_ref,
      body_id: lease.body_id,
      supervision_state: view.state,
      last_beat_at: view.lastBeatAt,
      beat_age_ms: view.beatAgeMs,
      verified_failure_observation: view.verifiedFailure?.observationId ?? null,
      detail: view.detail,
    };
    await this.deps.observationEvents.ingest({
      id: eventId,
      source: LEASE_WATCH_SOURCE,
      kind: view.state === 'LOST' ? 'lease.lost' : 'lease.suspected',
      occurred_at: formatRfc3339(this.deps.clock.nowEpochMs()),
      payload,
      provenance: [LEASE_WATCH_SOURCE, `lease:${lease.lease_id}`, `task:${lease.task_ref}`],
    });
  }
}
