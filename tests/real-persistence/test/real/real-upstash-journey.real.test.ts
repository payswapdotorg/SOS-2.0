/**
 * The REAL Upstash journey (Work Order P17-A) — env-gated (RUN_REAL=1),
 * default OFF. The journey through the real Upstash REST API:
 *
 *   1. startup probe (PING through the REST API);
 *   2. the coordination roundtrip through the frozen
 *      RedisCoordinationAdapter port: cache set/get (TTL), idempotency
 *      mark/seen, lease acquire/holder/release with a real TTL;
 *   3. THE NEVER-CANONICAL PROOF against real providers: semantic rows
 *      are written to the REAL durable canonical store (Neon when
 *      reachable this run — else the in-memory reference backend,
 *      recorded honestly), the ENTIRE coordination state is flushed
 *      (flushAll), and the durable semantic state is verified fully
 *      intact and queryable afterwards;
 *   4. honest provider states throughout.
 *
 * A provider outage during the run is recorded as UNAVAILABLE evidence
 * with the REAL failure (transport/DNS error verbatim) — never a silent
 * skip, never a fabricated success.
 */

import { describe, expect, it } from 'vitest';
import { InMemoryPostgresStoreAdapter } from '@sos-2/live-store';
import type { NeonPostgresStoreAdapter } from '@sos-2/real-persistence';
import {
  ambientSource,
  composeNeonAdapter,
  composeUpstashAdapter,
  globalFetch,
  journeyTelemetry,
  Journey,
  RUN_REAL,
  writeEvidence,
} from './real-world.js';

const suite = RUN_REAL ? describe : describe.skip;

suite('REAL Upstash integration (RUN_REAL=1): coordination roundtrip + the never-canonical proof', () => {
  const journey = new Journey();
  const source = ambientSource();
  const fetch = globalFetch();
  const { transcript, ledger } = journeyTelemetry();
  const clock = { nowEpochMs: () => Date.now() };
  const redis = composeUpstashAdapter(source, transcript, ledger, fetch, clock);

  it('probes the REAL Upstash REST API (PING — the startup probe)', async () => {
    if (redis === null) {
      journey.record('ping-probe', false, {
        attempted: false,
        reason: 'no UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN configured in the environment (names only)',
      });
      return;
    }
    const ok = await redis.probe();
    journey.record('ping-probe', ok, {
      state: redis.providerState().state,
      failure: redis.providerState().last_error,
      api_revision: redis.providerState().api_revision,
    });
    // The honest assertion: the recorded state IS the probe outcome (a
    // failing provider probe is VALID evidence — the journey continues).
    expect(redis.providerState().state === 'CONNECTED').toBe(ok);
    expect(['CONNECTED', 'UNAVAILABLE', 'DEGRADED']).toContain(redis.providerState().state);
  });

  it('round-trips cache/idempotency/lease through the frozen port (when the provider is reachable)', async () => {
    if (redis === null) {
      return;
    }
    if (redis.providerState().state !== 'CONNECTED') {
      journey.record('coordination-roundtrip', false, {
        attempted: false,
        reason: `provider ${redis.providerState().state} (the recorded real failure) — operations honestly not attempted`,
      });
      return;
    }
    const marker = `p17a-${Date.now()}`;
    await redis.cacheSet(marker, { lane: 'p17a', at: new Date().toISOString() } as never);
    const cached = await redis.cacheGet(marker);
    expect(cached).toEqual({ lane: 'p17a', at: (cached as Record<string, unknown>)['at'] });
    await redis.cacheDelete(marker);
    expect(await redis.cacheGet(marker)).toBeNull();
    await redis.idempotencyMark(`${marker}-event`);
    expect(await redis.idempotencySeen(`${marker}-event`)).toBe(true);
    const expires = Date.now() + 30_000;
    expect(await redis.leaseAcquire(`${marker}-lease`, 'worker-p17a', expires)).toBe(true);
    expect(await redis.leaseHolder(`${marker}-lease`)).toBe('worker-p17a');
    expect(await redis.leaseRelease(`${marker}-lease`, 'worker-p17a')).toBe(true);
    expect(await redis.leaseHolder(`${marker}-lease`)).toBeNull();
    journey.record('coordination-roundtrip', true, {
      cache_roundtrip: true,
      idempotency_roundtrip: true,
      lease_roundtrip: true,
      keys_prefix: 'sos:production:* (the P3 tier namespace)',
    });
  });

  it('runs THE NEVER-CANONICAL PROOF: flushAll loses ONLY acceleration; the durable canonical state stays intact', async () => {
    if (redis === null) {
      return;
    }
    // The durable canonical side: the REAL Neon adapter when a
    // DATABASE_URL is configured this run; else the in-memory reference
    // backend (recorded honestly — the cross-provider proof against the
    // REAL Upstash still runs whenever Upstash itself is reachable).
    const databaseUrl = source['DATABASE_URL'];
    const durable =
      databaseUrl !== undefined && databaseUrl.length > 0
        ? composeNeonAdapter(databaseUrl, transcript, ledger, fetch, clock)
        : new InMemoryPostgresStoreAdapter();
    const durableKind = databaseUrl !== undefined ? 'real-neon-adapter' : 'in-memory-reference';
    if (redis.providerState().state !== 'CONNECTED') {
      journey.record('never-canonical-proof', false, {
        attempted: false,
        reason: `Upstash ${redis.providerState().state} (the recorded real failure) — the proof honestly not executed against the real Redis; the reference-mode suite pins the invariant deterministically`,
        durable_side: durableKind,
      });
      return;
    }
    if (durableKind === 'real-neon-adapter') {
      await (durable as NeonPostgresStoreAdapter).ensureSchema();
    }
    // Semantic writes land in the durable store FIRST (never canonical).
    const marker = `p17a-proof-${Date.now()}`;
    await durable.putRow('p17a-proof', marker, { proof: 'flush-loses-nothing', written: new Date().toISOString() } as never);
    // Coordination entries are acceleration only.
    await redis.cacheSet(`${marker}-cache`, { acceleration: true } as never);
    await redis.idempotencyMark(`${marker}-event`);
    await redis.leaseAcquire(`${marker}-lease`, 'worker-p17a', Date.now() + 30_000);
    // FLUSH the entire coordination state.
    await redis.flushAll();
    // THE PROOF: the durable canonical state is fully intact and queryable.
    const row = await durable.getRow('p17a-proof', marker);
    expect(row).not.toBeNull();
    expect((row?.data as Record<string, unknown>)['proof']).toBe('flush-loses-nothing');
    const listed = await durable.listRows('p17a-proof');
    expect(listed.some((entry) => (entry.data as Record<string, unknown>)['proof'] === 'flush-loses-nothing')).toBe(true);
    // The coordination cache is cold (the flushed acceleration is gone).
    expect(await redis.cacheGet(`${marker}-cache`)).toBeNull();
    journey.record('never-canonical-proof', true, {
      durable_side: durableKind,
      durable_row_intact: true,
      durable_listable: true,
      coordination_cache_cold_after_flush: true,
      note: 'flushing the ENTIRE coordination state (sos:production:*) lost ONLY acceleration — the canonical store stayed fully intact and queryable',
    });
  });

  it('writes the machine-readable evidence (honest — including failures; credentials redacted)', () => {
    const state = ledger.reportFor('upstash', 'UPSTASH_REDIS_REST_TOKEN');
    const path = writeEvidence('upstash-integration.json', {
      evidence_kind: 'provider-connectivity',
      provider: 'upstash',
      provider_states: [state],
      credential_envs: ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'],
      rest_protocol: 'POST https://<db>.upstash.io/<command>/<args> (Authorization: Bearer)',
      namespace_contract: 'sos:production:* (the P3 tier prefix — the isolation seam)',
      never_canonical_contract: 'coordination ONLY — cache/idempotency/leases; flushing loses ONLY acceleration',
      adapter_attached: redis !== null,
      transcript: transcript.byProvider('upstash'),
      request_log: redis?.recordedRestRequests() ?? [],
      steps: journey.steps,
      honest_notes: [
        'A provider outage is recorded as UNAVAILABLE evidence with the real failure verbatim — never a silent skip, never a fabricated success.',
        'The never-canonical proof runs against the real Upstash whenever it is reachable; the durable side is the REAL Neon adapter when DATABASE_URL is configured this run (recorded honestly otherwise).',
        'The frozen port health() surface maps probed outcomes to AVAILABLE/UNAVAILABLE/UNKNOWN; the P17-A surface carries CONNECTED/UNKNOWN/UNAVAILABLE/DEGRADED with full probe evidence.',
      ],
    });
    expect(path.endsWith('upstash-integration.json')).toBe(true);
  });
});
