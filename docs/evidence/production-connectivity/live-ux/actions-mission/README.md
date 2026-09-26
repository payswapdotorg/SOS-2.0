# P18-B Evidence — Live Actions + Mission UX

Work Order: **P18-B** (Live UX wave, lane B of 3: live actions + mission UX).
Base: `3717b6c`. Lane branch: `wo/p18b-live-actions-mission-ux`.

Everything in this directory is machine-readable evidence produced by the
P18-B suites. Deterministic reference-mode evidence (88 tests, fixed seed
424242, run-to-run identical) lives in `tests/live-ux/actions`; the records
here are the REAL-integration outcomes (`RUN_REAL=1`, honest — including
provider refusals). Credentials are referenced by environment-variable
NAMES only; transcripts and records are redacted through BOTH merged
corpora (the P17-C observation corpus + the P17-A deployment corpus) before
any file is written, and the committed output is re-verified clean
(fail-closed).

## What this lane delivered

The P17-C live Mission experience is now the REAL production Mission
surface, and its consequential actions execute for real:

- `/mission` (REPLACED — the operator's structural fix) and `/live-mission`
  mount the P17-C `LiveMissionPage` through the **live-mission data seam**
  (`apps/web/app/live-mission/data-seam.ts` — the architect-defined
  binding; honest `'unwired'` empty state until lane P18-A's producer
  lands).
- `LIVE_ACTION_ENDPOINT` = **`/api/live-mission/actions`** (MOUNTING.md
  step 2): typed action submissions validated + executed through the
  merged `@sos-2/action-gateway` (authority re-evaluated at action time,
  fail-closed), ASK envelopes through the merged `@sos-2/ask`
  `AskQueue.resolve()`, deterministic envelope completion (same form ->
  same derived idempotency key), typed receipts.
- Receipts render server-side (POST-redirect-GET to `/mission/receipt`,
  plus a key-validated receipt round-trip cookie for the serverless
  multi-instance reality) with evidence/rationale links, the authority
  decision, the idempotency scope (in-process; NO durable confirmation
  claimed) and the safe-failure / denied-action UX.

## The honest states (the program-defining rule)

| Provider | State | The real evidence |
| --- | --- | --- |
| **Vercel (deployment)** | `CONNECTED` | The authenticated probe (`GET /v2/user` 200), the project (sos-2-0, repoId 1377439399, apps/web root, closure build command), and a **REAL deployment of this branch** — [`deployment-record.json`](./deployment-record.json). |
| **Vercel (deployment CREATION from the deployed endpoint)** | `UNAVAILABLE` (HTTP 403 from the function context) | The promotion/rollback actions reached the provider AFTER the action-time authority grant and were refused — recorded verbatim as typed honest receipts (see below). The same token from outside answers 200 (reads) / 402 (creation quota). Diagnosis + the lane-scoped env binding for the rerun are in the records. |
| **GitHub (revision binding)** | `CONNECTED` | `GET /repos/payswapdotorg/SOS-2.0/commits/<sha>` 200 inside the executor seam — every acted-on revision is real; the receipts carry the commit URL. |
| **OpenRouter (body provider)** | `CONNECTED` | A REAL `POST /chat/completions` 200 inside the `body.start` executor (model `meta-llama/llama-3.3-70b-instruct` — region-available; `openai/gpt-4o-mini` answers 403 in this region, recorded honestly). |
| **Neon / Upstash (durable idempotency + receipts)** | `UNAVAILABLE` (DNS) | The known P17-A fact: no durable confirmation is claimed anywhere; the in-process idempotency/receipt scope is stated on every receipt. |
| **ASK plane (deployed)** | honestly unwired | No ask producer is wired on this branch: a deployed resolution answers the typed `ASK_ENTRY_UNKNOWN` failure — never a fabricated resolution; the real queue contract is proven locally through the same envelope shape. |

**The account deployment quota** (100/day, Hobby) was exhausted during this
run (`402 payment_required`, reset `2026-09-27T15:51Z`): after the reset,
rerun the suite (below) for a fresh exact-head deployment and the full real
promotion/rollback journeys.

## Records

| File | What it records |
| --- | --- |
| [`real-live-actions.json`](./real-live-actions.json) | The action receipts transcripts: every consequential action type — envelope in, authority decision, receipt out (evidence ids, provider outputs), idempotency proof — against the DEPLOYED preview URL over real HTTP. Real outcomes: body summon SUCCEEDED (OpenRouter-backed, authority granted at action time); idempotent replay (the same envelope -> the recorded receipt, the provider NOT invoked again); denied action (GRANT_NEVER_HELD, fail-closed, executor never invoked); promotion/rollback typed honest provider refusals (HTTP 403 from the function context); ASK resolution honest failures + the local real-queue resolution contract. |
| [`deployment-record.json`](./deployment-record.json) | The deployment record (P3 registrar shape): revision `dpl_BFvUARnpuK9otSSCwsEBSdpXR9Xd`, exact `source_revision_sha` `1dab86017cbb4f5d6274a891a998129443a31f56` (a commit of this branch; `git merge-base`-verified ancestor of the suite head), URL `sos-2-0-jyo3p5xz3-ekonplacidegmailcoms-projects.vercel.app` (HTTP 200, serves the live mission experience), project ids, rollback pointer `dpl_4ajdk7WFtpJ69xzgUw7wea47g1Xj` (the prior production deployment, sha `3717b6c…` — the base). |
| [`journey-steps.json`](./journey-steps.json) | The chronological journey log (machine-readable, honest ok/false per step). |
| [`secrets-audit.json`](./secrets-audit.json) | The committed lane secrets audit: 38 files scanned, **0 secret-shaped findings** (pattern ids + scope only — never matched text). |
| [`ARCHITECTURE-DELTA.json`](./ARCHITECTURE-DELTA.json) | The architecture delta for the lane (validates against `spec/contracts/architecture-delta.schema.json`; `work_order: P18-B`). |

## The binding invariants (pinned by the deterministic suite, proven real here)

- **Authority at action time, fail-closed**: the deployed endpoint
  re-evaluates the CURRENT env-configured grants per submission; the
  never-held `console-observer` grant fails CLOSED (DENIED, executor never
  invoked, evidence-bound denial) — a REAL denied receipt is in the
  transcripts.
- **Idempotency**: the same envelope replays the recorded original receipt
  (REAL: the deployed instance answered `replayed` — the provider was not
  invoked again). The scope is in-process (durable adapters UNAVAILABLE) —
  stated on every receipt, never claimed durable.
- **No fabricated state**: provider refusals are typed honest failures with
  the real HTTP status recorded verbatim; UNKNOWN stays UNKNOWN; the ask
  plane answers its honest unwired failure.

## How to reproduce

```bash
corepack enable && corepack prepare pnpm@10.0.0 --activate
pnpm install --frozen-lockfile
node scripts/verify-repo.mjs && node scripts/verify-productization.mjs
pnpm -r --if-present build
pnpm -r --if-present test                 # deterministic reference mode (104 suites)

node tests/live-ux/actions/scripts/secret-scan.mjs \
  --json-out docs/evidence/production-connectivity/live-ux/actions-mission/secrets-audit.json

# The REAL journey (env-gated; values NEVER committed — names only).
# Deploys the exact branch head to the Vercel project, then submits the
# real actions against the deployed preview URL:
RUN_REAL=1 \
VERCEL_TOKEN=… VERCEL_PROJECT_ID=prj_ad9K6nw6F4zlpg4bmlZi9HQyNhvQ \
VERCEL_ORG_ID=team_4KOoA5CgtYaOF85yFXPeMXLt \
GITHUB_ACCESS_TOKEN=… BODY_PROVIDER_API_KEY=… \
pnpm --filter @sos-2/tests-live-ux-actions run test:real

# Against an ALREADY-deployed preview (skips the deployment; verifies the
# existing exact-branch deployment binding instead):
RUN_REAL=1 LIVE_MISSION_BASE_URL=https://<preview>.vercel.app … env … \
pnpm --filter @sos-2/tests-live-ux-actions run test:real
```

The deployed runtime binding is env-only on the Vercel project
(`VERCEL_TOKEN`, `GITHUB_ACCESS_TOKEN`, `BODY_PROVIDER_API_KEY`,
`SOS_LIVE_MISSION_GRANTS`, `SOS_LIVE_MISSION_BODY_MODEL`,
`SOS_LIVE_MISSION_VERCEL_*` — encrypted for credentials; the lane-scoped
`SOS_LIVE_MISSION_VERCEL_TOKEN`/`_PROJECT_ID` names are preferred by the
deployed host after the `VERCEL_TOKEN` name-collision observation).

## Delivery addendum (the PR gate)

- PR: payswapdotorg/SOS-2.0#41 (branch `wo/p18b-live-actions-mission-ux`, base `3717b6c`).
- The repository-contract check (`SOS repository verification` — verify.yml,
  `node scripts/verify-repo.mjs && node scripts/verify-productization.mjs`)
  passes on this head locally (recorded above). The parallel-lane PR carries
  the expected lockfile/workspace conflicts with main (P18-A/P18-C landed in
  parallel on disjoint owned paths; the architect's A→B→C integration
  reconciles them — no worker merges upstream).
- `deploy-contract.yml` fails REPO-WIDE, including on the base commit
  `3717b6c` itself and on main (verified through the Actions API at
  delivery time) — a pre-existing condition, not a regression of this lane.
