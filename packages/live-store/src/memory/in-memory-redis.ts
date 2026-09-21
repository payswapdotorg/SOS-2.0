/**
 * In-memory reference implementation of the RedisCoordinationAdapter port
 * (Upstash target).
 *
 * ═════════════════════════════════════════════════════════════════════════
 * NEVER CANONICAL (the binding rule of this adapter): everything held here
 * — cache entries, idempotency keys, lease mirrors — is ACCELERATION.
 * flushAll() destroys it all at any time and the system keeps working from
 * the durable PostgresStoreAdapter: semantic state stays intact and
 * queryable, duplicate detection stays correct (the durable event index is
 * the authority), lease truth is recomputed from durable records plus the
 * injected clock. This is exactly what the Redis-never-canonical test
 * proves.
 * ═════════════════════════════════════════════════════════════════════════
 *
 * Lease TTLs are evaluated against the INJECTED clock (determinism rule:
 * no hidden clocks anywhere in this package).
 */

import type { Clock } from '../clock.js';
import type {
  ProviderHealthRecord,
  RedisCoordinationAdapter,
} from '../ports/provider-adapters.js';
import type { JsonValue } from '@sos-2/semantic-spine';

interface InternalLease {
  holder: string;
  expiresAtEpochMs: number | null;
}

export class InMemoryRedisCoordinationAdapter implements RedisCoordinationAdapter {
  readonly providerName = 'redis' as const;
  readonly providerRole = 'coordination-only-never-canonical' as const;
  readonly providerTarget = 'upstash-redis' as const;

  private readonly clock: Clock;
  private readonly cache = new Map<string, JsonValue>();
  private readonly idempotencyKeys = new Set<string>();
  private readonly leases = new Map<string, InternalLease>();

  constructor(deps: { clock: Clock }) {
    this.clock = deps.clock;
  }

  health(): ProviderHealthRecord {
    return {
      provider: 'redis',
      role: this.providerRole,
      status: 'UNKNOWN',
      detail: 'in-memory reference backend (Upstash adapter not attached in P2); coordination only — never canonical',
    };
  }

  async cacheGet(key: string): Promise<JsonValue | null> {
    const value = this.cache.get(key);
    return value === undefined ? null : structuredClone(value);
  }

  async cacheSet(key: string, value: JsonValue): Promise<void> {
    this.cache.set(key, structuredClone(value));
  }

  async cacheDelete(key: string): Promise<void> {
    this.cache.delete(key);
  }

  async idempotencySeen(key: string): Promise<boolean> {
    return this.idempotencyKeys.has(key);
  }

  async idempotencyMark(key: string): Promise<void> {
    this.idempotencyKeys.add(key);
  }

  private liveLease(key: string): InternalLease | null {
    const lease = this.leases.get(key);
    if (lease === undefined) {
      return null;
    }
    if (lease.expiresAtEpochMs !== null && this.clock.nowEpochMs() >= lease.expiresAtEpochMs) {
      // Lazily drop the expired coordination key (the durable record + clock
      // remain the truth; this layer is only a mirror).
      this.leases.delete(key);
      return null;
    }
    return lease;
  }

  async leaseAcquire(key: string, holder: string, expiresAtEpochMs: number | null): Promise<boolean> {
    if (this.liveLease(key) !== null) {
      return false;
    }
    this.leases.set(key, { holder, expiresAtEpochMs });
    return true;
  }

  async leaseRelease(key: string, holder: string): Promise<boolean> {
    const lease = this.liveLease(key);
    if (lease === null || lease.holder !== holder) {
      return false;
    }
    this.leases.delete(key);
    return true;
  }

  async leaseHolder(key: string): Promise<string | null> {
    const lease = this.liveLease(key);
    return lease === null ? null : lease.holder;
  }

  async flushAll(): Promise<void> {
    this.cache.clear();
    this.idempotencyKeys.clear();
    this.leases.clear();
  }

  /** Number of cached entries (diagnostics/tests). */
  get cacheEntryCount(): number {
    return this.cache.size;
  }
}
