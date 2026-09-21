/**
 * In-memory reference implementations of the three provider ports
 * (Work Order P2).
 *
 * These implement the EXACT provider contracts a Neon/Upstash/R2 adapter
 * will implement later — same row/blob semantics, same determinism rules
 * (no hidden clocks: every timestamp comes from the INJECTED clock), same
 * failure-free reference behavior. Swapping them for real adapters never
 * changes semantics.
 */

import type { ProviderHealthRecord } from '@sos-2/api-contracts';
import { createHash } from 'node:crypto';
import { ObjectIntegrityError } from './errors.js';
import type { Clock } from './clock.js';
import type {
  ObjectStoreAdapter,
  PostgresRow,
  PostgresStoreAdapter,
  RedisCoordinationAdapter,
} from './provider-ports.js';
import { OBJECT_STORE_ROLE, POSTGRES_ROLE, REDIS_ROLE } from './provider-ports.js';

const SHA256_PATTERN = /^[0-9a-f]{64}$/;

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function assertSha256(contentHash: string, provider: string): void {
  if (!SHA256_PATTERN.test(contentHash)) {
    throw new ObjectIntegrityError(contentHash, `${provider}: content hash must be 64 lowercase hex characters`);
  }
}

// ---------------------------------------------------------------------------
// PostgresStoreAdapter (in-memory reference — the durable substrate)
// ---------------------------------------------------------------------------

export interface InMemoryPostgresOptions {
  /** Injected clock stamping write instants (never a hidden clock). */
  clock: Clock;
  /** Provider id (defaults to "postgres:memory-reference"). */
  providerId?: string;
}

/**
 * The in-memory reference durable store. It plays the ROLE Neon plays in
 * production: the durable substrate rows survive facade recreation (task
 * durability across body/process loss is pinned by tests). listRows is
 * sorted by key; listTables is sorted — deterministic everywhere.
 */
export class InMemoryPostgresStoreAdapter implements PostgresStoreAdapter {
  readonly providerId: string;
  readonly role: string;

  private readonly clock: Clock;
  private readonly tables = new Map<string, Map<string, PostgresRow>>();

  constructor(options: InMemoryPostgresOptions) {
    this.clock = options.clock;
    this.providerId = options.providerId ?? 'postgres:memory-reference';
    this.role = POSTGRES_ROLE;
  }

  health(): ProviderHealthRecord {
    return {
      provider: this.providerId,
      role: this.role,
      target: 'Neon',
      implementation: 'in-memory-reference',
      availability: 'UP',
      code: null,
      canonical: true,
      detail:
        'in-memory reference durable store (the canonical semantic substrate in reference mode); ' +
        'a Neon adapter implements the same row contract without semantic change',
    };
  }

  async getRow(table: string, key: string): Promise<PostgresRow | undefined> {
    return this.tables.get(table)?.get(key);
  }

  async putRow(row: PostgresRow): Promise<PostgresRow> {
    if (typeof row.table !== 'string' || row.table.length === 0) {
      throw new TypeError('row.table must be a non-empty string');
    }
    if (typeof row.key !== 'string' || row.key.length === 0) {
      throw new TypeError('row.key must be a non-empty string');
    }
    if (!Number.isInteger(row.revision) || row.revision < 1) {
      throw new TypeError('row.revision must be an integer >= 1');
    }
    if (typeof row.payload !== 'string') {
      throw new TypeError('row.payload must be a string');
    }
    if (typeof row.content_hash !== 'string' || !SHA256_PATTERN.test(row.content_hash)) {
      throw new TypeError('row.content_hash must be 64 lowercase hex characters');
    }
    let table = this.tables.get(row.table);
    if (table === undefined) {
      table = new Map<string, PostgresRow>();
      this.tables.set(row.table, table);
    }
    const stored: PostgresRow = { ...row };
    table.set(row.key, stored);
    return { ...stored };
  }

  async listRows(table: string): Promise<PostgresRow[]> {
    const rows = this.tables.get(table);
    if (rows === undefined) {
      return [];
    }
    return [...rows.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)).map((row) => ({ ...row }));
  }

  async listTables(): Promise<string[]> {
    return [...this.tables.keys()].sort();
  }
}

// ---------------------------------------------------------------------------
// RedisCoordinationAdapter (in-memory reference — never canonical)
// ---------------------------------------------------------------------------

export interface InMemoryRedisOptions {
  providerId?: string;
}

interface LeaseEntry {
  expiresAtEpochMs: number;
}

/**
 * The in-memory reference coordination layer: cache entries, idempotency
 * keys and lease liveness. NEVER CANONICAL — flushAll() destroys the whole
 * layer and the semantic layer must not notice (pinned by tests). Lease
 * liveness uses caller-supplied instants (no hidden clock).
 */
export class InMemoryRedisCoordinationAdapter implements RedisCoordinationAdapter {
  readonly providerId: string;
  readonly role: string;

  private readonly cache = new Map<string, string>();
  private readonly idempotency = new Set<string>();
  private readonly leases = new Map<string, LeaseEntry>();

  constructor(options: InMemoryRedisOptions = {}) {
    this.providerId = options.providerId ?? 'redis:memory-reference';
    this.role = REDIS_ROLE;
  }

  health(): ProviderHealthRecord {
    return {
      provider: this.providerId,
      role: this.role,
      target: 'Upstash',
      implementation: 'in-memory-reference',
      availability: 'UP',
      code: null,
      canonical: false,
      detail:
        'in-memory reference coordination layer (cache/idempotency/leases) — NEVER CANONICAL; ' +
        'flushing it never loses semantic state (the durable store is the semantic authority)',
    };
  }

  async cacheGet(key: string): Promise<string | undefined> {
    return this.cache.get(key);
  }

  async cachePut(key: string, value: string): Promise<void> {
    this.cache.set(key, value);
  }

  async cacheDelete(key: string): Promise<void> {
    this.cache.delete(key);
  }

  async idempotencySeen(key: string): Promise<boolean> {
    return this.idempotency.has(key);
  }

  async idempotencyRegister(key: string): Promise<void> {
    this.idempotency.add(key);
  }

  async leaseHeartbeat(leaseId: string, ttlSeconds: number, at: string): Promise<void> {
    if (typeof leaseId !== 'string' || leaseId.length === 0) {
      throw new TypeError('leaseId must be a non-empty string');
    }
    if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) {
      throw new TypeError('ttlSeconds must be a positive number');
    }
    const atEpochMs = Date.parse(at);
    if (!Number.isFinite(atEpochMs)) {
      throw new TypeError(`at must be an RFC3339 instant, received: ${JSON.stringify(at)}`);
    }
    this.leases.set(leaseId, { expiresAtEpochMs: atEpochMs + ttlSeconds * 1000 });
  }

  async leaseIsLive(leaseId: string, at: string): Promise<boolean> {
    const entry = this.leases.get(leaseId);
    if (entry === undefined) {
      return false;
    }
    const atEpochMs = Date.parse(at);
    if (!Number.isFinite(atEpochMs)) {
      throw new TypeError(`at must be an RFC3339 instant, received: ${JSON.stringify(at)}`);
    }
    return atEpochMs < entry.expiresAtEpochMs;
  }

  async flushAll(): Promise<void> {
    this.cache.clear();
    this.idempotency.clear();
    this.leases.clear();
  }
}

// ---------------------------------------------------------------------------
// ObjectStoreAdapter (in-memory reference)
// ---------------------------------------------------------------------------

export interface InMemoryObjectStoreOptions {
  providerId?: string;
}

/** The in-memory reference object store: content-addressed immutable blobs. */
export class InMemoryObjectStoreAdapter implements ObjectStoreAdapter {
  readonly providerId: string;
  readonly role: string;

  private readonly objects = new Map<string, Uint8Array>();

  constructor(options: InMemoryObjectStoreOptions = {}) {
    this.providerId = options.providerId ?? 'object-store:memory-reference';
    this.role = OBJECT_STORE_ROLE;
  }

  health(): ProviderHealthRecord {
    return {
      provider: this.providerId,
      role: this.role,
      target: 'Cloudflare R2',
      implementation: 'in-memory-reference',
      availability: 'UP',
      code: null,
      canonical: true,
      detail:
        'in-memory reference object store (large immutable artifacts by content hash); ' +
        'an R2 adapter implements the same contract without semantic change',
    };
  }

  async putObject(contentHash: string, bytes: Uint8Array): Promise<{ content_hash: string; size_bytes: number; outcome: 'STORED' | 'ALREADY_PRESENT' }> {
    assertSha256(contentHash, this.providerId);
    const existing = this.objects.get(contentHash);
    if (existing !== undefined) {
      const sameBytes = existing.length === bytes.length && existing.every((byte, index) => byte === bytes[index]);
      if (!sameBytes) {
        throw new ObjectIntegrityError(
          contentHash,
          'content-address violation: different bytes offered under an existing content hash (objects are immutable)',
        );
      }
      return { content_hash: contentHash, size_bytes: existing.length, outcome: 'ALREADY_PRESENT' };
    }
    const stored = Uint8Array.from(bytes);
    this.objects.set(contentHash, stored);
    return { content_hash: contentHash, size_bytes: stored.length, outcome: 'STORED' };
  }

  async getObject(contentHash: string): Promise<Uint8Array | undefined> {
    assertSha256(contentHash, this.providerId);
    const bytes = this.objects.get(contentHash);
    if (bytes === undefined) {
      return undefined;
    }
    return Uint8Array.from(bytes);
  }

  async hasObject(contentHash: string): Promise<boolean> {
    assertSha256(contentHash, this.providerId);
    return this.objects.has(contentHash);
  }

  async listObjects(): Promise<{ content_hash: string; size_bytes: number }[]> {
    return [...this.objects.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      .map(([content_hash, bytes]) => ({ content_hash, size_bytes: bytes.length }));
  }
}

/** The shared sha-256 hex helper (deterministic content addressing). */
export function contentHashHex(payload: string): string {
  return sha256Hex(payload);
}
