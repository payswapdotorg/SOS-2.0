/**
 * JOURNEY OBSERVATION (Work Order P13) — the P7 event-ingestion
 * discipline applied to the journey: EVERY stage transition, dispatch,
 * completion, denial and ask emits a durable, replay-protected
 * observation event into the P2 observation-event store.
 *
 * This is the TIMELINE a disconnected user replays on return: the events
 * survive body loss, provider outage and user-device shutdown because
 * they live in the durable store (never in a body, never in transit).
 *
 * Determinism: event ids are deterministic sequences
 * (`journey-obs:<journeyId>:<sequence>`); the injected clock stamps
 * occurred_at; payloads are canonical JSON.
 */

import type { Clock, ObservationEventRepository } from '@sos-2/live-store';
import { formatRfc3339 } from '@sos-2/live-store';
import type { JsonValue } from '@sos-2/semantic-spine';
import type { CloudTickRecord, GreenfieldJourneyStage, JourneyTimelineEvent } from './types.js';

/** The observation source identifier of the greenfield runtime. */
export const JOURNEY_OBSERVATION_SOURCE = 'greenfield-runtime';

/** The journey observation emitter (one per journey). */
export class JourneyObserver {
  private sequence = 0;

  constructor(
    private readonly observationEvents: ObservationEventRepository,
    private readonly clock: Clock,
    private readonly journeyId: string,
  ) {
    if (typeof observationEvents !== 'object' || observationEvents === null || typeof observationEvents.ingest !== 'function') {
      throw new TypeError('JourneyObserver requires the P2 observation-event repository (the durable, replay-protected boundary)');
    }
    if (typeof clock !== 'object' || clock === null || typeof clock.nowEpochMs !== 'function') {
      throw new TypeError('JourneyObserver requires an injected clock (no hidden time)');
    }
    if (typeof journeyId !== 'string' || journeyId.length === 0 || journeyId.includes('sos://')) {
      throw new TypeError('JourneyObserver requires a non-empty RUNTIME journey id (never sos:// shaped)');
    }
  }

  /** Emit one journey observation event (durable, replay-protected). */
  async emit(kind: string, payload: Record<string, unknown>, provenance: readonly string[]): Promise<string> {
    this.sequence += 1;
    const id = `journey-obs:${this.journeyId}:${String(this.sequence).padStart(6, '0')}`;
    await this.observationEvents.ingest({
      id,
      source: JOURNEY_OBSERVATION_SOURCE,
      kind,
      occurred_at: formatRfc3339(this.clock.nowEpochMs()),
      payload: { journeyId: this.journeyId, ...payload } as unknown as JsonValue,
      provenance: [JOURNEY_OBSERVATION_SOURCE, `journey:${this.journeyId}`, ...provenance],
    });
    return id;
  }

  /** The number of events emitted so far (audit). */
  emittedCount(): number {
    return this.sequence;
  }
}

function sequenceOf(eventId: string): number {
  const suffix = eventId.split(':').pop() ?? '0';
  return Number.parseInt(suffix, 10);
}

/** Read the journey's own observation timeline (ordered by emission sequence). */
export async function journeyTimeline(
  observationEvents: ObservationEventRepository,
  journeyId: string,
): Promise<JourneyTimelineEvent[]> {
  const listed = await observationEvents.list({ limit: null });
  const prefix = `journey-obs:${journeyId}:`;
  return listed.items
    .filter((event) => event.id.startsWith(prefix))
    .sort((a, b) => sequenceOf(a.id) - sequenceOf(b.id))
    .map((event) => ({
      eventId: event.id,
      kind: event.kind,
      occurredAt: event.occurred_at,
      receivedAt: event.received_at,
      payload: (event.payload ?? {}) as Record<string, unknown>,
      provenance: [...event.provenance],
    }));
}

/**
 * The task + evidence timeline: journey events PLUS the task-graph and
 * execution-fabric events of the journey's tasks (all durable P2
 * observation events), ordered by (receivedAt, id) — the replayable
 * combined timeline the product shows the returning user.
 */
export async function taskAndEvidenceTimeline(
  observationEvents: ObservationEventRepository,
  journeyId: string,
  taskIds: readonly string[],
): Promise<JourneyTimelineEvent[]> {
  const listed = await observationEvents.list({ limit: null });
  const taskPrefixes = taskIds.map((taskId) => `graph-obs:${taskId}:`);
  const fabricPrefixes = taskIds.map((taskId) => `fabric-obs:${taskId}:`);
  const journeyPrefix = `journey-obs:${journeyId}:`;
  const relevant = listed.items.filter((event) => {
    if (event.id.startsWith(journeyPrefix)) return true;
    if (taskPrefixes.some((prefix) => event.id.startsWith(prefix))) return true;
    return fabricPrefixes.some((prefix) => event.id.startsWith(prefix));
  });
  const journeySeq = (id: string): number => (id.startsWith(journeyPrefix) ? sequenceOf(id) : 0);
  return relevant
    .map((event) => ({
      eventId: event.id,
      kind: event.kind,
      occurredAt: event.occurred_at,
      receivedAt: event.received_at,
      payload: (event.payload ?? {}) as Record<string, unknown>,
      provenance: [...event.provenance],
    }))
    .sort((a, b) => {
      if (a.receivedAt !== b.receivedAt) return a.receivedAt < b.receivedAt ? -1 : 1;
      const seqDelta = journeySeq(a.eventId) - journeySeq(b.eventId);
      if (seqDelta !== 0) return seqDelta;
      return a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0;
    });
}

/** The stage a tick record's payload observed (for timeline projections). */
export function stageOfTickPayload(tick: CloudTickRecord): GreenfieldJourneyStage {
  return tick.stage;
}
