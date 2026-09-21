/**
 * The ingestion pipeline — replay-protected, typed, never double-applied.
 *
 * Wraps the P2 ObservationEventRepository.ingest contract: every event
 * carries an id; duplicate delivery is detected against the DURABLE
 * event index and answered with a typed DUPLICATE record. Malformed
 * inputs (validation failures) are typed REJECTED outcomes — the
 * pipeline keeps running and reports honestly; a broken event never
 * poisons the plane.
 *
 * Source health bookkeeping is deterministic and clock-injected: last
 * event per source, outcome counters, poll failures. NO hidden clocks.
 */

import type { Clock, IngestEventOutcome, ObservationEventInput, ObservationEventRepository, ObservationEventRecord } from '@sos-2/live-store';
import { InvalidRecordError } from '@sos-2/live-store';
import type { EventSourcePort, PollOutcome } from './sources.js';
import { normalizeExternalEvent } from './normalize.js';

/** The per-event typed outcome (mirrors + extends the P2 outcome). */
export type IngestionOutcome =
  | { readonly kind: 'APPLIED'; readonly event: ObservationEventRecord }
  | { readonly kind: 'DUPLICATE'; readonly eventId: string; readonly firstReceivedAt: string; readonly event: ObservationEventRecord }
  | { readonly kind: 'REJECTED'; readonly eventId: string; readonly reason: string };

/** Summary of one poll+ingest pass over one source. */
export interface PollIngestSummary {
  readonly source: string;
  readonly poll: PollOutcome;
  readonly applied: number;
  readonly duplicates: number;
  readonly rejected: number;
}

/** Per-source health (deterministic, clock-stamped by the injected clock). */
export interface SourceHealthRecord {
  readonly source: string;
  readonly lastEventAt: string | null;
  readonly lastReceivedAt: string | null;
  readonly appliedCount: number;
  readonly duplicateCount: number;
  readonly rejectedCount: number;
  readonly pollFailureCount: number;
  readonly lastPollOutcome: PollOutcome['kind'];
}

export interface EventIngestionPipelineDeps {
  readonly observationEvents: ObservationEventRepository;
  readonly clock: Clock;
}

/** RFC3339 formatting for the injected clock (epoch ms). */
export function epochMsToRfc3339(epochMs: number): string {
  const ms = Math.trunc(epochMs);
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) {
    throw new RangeError(`epoch milliseconds out of range, received: ${String(epochMs)}`);
  }
  return date.toISOString().replace('Z', 'Z');
}

export class EventIngestionPipeline {
  private readonly observationEvents: ObservationEventRepository;
  private readonly clock: Clock;
  private readonly health: Map<string, SourceHealthRecord>;

  constructor(deps: EventIngestionPipelineDeps) {
    this.observationEvents = deps.observationEvents;
    this.clock = deps.clock;
    this.health = new Map<string, SourceHealthRecord>();
  }

  /**
   * Ingest one normalized event. Replay protection is the DURABLE store's
   * (P2) contract: APPLIED or typed DUPLICATE — never double-applied.
   * Validation failures become typed REJECTED (the pipeline never throws
   * for data problems; it throws only for wiring mistakes).
   */
  async ingest(input: ObservationEventInput): Promise<IngestionOutcome> {
    const receivedAt = epochMsToRfc3339(this.clock.nowEpochMs());
    let outcome: IngestEventOutcome;
    try {
      outcome = await this.observationEvents.ingest(input);
    } catch (error) {
      if (error instanceof InvalidRecordError) {
        this.noteRejected(input.source, input.id, (error as Error).message, receivedAt);
        return { kind: 'REJECTED', eventId: input.id, reason: (error as Error).message };
      }
      throw error;
    }
    if (outcome.kind === 'APPLIED') {
      this.noteApplied(input.source, input.occurred_at, receivedAt);
      return { kind: 'APPLIED', event: outcome.event };
    }
    this.noteDuplicate(input.source, receivedAt);
    return { kind: 'DUPLICATE', eventId: outcome.event_id, firstReceivedAt: outcome.first_received_at, event: outcome.event };
  }

  /** Poll one source, normalize every envelope, ingest each (typed). */
  async pollSource(source: EventSourcePort): Promise<PollIngestSummary> {
    const description = source.describe();
    let poll: PollOutcome;
    let envelopes: readonly import('./sources.js').ExternalEventEnvelope[] = [];
    try {
      envelopes = await source.poll();
      poll = envelopes.length > 0 ? { kind: 'POLLED', source: description.source, count: envelopes.length } : { kind: 'EMPTY', source: description.source };
    } catch (error) {
      poll = { kind: 'POLL_FAILED', source: description.source, reason: (error as Error).message };
      this.notePollFailure(description.source);
      return { source: description.source, poll, applied: 0, duplicates: 0, rejected: 0 };
    }
    let applied = 0;
    let duplicates = 0;
    let rejected = 0;
    for (const envelope of envelopes) {
      let input: ObservationEventInput;
      try {
        input = normalizeExternalEvent(description, envelope);
      } catch (error) {
        rejected += 1;
        this.noteRejected(description.source, `${description.source}:<invalid>`, (error as Error).message, epochMsToRfc3339(this.clock.nowEpochMs()));
        continue;
      }
      const outcome = await this.ingest(input);
      if (outcome.kind === 'APPLIED') {
        applied += 1;
      } else if (outcome.kind === 'DUPLICATE') {
        duplicates += 1;
      } else {
        rejected += 1;
      }
    }
    return { source: description.source, poll, applied, duplicates, rejected };
  }

  /** Snapshot of per-source health (deterministic order by source id). */
  healthSnapshot(): SourceHealthRecord[] {
    return [...this.health.entries()]
      .map(([source, record]) => ({ ...record, source }))
      .sort((left, right) => (left.source < right.source ? -1 : left.source > right.source ? 1 : 0));
  }

  private noteApplied(source: string, eventAt: string, receivedAt: string): void {
    const record = this.base(source, receivedAt);
    this.health.set(source, {
      ...record,
      lastEventAt: laterOf(record.lastEventAt, eventAt),
      lastReceivedAt: receivedAt,
      appliedCount: record.appliedCount + 1,
      lastPollOutcome: 'POLLED',
    });
  }

  private noteDuplicate(source: string, receivedAt: string): void {
    const record = this.base(source, receivedAt);
    this.health.set(source, {
      ...record,
      lastReceivedAt: receivedAt,
      duplicateCount: record.duplicateCount + 1,
      lastPollOutcome: 'POLLED',
    });
  }

  private noteRejected(source: string, eventId: string, reason: string, receivedAt: string): void {
    void eventId;
    void reason;
    const record = this.base(source, receivedAt);
    this.health.set(source, {
      ...record,
      lastReceivedAt: receivedAt,
      rejectedCount: record.rejectedCount + 1,
      lastPollOutcome: 'POLLED',
    });
  }

  private notePollFailure(source: string): void {
    const receivedAt = epochMsToRfc3339(this.clock.nowEpochMs());
    const record = this.base(source, receivedAt);
    this.health.set(source, {
      ...record,
      pollFailureCount: record.pollFailureCount + 1,
      lastPollOutcome: 'POLL_FAILED',
    });
  }

  private base(source: string, receivedAt: string): SourceHealthRecord {
    const existing = this.health.get(source);
    if (existing) {
      return existing;
    }
    return {
      source,
      lastEventAt: null,
      lastReceivedAt: receivedAt,
      appliedCount: 0,
      duplicateCount: 0,
      rejectedCount: 0,
      pollFailureCount: 0,
      lastPollOutcome: 'EMPTY',
    };
  }
}

function laterOf(left: string | null, right: string): string {
  if (left === null) {
    return right;
  }
  return left >= right ? left : right;
}
