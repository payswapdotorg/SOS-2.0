# P18-INT Evidence — The Architect Integration Pass (the A→B→C seam)

Work Order: **P18-INT** (the architect integration pass: the seam swap, the
ungated route journeys, the strictly separated integration suites, the
evidence package).
Base: `c2dc1ac` (main, post P18-A/B/C lane merges — PRs #39/#41/#40).
Branch: `wo/p18-integration`.

Everything in this directory is machine-readable evidence produced by the
P18-INT suites. Deterministic evidence (35 integrated tests + 88 actions
tests + 124 journey tests, fixed seed 424242, run-to-run identical) lives in
`tests/live-ux/integration`; the records here are the REAL-integration
outcomes (`RUN_REAL=1`, honest — including the credential gaps of the
delivery environment). Credentials are referenced by environment-variable
NAMES only; transcripts and records are redacted through BOTH merged
corpora (the P17-C observation corpus + the P17-A deployment corpus) before
any file is written, and the committed output is re-verified clean
(fail-closed: [`secrets-audit.json`](./secrets-audit.json), 0 findings).

## What this pass delivered

The three merged P18 lanes are now ONE coherent live product:

- **THE SEAM SWAP**: `apps/web/app/live-mission/data-seam.ts` —
  `getLiveMissionData()` now composes lane P18-A's real producer
  (`createLiveMissionDataProducer`, composed ONCE at module scope) instead
  of returning the honest `'unwired'` placeholder. Every mission surface
  (`/mission`, `/live-mission`) renders the REAL observed state through
  this one function. See [`seam-swap-record.md`](./seam-swap-record.md) +
  [`provenance-matrix.json`](./provenance-matrix.json).
- **THE UNGATED ROUTE JOURNEYS**: lane C's
  `tests/live-ux/journeys/90-route-full-path` suites run unconditionally
  (the `requires-p18b-mount` capability gates are removed — the P18-B
  mounts are merged on main).
- **THE STRICTLY SEPARATED INTEGRATION SUITES**:
  `tests/live-ux/integration` (the NEW workspace package
  `@sos-2/tests-live-ux-integration`) — the deterministic integrated
  full-path suite (35 tests, offline, the seam scripted through a producer
  mock at the module boundary — the app files are never touched) + the
  env-gated `RUN_REAL=1` real integration suite (12 tests, default OFF).

## THE FLAGGED DEVIATION (cross-owned-path; architect ruling requested)

The work order mandates BOTH the seam swap (§1) and a green full suite
(§3). Empirically the swap obsoletes exactly three pins in lane B's frozen
`tests/live-ux/actions/test/mount-seams.test.tsx` — the pre-swap assertions
`storeRef === 'unwired'`, `asOf === 'never'`, and byte-equal per-call
results. That file is a P18-B owned path OUTSIDE the P18-INT owned surface;
the minimal mechanical adjustment was made with equal assertion strength
(the explicit reference-store marker, a real RFC3339 probe instant,
structural determinism) and is flagged for the architect's ruling in the
completion report. Every other assertion in that file is byte-identical to
the P18-B delivery. The architect may revert/re-pin in one commit.

## The honest states (the program-defining rule)

| Provider | State (this run) | The real evidence |
| --- | --- | --- |
| **The seam** | **LIVE (real producer)** | [`real-data-plane.json`](./real-data-plane.json): one bounded honest data-plane pass through the SAME function the seam composes; the seam contract test verified `getLiveMissionData()` answers the real selection's store identity. |
| **Neon** (canonical durable store) | `UNAVAILABLE` (real transport failure) | The probe failed at the transport level with the verbatim fact (`transport failure for POST https:///sql: fetch failed` — no `DATABASE_URL` exists, Neon was never provisioned; the same DNS-unreachability family the P17-A/P18-A lanes recorded). The selection degrades to the EXPLICIT reference marker — never masquerading as production durable state. |
| **Vercel** | `UNKNOWN` (no token) | No `VERCEL_TOKEN` in the delivery environment — the honest state, never fabricated. The free-tier build-rate limit had RECOVERED as of 2026-09-26T10:39Z (last deployment READY, per the P18-B evidence); the CURRENT state must be reported at run time by the credentialed re-run — it can re-trip. |
| **GitHub / R2 / Upstash / OpenRouter** | `UNKNOWN` (never probed / no credentials) | Honest `UNKNOWN` with the reason carried verbatim; `missingEnv` lists the env NAMES only. |

A provider outage or a missing credential is **valid evidence** — recorded
with the real failure, never a silent skip, never a fabricated
`CONNECTED`. The delivery environment carried NO provider credentials
(env NAMES only), so the RUN_REAL=1 execution recorded here is the HONEST
PARTIAL run: the two credential-free steps (the real data-plane pass + the
real seam contract) passed and are recorded; the ten credential steps
failed FAST with their reasons in [`journey-steps.json`](./journey-steps.json).
The full provider journeys (the exact-head deployment, the deployed-surface
probes through the real seam, the real consequential actions) are delivered
in the suite and run with the operator's credential set via the commands
below — overwriting these records with the full journey, bound to that
run's exact head.

## Records

| File | What it records |
| --- | --- |
| [`real-data-plane.json`](./real-data-plane.json) | The REAL data-plane pass (the same function the seam composes): the durable-store selection (mode, canonical/coordination states with the real failures, the store_ref), the Vercel deployment-state read, the provider-health rows, the snapshot durability, the full data-plane view (the per-field provenance projections) and the DTO summary. |
| [`journey-steps.json`](./journey-steps.json) | The chronological RUN_REAL journey log: the honest provider-composition skip, the real data-plane pass, the real seam contract, and the ten honest credential-required failures (env NAMES only). |
| [`action-receipts.json`](./action-receipts.json) | The HTTP transcripts + receipts record (empty of transcripts in this run — the credential-free steps make no submissions; the schema + honesty notes state the contract the credentialed re-run fills). |
| [`seam-swap-record.md`](./seam-swap-record.md) | The seam swap diff record: the exact before/after of `apps/web/app/live-mission/data-seam.ts` with the provenance semantics of each side. |
| [`provenance-matrix.json`](./provenance-matrix.json) | The per-field provenance matrix: which DTO field comes from which real source, with the reference vs production separation made explicit per row. |
| [`journey-results.json`](./journey-results.json) | The eight mandatory route-level journeys: the level verified, the real-vs-reference posture, and the honest gaps. |
| [`secrets-audit.json`](./secrets-audit.json) | The committed output of the lane secrets audit: 20 files scanned across the P18-INT owned paths, **0 secret-shaped findings** (pattern ids only — never matched text). |
| [`ARCHITECTURE-DELTA.json`](./ARCHITECTURE-DELTA.json) | The architecture delta for the pass (the frozen 8-key schema; work order `P18-INT`). |

## How to reproduce

```bash
corepack enable && corepack prepare pnpm@10.0.0 --activate
pnpm install --frozen-lockfile
node scripts/verify-repo.mjs && node scripts/verify-productization.mjs
pnpm -r --if-present build
pnpm -r --if-present test        # deterministic suites only (the real suite stays OFF)

# The DETERMINISTIC integrated suite alone:
pnpm --filter @sos-2/tests-live-ux-integration run test:reference

# The REAL-integration suite (env-gated; default OFF; values NEVER
# committed — the P3 typed-registry NAMES):
RUN_REAL=1 \
GITHUB_ACCESS_TOKEN=… VERCEL_TOKEN=… VERCEL_PROJECT_ID=… \
BODY_PROVIDER_API_KEY=… \
NEON_API_KEY=… NEON_DATABASE_NAME=sos NEON_BRANCH_NAME=main \
UPSTASH_REDIS_REDIS_REST_URL=… UPSTASH_REDIS_REST_URL=… UPSTASH_REDIS_REST_TOKEN=… \
R2_ACCOUNT_ID=… R2_ACCESS_KEY_ID=… R2_SECRET_ACCESS_KEY=… \
R2_S3_ENDPOINT=… R2_BUCKET_NAME=sos20-evidence-prod \
pnpm --filter @sos-2/tests-live-ux-integration run test:real

# Refresh the lane secrets audit after the run:
node tests/live-ux/integration/scripts/secret-scan.mjs \
  --json-out docs/evidence/production-connectivity/live-ux/integration/secrets-audit.json
```

The RUN_REAL suite deploys the exact branch head to the Vercel project
(`gitSource` ref = HEAD; retries for the fresh-push GitHub index
propagation) and submits the real consequential actions against the
deployed preview URL; set `LIVE_MISSION_BASE_URL` to instead re-verify an
existing READY deployment of the branch (the P18-B quota-exhaustion
precedent). Without any credentials the suite still runs its two
credential-free steps honestly (the data-plane pass + the seam contract)
and fails the credential steps fast with their reasons — exactly the
record committed here.

## The suites summary

| Suite | Tests | Posture |
| --- | --- | --- |
| `tests/live-ux/integration` deterministic (seam 8 / journeys 15 / invariants 12) | 35 | offline, seed 424242, run-to-run identical — executed green at the delivery head |
| `tests/live-ux/integration` real (`RUN_REAL=1`) | 12 | env-gated, default OFF — executed honestly in the credential-less delivery environment: 2 passed (the seam steps), 10 failed fast with the honest credential reasons; the full journey requires the operator credential set |
| `tests/live-ux/journeys` (lane C, ungated) | 124 | offline, seed 424242 — green (125 minus the removed always-run gate-state probe) |
| `tests/live-ux/actions` (lane B) | 88 | offline, seed 424242 — green with the three flagged re-pins |
