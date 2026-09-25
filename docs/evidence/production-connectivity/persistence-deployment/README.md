# P17-A Evidence — Real Persistence + Deployment

Work Order: **P17-A** (Production Connectivity, persistence/deployment
lane). Base: `4238341`. Lane branch: `wo/p17a-real-persistence`.

Everything in this directory is machine-readable evidence produced by
the env-gated REAL-provider integration suite (`RUN_REAL=1`) or by
honest probes. Deterministic reference-mode evidence (scripted
providers, run-to-run identical, fixed seed 424242) lives in
`tests/real-persistence` (66 tests). Credentials are referenced by
environment-variable NAMES only; transcripts are redacted
(Authorization → env-name references; bodies through the dual lane
redaction corpora, pattern ids only, never values).

## The honest states (the program-defining rule)

| Provider | State | The real evidence |
| --- | --- | --- |
| **Vercel** | `CONNECTED` | The authenticated token probe (`GET /v2/user`), team discovery, the git-linked project `sos-2-0` (repo `payswapdotorg/SOS-2.0`, rootDirectory `apps/web`, framework `nextjs`, region `iad1`), and a **REAL deployment of the exact branch head** — see [`vercel-deployment.json`](./vercel-deployment.json). |
| **Cloudflare R2** | `CONNECTED` | The SigV4-signed S3 API (ListBuckets / CreateBucket / HeadBucket / PutObject / GetObject / HeadObject / DeleteObject) — the write-once object journey, byte-exact read-back, the honest 404 failure path and the retention-path delete — see [`r2-integration.json`](./r2-integration.json). |
| **Neon** | `UNAVAILABLE` | The REAL failure recorded verbatim: `api.neon.tech` does not resolve from the execution environment (`transport failure … fetch failed`, DNS). The provisioning journey honestly did not proceed (no project created, no SQL roundtrip attempted, no fabricated success) — see [`neon-integration.json`](./neon-integration.json). |
| **Upstash** | `UNAVAILABLE` | The REAL failure recorded verbatim: the REST endpoint `meet-ewe-145933.upstash.io` does not resolve (`NXDOMAIN`). The coordination roundtrip and the never-canonical proof against the real Redis honestly did not run; the deterministic suite pins the invariant offline — see [`upstash-integration.json`](./upstash-integration.json). |

Aggregate: [`provider-states.json`](./provider-states.json) (derived by
`infra/production-connectivity/scripts/summarize-provider-states.mjs`).

A provider outage is **valid evidence** — recorded as `UNAVAILABLE`
with the real failure, never a silent skip, never a fabricated
`CONNECTED`.

## Records

| File | What it records |
| --- | --- |
| [`vercel-deployment.json`](./vercel-deployment.json) | The REAL deployment of `apps/web` from the EXACT git head `b5938ea4654144df287ce3e907389fc1f911ccf6` (gitSource `{type:'github', repoId:1377439399, ref:<sha>}` — the verified v13 protocol): deployment revision `dpl_BVGQujQjFnmyW6yEzkQF1u6oZi2Q`, READY, preview URL **https://sos-2-0-91mffwr2s-ekonplacidegmailcoms-projects.vercel.app** (HTTP 200, serves the SOS Console), the binding VERIFIED (`observed_commit_sha === requested sha`), 9 readiness polls (~63 s). The frozen `DeploymentRecord` (minted through `createDeployment`, `artifact_revision` = git-sha of the exact head), the P3 registrar-shaped revision record (region `iad1`, rollback pointer to `dpl_7WGZGQC27VVX6xgy4FDSmJJYBuWU` — the prior deployment of this lane), the truthful `DeploymentOutcome` (SUCCESS) and the frozen `DeploymentStore` lifecycle (PLANNED → DEPLOYED, `statusOf` = SUCCESS). Full redacted request/response transcript (team id `team_4KOoA5CgtYaOF85yFXPeMXLt`). |
| [`r2-integration.json`](./r2-integration.json) | The write-once object journey in bucket `sos20-evidence-prod` (S3 endpoint `https://7e333607c4ceeef5d092be1bb94108bf.r2.cloudflarestorage.com`, SigV4 region `auto`): bucket provisioned (first probe → honest 404 → CreateBucket → re-probe CONNECTED), a 1-byte probe object + the P17-A evidence-bundle object under `production/evidence/<sha256>` (the P3 `r2ObjectKey` contract), byte-exact read-back, idempotent re-put (identical bytes → the identical ref), the honest 404 failure path (absent content hash → null), and the DOCUMENTED retention-path delete of the probe object. The evidence bundle remains in the bucket as durable write-once evidence. |
| [`neon-integration.json`](./neon-integration.json) | The honest `UNAVAILABLE` record: the management-API probe (`GET https://api.neon.tech/api/v2/users/me` with `NEON_API_KEY`) failed at the transport level (the hostname does not resolve from this execution environment); provisioning/SQL/cleanup honestly not attempted. The adapter and the full provisioning journey (project → tier-named branch `main` + database `sos` per the P3 naming contract → pooled connection string → real SQL roundtrip through the frozen `PostgresStoreAdapter`) are implemented and reference-mode tested; they will run whenever the provider is reachable. `DATABASE_URL` is never a committed value. |
| [`upstash-integration.json`](./upstash-integration.json) | The honest `UNAVAILABLE` record: the PING probe failed at the transport level (`meet-ewe-145933.upstash.io` does not resolve — NXDOMAIN); the coordination roundtrip and the never-canonical proof (flush → durable state intact) honestly not run against the real Redis. The full journey is implemented (tier-prefixed `sos:production:*` keys, P3 TTL policy, atomic lease release via EVAL, namespaced `flushAll`) and reference-mode tested; the never-canonical invariant is pinned deterministically offline. |
| [`provider-states.json`](./provider-states.json) | The aggregate honest states for all four providers (derived from the records above). |
| [`secrets-audit.json`](./secrets-audit.json) | The committed output of the lane secrets audit: 58 files scanned across the owned paths, **0 secret-shaped findings** (pattern ids + positions only — never matched text). |
| [`ARCHITECTURE-DELTA.json`](./ARCHITECTURE-DELTA.json) | The architecture delta for the lane (validates against `spec/contracts/architecture-delta.schema.json`; work order `P17-A`). |

## Connectivity facts observed (quotas/identities)

- **Vercel** (Hobby): team `team_4KOoA5CgtYaOF85yFXPeMXLt` (slug
  `ekonplacidegmailcoms-projects`); project `prj_ad9K6nw6F4zlpg4bmlZi9HQyNhvQ`
  (`sos-2-0`); GitHub link `payswapdotorg/SOS-2.0` (repoId `1377439399`,
  gitCredential `cred_26dd4440…`); node `24.x`; region `iad1`; rate-limit
  headers observed (`x-ratelimit-limit: 1000` per window on the reads).
  Deployments expire after 30 days (project `deploymentExpiration`).
- **Cloudflare R2** (Free): account `7e333607c4ceeef5d092be1bb94108bf`;
  bucket `sos20-evidence-prod` created this run (ListBuckets 200 — the
  account's other buckets are unrelated projects); S3 API revision
  `2006-03-01` (the S3 XML namespace).
- **Neon** (Free): the management API hostname `api.neon.tech` has no A
  record resolvable from this execution environment (verified against
  public recursive resolvers) — recorded `UNAVAILABLE`; no project was
  provisioned (smallest honest footprint).
- **Upstash** (Free): the REST endpoint hostname does not resolve
  (NXDOMAIN) — recorded `UNAVAILABLE`; no coordination state was
  written.

## How to reproduce

```bash
corepack enable && corepack prepare pnpm@latest-10 --activate
pnpm install --frozen-lockfile
node scripts/verify-repo.mjs && node scripts/verify-productization.mjs
pnpm -r --if-present build
pnpm -r --if-present test                      # deterministic reference mode (108 packages)
node infra/production-connectivity/scripts/check-zero-deps.mjs
node infra/production-connectivity/scripts/secret-scan.mjs

# The REAL-provider journeys (env-gated; values NEVER committed):
RUN_REAL=1 \
NEON_API_KEY=… NEON_API_KEY_SECONDARY=… \
UPSTASH_REDIS_REST_URL=… UPSTASH_REDIS_REST_TOKEN=… \
R2_ACCOUNT_ID=… R2_ACCESS_KEY_ID=… R2_SECRET_ACCESS_KEY=… \
R2_S3_ENDPOINT=… R2_BUCKET_NAME=sos20-evidence-prod \
VERCEL_TOKEN=… \
pnpm --filter @sos-2/tests-real-persistence test

# Refresh the summaries after the journeys:
node infra/production-connectivity/scripts/summarize-provider-states.mjs
node infra/production-connectivity/scripts/secret-scan.mjs \
  --json-out docs/evidence/production-connectivity/persistence-deployment/secrets-audit.json
```

The deterministic suites (offline, fixed seed 424242) live in
`tests/real-persistence` (66 tests) plus the package-local structure
suites (5 + 5 + 5). They pin the frozen-contract compliance, the
honest-state machine, the P3 structural alignment, the redaction + SigV4
discipline, the Vercel record minting and the never-canonical invariant
without any network.
