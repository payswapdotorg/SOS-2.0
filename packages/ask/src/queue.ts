/**
 * The ASK QUEUE — ordered, deduplicated by input digest (Work Order W10:
 * "AskQueue (ordered, deduplicated by input digest)").
 *
 * ORDER (documented, deterministic): severity priority FIRST (SEVERE before
 * HIGH before MODERATE before LOW — the ask's risk severity), then FIFO
 * within a severity (enqueued_at ascending), then the ask artifact id as
 * the final tiebreak. Two asks with the same (priority, enqueued_at) never
 * compare ambiguously.
 *
 * DEDUPLICATION: the key is the ORIGIN decision's exact input digest — the
 * same escalated input is enqueued exactly once (idempotent enqueue
 * returns the existing entry, whether PENDING or RESOLVED: the identical
 * input was already escalated, and — if resolved — already decided by the
 * authority; only a CHANGED input, i.e. a different digest, produces a new
 * ask). This is the honest reading of "deduplicated by input digest".
 *
 * RESOLUTION: resolve(entryId, { resolved_by, chosen_alternative_id, note,
 * provenance, created_at }) produces a DecisionRecord through
 * @sos-2/decision's mintResolutionDecision — the record carries the
 * provenance of who resolved it AND binds to the origin decision's exact
 * input digest — then marks the entry RESOLVED (terminal; an entry is
 * resolved at most once).
 *
 * ASK IS A SUCCESS STATE (R16): enqueueing a valid ask never throws; the
 * queue is a positive workflow (an in-memory routing structure mirroring
 * @sos-2/authority's GrantStore discipline — entries reference spine
 * artifacts, they are not themselves artifacts).
 */

import { assertValidAskRequest } from '@sos-2/authority';
import type { AskRequestArtifact, AskRiskSeverity } from '@sos-2/authority';
import { assertValidDecisionRecord, mintResolutionDecision } from '@sos-2/decision';
import type { DecisionRecord } from '@sos-2/decision';
import { RFC3339_PATTERN } from '@sos-2/semantic-spine';
import { AskError } from './errors.js';
import { askPriorityOf } from './context.js';

export type AskEntryStatus = 'PENDING' | 'RESOLVED';

/** The severity rank used for ordering (SEVERE first). */
const SEVERITY_RANK: Readonly<Record<AskRiskSeverity, number>> = {
  LOW: 0,
  MODERATE: 1,
  HIGH: 2,
  SEVERE: 3,
};

export interface AskResolutionRecord {
  /** The resolution DecisionRecord's spine id. */
  decision_ref: string;
  /** WHO resolved it. */
  resolved_by: string;
  /** The chosen alternative id. */
  chosen_alternative_id: string;
  /** RFC3339 resolution instant. */
  resolved_at: string;
}

export interface AskQueueEntry {
  /** The entry id — the AskRequest artifact id (1:1 with the ask artifact). */
  id: string;
  ask: AskRequestArtifact;
  /** The ORIGINATING ASK decision record (spine id). */
  origin_decision_ref: string;
  /** The origin decision's exact input digest — the DEDUPLICATION KEY. */
  origin_input_digest: string;
  /** RFC3339 enqueue instant. */
  enqueued_at: string;
  /** Presentation priority: the ask's risk severity. */
  priority: AskRiskSeverity;
  status: AskEntryStatus;
  /** Non-null iff status is RESOLVED. */
  resolution: AskResolutionRecord | null;
}

export interface EnqueueAskInput {
  ask: AskRequestArtifact;
  /** The ORIGINATING ASK decision record (action must be ASK). */
  origin_decision: DecisionRecord;
  /** RFC3339 enqueue instant (caller-supplied; no hidden clocks). */
  enqueued_at: string;
}

export interface AskResolutionInput {
  /** WHO resolved it (non-empty; the human/authority identity). */
  resolved_by: string;
  /** The chosen alternative id — one of the ask's alternatives. */
  chosen_alternative_id: string;
  /** The resolver's note (non-empty). */
  note: string;
  /** Provenance for the resolution decision record (non-empty). */
  provenance: string[];
  /** RFC3339 resolution instant. */
  created_at: string;
  /** Optional authorizing artifact for the resolution record. */
  authority_ref?: string | null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isRfc3339(value: unknown): value is string {
  return typeof value === 'string' && RFC3339_PATTERN.test(value);
}

/** The deterministic queue ordering: severity desc, enqueued_at asc, id asc. */
function compareEntries(a: AskQueueEntry, b: AskQueueEntry): number {
  const bySeverity = SEVERITY_RANK[b.priority] - SEVERITY_RANK[a.priority];
  if (bySeverity !== 0) {
    return bySeverity;
  }
  if (a.enqueued_at !== b.enqueued_at) {
    return a.enqueued_at < b.enqueued_at ? -1 : 1;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** The in-memory ask queue (a routing structure over spine artifacts). */
export class AskQueue {
  private readonly entries = new Map<string, AskQueueEntry>();
  private readonly byDigest = new Map<string, string>();

  /**
   * Enqueue an ask. Deduplicated by the ORIGIN decision's input digest:
   * re-presenting the same escalated input returns the EXISTING entry
   * (idempotent — no duplicate). Throws AskError only for invalid
   * operations (a non-ASK origin, a malformed ask or instant) — a valid ask
   * NEVER fails to enqueue (ASK is a success state).
   */
  enqueue(input: EnqueueAskInput): AskQueueEntry {
    assertValidAskRequest(input.ask);
    assertValidDecisionRecord(input.origin_decision);
    if (input.origin_decision.content.action !== 'ASK' || input.origin_decision.content.escalation === null) {
      throw new AskError(
        `only an ASK decision record can originate a queue entry, received action ${JSON.stringify(input.origin_decision.content.action)}`,
      );
    }
    if (!isRfc3339(input.enqueued_at)) {
      throw new AskError(`enqueued_at must be an RFC3339 timestamp, received: ${JSON.stringify(input.enqueued_at)}`);
    }

    const digest = input.origin_decision.content.input_digest;
    const existingId = this.byDigest.get(digest);
    if (existingId !== undefined) {
      const existing = this.entries.get(existingId);
      if (existing === undefined) {
        throw new AskError('internal invariant: digest index references a missing queue entry');
      }
      return existing; // idempotent: the same exact input is already queued (or already resolved)
    }

    const entry: AskQueueEntry = {
      id: input.ask.envelope.id,
      ask: input.ask,
      origin_decision_ref: input.origin_decision.envelope.id,
      origin_input_digest: digest,
      enqueued_at: input.enqueued_at,
      priority: askPriorityOf(input.ask),
      status: 'PENDING',
      resolution: null,
    };
    this.entries.set(entry.id, entry);
    this.byDigest.set(digest, entry.id);
    this.origins.set(input.origin_decision.envelope.id, input.origin_decision);
    return entry;
  }

  /**
   * Resolve a PENDING entry: mints the resolution DecisionRecord through
   * @sos-2/decision (with the provenance of who resolved it, bound to the
   * origin's exact input digest) and marks the entry RESOLVED (terminal).
   */
  resolve(entryId: string, resolution: AskResolutionInput): DecisionRecord {
    if (!isNonEmptyString(entryId)) {
      throw new AskError(`entry id must be a non-empty string, received: ${JSON.stringify(entryId)}`);
    }
    const entry = this.entries.get(entryId);
    if (entry === undefined) {
      throw new AskError(`unknown ask queue entry: ${JSON.stringify(entryId)}`);
    }
    if (entry.status === 'RESOLVED') {
      throw new AskError(
        `ask queue entry ${entryId} is already RESOLVED (decision ${entry.resolution?.decision_ref ?? '?'}) — an entry is resolved at most once; a NEW ask for a changed input has a different digest`,
      );
    }
    if (typeof resolution !== 'object' || resolution === null) {
      throw new AskError('resolution must be an object { resolved_by, chosen_alternative_id, note, provenance, created_at }');
    }
    if (!isNonEmptyString(resolution.resolved_by)) {
      throw new AskError('resolution resolved_by must be a non-empty string — the provenance of who resolved the ask is mandatory');
    }
    if (!isNonEmptyString(resolution.chosen_alternative_id)) {
      throw new AskError('resolution chosen_alternative_id must be a non-empty string');
    }
    if (!isNonEmptyString(resolution.note)) {
      throw new AskError('resolution note must be a non-empty string (every resolution is auditable)');
    }
    if (!Array.isArray(resolution.provenance) || !resolution.provenance.every(isNonEmptyString) || resolution.provenance.length === 0) {
      throw new AskError('resolution provenance must be a non-empty array of non-empty strings');
    }
    if (!isRfc3339(resolution.created_at)) {
      throw new AskError(`resolution created_at must be an RFC3339 timestamp, received: ${JSON.stringify(resolution.created_at)}`);
    }

    const originDecision = this.origins.get(entry.origin_decision_ref);
    if (originDecision === undefined) {
      throw new AskError(
        `the origin decision record ${entry.origin_decision_ref} was not retained by this queue — re-resolve through a queue that holds the origin (enqueue carries the origin)`,
      );
    }

    const record = mintResolutionDecision({
      ask: entry.ask,
      origin_decision: originDecision,
      resolved_by: resolution.resolved_by,
      alternative_id: resolution.chosen_alternative_id,
      note: resolution.note,
      meta: {
        provenance: [...resolution.provenance],
        created_at: resolution.created_at,
        authority_ref: resolution.authority_ref ?? null,
      },
    });

    entry.status = 'RESOLVED';
    entry.resolution = {
      decision_ref: record.envelope.id,
      resolved_by: resolution.resolved_by,
      chosen_alternative_id: resolution.chosen_alternative_id,
      resolved_at: resolution.created_at,
    };
    return record;
  }

  /** Retained origin decision records (for resolution minting). */
  private readonly origins = new Map<string, DecisionRecord>();

  get(id: string): AskQueueEntry | undefined {
    return this.entries.get(id);
  }

  /** The PENDING entries in queue order (severity first, FIFO within severity). */
  pending(): AskQueueEntry[] {
    return this.list().filter((entry) => entry.status === 'PENDING');
  }

  /** ALL entries in queue order (deterministic). */
  list(): AskQueueEntry[] {
    return [...this.entries.values()].sort(compareEntries);
  }

  /** The entry deduplicated for a given input digest, if any. */
  byInputDigest(digest: string): AskQueueEntry | undefined {
    const id = this.byDigest.get(digest);
    return id === undefined ? undefined : this.entries.get(id);
  }

  get size(): number {
    return this.entries.size;
  }

  get pendingCount(): number {
    return this.pending().length;
  }
}
