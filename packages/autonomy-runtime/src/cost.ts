/**
 * Task cost / resource accounting (Work Order P12).
 *
 * Every lease action, retry, and recovery episode APPENDS to the task's
 * durable cost record (the TaskRecord's §6 resource_usage field):
 * accounting is EVIDENCE, never an enforcement authority — the ledger
 * records what happened; it never gates, never blocks and never
 * rewrites history. Episodes are append-only typed records; the
 * durable write is CAS-guarded (typed conflict surfaced loudly, never
 * silently dropped).
 */

import type { Clock, TaskRecord, TaskStateRepository } from '@sos-2/live-store';
import { formatRfc3339 } from '@sos-2/live-store';
import type { JsonValue } from '@sos-2/semantic-spine';
import { AutonomyRuntimeError } from './errors.js';

export const COST_EPISODE_KINDS = [
  'LEASE_GRANTED',
  'LEASE_RENEWED',
  'LEASE_REVOKED',
  'RETRY_SCHEDULED',
  'OUTAGE_WINDOW_OPENED',
  'OUTAGE_WINDOW_CLOSED',
  'RECOVERY_PLANNED',
  'RECOVERY_EXECUTED',
] as const;

export type CostEpisodeKind = (typeof COST_EPISODE_KINDS)[number];

/** One typed cost episode (append-only evidence). */
export interface CostEpisode {
  readonly episode_id: string;
  readonly task_id: string;
  readonly kind: CostEpisodeKind;
  /** When the episode occurred (RFC3339, injected clock). */
  readonly at: string;
  /** Episode detail (opaque canonical JSON — evidence, never interpreted for gating). */
  readonly detail: JsonValue;
}

/** The durable shape stored in TaskRecord.resource_usage (typed, append-only). */
export interface CostLedgerRecord {
  readonly episodes: readonly CostEpisode[];
}

export interface CostLedgerDeps {
  readonly tasks: TaskStateRepository;
  readonly clock: Clock;
}

/**
 * The durable cost ledger: appends typed episodes to the task record's
 * resource_usage field. NEVER an enforcement authority — a failed append
 * is a loud typed error (evidence must not vanish silently), and the
 * ledger never gates any other component's behavior.
 */
export class CostLedger {
  constructor(private readonly deps: CostLedgerDeps) {}

  /** Append one episode durably (CAS-guarded; conflicts surface loudly). */
  async append(taskId: string, kind: CostEpisodeKind, detail: JsonValue): Promise<CostEpisode> {
    if (typeof taskId !== 'string' || taskId.length === 0) {
      throw new AutonomyRuntimeError('INVALID_INPUT', `cost episode taskId must be a non-empty string, received: ${JSON.stringify(taskId)}`);
    }
    const task = await this.deps.tasks.get(taskId);
    if (task === undefined) {
      throw new AutonomyRuntimeError('COST_LEDGER', `task ${JSON.stringify(taskId)} is not in the durable store — cost evidence appends to EXISTING tasks only`);
    }
    const ledger = readLedger(task);
    const episode: CostEpisode = {
      episode_id: `cost:${taskId}:${ledger.episodes.length + 1}`,
      task_id: taskId,
      kind,
      at: formatRfc3339(this.deps.clock.nowEpochMs()),
      detail,
    };
    const updated: CostLedgerRecord = { episodes: [...ledger.episodes, episode] };
    const record: TaskRecord = { ...structuredClone(task), resource_usage: updated as unknown as JsonValue, updated_at: formatRfc3339(this.deps.clock.nowEpochMs()), revision: task.revision + 1 };
    const put = await this.deps.tasks.put(record, { expected_revision: task.revision });
    if (put.kind !== 'STORED' && put.kind !== 'IDENTICAL') {
      throw new AutonomyRuntimeError('COST_LEDGER', `cost episode append lost the CAS race on task ${JSON.stringify(taskId)} (${put.kind}) — retry with the fresh record; evidence never vanishes silently`);
    }
    return episode;
  }

  /** Read the task's episodes (derived view of the durable record). */
  async episodesOf(taskId: string): Promise<readonly CostEpisode[]> {
    const task = await this.deps.tasks.get(taskId);
    if (task === undefined) {
      throw new AutonomyRuntimeError('COST_LEDGER', `task ${JSON.stringify(taskId)} is not in the durable store`);
    }
    return readLedger(task).episodes;
  }
}

/** Parse the durable resource_usage into the typed ledger (tolerant read of a null ledger). */
export function readLedger(task: TaskRecord): CostLedgerRecord {
  if (task.resource_usage === null) return { episodes: [] };
  const value = task.resource_usage as { episodes?: unknown };
  if (typeof value !== 'object' || value === null || !Array.isArray(value['episodes'])) {
    throw new AutonomyRuntimeError('COST_LEDGER', `task ${JSON.stringify(task.task_id)} carries a malformed cost ledger — the durable shape is { episodes: CostEpisode[] }`);
  }
  return { episodes: value['episodes'] as readonly CostEpisode[] };
}
