# @sos-2/real-persistence — Real Persistence Adapters (Work Order P17-A)

The vendor-backed realization of the **frozen P2 live-store provider
ports** over the real free-tier stack of
`docs/deployment/free-tier-plan.md`:

| Port (frozen, `packages/live-store`) | Real provider | Realization |
| --- | --- | --- |
| `PostgresStoreAdapter` (durable canonical state) | **Neon PostgreSQL** | `NeonPostgresStoreAdapter` — real SQL over the Neon HTTPS SQL proxy (`POST /sql`, connection string in the `Neon-Connection-String` header; `INSERT … ON CONFLICT` / guarded `UPDATE … WHERE storage_version = $x` exactly the port's documented semantics). The **sole canonical store**. |
| `RedisCoordinationAdapter` (coordination only — **NEVER CANONICAL**) | **Upstash Redis** | `UpstashRedisCoordinationAdapter` — real REST commands (`POST /<command>/<args>`, `Authorization: Bearer`), tier-prefixed keys (`sos:<tier>:<purpose>:<key>` per the P3 namespace contract), bounded TTLs (P3 policy), `flushAll` destroys the adapter's whole tier namespace (the never-canonical proof operation). |
| `ObjectStoreAdapter` (write-once immutable artifacts) | **Cloudflare R2** | `R2ObjectStoreAdapter` — the S3-compatible API with **AWS SigV4 implemented on `node:crypto` (zero external dependencies)**; content-addressed keys `<tier-prefix>/<purpose>/<sha256>` per the P3 `r2ObjectKey` contract; idempotent re-puts (identical bytes → identical ref); deletion ONLY through the documented retention path (deliberately outside the frozen port). |

## Honest provider states (the program-defining rule)

`CONNECTED / UNKNOWN / UNAVAILABLE / DEGRADED` — every state comes from
a REAL probe through the injectable FetchPort (the P17-B/P17-C
vocabulary). Unprobed is `UNKNOWN` (never health); a down provider is
`UNAVAILABLE` with the real error recorded verbatim (DNS resolution
failures included); a throttled provider is `DEGRADED` (429). The
frozen port `health()` surface maps probed outcomes to
`AVAILABLE/UNAVAILABLE/UNKNOWN` (the documented bridge —
`mapProviderStateToPortAvailability`; DEGRADED answered its probe →
AVAILABLE with the degradation carried in the detail and on the P17-A
surface). Provider failures throw the frozen live-store
`ProviderUnavailableError` — never a fabricated success.

## Discipline

- **One HTTP seam**: every network call goes through the injectable
  `FetchPort` (`src/http.ts` is the only global-fetch reference — the
  documented impure boundary `bindGlobalFetch`). Deterministic tests
  script the seam; only the env-gated integration suite
  (`RUN_REAL=1`, `tests/real-persistence`) attaches the real fetch.
- **Env-only credentials**: `resolveRealPersistenceEnvironment(source)`
  resolves P3-registry names (`DATABASE_URL`, `NEON_API_KEY`,
  `UPSTASH_REDIS_REST_URL/TOKEN`, `R2_*`) plus the documented lane
  alternates (`NEON_API_KEY_SECONDARY`, `R2_S3_ENDPOINT`); values flow
  onward into clients only — outcomes/notes/telemetry/evidence carry
  NAMES only (transcripts redact credential headers to env-name
  references through the lane corpus).
- **P3 contracts carried structurally** (`src/infra-vocabulary.ts`):
  `@sos-2/infra-deployment` is a frozen zero-dependency no-build
  package with no module entry point — its naming/TTL/region/revision
  contracts are mirrored field-for-field here, and the alignment is
  PINNED BY TEST (`tests/real-persistence/test/infra-alignment.test.ts`
  imports the real sources through non-literal dynamic imports — the
  P17-B pinning precedent).
- **Zero external dependencies**: workspace:* + the established
  toolchain only; fetch and crypto are Node built-ins.
- **Determinism**: no `process.env`, no `Date.now`, no `Math.random`,
  no ambient network in package src (pinned by
  `test/structure.test.ts`).

## Module map

| Path | Contract |
| --- | --- |
| `src/http.ts` | The injectable FetchPort seam + the impure `bindGlobalFetch` boundary |
| `src/provider-state.ts` | The honest P17-A states + probe ledger + the frozen-port health bridge |
| `src/redaction.ts` / `src/transcript.ts` | The lane secret-shape corpus; redacted transcripts |
| `src/recording-fetch.ts` | The transcript-recording FetchPort wrapper (the evidence seam) |
| `src/environment.ts` | Env-only credential resolution (P3 registry names; names only in outputs) |
| `src/infra-vocabulary.ts` | The P3 neon/upstash/r2/vercel/revision contracts, structural mirror |
| `src/neon-admin.ts` / `src/neon-http.ts` | The real Neon management API + HTTPS SQL proxy clients |
| `src/neon-postgres-adapter.ts` | `NeonPostgresStoreAdapter` (the canonical durable store) |
| `src/upstash-rest.ts` / `src/upstash-redis-adapter.ts` | The real Upstash REST client + coordination adapter (never canonical) |
| `src/r2-s3.ts` / `src/r2-object-store-adapter.ts` | The SigV4 S3 client + write-once object-store adapter |
| `src/composition.ts` | The composition boundary (env → adapters + evidence surfaces) |

The deterministic suites live in `tests/real-persistence`; the
env-gated real journeys (`RUN_REAL=1`) record honest outcomes —
including failures — as evidence.
