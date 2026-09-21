/**
 * Revision + record headers (Work Order P2).
 *
 * Every single-record response carries the record's EXACT revision (the
 * semantic revision the owning domain artifact carries — for spine envelope
 * artifacts this is envelope.version, preserved verbatim by the store) in a
 * dedicated header, plus the record id, so clients can implement optimistic
 * concurrency without parsing bodies. These are the STABLE header names of
 * the API contract.
 */

/** Response header carrying the record's exact revision (integer >= 1). */
export const REVISION_HEADER = 'x-sos-revision';

/** Response header carrying the record's semantic id. */
export const RECORD_ID_HEADER = 'x-sos-record-id';

/** Response header carrying the write outcome (STORED | IDEMPOTENT_REPLAY). */
export const WRITE_OUTCOME_HEADER = 'x-sos-write-outcome';

/** Response header carrying the total item count of a full listing (List responses). */
export const TOTAL_COUNT_HEADER = 'x-sos-total-count';

export const WRITE_OUTCOMES = ['STORED', 'IDEMPOTENT_REPLAY'] as const;

export type WriteOutcome = (typeof WRITE_OUTCOMES)[number];

const WRITE_OUTCOME_SET: ReadonlySet<string> = new Set(WRITE_OUTCOMES);

export function isWriteOutcome(value: unknown): value is WriteOutcome {
  return typeof value === 'string' && WRITE_OUTCOME_SET.has(value);
}
