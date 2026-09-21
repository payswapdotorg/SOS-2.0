/**
 * The revisioned-record engine (Work Order P2) — ONE implementation of the
 * semantic discipline, reused by every repository.
 *
 * Hard rules implemented here (each pinned by tests):
 *
 *  1. VERBATIM PRESERVATION — the store returns the record it was given,
 *     structurally; store -> load round-trip equality is asserted on the
 *     SPINE's canonical serialization. Ids are never re-minted and content
 *     is never rewritten (the spine is the only identity authority).
 *  2. IDEMPOTENT WRITES — replaying a byte-identical write (canonical
 *     equality) is a NO-OP returning the STORED record — not an error, not
 *     a duplicate.
 *  3. STALE-REVISION DETECTION — a write whose revision is OLDER than the
 *     stored revision fails with a TYPED conflict carrying the CURRENT
 *     revision (optimistic concurrency). Same-revision lifecycle
 *     transitions (the spine's id-preserving withStatus semantics) and
 *     newer revisions are stored.
 *  4. IMMUTABLE RECORDS — flat content-addressed records (revision null):
 *     identical replay is a no-op; a DIFFERENT record under a stored id is
 *     a typed IMMUTABLE_COLLISION.
 *  5. DURABLE CAS — the final durable write is guarded by the storage
 *     version (Postgres-style), so concurrent writers cannot silently
 *     interleave; a lost race surfaces as a typed conflict.
 *  6. READ-THROUGH CACHE — the coordination layer (Redis port) accelerates
 *     get() but is NEVER authoritative: every cache error is swallowed and
 *     the durable row serves the read; put() refreshes the cache entry.
 */

import { canonicalSerialize } from '@sos-2/semantic-spine';
import type { JsonValue } from '@sos-2/semantic-spine';
import { CorruptRowError, InvalidRecordError, UnknownStoreError } from '../errors.js';
import type {
  PostgresStoreAdapter,
  RedisCoordinationAdapter,
} from '../ports/provider-adapters.js';
import type { ListOptions, ListResult, PutOptions, PutResult, RevisionToken } from '../results.js';

/**
 * How a record family maps onto the engine's generic discipline. The
 * validate function is the OWNING PACKAGE's assert (consumed verbatim);
 * idOf/revisionOf/supersedesOf come from the record shape itself.
 */
export interface RecordDescriptor<R> {
  /** The durable namespace (Postgres table analogue). */
  readonly namespace: string;
  /** The owning package's validation (throws on invalid records). */
  validate(record: unknown): asserts record is R;
  /** The record's durable id. */
  idOf(record: R): string;
  /**
   * The record's revision (envelope.version / explicit revision), or null
   * for immutable flat records.
   */
  revisionOf(record: R): RevisionToken;
  /** For envelope artifacts: the supersedes target, or null. */
  supersedesOf?(record: R): string | null;
}

function canonicalOrInvalid(namespace: string, value: unknown): string {
  try {
    return canonicalSerialize(value);
  } catch (cause) {
    throw new InvalidRecordError(
      namespace,
      `record is not canonical-JSON serializable: ${(cause as Error).message}`,
    );
  }
}

export class RevisionedRecordEngine<R> {
  private readonly durable: PostgresStoreAdapter;
  private readonly coordination: RedisCoordinationAdapter | null;
  private readonly descriptor: RecordDescriptor<R>;

  constructor(deps: {
    durable: PostgresStoreAdapter;
    coordination?: RedisCoordinationAdapter | null;
    descriptor: RecordDescriptor<R>;
  }) {
    this.durable = deps.durable;
    this.coordination = deps.coordination ?? null;
    this.descriptor = deps.descriptor;
  }

  private cacheKey(id: string): string {
    return `${this.descriptor.namespace}:${id}`;
  }

  /** Read-through cache get — NEVER authoritative: any error is a miss. */
  private async cacheGetSafely(key: string): Promise<JsonValue | null> {
    if (this.coordination === null) {
      return null;
    }
    try {
      return await this.coordination.cacheGet(key);
    } catch {
      return null;
    }
  }

  /** Cache refresh — best effort only; a failing cache never fails a write. */
  private async cacheSetSafely(key: string, value: JsonValue): Promise<void> {
    if (this.coordination === null) {
      return;
    }
    try {
      await this.coordination.cacheSet(key, value);
    } catch {
      // The coordination layer is acceleration only — ignore.
    }
  }

  /** Cache invalidation — best effort only. */
  private async cacheDeleteSafely(key: string): Promise<void> {
    if (this.coordination === null) {
      return;
    }
    try {
      await this.coordination.cacheDelete(key);
    } catch {
      // The coordination layer is acceleration only — ignore.
    }
  }

  private validateStored(namespace: string, id: string, data: unknown): R {
    try {
      this.descriptor.validate(data);
    } catch (cause) {
      throw new CorruptRowError(namespace, id, `stored row failed the owning package's validation: ${(cause as Error).message}`);
    }
    return data as R;
  }

  async put(record: R, options?: PutOptions): Promise<PutResult<R>> {
    const { namespace } = this.descriptor;
    try {
      this.descriptor.validate(record);
    } catch (cause) {
      throw new InvalidRecordError(namespace, (cause as Error).message);
    }
    const id = this.descriptor.idOf(record);
    const incomingCanonical = canonicalOrInvalid(namespace, record);

    let current = await this.durable.getRow(namespace, id);
    if (current === null) {
      const inserted = await this.durable.putRow(namespace, id, record as unknown as JsonValue, { if_absent: true });
      if (inserted.ok) {
        await this.cacheSetSafely(this.cacheKey(id), record as unknown as JsonValue);
        return { kind: 'STORED', record };
      }
      // Lost the insert race: fall through against the winner.
      current = await this.durable.getRow(namespace, id);
      if (current === null) {
        throw new UnknownStoreError(`durable store reported an existing row for ${namespace}/${id} but cannot read it`);
      }
    }

    const storedRecord = this.validateStored(namespace, id, current.data);
    const storedCanonical = canonicalOrInvalid(namespace, current.data);
    if (storedCanonical === incomingCanonical) {
      // Idempotent replay: a NO-OP returning the stored record.
      return { kind: 'IDENTICAL', record: structuredClone(storedRecord) };
    }

    const storedRevision = this.descriptor.revisionOf(storedRecord);
    const incomingRevision = this.descriptor.revisionOf(record);

    if (incomingRevision === null || storedRevision === null) {
      // Immutable record family: a different record under a stored id is a
      // collision (deterministic content addressing makes this a tamper or
      // a forced collision — never silently overwritten).
      return {
        kind: 'CONFLICT',
        reason: 'IMMUTABLE_COLLISION',
        id,
        current_revision: null,
        current_record: structuredClone(storedRecord),
      };
    }

    if (incomingRevision < storedRevision) {
      // STALE: the typed conflict carries the CURRENT revision.
      return {
        kind: 'CONFLICT',
        reason: 'STALE_REVISION',
        id,
        current_revision: storedRevision,
        current_record: structuredClone(storedRecord),
      };
    }

    const expected = options?.expected_revision ?? null;
    if (expected !== null && expected !== storedRevision) {
      return {
        kind: 'CONFLICT',
        reason: 'REVISION_MISMATCH',
        id,
        current_revision: storedRevision,
        current_record: structuredClone(storedRecord),
      };
    }

    const outcome = await this.durable.putRow(namespace, id, record as unknown as JsonValue, {
      expected_storage_version: current.storage_version,
    });
    if (!outcome.ok) {
      // A concurrent writer won the CAS — typed conflict with the current state.
      const fresh = await this.durable.getRow(namespace, id);
      const freshRecord = fresh === null ? storedRecord : this.validateStored(namespace, id, fresh.data);
      const freshRevision = fresh === null ? storedRevision : this.descriptor.revisionOf(freshRecord);
      return {
        kind: 'CONFLICT',
        reason: 'REVISION_MISMATCH',
        id,
        current_revision: freshRevision,
        current_record: structuredClone(freshRecord),
      };
    }

    await this.cacheSetSafely(this.cacheKey(id), record as unknown as JsonValue);
    return { kind: 'STORED', record };
  }

  async get(id: string): Promise<R | undefined> {
    const { namespace } = this.descriptor;
    if (typeof id !== 'string' || id.length === 0) {
      throw new UnknownStoreError(`record id must be a non-empty string, received: ${JSON.stringify(id)}`);
    }

    // Read-through cache (never authoritative: any cache error is a miss).
    const cached = await this.cacheGetSafely(this.cacheKey(id));
    if (cached !== null) {
      try {
        const record = this.validateStored(namespace, id, cached);
        return structuredClone(record);
      } catch {
        // A stale/invalid cache entry is discarded — the durable row serves.
        await this.cacheDeleteSafely(this.cacheKey(id));
      }
    }

    const row = await this.durable.getRow(namespace, id);
    if (row === null) {
      return undefined;
    }
    const record = this.validateStored(namespace, id, row.data);
    await this.cacheSetSafely(this.cacheKey(id), row.data);
    return structuredClone(record);
  }

  async list(options?: ListOptions): Promise<ListResult<R>> {
    const { namespace } = this.descriptor;
    const afterId = options?.after_id ?? null;
    const limit = options?.limit ?? null;
    const rows = await this.durable.listRows(namespace);
    const records: { id: string; record: R }[] = [];
    for (const row of rows) {
      const candidate = this.validateStored(namespace, '', row.data);
      const id = this.descriptor.idOf(candidate);
      if (afterId !== null && !(id > afterId)) {
        continue;
      }
      records.push({ id, record: candidate });
    }
    // listRows is already sorted by id; the filter preserves that order.
    const slice = limit === null ? records : records.slice(0, limit);
    const hasMore = limit !== null && records.length > limit;
    const last = slice.length === 0 ? null : slice[slice.length - 1]!;
    return {
      items: slice.map((entry) => structuredClone(entry.record)),
      next_after_id: hasMore && last !== null ? last.id : null,
    };
  }

  /**
   * The stored revision chain of an envelope artifact: root -> head, over
   * STORED rows. The walk stops honestly at a missing supersedes target
   * (the durable store accepts out-of-order writes; the domain layer
   * judges chain completeness). Cycles are detected and fail typed.
   */
  async history(id: string): Promise<R[]> {
    const { namespace, supersedesOf } = this.descriptor;
    if (supersedesOf === undefined) {
      throw new UnknownStoreError(`namespace ${JSON.stringify(namespace)} is not a supersedes-chained record family`);
    }
    const start = await this.get(id);
    if (start === undefined) {
      return [];
    }
    const chain: R[] = [start];
    const visited = new Set<string>([id]);
    let cursor: R | undefined = start;
    while (cursor !== undefined) {
      const previousId = supersedesOf(cursor);
      if (previousId === null) {
        break;
      }
      if (visited.has(previousId)) {
        throw new UnknownStoreError(`revision cycle detected at ${previousId} in namespace ${JSON.stringify(namespace)}`);
      }
      visited.add(previousId);
      const previous = await this.get(previousId);
      if (previous === undefined) {
        break; // Honest stop: the chain's stored prefix only.
      }
      chain.push(previous);
      cursor = previous;
    }
    chain.reverse();
    return chain;
  }
}
