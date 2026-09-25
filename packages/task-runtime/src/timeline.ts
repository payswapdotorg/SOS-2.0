/**
 * The task timeline (Work Order P12): a durable, REPLAYABLE, user-
 * inspectable event log per task — lease grants, heartbeats
 * (supervision verdicts), checkpoints, recoveries, cancellations and
 * completions.
 *
 * A DERIVED VIEW, never a second source of truth: every entry maps to a
 * durable observation event (its event id) or to the task record's own
 * fields; the timeline never stores anything and never invents events.
 * Pinned by tests: the replayed timeline matches the observation log
 * exactly (same events, same order, no extras, no gaps).
 */

import type { ObservationEventRepository, TaskRecord, TaskStateRepository } from '@sos-2/live-store';

/** One timeline entry (a derived view of one durable observation event). */
export interface TimelineEntry {
  /** When the underlying event was received (RFC3339 — the store's clock stamp). */
  readonly at: string;
  /** The timeline category: lease / heartbeat / checkpoint / recovery / cancellation / completion / task. */
  readonly category: 'lease' | 'heartbeat' | 'checkpoint' | 'recovery' | 'cancellation' | 'completion' | 'task';
  /** The durable observation event id backing this entry. */
  readonly event_id: string;
  /** Honest detail (verbatim from the event payload — never reinterpreted). */
  readonly detail: string;
}

export interface TaskTimelineDeps {
  readonly tasks: TaskStateRepository;
  readonly observationEvents: ObservationEventRepository;
}

/** The derived task timeline (replayable; read-only). */
export class TaskTimeline {
  constructor(private readonly deps: TaskTimelineDeps) {}

  /** Replay the timeline of one task: every durable observation event that concerns it, in store order. */
  async replay(taskId: string): Promise<readonly TimelineEntry[]> {
    if (typeof taskId !== 'string' || taskId.length === 0) {
      throw new TypeError(`taskId must be a non-empty string, received: ${JSON.stringify(taskId)}`);
    }
    const record: TaskRecord | undefined = await this.deps.tasks.get(taskId);
    if (record === undefined) {
      throw new Error(`task ${JSON.stringify(taskId)} is not in the durable store`);
    }
    // The record's observations array is the ordered event-id chain; the
    // timeline derives its entries from those events VERBATIM (plus the
    // lease-watch events naming this task in their payload).
    const byId = new Set<string>(record.observations);
    const listed = await this.deps.observationEvents.list({ limit: null });
    const watchEvents = listed.items.filter(
      (event) =>
        event.source === 'autonomy-lease-watch' &&
        typeof event.payload === 'object' && event.payload !== null &&
        (event.payload as Record<string, unknown>)['task_ref'] === taskId,
    );
    for (const event of watchEvents) {
      byId.add(event.id);
    }
    const entries: TimelineEntry[] = [];
    for (const event of listed.items) {
      if (!byId.has(event.id)) continue;
      entries.push({
        at: event.received_at,
        category: categoryOf(event.source, event.kind),
        event_id: event.id,
        detail: detailOf(event),
      });
    }
    // The honest replay order: reception time first, event id as the
    // deterministic tie-break (the store lists by record id, not time).
    entries.sort((a, b) => (a.at === b.at ? (a.event_id < b.event_id ? -1 : a.event_id > b.event_id ? 1 : 0) : a.at < b.at ? -1 : 1));
    return entries;
  }
}

function categoryOf(source: string, kind: string): TimelineEntry['category'] {
  if (source === 'autonomy-lease-watch') {
    return kind === 'lease.lost' || kind === 'lease.suspected' ? 'heartbeat' : 'lease';
  }
  if (kind.startsWith('task.checkpoint')) return 'checkpoint';
  if (kind === 'task.body-replaced' || kind.startsWith('task.body-completion')) return 'recovery';
  if (kind === 'task.cancelled' || kind === 'task.created' || kind.startsWith('task.')) return 'task';
  if (kind.startsWith('action.')) return 'lease';
  return 'task';
}

function detailOf(event: { source: string; kind: string; payload: unknown }): string {
  return `${event.source} ${event.kind}: ${JSON.stringify(event.payload)}`;
}
