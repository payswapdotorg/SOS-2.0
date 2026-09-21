/**
 * Provider ports (Work Order P2) — the provider-neutral mechanism
 * contracts a production backend implements. The SEMANTIC layer
 * (@sos-2/live-store repositories) is implemented ONCE over these ports;
 * swapping the provider never changes meaning (the W12
 * "platforms and vendors are adapters" discipline applied to storage).
 *
 * Provider roles (docs/deployment/free-tier-plan.md):
 *
 *   PostgresStoreAdapter  -> Neon (durable PostgreSQL). THE canonical
 *                            home of live semantic/application state.
 *                            Row payload = canonical serialization of the
 *                            verbatim record; row revision = the record's
 *                            exact revision.
 *
 *   RedisCoordinationAdapter -> Upstash (Redis). Coordination ONLY:
 *                            cache, idempotency keys, lease heartbeats.
 *                            REDIS IS NEVER CANONICAL — it holds NO
 *                            semantic authority; flushing or losing it
 *                            NEVER loses or changes semantic state
 *                            (pinned by tests). Best-effort cache
 *                            failures degrade coordination (typed
 *                            degradation records), never semantics.
 *
 *   ObjectStoreAdapter    -> Cloudflare R2. Large immutable artifacts by
 *                            content hash (evidence/import/report blobs).
 *                            Content-addressed and immutable: the same
 *                            hash always means the same bytes.
 *
 * FAILURE MODEL (typed, honest): provider methods signal failure by
 * throwing ProviderUnavailableError (the operation was NOT performed) or
 * ProviderUnknownError (the outcome cannot be determined) — both carry
 * typed availability records. Success is NEVER fabricated, and failure is
 * NEVER silent. Domain packages never import provider specifics: this
 * module (and its in-memory reference implementation) is the only place
 * provider vocabulary exists.
 */

import type { ProviderHealthRecord } from '@sos-2/api-contracts';

/** The durable row contract of the PostgresStoreAdapter port. */
export interface PostgresRow {
  /** Durable table (repository storage concern, e.g. "mission", "observation_events"). */
  table: string;
  /** The record's semantic id (spine-minted, extracted — never minted by the store). */
  key: string;
  /** The record's EXACT revision (envelope.version, caller-owned revision, or 1 for immutable records). */
  revision: number;
  /** The canonical serialization of the VERBATIM record (the store never rewrites content). */
  payload: string;
  /**
   * sha-256 (64 lowercase hex) of the canonical content compared for identity/dedup.
   * For record tables: the hash of `payload`. For the event table: the hash of
   * the canonical REQUEST part (replay identity — the full record also carries
   * ingested_at).
   */
  content_hash: string;
  /** RFC3339 write instant (injected clock at write time; never a hidden clock). */
  written_at: string;
}

/**
 * The durable semantic state port (Neon target). The single CANONICAL home
 * of live product state. A production adapter implements the same row
 * contract; the in-memory reference implements it with deterministic
 * in-memory rows.
 */
export interface PostgresStoreAdapter {
  /** Provider identity, e.g. "postgres:memory-reference" | "postgres:neon". */
  readonly providerId: string;
  /** The documented provider role (durable semantic state — canonical). */
  readonly role: string;
  /** Typed availability (UP when serving; UNAVAILABLE/UNKNOWN typed otherwise). */
  health(): ProviderHealthRecord;
  /** Fetch one row by table + key, or undefined. */
  getRow(table: string, key: string): Promise<PostgresRow | undefined>;
  /** Write one row (the semantic layer owns conflict detection; this is the unconditional durable write). */
  putRow(row: PostgresRow): Promise<PostgresRow>;
  /** All rows of one table, sorted by key (deterministic). */
  listRows(table: string): Promise<PostgresRow[]>;
  /** All tables that currently hold rows, sorted (deterministic diagnostics). */
  listTables(): Promise<string[]>;
}

/**
 * The coordination port (Upstash target) — cache, idempotency and lease
 * coordination ONLY. REDIS IS NEVER CANONICAL (role is documented on the
 * port and health always reports canonical: false): every method here is
 * best-effort coordination; correctness NEVER depends on it. flushAll()
 * exists precisely so the never-canonical rule is testable: destroying
 * this layer must leave semantic state intact and queryable from the
 * durable store.
 */
export interface RedisCoordinationAdapter {
  readonly providerId: string;
  /** The documented provider role: coordination (cache/idempotency/leases) — NEVER CANONICAL. */
  readonly role: string;
  /** Typed availability; always reports canonical: false. */
  health(): ProviderHealthRecord;
  /** Read a cached canonical payload, or undefined on miss. */
  cacheGet(key: string): Promise<string | undefined>;
  /** Write a cached canonical payload (write-through after the durable write). */
  cachePut(key: string, value: string): Promise<void>;
  /** Invalidate a cache entry. */
  cacheDelete(key: string): Promise<void>;
  /** Has this idempotency key been registered? (Coordination metadata; the durable store is the dedup authority.) */
  idempotencySeen(key: string): Promise<boolean>;
  /** Register an idempotency key (coordination metadata). */
  idempotencyRegister(key: string): Promise<void>;
  /**
   * Record a body-lease heartbeat: `leaseId` is considered live for
   * `ttlSeconds` after the caller-supplied instant `at`. Ephemeral
   * liveness coordination ONLY — the durable BodyLeaseRecord is the
   * semantic truth of the lease.
   */
  leaseHeartbeat(leaseId: string, ttlSeconds: number, at: string): Promise<void>;
  /** Is the lease currently live per the coordination layer? (A hint, never semantic truth.) */
  leaseIsLive(leaseId: string, at: string): Promise<boolean>;
  /** Destroy/flush the whole coordination layer (the never-canonical proof hook). */
  flushAll(): Promise<void>;
}

/** The large-immutable-artifact port (Cloudflare R2 target). */
export interface ObjectStoreAdapter {
  readonly providerId: string;
  /** The documented provider role: large immutable artifacts by content hash. */
  readonly role: string;
  health(): ProviderHealthRecord;
  /**
   * Store immutable bytes under their sha-256 content hash. Content
   * addressing is enforced: re-putting identical bytes is an idempotent
   * no-op (ALREADY_PRESENT); putting DIFFERENT bytes under an existing
   * hash is a typed integrity violation.
   */
  putObject(contentHash: string, bytes: Uint8Array): Promise<{ content_hash: string; size_bytes: number; outcome: 'STORED' | 'ALREADY_PRESENT' }>;
  /** Fetch the bytes for a content hash, or undefined. */
  getObject(contentHash: string): Promise<Uint8Array | undefined>;
  /** Does the object exist? */
  hasObject(contentHash: string): Promise<boolean>;
  /** All objects (content hash + size), sorted by hash (deterministic). */
  listObjects(): Promise<{ content_hash: string; size_bytes: number }[]>;
}

// ---------------------------------------------------------------------------
// Provider role documentation constants
// ---------------------------------------------------------------------------

export const POSTGRES_ROLE =
  'durable semantic state (Neon target) — the single CANONICAL home of live product state';

export const REDIS_ROLE =
  'coordination only (cache/idempotency/leases, Upstash target) — NEVER CANONICAL; flushing it never loses semantic state';

export const OBJECT_STORE_ROLE =
  'large immutable artifacts by content hash (Cloudflare R2 target) — content-addressed, never rewritten';
