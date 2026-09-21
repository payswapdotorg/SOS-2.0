/**
 * The observation event log (Work Order P2) — the event boundary used by
 * the persistent Spirit and the Observation Plane
 * (spec/productization-execution-architecture.md section 5).
 *
 * REPLAY PROTECTION (hard): every event carries an `event_id`; the DURABLE
 * event log is keyed by it. A duplicate delivery with IDENTICAL content is
 * detected and skipped — a typed DUPLICATE record carrying the first
 * ingestion instant, never double-applied, never an error. A divergent
 * redelivery (same id, different content) is a typed EVENT_DIVERGENCE
 * conflict — never a silent overwrite. The Redis idempotency area is
 * coordination metadata ONLY: correctness never depends on it (flushing
 * the coordination layer does not disable replay protection — pinned by
 * tests).
 *
 * The stored event is the request plus the store-side `ingested_at`
 * stamped by the INJECTED clock (never a hidden clock). The durable row's
 * content_hash is the sha-256 of the canonical REQUEST part (the replay
 * identity); the payload is the canonical full record. Events list in
 * (occurred_at, event_id) order — deterministic.
 */

import {
  assertValidEventIngestionRequest,
  isObservationEventRecord,
  type DuplicateEventRecord,
  type EventDivergenceRecord,
  type EventIngestionRequest,
  type ObservationEventRecord,
} from '@sos-2/api-contracts';
import { canonicalSerialize } from '@sos-2/semantic-spine';
import { contentHashHex } from './in-memory-providers.js';
import type { Clock } from './clock.js';
import { DurableRowCorruptionError, InvalidRecordError, LiveStoreError } from './errors.js';
import type { PageResult, RepositoryDeps } from './repositories.js';
import type { PostgresStoreAdapter } from './provider-ports.js';

/** The typed ingestion outcome. */
export type IngestOutcome =
  | { outcome: 'APPLIED'; event: ObservationEventRecord }
  | { outcome: 'DUPLICATE'; duplicate: DuplicateEventRecord }
  | { outcome: 'EVENT_CONFLICT'; conflict: EventDivergenceRecord };

/** The observation event ingestion port (the event boundary). */
export interface EventIngestionPort {
  /** Ingest one event. Replay protection is mandatory (see module doc). */
  ingest(request: EventIngestionRequest): Promise<IngestOutcome>;
  /** Fetch one stored event by event id, or undefined. */
  get(eventId: string): Promise<ObservationEventRecord | undefined>;
  /** All stored events in (occurred_at, event_id) order (deterministic). */
  list(): Promise<ObservationEventRecord[]>;
  /** One deterministic page in (occurred_at, event_id) order. */
  listPage(request: { after_key: string | null; limit: number }): Promise<PageResult<ObservationEventRecord>>;
  /** The number of stored events (deterministic). */
  size(): Promise<number>;
  /** The composite sort key of an event ((occurred_at, event_id) — deterministic). */
  sortKeyOf(event: ObservationEventRecord): string;
}

export const EVENT_TABLE = 'observation_events';

function eventSortKey(event: Pick<ObservationEventRecord, 'occurred_at' | 'event_id'>): string {
  return `${event.occurred_at}\u0000${event.event_id}`;
}

function parseEventRow(row: { key: string; payload: string }): ObservationEventRecord {
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.payload);
  } catch (cause) {
    throw new DurableRowCorruptionError('ObservationEvent', row.key, `payload is not JSON: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
  if (!isObservationEventRecord(parsed)) {
    throw new DurableRowCorruptionError('ObservationEvent', row.key, 'payload does not match the observation event record contract');
  }
  return parsed;
}

/**
 * The reference event log over the durable provider port. Replay
 * protection is keyed by event_id in the DURABLE store; the coordination
 * layer only registers idempotency keys (best-effort metadata).
 */
export class ObservationEventLog implements EventIngestionPort {
  private readonly durable: PostgresStoreAdapter;
  private readonly deps: RepositoryDeps;

  constructor(deps: RepositoryDeps) {
    this.deps = deps;
    this.durable = deps.durable;
  }

  sortKeyOf(event: ObservationEventRecord): string {
    return eventSortKey(event);
  }

  async ingest(request: EventIngestionRequest): Promise<IngestOutcome> {
    try {
      assertValidEventIngestionRequest(request);
    } catch (cause) {
      throw new InvalidRecordError('observation-event', cause instanceof Error ? cause.message : String(cause));
    }
    // The replay identity: the canonical REQUEST part (ingested_at is
    // store-side and excluded from dedup comparison).
    const requestCanonical = canonicalSerialize(request);
    const requestHash = contentHashHex(requestCanonical);

    const existing = await this.durable.getRow(EVENT_TABLE, request.event_id);
    if (existing !== undefined) {
      const storedEvent = parseEventRow(existing);
      if (existing.content_hash === requestHash) {
        return {
          outcome: 'DUPLICATE',
          duplicate: {
            error_kind: 'DUPLICATE',
            event_id: request.event_id,
            first_ingested_at: storedEvent.ingested_at,
            message:
              'duplicate delivery detected and skipped (the event was already ingested with identical content; never double-applied)',
          },
        };
      }
      return {
        outcome: 'EVENT_CONFLICT',
        conflict: {
          error_kind: 'CONFLICT',
          code: 'EVENT_DIVERGENCE',
          event_id: request.event_id,
          first_ingested_at: storedEvent.ingested_at,
          message:
            `event id ${JSON.stringify(request.event_id)} was redelivered with DIFFERENT content ` +
            '(events are immutable once ingested; a divergent redelivery is never silently overwritten)',
        },
      };
    }

    const event: ObservationEventRecord = { ...request, ingested_at: this.deps.clock.now() };
    if (!isObservationEventRecord(event)) {
      // Defensive: the stamped record must still satisfy the contract.
      throw new InvalidRecordError('observation-event', 'stamped event record failed the contract guard');
    }
    await this.durable.putRow({
      table: EVENT_TABLE,
      key: event.event_id,
      revision: 1,
      payload: canonicalSerialize(event),
      content_hash: requestHash,
      written_at: event.ingested_at,
    });
    // Coordination metadata only — best-effort, never authoritative.
    const coordination = this.deps.coordination;
    if (coordination !== null) {
      try {
        await coordination.idempotencyRegister(`event:${event.event_id}`);
      } catch {
        // Never silent: record the degradation, never fail ingestion.
        this.deps.degradation.record(
          coordination.providerId,
          'IDEMPOTENCY_REGISTER_FAILED',
          'idempotency key registration failed (coordination metadata only — replay protection is enforced by the durable event log)',
          this.deps.clock.now(),
        );
      }
    }
    return { outcome: 'APPLIED', event };
  }

  async get(eventId: string): Promise<ObservationEventRecord | undefined> {
    const row = await this.durable.getRow(EVENT_TABLE, eventId);
    if (row === undefined) {
      return undefined;
    }
    return parseEventRow(row);
  }

  async list(): Promise<ObservationEventRecord[]> {
    const rows = await this.durable.listRows(EVENT_TABLE);
    const events = rows.map((row) => parseEventRow(row));
    return events.sort((a, b) => this.compareKeys(a, b));
  }

  async listPage(request: { after_key: string | null; limit: number }): Promise<PageResult<ObservationEventRecord>> {
    if (!Number.isInteger(request.limit) || request.limit < 1) {
      throw new LiveStoreError(`listPage limit must be a positive integer, received: ${String(request.limit)}`);
    }
    const events = await this.list();
    const total = events.length;
    const after = request.after_key;
    const eligible = after === null ? events : events.filter((event) => this.sortKeyOf(event) > after);
    const slice = eligible.slice(0, request.limit);
    const last = slice[slice.length - 1];
    const next_key = last !== undefined && slice.length < eligible.length ? this.sortKeyOf(last) : null;
    return { items: slice, next_key, total };
  }

  async size(): Promise<number> {
    return (await this.durable.listRows(EVENT_TABLE)).length;
  }

  private compareKeys(a: ObservationEventRecord, b: ObservationEventRecord): number {
    const keyA = this.sortKeyOf(a);
    const keyB = this.sortKeyOf(b);
    return keyA < keyB ? -1 : keyA > keyB ? 1 : 0;
  }
}
