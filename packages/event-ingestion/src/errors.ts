/**
 * Typed errors for @sos-2/event-ingestion.
 *
 * Errors are for CONTRACT violations (programmer mistakes: a malformed
 * adapter, an invalid envelope) — never for honest operational outcomes.
 * Replayed duplicates, rejected malformed events and failed polls are
 * TYPED OUTCOMES (see ingest.ts / sources.ts), never exceptions: the
 * observation plane keeps running and reports truthfully.
 */

export class EventIngestionError extends Error {
  readonly code: 'EVENT_INGESTION';

  constructor(message: string) {
    super(message);
    this.name = 'EventIngestionError';
    this.code = 'EVENT_INGESTION';
  }
}
