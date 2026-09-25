/**
 * Checkpoint integrity (Work Order P12).
 *
 * Checkpoints are CONTENT-ADDRESSED: at capture time the runtime records
 * the sha-256 content hash of the durable checkpoint payload (the exact
 * TaskCheckpoint record); at resume time the hash is RECOMPUTED over the
 * stored payload and compared. A mismatch (corruption, tampering, a
 * different payload under the same id) fails closed as the typed
 * CHECKPOINT_INVALID denial — the checkpoint is never silently
 * re-derived and never resumed from.
 *
 * The hash is produced by the semantic spine's contentHash (the only
 * identity/serialization authority — this module never re-implements a
 * digest).
 */

import { contentHash } from '@sos-2/semantic-spine';
import type { TaskCheckpoint } from '@sos-2/live-store';
import { TaskRuntimeError } from './errors.js';

/** The typed integrity verdict of one stored checkpoint. */
export interface CheckpointIntegrity {
  readonly checkpoint_id: string;
  readonly content_hash: string;
  readonly valid: boolean;
}

/** The checkpoint integrity store port (provider-neutral, injectable). */
export interface CheckpointIntegrityStore {
  /** Record the content hash of a stored checkpoint (single-use checkpoint ids). */
  record(checkpoint: TaskCheckpoint): CheckpointIntegrity;
  /** Recompute + compare: the verdict for one stored checkpoint. */
  verify(checkpoint: TaskCheckpoint): CheckpointIntegrity;
}

/**
 * The deterministic in-memory integrity store (reference
 * implementation). Real durable stores bind later behind the same port.
 */
export class InMemoryCheckpointIntegrity implements CheckpointIntegrityStore {
  private readonly hashes = new Map<string, string>();

  record(checkpoint: TaskCheckpoint): CheckpointIntegrity {
    const hash = hashOf(checkpoint);
    const prior = this.hashes.get(checkpoint.checkpoint_id);
    if (prior !== undefined && prior !== hash) {
      throw new TaskRuntimeError('CHECKPOINT_INVALID', `checkpoint id ${JSON.stringify(checkpoint.checkpoint_id)} is single-use — a different payload under a stored id is a tamper attempt, never re-recorded`);
    }
    this.hashes.set(checkpoint.checkpoint_id, hash);
    return { checkpoint_id: checkpoint.checkpoint_id, content_hash: hash, valid: true };
  }

  verify(checkpoint: TaskCheckpoint): CheckpointIntegrity {
    const recorded = this.hashes.get(checkpoint.checkpoint_id);
    if (recorded === undefined) {
      return { checkpoint_id: checkpoint.checkpoint_id, content_hash: hashOf(checkpoint), valid: false };
    }
    const recomputed = hashOf(checkpoint);
    return { checkpoint_id: checkpoint.checkpoint_id, content_hash: recomputed, valid: recorded === recomputed };
  }
}

/** The content hash of a checkpoint payload (spine authority). */
export function hashOf(checkpoint: TaskCheckpoint): string {
  return contentHash({
    checkpoint_id: checkpoint.checkpoint_id,
    recorded_at: checkpoint.recorded_at,
    label: checkpoint.label,
    work_graph_state: checkpoint.work_graph_state,
    notes: checkpoint.notes,
  });
}

/** Fail-closed verify: an invalid verdict throws the typed denial. */
export function assertCheckpointVerifiable(store: CheckpointIntegrityStore, checkpoint: TaskCheckpoint): void {
  const verdict = store.verify(checkpoint);
  if (!verdict.valid) {
    throw new TaskRuntimeError(
      'CHECKPOINT_INVALID',
      `checkpoint ${JSON.stringify(checkpoint.checkpoint_id)} failed its integrity check (content hash mismatch or no recorded hash) — a corrupted or tampered checkpoint fails closed and is never silently re-derived`,
    );
  }
}
