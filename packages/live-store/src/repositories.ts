/**
 * The revisioned record repositories (Work Order P2) — the semantic core
 * of the live store.
 *
 * ONE generic implementation over the durable provider port
 * (PostgresStoreAdapter), parameterized by the record adapter (owning
 * guard + id/revision extraction). The semantic disciplines are pinned:
 *
 *   VERBATIM PRESERVATION — the store returns the record it was given:
 *   canonical-serialization round-trip equality on every read; ids are
 *   extracted (spine-minted), never re-minted; content is never
 *   rewritten.
 *
 *   IDEMPOTENT WRITES — replaying an identical write (same id, same
 *   canonical payload) is a NO-OP that returns the stored record: not an
 *   error, not a duplicate, and no durable write happens.
 *
 *   OPTIMISTIC CONCURRENCY (typed) — a write whose revision is OLDER than
 *   the stored revision fails with a typed STALE_REVISION conflict record
 *   carrying the CURRENT revision; an equal-revision divergent write fails
 *   with a typed REVISION_DIVERGENCE conflict (the store never rewrites
 *   content); a forward write (higher revision) is stored.
 *
 *   LIFECYCLE (enveloped repositories) — the sanctioned same-revision
 *   divergence (spine status transition, identity preserved) flows through
 *   the DEDICATED setStatus operation validated by the spine's withStatus
 *   (the W12 RepositoryAdapter precedent); raw puts attempting it conflict.
 *
 *   NEVER-CANONICAL COORDINATION — the Redis port is used BEST-EFFORT
 *   (read-through cache verified against the owning guard; write-through
 *   after the durable write). A coordination failure NEVER fails a
 *   semantic operation and is NEVER silently dropped: it is recorded as a
 *   typed CoordinationDegradationRecord, queryable on the facade. A
 *   corrupted cache entry is evicted and repaired from the durable store.
 */

import type { RevisionConflictRecord } from '@sos-2/api-contracts';
import { canonicalSerialize } from '@sos-2/semantic-spine';
import type { ArtifactStatus } from '@sos-2/semantic-spine';
import { contentHashHex } from './in-memory-providers.js';
import type { Clock } from './clock.js';
import { DurableRowCorruptionError, InvalidRecordError, LiveStoreError, RecordNotFoundError } from './errors.js';
import type { EnvelopedRecordAdapter, RecordAdapter } from './record-adapters.js';
import type { PostgresStoreAdapter, RedisCoordinationAdapter } from './provider-ports.js';

/** The typed write outcome: success carries the stored record; conflict carries the typed conflict record. */
export type PutOutcome<R> =
  | { outcome: 'STORED'; record: R }
  | { outcome: 'IDEMPOTENT_REPLAY'; record: R }
  | { outcome: 'REVISION_CONFLICT'; conflict: RevisionConflictRecord };

/** One page of a deterministic listing (sorted by record id; after_key is EXCLUSIVE). */
export interface PageResult<R> {
  items: R[];
  /** The sort key of the last returned item, or null when the listing is exhausted. */
  next_key: string | null;
  /** Total records in the repository (deterministic). */
  total: number;
}

export interface ListPageRequest {
  /** Return items with sort key strictly AFTER this key, or null for the first page. */
  after_key: string | null;
  limit: number;
}

/** The provider-neutral revisioned record repository port. */
export interface RevisionedRecordPort<R> {
  /** Repository kind (owning package's vocabulary, e.g. "Mission"). */
  readonly kind: string;
  /** Store one record (validated by the owning guard). Identical replay = idempotent no-op. */
  put(record: R): Promise<PutOutcome<R>>;
  /** Fetch the verbatim record by id, or undefined. */
  get(id: string): Promise<R | undefined>;
  /** Does the repository hold this id? */
  has(id: string): Promise<boolean>;
  /** All records, sorted by id (deterministic). */
  list(): Promise<R[]>;
  /** One deterministic page (sorted by id, exclusive after_key). */
  listPage(request: ListPageRequest): Promise<PageResult<R>>;
  /** The number of records (deterministic). */
  size(): Promise<number>;
  /** The record's EXACT revision (envelope.version / caller-owned revision / 1 for immutable records). */
  revisionOf(record: R): number;
}

/** The enveloped-repository extension: the sanctioned spine lifecycle transition. */
export interface EnvelopedRecordPort<R> extends RevisionedRecordPort<R> {
  /**
   * Apply a spine lifecycle status transition (withStatus: identity
   * preserved, invalid transitions throw). This is the ONLY sanctioned
   * same-revision divergence; the updated artifact is stored verbatim.
   */
  setStatus(id: string, next: ArtifactStatus): Promise<R>;
}

/** The typed coordination-degradation record (mirrors the api-contracts shape). */
export interface CoordinationDegradation {
  provider: string;
  code: string;
  degraded_operations: number;
  last_at: string;
  detail: string;
}

/** The shared, typed coordination-degradation accumulator (never silent). */
export class CoordinationDegradationLog {
  private readonly entries = new Map<string, CoordinationDegradation>();

  record(provider: string, code: string, detail: string, at: string): void {
    const key = `${provider}\u0000${code}`;
    const existing = this.entries.get(key);
    if (existing === undefined) {
      this.entries.set(key, { provider, code, degraded_operations: 1, last_at: at, detail });
    } else {
      existing.degraded_operations += 1;
      existing.last_at = at;
      existing.detail = detail;
    }
  }

  /** The typed degradation records in first-encounter order (deterministic). */
  list(): CoordinationDegradation[] {
    return [...this.entries.values()].map((entry) => ({ ...entry }));
  }
}

/** Everything a record set needs (injected — no hidden clocks, no hidden providers). */
export interface RepositoryDeps {
  readonly durable: PostgresStoreAdapter;
  readonly coordination: RedisCoordinationAdapter | null;
  readonly clock: Clock;
  readonly degradation: CoordinationDegradationLog;
}

function validateRecord<R>(adapter: RecordAdapter<R>, record: unknown): R {
  try {
    adapter.assertValid(record);
  } catch (cause) {
    throw new InvalidRecordError(adapter.kind, cause instanceof Error ? cause.message : String(cause));
  }
  return record as R;
}

function parseRow<R>(adapter: RecordAdapter<R>, row: { key: string; payload: string }): R {
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.payload);
  } catch (cause) {
    throw new DurableRowCorruptionError(adapter.kind, row.key, `payload is not JSON: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
  try {
    adapter.assertValid(parsed);
  } catch (cause) {
    throw new DurableRowCorruptionError(adapter.kind, row.key, cause instanceof Error ? cause.message : String(cause));
  }
  return parsed as R;
}

/**
 * The generic revisioned record set — ONE semantic implementation over the
 * durable provider port. A Neon-backed PostgresStoreAdapter, a file-backed
 * one or the in-memory reference all preserve the same semantics.
 */
export class RevisionedRecordSet<R> implements RevisionedRecordPort<R> {
  readonly kind: string;

  protected readonly adapter: RecordAdapter<R>;
  protected readonly deps: RepositoryDeps;

  constructor(adapter: RecordAdapter<R>, deps: RepositoryDeps) {
    this.adapter = adapter;
    this.kind = adapter.kind;
    this.deps = deps;
  }

  revisionOf(record: R): number {
    return this.adapter.revisionOf(record);
  }

  async put(record: R): Promise<PutOutcome<R>> {
    const validated = validateRecord(this.adapter, record);
    const id = this.adapter.idOf(validated);
    const payload = canonicalSerialize(validated);
    const revision = this.adapter.revisionOf(validated);

    const existing = await this.deps.durable.getRow(this.adapter.table, id);
    if (existing === undefined) {
      await this.writeRow(id, revision, payload);
      return { outcome: 'STORED', record: parseRow(this.adapter, { key: id, payload }) };
    }
    if (existing.payload === payload) {
      // Identical replay: a NO-OP returning the stored record — not an
      // error, not a duplicate; the durable write does not happen again.
      await this.safeCachePopulate(id, existing.payload);
      return { outcome: 'IDEMPOTENT_REPLAY', record: parseRow(this.adapter, { key: id, payload: existing.payload }) };
    }
    if (revision < existing.revision) {
      return {
        outcome: 'REVISION_CONFLICT',
        conflict: {
          error_kind: 'CONFLICT',
          code: 'STALE_REVISION',
          repository: this.adapter.kind,
          record_id: id,
          attempted_revision: revision,
          current_revision: existing.revision,
          message: `stale revision: attempted ${revision}, but the stored ${this.adapter.kind} is at revision ${existing.revision} (move forward from the current revision)`,
        },
      };
    }
    if (revision === existing.revision) {
      return {
        outcome: 'REVISION_CONFLICT',
        conflict: {
          error_kind: 'CONFLICT',
          code: 'REVISION_DIVERGENCE',
          repository: this.adapter.kind,
          record_id: id,
          attempted_revision: revision,
          current_revision: existing.revision,
          message:
            `revision divergence: different ${this.adapter.kind} content was offered at the stored revision ${revision} ` +
            '(the store never rewrites content; lifecycle transitions use the dedicated setStatus operation)',
        },
      };
    }
    // Forward write (higher revision) — stored verbatim.
    await this.writeRow(id, revision, payload);
    return { outcome: 'STORED', record: parseRow(this.adapter, { key: id, payload }) };
  }

  async get(id: string): Promise<R | undefined> {
    const cached = await this.verifiedCacheRead(id);
    if (cached !== undefined) {
      return cached;
    }
    const row = await this.deps.durable.getRow(this.adapter.table, id);
    if (row === undefined) {
      return undefined;
    }
    const record = parseRow(this.adapter, row);
    await this.safeCachePopulate(id, row.payload);
    return record;
  }

  async has(id: string): Promise<boolean> {
    return (await this.deps.durable.getRow(this.adapter.table, id)) !== undefined;
  }

  async list(): Promise<R[]> {
    const rows = await this.deps.durable.listRows(this.adapter.table);
    return rows.map((row) => parseRow(this.adapter, row));
  }

  async listPage(request: ListPageRequest): Promise<PageResult<R>> {
    if (!Number.isInteger(request.limit) || request.limit < 1) {
      throw new LiveStoreError(`listPage limit must be a positive integer, received: ${String(request.limit)}`);
    }
    const rows = await this.deps.durable.listRows(this.adapter.table);
    const total = rows.length;
    const after = request.after_key;
    const eligible = after === null ? rows : rows.filter((row) => row.key > after);
    const slice = eligible.slice(0, request.limit);
    const items = slice.map((row) => parseRow(this.adapter, row));
    const last = slice[slice.length - 1];
    const next_key = last !== undefined && slice.length < eligible.length ? last.key : null;
    return { items, next_key, total };
  }

  async size(): Promise<number> {
    return (await this.deps.durable.listRows(this.adapter.table)).length;
  }

  /**
   * Best-effort coordination wrapper: a provider failure during a cache
   * operation NEVER fails the semantic operation and is recorded as a
   * typed degradation (never silent, never absence-of-failure).
   */
  protected async safeCache<T>(operation: string, fn: () => Promise<T>): Promise<T | undefined> {
    if (this.deps.coordination === null) {
      return undefined;
    }
    try {
      return await fn();
    } catch (cause) {
      this.deps.degradation.record(
        this.deps.coordination.providerId,
        'COORDINATION_OPERATION_FAILED',
        `${operation} degraded: ${cause instanceof Error ? cause.message : String(cause)} (semantic state is intact — the durable store is authoritative; Redis is never canonical)`,
        this.deps.clock.now(),
      );
      return undefined;
    }
  }

  private cacheKey(id: string): string {
    return `${this.adapter.table}:${id}`;
  }

  /**
   * Read-through cache with VERIFICATION: a cache hit is parsed, guarded
   * and re-canonicalized; anything that disagrees with the owning guard
   * (corruption/poisoning) is EVICTED and repaired from the durable store
   * — the cache is never authoritative.
   */
  private async verifiedCacheRead(id: string): Promise<R | undefined> {
    const coordination = this.deps.coordination;
    if (coordination === null) {
      return undefined;
    }
    const cached = await this.safeCache('cacheGet', () => coordination.cacheGet(this.cacheKey(id)));
    if (cached === undefined) {
      return undefined;
    }
    try {
      const record = parseRow(this.adapter, { key: id, payload: cached });
      if (canonicalSerialize(record) !== cached) {
        throw new Error('cached payload is not the canonical form of the record');
      }
      return record;
    } catch (cause) {
      this.deps.degradation.record(
        coordination.providerId,
        'CACHE_CORRUPTION_EVICTED',
        `cache entry for ${this.cacheKey(id)} failed verification (${cause instanceof Error ? cause.message : String(cause)}) — evicted and repaired from the durable store (the cache is never authoritative)`,
        this.deps.clock.now(),
      );
      await this.safeCache('cacheDelete', () => coordination.cacheDelete(this.cacheKey(id)));
      return undefined;
    }
  }

  private async safeCachePopulate(id: string, payload: string): Promise<void> {
    const coordination = this.deps.coordination;
    if (coordination === null) {
      return;
    }
    await this.safeCache('cachePut', () => coordination.cachePut(this.cacheKey(id), payload));
  }

  /** Durable write FIRST (authoritative); best-effort write-through coordination after. */
  protected async writeRow(id: string, revision: number, payload: string): Promise<void> {
    await this.deps.durable.putRow({
      table: this.adapter.table,
      key: id,
      revision,
      payload,
      content_hash: contentHashHex(payload),
      written_at: this.deps.clock.now(),
    });
    await this.safeCachePopulate(id, payload);
  }
}

/** The enveloped record set: adds the sanctioned spine lifecycle transition. */
export class EnvelopedRecordSet<R> extends RevisionedRecordSet<R> implements EnvelopedRecordPort<R> {
  private readonly envelopedAdapter: EnvelopedRecordAdapter<R>;

  constructor(adapter: EnvelopedRecordAdapter<R>, deps: RepositoryDeps) {
    super(adapter, deps);
    this.envelopedAdapter = adapter;
  }

  async setStatus(id: string, next: ArtifactStatus): Promise<R> {
    const row = await this.deps.durable.getRow(this.adapter.table, id);
    if (row === undefined) {
      throw new RecordNotFoundError(this.adapter.kind, id);
    }
    const current = parseRow(this.adapter, row);
    let updated: R;
    try {
      updated = this.envelopedAdapter.withStatus(current, next);
    } catch (cause) {
      throw new InvalidRecordError(
        this.adapter.kind,
        `status transition to ${next} rejected by the spine lifecycle contract: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
    // The SANCTIONED same-revision divergence: identity and revision are
    // preserved (withStatus guarantees it), only the status moves.
    const payload = canonicalSerialize(updated);
    const revision = this.envelopedAdapter.revisionOf(updated);
    await this.writeRow(id, revision, payload);
    return parseRow(this.adapter, { key: id, payload });
  }
}
