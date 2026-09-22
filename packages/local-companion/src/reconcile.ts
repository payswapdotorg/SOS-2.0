/**
 * RECONNECT + STATE RECONCILIATION (Work Order P11) — the companion
 * reconciles its durable local event log against the P2 live-store on
 * reconnect.
 *
 * EXACTLY-ONCE, NO LOSS, NO DUPLICATION: every local event replays into
 * the merged P2 ObservationEventRepository through its IDEMPOTENT,
 * REPLAY-PROTECTED ingestion (duplicate delivery is answered with a typed
 * DUPLICATE record against the durable event index — never
 * double-applied). The replay-protection key is the deterministic
 * observation-event id 'local-companion:<device_id>:<event_id>' — stable
 * across replays, so a re-reconciliation after a lost acknowledgement
 * deduplicates exactly.
 *
 * GAP-FREE SEQUENCE CONTINUITY: the local log's sequence numbers are
 * 1-based and contiguous; reconciliation verifies continuity over the
 * replayed range and a gap is a typed COMPANION_RECONCILIATION_GAP
 * violation reported loudly (never silent, never folded away).
 *
 * The reconciliation outcome is a typed report — applied/duplicate counts,
 * the new watermark and the full considered range — honest evidence, never
 * a fabricated "all synced".
 */

import { CompanionReconciliationError } from './errors.js';
import { companionDenial } from './denials.js';
import type { CompanionDenial } from './denials.js';
import type { LocalEventLog, LocalEventRecord } from './observations.js';
import { companionEventSource, companionObservationEventId } from './observations.js';
import type { ObservationEventInput, ObservationEventRepository } from '@sos-2/live-store';

/** The honest typed report of one reconciliation pass. */
export interface ReconciliationReport {
  /** How many pending local events were replayed on this pass. */
  readonly replayed: number;
  /** How many replays were APPLIED (first ingestion). */
  readonly applied: number;
  /** How many replays were DUPLICATE (already held by the durable index — deduplicated exactly, never double-applied). */
  readonly duplicates: number;
  /** The sequence range considered (inclusive; null when nothing was pending). */
  readonly range: { readonly from: number; readonly to: number } | null;
  /** The new acknowledgement watermark (the last sequence the live store provably holds). */
  readonly watermark: number;
}

/** Convert one local event record into its P2 observation-event input (idempotent key + provenance labelling). */
export function toObservationEventInput(record: LocalEventRecord): ObservationEventInput {
  return {
    id: companionObservationEventId(record.device_id, record.event_id),
    source: companionEventSource(record.device_id),
    kind: record.kind,
    occurred_at: record.occurred_at,
    payload: record.payload,
    provenance: [...record.provenance],
  };
}

/**
 * Reconcile the companion's durable local event log against the P2
 * live-store observation events: verify gap-free continuity over the
 * pending suffix FIRST (fail-closed — a gap aborts the pass before the
 * store ever sees an event), then replay every pending event (sequence
 * order), ingest idempotently, and advance the acknowledgement watermark
 * exactly past events the durable index provably holds (APPLIED or
 * DUPLICATE — both prove the store holds the event).
 */
export async function reconcileLocalEventLog(deps: {
  readonly log: LocalEventLog;
  readonly observationEvents: ObservationEventRepository;
}): Promise<ReconciliationReport> {
  const watermark = deps.log.watermark();
  const pending = deps.log.pendingAfter(watermark);
  // GAP-FREE continuity is a hard invariant — pre-scan the pending suffix
  // and refuse the WHOLE pass on a gap (never silent, never partially
  // applied: ingestion is refused before the store ever sees an event).
  for (let index = 0; index < pending.length; index += 1) {
    const event = pending[index]!;
    if (event.seq !== watermark + index + 1) {
      const violation: CompanionDenial = companionDenial(
        'COMPANION_RECONCILIATION_GAP',
        `seq:${watermark + index + 1}`,
        `the local event log reports sequence ${event.seq} where ${watermark + index + 1} was expected — gap-free sequence continuity is a hard invariant (no loss, no duplication) and a gap is never silent`,
      );
      throw new CompanionReconciliationError('reconciliation', JSON.stringify(violation));
    }
  }
  let applied = 0;
  let duplicates = 0;
  let lastSeq = watermark;
  for (const event of pending) {
    const outcome = await deps.observationEvents.ingest(toObservationEventInput(event));
    if (outcome.kind === 'APPLIED') {
      applied += 1;
    } else {
      duplicates += 1;
    }
    lastSeq = event.seq;
  }
  deps.log.acknowledge(lastSeq);
  return {
    replayed: pending.length,
    applied,
    duplicates,
    range: pending.length === 0 ? null : { from: pending[0]!.seq, to: lastSeq },
    watermark: lastSeq,
  };
}
