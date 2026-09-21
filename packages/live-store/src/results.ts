/**
 * Typed write/list/ingest outcomes (Work Order P2 semantic discipline).
 *
 * These are the STORE's semantic result records — plain data, never thrown:
 *
 *   STORED      the record was written (first time, or at a newer revision,
 *               or a validated same-revision lifecycle transition with CAS)
 *   IDENTICAL   the replay of a byte-identical write — a NO-OP returning
 *               the stored record (not an error, not a duplicate)
 *   CONFLICT    the write was rejected — stale revision (older than the
 *               stored revision), expected-revision mismatch, or an
 *               immutable-record id collision — carrying the CURRENT
 *               revision (optimistic concurrency)
 */

import type { ObservationEventRecord } from './records/observation-event.js';

/** The revision of a stored record: a number, or null for immutable records. */
export type RevisionToken = number | null;

export const PUT_CONFLICT_REASONS = ['STALE_REVISION', 'REVISION_MISMATCH', 'IMMUTABLE_COLLISION'] as const;

export type PutConflictReason = (typeof PUT_CONFLICT_REASONS)[number];

/** Options for a record write. */
export interface PutOptions {
  /**
   * Optimistic concurrency: the revision the caller EXPECTS to be stored.
   * When it does not match the current stored revision the write fails with
   * a typed REVISION_MISMATCH conflict. null/absent = no CAS check.
   */
  expected_revision?: RevisionToken;
}

export type PutResult<R> =
  | { kind: 'STORED'; record: R }
  | { kind: 'IDENTICAL'; record: R }
  | {
      kind: 'CONFLICT';
      reason: PutConflictReason;
      id: string;
      /** The CURRENT stored revision (the conflict evidence). */
      current_revision: RevisionToken;
      current_record: R;
    };

/** Seek-style list options (deterministic ordering by record id). */
export interface ListOptions {
  /** Return only records whose id sorts strictly after this id. */
  after_id?: string | null;
  /** Maximum number of items, or null for all. */
  limit?: number | null;
}

export interface ListResult<R> {
  items: R[];
  /** The id to seek past for the next page, or null when exhausted. */
  next_after_id: string | null;
}

/** The outcome of event ingestion (replay protection). */
export type IngestEventOutcome =
  | { kind: 'APPLIED'; event: ObservationEventRecord }
  | {
      kind: 'DUPLICATE';
      event_id: string;
      /** When this event id was FIRST applied (RFC3339). */
      first_received_at: string;
      event: ObservationEventRecord;
    };