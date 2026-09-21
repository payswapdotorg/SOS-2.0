/**
 * Body lease records (Work Order P2).
 *
 * spec/productization-execution-architecture.md §1: "The body is normally
 * ephemeral. A task owns a body lease; the task, evidence and state survive
 * body replacement." §3: "The broker may suspend, replace or release a body
 * without losing the task."
 *
 * Lease TRUTH is durable in the store (the task-durability guarantee); the
 * Redis coordination layer (Upstash role per docs/deployment/free-tier-plan.md:
 * "cache, idempotency, rate limiting, leases and lightweight queue
 * coordination") carries only a TTL mirror for fast liveness checks — it is
 * NEVER canonical and can be flushed at any time; lease truth is recomputed
 * from the durable record and the injected clock.
 *
 * Execution-fabric vocabulary (P2's own boundary) — NOT a Semantic Spine
 * artifact. Lifecycle: ACTIVE -> RELEASED | REVOKED | EXPIRED (terminal).
 * A released/revoked/expired lease never reactivates; a replacement body
 * takes a NEW lease id.
 */

import { InvalidRecordError } from '../errors.js';

export const BODY_LEASE_NAMESPACE = 'body-lease';

export const BODY_LEASE_STATES = ['ACTIVE', 'RELEASED', 'REVOKED', 'EXPIRED'] as const;

export type BodyLeaseState = (typeof BODY_LEASE_STATES)[number];

const BODY_LEASE_STATE_SET: ReadonlySet<string> = new Set(BODY_LEASE_STATES);

const RFC3339_PATTERN = /^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isRfc3339(value: unknown): value is string {
  return typeof value === 'string' && RFC3339_PATTERN.test(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

const BODY_LEASE_KEYS = [
  'lease_id',
  'task_ref',
  'body_id',
  'holder',
  'state',
  'acquired_at',
  'expires_at',
  'released_at',
  'release_reason',
  'revision',
] as const;

/** The durable body lease record. */
export interface BodyLeaseRecord {
  /** Lease identity (execution-fabric id; single-use — never reactivated). */
  lease_id: string;
  /** The task that owns this lease (task_id). */
  task_ref: string;
  /** The execution body the lease binds, or null while unassigned. */
  body_id: string | null;
  /** The lease holder principal (who acquired it). */
  holder: string;
  /** Lease lifecycle state; RELEASED/REVOKED/EXPIRED are terminal. */
  state: BodyLeaseState;
  /** Acquisition instant, RFC3339. */
  acquired_at: string;
  /** Expiry instant, RFC3339, or null for a non-expiring lease. */
  expires_at: string | null;
  /** Release/revocation/expiry instant, or null while ACTIVE. */
  released_at: string | null;
  /** Why the lease ended, or null while ACTIVE. */
  release_reason: string | null;
  /** Optimistic-concurrency revision (integer >= 1). */
  revision: number;
}

/** Full validation of a body lease record (throws InvalidRecordError). */
export function assertValidBodyLeaseRecord(value: unknown): asserts value is BodyLeaseRecord {
  if (!isPlainObject(value)) {
    throw new InvalidRecordError(BODY_LEASE_NAMESPACE, 'body lease record must be an object');
  }
  if (!hasExactKeys(value, BODY_LEASE_KEYS)) {
    throw new InvalidRecordError(
      BODY_LEASE_NAMESPACE,
      `body lease record must have the exact field set { ${BODY_LEASE_KEYS.join(', ')} }`,
    );
  }
  if (!isNonEmptyString(value['lease_id'])) {
    throw new InvalidRecordError(BODY_LEASE_NAMESPACE, `lease_id must be a non-empty string, received: ${JSON.stringify(value['lease_id'])}`);
  }
  if (!isNonEmptyString(value['task_ref'])) {
    throw new InvalidRecordError(BODY_LEASE_NAMESPACE, `task_ref must be a non-empty string, received: ${JSON.stringify(value['task_ref'])}`);
  }
  if (value['body_id'] !== null && !isNonEmptyString(value['body_id'])) {
    throw new InvalidRecordError(BODY_LEASE_NAMESPACE, `body_id must be null or a non-empty string, received: ${JSON.stringify(value['body_id'])}`);
  }
  if (!isNonEmptyString(value['holder'])) {
    throw new InvalidRecordError(BODY_LEASE_NAMESPACE, `holder must be a non-empty string, received: ${JSON.stringify(value['holder'])}`);
  }
  if (typeof value['state'] !== 'string' || !BODY_LEASE_STATE_SET.has(value['state'])) {
    throw new InvalidRecordError(
      BODY_LEASE_NAMESPACE,
      `lease state must be one of ${BODY_LEASE_STATES.join(', ')}, received: ${JSON.stringify(value['state'])}`,
    );
  }
  if (!isRfc3339(value['acquired_at'])) {
    throw new InvalidRecordError(BODY_LEASE_NAMESPACE, `acquired_at must be RFC3339, received: ${JSON.stringify(value['acquired_at'])}`);
  }
  if (value['expires_at'] !== null && !isRfc3339(value['expires_at'])) {
    throw new InvalidRecordError(BODY_LEASE_NAMESPACE, `expires_at must be null or RFC3339, received: ${JSON.stringify(value['expires_at'])}`);
  }
  if (value['released_at'] !== null && !isRfc3339(value['released_at'])) {
    throw new InvalidRecordError(BODY_LEASE_NAMESPACE, `released_at must be null or RFC3339, received: ${JSON.stringify(value['released_at'])}`);
  }
  if (value['release_reason'] !== null && !isNonEmptyString(value['release_reason'])) {
    throw new InvalidRecordError(BODY_LEASE_NAMESPACE, `release_reason must be null or a non-empty string, received: ${JSON.stringify(value['release_reason'])}`);
  }
  const active = value['state'] === 'ACTIVE';
  if (active !== (value['released_at'] === null)) {
    throw new InvalidRecordError(
      BODY_LEASE_NAMESPACE,
      `an ACTIVE lease has released_at null and an ended lease has a release instant (state ${String(value['state'])}, released_at ${JSON.stringify(value['released_at'])})`,
    );
  }
  if (active !== (value['release_reason'] === null)) {
    throw new InvalidRecordError(
      BODY_LEASE_NAMESPACE,
      `an ACTIVE lease has release_reason null and an ended lease has a reason (state ${String(value['state'])})`,
    );
  }
  if (typeof value['revision'] !== 'number' || !Number.isInteger(value['revision']) || value['revision'] < 1) {
    throw new InvalidRecordError(BODY_LEASE_NAMESPACE, `lease revision must be an integer >= 1, received: ${JSON.stringify(value['revision'])}`);
  }
}

/**
 * Pure expiry evaluation: is this lease expired AT the given instant?
 * (Lease truth recomputed from the durable record + injected clock — the
 * coordination layer is never canonical.)
 */
export function isLeaseExpiredAt(lease: BodyLeaseRecord, nowEpochMs: number): boolean {
  if (lease.expires_at === null) {
    return false;
  }
  return nowEpochMs >= Date.parse(lease.expires_at);
}
