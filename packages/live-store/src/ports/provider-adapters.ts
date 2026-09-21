/**
 * Provider ports (Work Order P2) — the provider-neutral boundary for the
 * free-tier reference stack of docs/deployment/free-tier-plan.md.
 *
 * ┌────────────────────────────────────────────────────────────────────────┐
 * │ THE NEVER-CANONICAL RULE (spec/productization-requirements.md:         │
 * │ "Redis/queues are never canonical"):                                   │
 * │                                                                        │
 * │   The RedisCoordinationAdapter is coordination ONLY — cache, leases    │
 * │   and idempotency. It holds NO canonical semantic state. Flushing or   │
 * │   destroying it at ANY time loses ONLY acceleration; the durable       │
 * │   PostgresStoreAdapter (Neon target) is the sole canonical store, and  │
 * │   every semantic fact remains intact and queryable from it.           │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * Provider roles (docs/deployment/free-tier-plan.md):
 *
 *   Neon (PostgresStoreAdapter)   canonical durable product state: mission,
 *                                 System State projections, evidence
 *                                 metadata, task state, authority, decisions,
 *                                 experiments, packages and history.
 *   Upstash (RedisCoordination..) short-lived acceleration and coordination
 *                                 ONLY — cache, idempotency, rate limiting,
 *                                 leases, lightweight queue coordination.
 *                                 NEVER CANONICAL.
 *   Cloudflare R2 (ObjectStore..) large immutable evidence/import/report
 *                                 objects by content hash; semantic metadata
 *                                 and content hashes remain in the durable
 *                                 semantic layer.
 *
 * Domain packages NEVER import provider specifics: these ports live here,
 * behind the live-store boundary, and the in-memory reference
 * implementations below satisfy the same contracts a real Neon/Upstash/R2
 * adapter satisfies in later waves — WITHOUT contract change. No vendor SDK
 * is added by this Work Order.
 *
 * Failure model: every adapter exposes health() as a TYPED availability
 * record — AVAILABLE (configured provider answered its probe),
 * UNAVAILABLE (configured provider failing — never fabricated success) or
 * UNKNOWN (no provider configured / cannot determine). Adapter operations
 * that fail throw ProviderUnavailableError (typed), which callers surface
 * as typed UNAVAILABLE — never as silent absence-of-failure.
 */

import type { JsonValue } from '@sos-2/semantic-spine';

/** The three providers of the free-tier reference stack. */
export const PROVIDER_NAMES = ['postgres', 'redis', 'object-store'] as const;

export type ProviderName = (typeof PROVIDER_NAMES)[number];

/**
 * Operational availability states (DISTINCT from the six frozen evidence
 * truth states; UNAVAILABLE and UNKNOWN are never conflated and never
 * upgraded to AVAILABLE without a probe).
 */
export const PROVIDER_AVAILABILITIES = ['AVAILABLE', 'UNAVAILABLE', 'UNKNOWN'] as const;

export type ProviderAvailability = (typeof PROVIDER_AVAILABILITIES)[number];

/** A typed per-provider availability record. */
export interface ProviderHealthRecord {
  provider: ProviderName;
  /** The provider's documented role. */
  role: string;
  status: ProviderAvailability;
  /** Human-readable explanation, or null. */
  detail: string | null;
}

/** The health of all three providers. */
export interface ProviderHealthReport {
  postgres: ProviderHealthRecord;
  redis: ProviderHealthRecord;
  objectStore: ProviderHealthRecord;
}

/** A stored row as the durable adapter returns it. */
export interface StoredRow {
  /** The row's canonical-JSON document. */
  data: JsonValue;
  /** The adapter's monotonic storage version (used for CAS writes). */
  storage_version: number;
}

/** The outcome of a durable row write. */
export type RowPutOutcome =
  | { ok: true; storage_version: number }
  | { ok: false; kind: 'ALREADY_EXISTS' | 'VERSION_CONFLICT'; current_storage_version: number };

/** Options for a durable row write. */
export interface RowPutOptions {
  /** Fail with ALREADY_EXISTS when the row already exists. */
  if_absent?: boolean;
  /**
   * Fail with VERSION_CONFLICT unless the row's current storage version is
   * exactly this value (Postgres-style `UPDATE ... WHERE version = $x`).
   */
  expected_storage_version?: number;
}

/**
 * The durable canonical store port (Neon target).
 *
 * Rows are canonical-JSON documents keyed by (namespace, id). Every
 * semantic fact of the live product state lives here and ONLY here.
 */
export interface PostgresStoreAdapter {
  readonly providerName: 'postgres';
  readonly providerRole: 'durable-canonical-state';
  readonly providerTarget: 'neon-postgres';

  /** Typed availability of the durable provider. */
  health(): ProviderHealthRecord;

  /** Fetch a row by (namespace, id), or null when absent. */
  getRow(namespace: string, id: string): Promise<StoredRow | null>;

  /**
   * Write a row (upsert semantics; the storage version increments). With
   * if_absent or expected_storage_version the write is guarded
   * (compare-and-set) and fails with a typed outcome instead of writing.
   */
  putRow(namespace: string, id: string, data: JsonValue, options?: RowPutOptions): Promise<RowPutOutcome>;

  /**
   * All rows of a namespace in their LATEST version, sorted by id
   * (deterministic). No cache, no coordination — the canonical truth.
   */
  listRows(namespace: string): Promise<StoredRow[]>;
}

/**
 * The coordination port (Upstash target) — cache, leases and idempotency
 * ONLY.
 *
 * ══════════════════════════════════════════════════════════════════════
 * NEVER CANONICAL: nothing in this adapter is authoritative. Flushing or
 * destroying it loses only acceleration. A "seen" idempotency answer is
 * never trusted for REJECTION without confirming against the durable
 * store; a lease's truth is always recomputable from the durable lease
 * record plus the clock.
 * ══════════════════════════════════════════════════════════════════════
 */
export interface RedisCoordinationAdapter {
  readonly providerName: 'redis';
  readonly providerRole: 'coordination-only-never-canonical';
  readonly providerTarget: 'upstash-redis';

  /** Typed availability of the coordination provider. */
  health(): ProviderHealthRecord;

  /** Cached value for a key, or null on miss. */
  cacheGet(key: string): Promise<JsonValue | null>;

  /** Cache a value under a key (read-through acceleration only). */
  cacheSet(key: string, value: JsonValue): Promise<void>;

  /** Invalidate a cached key. */
  cacheDelete(key: string): Promise<void>;

  /** Fast-path duplicate check for an idempotency key (never authoritative). */
  idempotencySeen(key: string): Promise<boolean>;

  /** Mark an idempotency key as seen (acceleration only). */
  idempotencyMark(key: string): Promise<void>;

  /**
   * Try to acquire a coordination lease: fails when a live lease exists.
   * `expiresAtEpochMs` bounds the lease (evaluated against the injected
   * clock in the reference implementation).
   */
  leaseAcquire(key: string, holder: string, expiresAtEpochMs: number | null): Promise<boolean>;

  /** Release a coordination lease (only the holder may release). */
  leaseRelease(key: string, holder: string): Promise<boolean>;

  /** The current lease holder, or null when unleased/expired. */
  leaseHolder(key: string): Promise<string | null>;

  /**
   * Destroy ALL coordination state (the never-canonical proof operation:
   * semantic state must remain fully intact and queryable afterwards).
   */
  flushAll(): Promise<void>;
}

/** A stored object reference, as returned by the object-store port. */
export interface StoredObjectRef {
  /** sha-256 content hash (64 lowercase hex) — the immutable object key. */
  content_hash: string;
  /** Provider-shaped reference, e.g. "r2://<hash>". */
  object_ref: string;
  /** Object size in bytes. */
  size_bytes: number;
}

/**
 * The large-artifact port (Cloudflare R2 target): immutable objects keyed
 * by CONTENT HASH. Semantic metadata and content hashes remain in the
 * durable semantic layer (docs/deployment/free-tier-plan.md).
 */
export interface ObjectStoreAdapter {
  readonly providerName: 'object-store';
  readonly providerRole: 'large-immutable-artifacts';
  readonly providerTarget: 'cloudflare-r2';

  /** Typed availability of the object-store provider. */
  health(): ProviderHealthRecord;

  /**
   * Store an immutable object (content-addressed; idempotent: identical
   * bytes produce the identical ref, never a duplicate).
   */
  putObject(bytes: Uint8Array): Promise<StoredObjectRef>;

  /** Fetch the object with this content hash, or null when absent. */
  getObject(contentHash: string): Promise<Uint8Array | null>;

  /** Does an object with this content hash exist? */
  hasObject(contentHash: string): Promise<boolean>;
}
