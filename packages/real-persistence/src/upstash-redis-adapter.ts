/**
 * The REAL Upstash Redis coordination adapter (Work Order P17-A) — the
 * vendor-backed realization of the frozen P2 RedisCoordinationAdapter
 * port over the Upstash REST API.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * NEVER CANONICAL (the binding rule of this adapter, encoded by the P3
 * infra contract this lane mirrors): everything held here — cache
 * entries, idempotency keys, lease mirrors — is ACCELERATION.
 * flushAll() destroys it all at any time and the system keeps working
 * from the durable PostgresStoreAdapter (Neon): semantic state stays
 * intact and queryable, duplicate detection stays correct (the durable
 * event index is the authority), lease truth is recomputable from
 * durable records plus the injected clock. The reference-mode suite
 * pins this proof; the real integration journey runs it against the
 * REAL Upstash instance.
 *
 * Every key is TIER-PREFIXED per the P3 namespace contract
 * (sos:<tier>:<purpose>:<key>) — the isolation seam: a preview adapter
 * can never share a Redis namespace with production. flushAll destroys
 * ALL of THIS adapter's coordination state (the complete
 * sos:<tier>:* namespace it owns) — the never-canonical proof
 * operation; other tiers' state is not this adapter's coordination
 * state and destroying it would violate the tier isolation seam.
 *
 * TTL DISCIPLINE (P3 UPSTASH_TTL_POLICY_MS, mirrored structurally):
 * cache entries carry the cache TTL (5 min) and idempotency keys the
 * idempotency TTL (24 h) — Redis data is short-lived BY CONTRACT. The
 * port's lease expiry (expiresAtEpochMs) is honored EXACTLY: a bounded
 * lease becomes a Redis key with PX expiry at the caller-supplied
 * instant; a null-expiry lease is stored without TTL (the port's
 * semantics — its truth remains recomputable from the durable record
 * plus the clock, never canonical).
 * ═════════════════════════════════════════════════════════════════════════
 *
 * HONESTY: health() (the frozen port surface) reports the
 * AVAILABLE/UNAVAILABLE/UNKNOWN mapping of the P17-A probe state —
 * UNKNOWN before any probe, never fabricated. Provider failures throw
 * the frozen live-store ProviderUnavailableError (typed). The P17-A
 * provider-state surface carries CONNECTED/UNKNOWN/UNAVAILABLE/DEGRADED
 * with the full probe evidence (a DNS resolution failure is UNAVAILABLE
 * evidence, never a silent skip).
 */

import { ProviderUnavailableError } from '@sos-2/live-store';
import type { Clock, ProviderHealthRecord, RedisCoordinationAdapter } from '@sos-2/live-store';
import type { JsonValue } from '@sos-2/semantic-spine';
import { canonicalSerialize } from '@sos-2/semantic-spine';
import { UpstashRestClient, UpstashRestError } from './upstash-rest.js';
import type { RecordedUpstashRequest } from './upstash-rest.js';
import { TransportError } from './http.js';
import type { FetchPort } from './http.js';
import type { PersistenceProbeLedger, RealPersistenceProviderStateReport } from './provider-state.js';
import { mapProviderStateToPortAvailability } from './provider-state.js';
import { UPSTASH_TTL_POLICY_MS, upstashTierPrefix } from './infra-vocabulary.js';
import type { UpstashNamespacePurpose } from './infra-vocabulary.js';

/** The atomic release script (only the holder may release its lease). */
const RELEASE_LUA = 'if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("DEL", KEYS[1]) else return 0 end';

/** Options for the real Upstash coordination adapter. */
export interface UpstashRedisAdapterOptions {
  /** The REST endpoint base URL. */
  readonly restUrl: string;
  /** The REST token VALUE (secret; injected at the composition boundary). */
  readonly token: string;
  /** The environment tier whose namespace this adapter owns (the isolation seam). */
  readonly tier: 'local' | 'preview' | 'production';
  /** The injectable network seam (the ONLY network this adapter performs). */
  readonly fetch: FetchPort;
  /** The injected clock (lease TTL evaluation; no hidden time). */
  readonly clock: Clock;
  /** The probe ledger (honest provider states from REAL probes only). */
  readonly ledger: PersistenceProbeLedger;
  /** The env NAME the token came from (for redacted references in reports). */
  readonly credentialEnv: string | null;
}

/**
 * The REAL Upstash Redis coordination adapter — coordination ONLY
 * (cache/idempotency/leases), NEVER CANONICAL, behind the frozen P2
 * port.
 */
export class UpstashRedisCoordinationAdapter implements RedisCoordinationAdapter {
  readonly providerName = 'redis' as const;
  readonly providerRole = 'coordination-only-never-canonical' as const;
  readonly providerTarget = 'upstash-redis' as const;

  private readonly rest: UpstashRestClient;
  private readonly clock: Clock;
  private readonly ledger: PersistenceProbeLedger;
  private readonly credentialEnv: string | null;
  private readonly tier: 'local' | 'preview' | 'production';

  constructor(options: UpstashRedisAdapterOptions) {
    this.rest = new UpstashRestClient({ restUrl: options.restUrl, token: options.token, fetch: options.fetch });
    this.clock = options.clock;
    this.ledger = options.ledger;
    this.credentialEnv = options.credentialEnv;
    this.tier = options.tier;
  }

  /** The env NAME the credential came from (names only — never values). */
  credentialEnvName(): string | null {
    return this.credentialEnv;
  }

  /** The recorded REST round-trips (method + path + status; never credentials). */
  recordedRestRequests(): readonly RecordedUpstashRequest[] {
    return this.rest.recordedRequests();
  }

  /** The honest P17-A provider-state report (probe evidence or the honest unprobed state). */
  providerState(): RealPersistenceProviderStateReport {
    return this.ledger.reportFor('upstash', this.credentialEnv);
  }

  /** The frozen port health surface (AVAILABLE/UNAVAILABLE/UNKNOWN — never fabricated). */
  health(): ProviderHealthRecord {
    const state = this.ledger.reportFor('upstash', this.credentialEnv);
    const availability = mapProviderStateToPortAvailability(state.state);
    return {
      provider: 'redis',
      role: this.providerRole,
      status: availability,
      detail:
        state.state === 'UNKNOWN'
          ? 'real Upstash adapter attached; not yet probed this run (the honest state is UNKNOWN — never fabricated); coordination only — never canonical'
          : state.state === 'CONNECTED'
            ? `real Upstash adapter probed at ${state.probed_at} (coordination only — never canonical; ${state.api_revision ?? 'api revision not reported'})`
            : state.state === 'DEGRADED'
              ? `real Upstash adapter probed at ${state.probed_at} and DEGRADED (the provider answered its probe with a limitation: ${state.last_error ?? 'throttled'})`
              : `real Upstash adapter probed at ${state.probed_at} and UNAVAILABLE (the real failure: ${state.last_error ?? 'unspecified'})`,
    };
  }

  /**
   * The REAL startup/health probe: a live PING through the REST API.
   * Records a probe entry (honest state). Returns the honest outcome —
   * never throws for a provider failure.
   */
  async probe(): Promise<boolean> {
    const endpoint = '/ping';
    try {
      const result = await this.rest.command<string>('ping');
      const ok = result === 'PONG';
      this.ledger.record({
        provider: 'upstash',
        probeId: 'upstash:ping',
        endpoint,
        at: new Date(this.clock.nowEpochMs()).toISOString(),
        status: 200,
        ok,
        failure: ok ? null : `the REST API answered but the ping result was ${JSON.stringify(result)}`,
        apiRevision: 'upstash.rest.v1',
      });
      return ok;
    } catch (error) {
      const failure =
        error instanceof TransportError
          ? `transport failure: ${error.message}`
          : error instanceof UpstashRestError
            ? `rest failure (HTTP ${String(error.status ?? 0)}): ${error.message}`
            : `unexpected failure: ${(error as Error).message}`;
      this.ledger.record({
        provider: 'upstash',
        probeId: 'upstash:ping',
        endpoint,
        at: new Date(this.clock.nowEpochMs()).toISOString(),
        status: error instanceof UpstashRestError ? error.status : null,
        ok: false,
        failure,
        apiRevision: null,
      });
      return false;
    }
  }

  async cacheGet(key: string): Promise<JsonValue | null> {
    const raw = await this.guarded('cacheGet', () => this.rest.command<string | null>('get', this.namespacedKey('cache', key)));
    if (raw === null || raw === undefined) {
      return null;
    }
    try {
      return JSON.parse(raw) as JsonValue;
    } catch {
      // A cache entry that cannot be parsed is an acceleration MISS —
      // never a crash of the caller (the canonical store is the truth).
      return null;
    }
  }

  async cacheSet(key: string, value: JsonValue): Promise<void> {
    await this.guarded('cacheSet', () =>
      this.rest.command('set', this.namespacedKey('cache', key), canonicalSerialize(value), 'PX', String(UPSTASH_TTL_POLICY_MS.cache)),
    );
  }

  async cacheDelete(key: string): Promise<void> {
    await this.guarded('cacheDelete', () => this.rest.command('del', this.namespacedKey('cache', key)));
  }

  async idempotencySeen(key: string): Promise<boolean> {
    const exists = await this.guarded('idempotencySeen', () =>
      this.rest.command<number>('exists', this.namespacedKey('idempotency', key)),
    );
    return exists === 1;
  }

  async idempotencyMark(key: string): Promise<void> {
    await this.guarded('idempotencyMark', () =>
      this.rest.command('set', this.namespacedKey('idempotency', key), '1', 'PX', String(UPSTASH_TTL_POLICY_MS.idempotency)),
    );
  }

  async leaseAcquire(key: string, holder: string, expiresAtEpochMs: number | null): Promise<boolean> {
    const leaseKey = this.namespacedKey('leases', key);
    if (expiresAtEpochMs === null) {
      // Port semantics: a null-expiry lease persists until released. Its
      // truth remains recomputable from the durable record plus the clock.
      const result = await this.guarded('leaseAcquire', () => this.rest.command<string>('set', leaseKey, holder, 'NX'));
      return result === 'OK';
    }
    const ttlMs = expiresAtEpochMs - this.clock.nowEpochMs();
    if (ttlMs <= 0) {
      // The requested lease is ALREADY expired at acquire time — no live
      // lease exists, and a lease with a past expiry is instantly dead
      // (the reference adapter's observable behavior).
      return true;
    }
    const result = await this.guarded('leaseAcquire', () =>
      this.rest.command<string>('set', leaseKey, holder, 'NX', 'PX', String(Math.ceil(ttlMs))),
    );
    return result === 'OK';
  }

  async leaseRelease(key: string, holder: string): Promise<boolean> {
    const result = await this.guarded('leaseRelease', () =>
      this.rest.command<number>('eval', RELEASE_LUA, '1', this.namespacedKey('leases', key), holder),
    );
    return result === 1;
  }

  async leaseHolder(key: string): Promise<string | null> {
    const holder = await this.guarded('leaseHolder', () =>
      this.rest.command<string | null>('get', this.namespacedKey('leases', key)),
    );
    return holder === null || holder === undefined ? null : holder;
  }

  /**
   * Destroy ALL coordination state of THIS adapter (the complete
   * sos:<tier>:* namespace it owns) — the never-canonical proof
   * operation: semantic state must remain fully intact and queryable
   * from the durable store afterwards. Implemented as SCAN + DEL loops
   * over the tier prefix (bounded batches; other tiers' namespaces are
   * not this adapter's coordination state — the tier isolation seam).
   */
  async flushAll(): Promise<void> {
    const pattern = `${upstashTierPrefix(this.tier)}:*`;
    for (;;) {
      const page = await this.guarded('flushAll (scan)', () =>
        this.rest.command<[string, string[]]>('scan', '0', 'MATCH', pattern, 'COUNT', '100'),
      );
      const keys = Array.isArray(page) ? page[1] : [];
      if (keys.length > 0) {
        await this.guarded('flushAll (del)', () => this.rest.command('del', ...keys));
      }
      const cursor = Array.isArray(page) ? page[0] : '0';
      if (cursor === '0' || keys.length === 0) {
        break;
      }
    }
  }

  // ------------------------------------------------------------------ internals

  private namespacedKey(purpose: UpstashNamespacePurpose, key: string): string {
    if (typeof key !== 'string' || key.length === 0) {
      throw new ProviderUnavailableError('redis', `coordination key must be a non-empty string, received: ${JSON.stringify(key)}`);
    }
    return `${upstashTierPrefix(this.tier)}:${purpose}:${key}`;
  }

  /** Map provider failures to the frozen typed ProviderUnavailableError — never a fabricated success. */
  private async guarded<T>(what: string, operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof ProviderUnavailableError) {
        throw error;
      }
      const failure =
        error instanceof TransportError
          ? error.message
          : error instanceof UpstashRestError
            ? error.message
            : (error as Error).message;
      throw new ProviderUnavailableError(
        'redis',
        `the real Upstash provider failed during "${what}" (${failure}) — the honest state is UNAVAILABLE, never a fabricated success`,
      );
    }
  }
}
