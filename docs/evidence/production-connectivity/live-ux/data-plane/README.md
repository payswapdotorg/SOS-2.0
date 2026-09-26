# P18-A Evidence — Live Data Plane + Persistence/Deployment Integration

Work Order: **P18-A** (Live UX, lane A of 3 — the live data plane).
Base: `3717b6c`. Lane branch: `wo/p18a-live-data-plane`.

Everything in this directory is machine-readable evidence produced by the
env-gated REAL-provider integration suite (`RUN_REAL=1`) of
`tests/live-ux/data-plane` — the same data-plane module the architect's
live-mission seam will call (`apps/web/live-data/src/producer.ts` →
`createLiveMissionDataProducer()`). Credentials are referenced by
environment-variable NAMES only (the P3 typed registry:
`GITHUB_ACCESS_TOKEN`, `VERCEL_TOKEN`, `VERCEL_PROJECT_ID`,
`NEON_API_KEY`, `UPSTASH_REDIS_REST_URL`/`_TOKEN`, `R2_*`);
records are canonical JSON redacted through all three lane corpora
(persistence + deployment + observation — fail-closed).

## The honest states (the program-defining rule)

| Provider | State | The real evidence |
| --- | --- | --- |
| **GitHub** (repo events + CI + repo-head probe) | `CONNECTED` | The real REST drain with the PAT: 64 observation events applied in one drain; the observed `main` head `3717b6ccac…` **matches the repository head at the run**; branch heads for `main`, `wo/p15a-product-dogfood-lane`, `wo/p17c-real-observation-ux`; 8 open pull requests (#31–#38); CI latest runs carried verbatim (`SOS repository verification` → `SUCCESS` on the head; `.github/workflows/deploy-contract.yml` → `FAILURE` on the head — an honest `CI_FAILING_ON_HEAD` detection, never folded) — see [`real-drain.json`](./real-drain.json). |
| **Vercel** (deployment state + source SHA) | `CONNECTED` | The real `/v6/deployments` read (vercel.v6): 12 deployment records with their EXACT `source_revision_sha` values; the latest production deployment `dpl_4ajdk7WFtpJ69xzgUw7wea47g1Xj` is **bound VERIFIED to the observed head** (`source_revision_sha === 3717b6ccac…`); the org id `team_4KOoA5CgtYaOF85yFXPeMXLt` discovered through the authenticated `/v2/user` probe — see [`vercel-org.json`](./vercel-org.json). |
| **Cloudflare R2** | `CONNECTED` | The frozen P17-A startup probe through the real SigV4-signed S3 adapter (HeadBucket on `sos20-evidence-prod`) answered OK — see [`r2-connectivity.json`](./r2-connectivity.json). |
| **Neon** (canonical durable store) | `UNAVAILABLE` (management API) / `UNKNOWN` (durable adapter) | The exact DNS facts recorded verbatim: `getaddrinfo ENOTFOUND api.neon.tech` (the management-API probe with `NEON_API_KEY` failed at the transport level — provisioning cannot proceed, the P17-A record continued); **no `DATABASE_URL` exists** (Neon was never provisioned), so the durable adapter stays honestly unattached (`UNKNOWN — never fabricated`). The selection degrades to the EXPLICIT reference store: `store_ref = reference:in-memory-observation-store`, NOTHING persisted — see [`neon-management-probe.json`](./neon-management-probe.json) + [`provider-states.json`](./provider-states.json). |
| **Upstash** (coordination only — never canonical) | `UNAVAILABLE` | The REST probe failed at the transport level with the exact DNS fact: `getaddrinfo ENOTFOUND meet-ewe-145933.upstash.io` (NXDOMAIN); the coordination store is never promoted — the never-canonical rule holds — see [`provider-states.json`](./provider-states.json). |

Aggregate selection this run: **REFERENCE_FALLBACK** with
`store_ref: reference:in-memory-observation-store` — the canonical store
did not answer a real probe, so live mission data is served from the
reference in-memory observation store, **explicitly NOT production
durable state** (machine-checkable: the store view carries
`reference_mode: true` + the degradation note; the provenance matrix
marks every store-served field `REFERENCE_IN_MEMORY`; the snapshot
durability records `persisted: false`).

A provider outage is **valid evidence** — recorded as `UNAVAILABLE`
with the real failure, never a silent skip, never a fabricated
`CONNECTED`.

## Records

| File | What it records |
| --- | --- |
| [`provider-states.json`](./provider-states.json) | The durable-store selection (mode, canonical/coordination states with the real failures, the store_ref) + every provider row (neon / upstash / r2 / vercel) + every observation source's honest state with probe evidence (api revisions, last errors, probe instants). |
| [`real-drain.json`](./real-drain.json) | The REAL observation drain through the data plane: the drained snapshot (branch heads matching the repo head, open PRs, CI runs verbatim, deployment observation), the real Vercel deployment-state read (12 records, exact `source_revision_sha` values), the reconciliation findings (`deploy:environment:production` ALIGNED — the production claim reconciles against the observed deployment), the honest detections (`CI_FAILING_ON_HEAD`), the snapshot durability (NOT persisted — reference mode), 64 events in window. |
| [`producer-provenance.json`](./producer-provenance.json) | **The producer provenance record**: for every field the live-mission DTO carries — which store/plane produced it, at which revision, with which honest state (the full provenance matrix: `storeRef`, `asOf`, `drainedAt`, `sources`, `eventsInWindow`, `repository.branchHeads`, `repository.openPullRequests`, `ci.latestByPipeline`, `deployments.byEnvironment`, `providerHealth`, `findings`, `detections`, `deployments.sourceRevisionShaBinding`) + the authoritative-store view + the deployment/source-SHA binding verdict (VERIFIED) + the snapshot durability. |
| [`neon-management-probe.json`](./neon-management-probe.json) | The honest Neon record: the management-API probe (`GET https://api.neon.tech/api/v2/users/me` with `NEON_API_KEY`) `UNAVAILABLE` with the real transport failure + the exact DNS facts (`ENOTFOUND api.neon.tech`, `ENOTFOUND meet-ewe-145933.upstash.io`) + the honest `DATABASE_URL` absence. |
| [`r2-connectivity.json`](./r2-connectivity.json) | The frozen P17-A startup probes through the real adapters: Neon unattached (`attached: false` — no `DATABASE_URL`, honestly not probed), Upstash PING probed and failed (NXDOMAIN), R2 HeadBucket OK through the SigV4-signed S3 adapter, Vercel `/v2/user` OK. |
| [`vercel-org.json`](./vercel-org.json) | The Vercel org/team id discovery through the authenticated `/v2/user` probe (`team_4KOoA5CgtYaOF85yFXPeMXLt` — the `VERCEL_ORG_ID` topology record; provider state CONNECTED after the probe). |
| [`secrets-audit.json`](./secrets-audit.json) | The committed output of the lane secrets audit: 39 files scanned across the owned paths, **0 secret-shaped findings** (pattern ids + positions only — never matched text). |
| [`ARCHITECTURE-DELTA.json`](./ARCHITECTURE-DELTA.json) | The architecture delta for the lane (the frozen 8-key schema; work order `P18-A`). |

## What the data plane is (the lane summary)

`apps/web/live-data` (the server-only module) + the
`@sos-2/infra-production-connectivity` extension
(`src/live-data-wiring.ts`) + the `packages/web-contracts/live`
subpackage (the pure projections): one bounded honest pass per live
mission request —

1. **Durable-store selection** behind the frozen P17-A adapters: REAL
   probes of the canonical Neon adapter (attached only when
   `DATABASE_URL` exists) and the coordination-only Upstash adapter
   (NEVER canonical — the frozen provider-ports rule carried verbatim).
   `PRODUCTION_DURABLE` only on a CONNECTED canonical probe; every
   other honest state degrades to the explicit `reference:` marker.
2. **The real Vercel deployment-state read**: the deployment records
   with their EXACT `source_revision_sha` (the frozen client mapping),
   latest-by-target, and the deployment/source-SHA binding verdict
   (`VERIFIED` / `DIVERGED` / `NO_DEPLOYMENT` / `UNAVAILABLE` —
   difference only, ordering never claimed).
3. **The real observation drain** (the merged P17-C
   `createRealObservationPlane`): GitHub repo/CI observation, Vercel
   deployment events, runtime telemetry, scheduled probes where
   coverage is insufficient, provider health — WITHOUT a body (§5) —
   with the claims port built from the REAL reads (the production
   deployment claim + the durable previous-snapshot claim).
4. **The snapshot durability binding**: when (and only when) the
   canonical store is CONNECTED, the observation snapshot persists to
   it (`putRow` + read-back at the EXACT storage version); in reference
   mode NOTHING is persisted.
5. **The data-plane view** (pure, deterministic projections): the
   authoritative store, the provider rows, the per-field provenance
   matrix, the deployment binding, the durability record — with the
   fail-closed validator (reference separation is machine-checked).

## How to reproduce

```bash
corepack enable && corepack prepare pnpm@10.0.0 --activate
pnpm install --frozen-lockfile
node scripts/verify-repo.mjs && node scripts/verify-productization.mjs
pnpm -r --if-present build
pnpm -r --if-present test        # deterministic reference mode (4027 tests, exit 0)

# The REAL-provider data-plane run (env-gated; values NEVER committed —
# the P3 typed-registry NAMES; no DATABASE_URL exists: Neon was never
# provisioned — api.neon.tech is DNS-unreachable, recorded honestly):
RUN_REAL=1 \
GITHUB_ACCESS_TOKEN=… VERCEL_TOKEN=… VERCEL_PROJECT_ID=… \
NEON_API_KEY=… \
UPSTASH_REDIS_REST_URL=… UPSTASH_REDIS_REST_TOKEN=… \
R2_ACCOUNT_ID=… R2_ACCESS_KEY_ID=… R2_SECRET_ACCESS_KEY=… \
R2_S3_ENDPOINT=… R2_BUCKET_NAME=sos20-evidence-prod \
NEON_DATABASE_NAME=sos NEON_BRANCH_NAME=main \
pnpm --filter @sos-2/tests-live-ux-data-plane test

# Refresh the lane secrets audit after the run:
node tests/live-ux/data-plane/scripts/secret-scan-live-ux.mjs \
  --json-out docs/evidence/production-connectivity/live-ux/data-plane/secrets-audit.json
```

The deterministic suites (offline, fixed seed 424242) live in
`tests/live-ux/data-plane` (39 tests + the 19-test
`packages/web-contracts/live` suite + the 16-test
`infra/production-connectivity` live-data-wiring suite) — they pin the
six work-order scenarios (connected store; unavailable store; stale
observations; partial providers; no-data; replay/reconciliation) plus
the seam producer contract, with every projection carrying provenance.
