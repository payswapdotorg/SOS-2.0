/**
 * @sos-2/real-persistence — the REAL persistence adapters (Work Order
 * P17-A, persistence/deployment lane).
 *
 * The vendor-backed realization of the frozen P2 live-store provider
 * ports over the real free-tier stack:
 *
 *   - neon-admin.ts / neon-http.ts     the real Neon seams: the
 *                                       management API (provisioning)
 *                                       and the HTTPS SQL proxy
 *                                       (durable canonical state)
 *   - neon-postgres-adapter.ts         NeonPostgresStoreAdapter — the
 *                                       PostgresStoreAdapter port over
 *                                       real SQL (sole canonical store)
 *   - upstash-rest.ts / upstash-redis-adapter.ts
 *                                       the RedisCoordinationAdapter
 *                                       port over the real Upstash REST
 *                                       API — coordination ONLY, NEVER
 *                                       CANONICAL (tier-prefixed keys,
 *                                       bounded TTLs, flushAll proof)
 *   - r2-s3.ts / r2-object-store-adapter.ts
 *                                       the ObjectStoreAdapter port
 *                                       over the real R2 S3 API (SigV4
 *                                       on node:crypto — zero external
 *                                       dependencies; write-once
 *                                       content-addressed objects under
 *                                       tier-prefixed keys)
 *   - composition.ts                    the composition boundary (env
 *                                       -> adapters + evidence surfaces)
 *   - provider-state.ts                 the honest P17-A states
 *                                       (CONNECTED/UNKNOWN/UNAVAILABLE/
 *                                       DEGRADED) + the frozen-port
 *                                       AVAILABLE/UNAVAILABLE/UNKNOWN
 *                                       bridge
 *   - http.ts / recording-fetch.ts     the injectable FetchPort seam +
 *                                       the redacted transcript wrapper
 *                                       (the ONLY places network and
 *                                       evidence capture happen)
 *   - transcript.ts / redaction.ts     redacted transcripts; the lane
 *                                       secret-shape corpus
 *   - environment.ts                    env-only credential resolution
 *                                       (P3 registry names; names only
 *                                       in every output)
 *   - infra-vocabulary.ts              the P3 provider configuration
 *                                       contracts carried STRUCTURALLY
 *                                       (the frozen P8 body-runtimes
 *                                       precedent; alignment pinned by
 *                                       test in tests/real-persistence)
 *
 * Determinism discipline: no hidden clocks, no ambient env, no ambient
 * network in package src — the deterministic suites script the FetchPort
 * seam; network happens only in the env-gated integration suite
 * (RUN_REAL=1). Zero external dependencies (workspace:* + toolchain).
 * The frozen contracts are consumed read-only.
 */

export * from './provider-state.js';
export * from './http.js';
export * from './redaction.js';
export * from './transcript.js';
export * from './recording-fetch.js';
export * from './environment.js';
export * from './infra-vocabulary.js';
export * from './neon-admin.js';
export * from './neon-http.js';
export * from './neon-postgres-adapter.js';
export * from './upstash-rest.js';
export * from './upstash-redis-adapter.js';
export * from './r2-s3.js';
export * from './r2-object-store-adapter.js';
export * from './composition.js';
