# P18-B Evidence — Live Actions + Mission UX

Work Order: **P18-B** (Live UX, lane B of 3 — live actions + mission UX).
Base: `3717b6c`. Lane branch: `wo/p18b-live-actions-mission-ux`.

Everything in this directory is machine-readable evidence: the deployed
revision record (§4), the RUN_REAL action receipts against the deployed
preview URL, the HTTP transcripts, the honest provider states at runtime,
and the secrets audit. Credentials are referenced by environment-variable
NAMES only (the P3 typed registry: `GITHUB_ACCESS_TOKEN`, `VERCEL_TOKEN`,
`VERCEL_PROJECT_ID`, `VERCEL_ORG_ID`, `BODY_PROVIDER_API_KEY`,
`BODY_PROVIDER_MODEL`, `LIVE_MISSION_GRANTS`); no credential value appears
in any committed file (the secrets audit proves it).

## What this lane delivered

1. **The route mounts (the operator's structural fix).** The read-only
   Mission view is REPLACED by the P17-C live Mission experience:
   `apps/web/app/mission/page.tsx` (the production Mission route) and
   `apps/web/app/live-mission/page.tsx` (the MOUNTING.md mount) both render
   `LiveMissionPage` through the architect-defined data seam
   (`apps/web/app/live-mission/data-seam.ts` — one function, one file,
   whose honest default is the UNWIRED empty state: lane A's producer lands
   through the architect's integration pass). Start mission / Import
   system / Resume mission + the first-class onboarding entry are live;
   the consequential action forms POST to the mounted endpoint and stay
   honestly disabled until a real repository head is observed.
2. **The live action endpoint** `/api/live-mission/actions`
   (`LIVE_ACTION_ENDPOINT` — the MOUNTING.md step-2 mount): every
   submission is a TYPED envelope validated + executed through the merged
   `@sos-2/action-gateway` (authority re-evaluated AT ACTION TIME,
   fail-closed; idempotent — the same envelope replays the recorded
   receipt; evidence-bound receipts), ASK resolutions flow through the
   merged `@sos-2/ask` `AskQueue.resolve()` (human authority; the queue
   mints the Decision record), and the endpoint answers with typed
   receipts — JSON for programmatic submissions, the server-rendered
   receipt document (evidence/rationale links, safe-failure and
   denied-action UX, the machine-checkable data island) for browser form
   POSTs.
3. **The receipt rendering.** Every consequential action answers with a
   receipt that carries the typed outcome verbatim, the six product
   review questions, the evidence ids, the authority decision, the real
   provider facts (honest four-state machine), and the honest scope
   limitations (process-local stores — the canonical durable stores are
   DNS-unreachable, so no durable confirmation is claimed).
4. **The authority model.** The console's authority is the operator's
   env-declared grant set (`LIVE_MISSION_GRANTS` — e.g.
   `body-lifecycle:*,promotion:production,rollback:*`), re-read at EVERY
   action (removing an entry denies the next action); unset or empty
   denies everything (`GRANT_NEVER_HELD`). A provider credential is never
   authority by itself.
5. **The idempotency discipline.** The frozen P17-C forms post
   identity-INCOMPLETE envelopes by design; the endpoint derives the
   identity DETERMINISTICALLY from the envelope content (the action
   gateway's contentAddress discipline), so double-submitting a form is a
   REPLAY of the recorded receipt — never a second execution. Caller-
   supplied identity is used as-is (the P17-C builders' full output).

## The honest states (the program-defining rule)

| Provider | State | The real evidence |
| --- | --- | --- |
| **OpenRouter** (the body's hosted model provider) | `CONNECTED` | The real body summon executes a REAL bounded completion (16-token probe) through the merged OpenRouter client; the receipt carries the real response id (`gen-1790451404-…`), the model the provider reports actually serving (`qwen/qwen3-coder-flash`) and the token usage — see [`action-receipts.json`](./action-receipts.json). |
| **GitHub** | `CONNECTED` | The credential answers with admin on `payswapdotorg/SOS-2.0` (repoId 1377439399) — the branch push + the PR. |
| **Vercel** (the deployment + the deployment records) | `UNAVAILABLE` (credential rejected) | The provided `VERCEL_TOKEN` answered **403 invalidToken** on the authenticated `/v2/user` probe at the recorded instants — the deploy, the project-env setup and the deployment-records binding could not execute. Recorded verbatim in [`deployment-record.json`](./deployment-record.json); the deploy + RUN_REAL-against-the-deployed-preview re-execute with a valid credential (the exact commands are in that record). The promotion/rollback receipts therefore carry the HONEST reference mode with the exact limitation — never a fake dpl_… binding. |
| **Neon / Upstash** (the canonical durable stores) | `UNAVAILABLE` (the recorded DNS facts) | The idempotency store, the event log, the evidence sink and the ask queue are PROCESS-LOCAL; every receipt carries the honest scope note. No durable confirmation is claimed (the P18-A lane recorded the exact DNS facts: `ENOTFOUND api.neon.tech`, `ENOTFOUND meet-ewe-145933.upstash.io`). |

A provider outage — and a rejected credential — are **valid evidence**: recorded with the exact failure, never a silent skip, never a fabricated `CONNECTED`.

### The run reality (recorded honestly)

The RUN_REAL suite executed **9/9 green** against the lane's **PRODUCTION
BUILD** (`pnpm exec next start` on the branch head — the exact artifact the
deploy would serve): the real OpenRouter-backed body summon, the idempotent
replay over the wire, the honest reference-mode promotion/rollback, the real
ASK resolution (a real Decision record minted through the merged queue) and
the fail-closed denial. The task packet's preference for the DEPLOYED
preview URL could not be met — the Vercel credential was rejected (the
recorded 403); everything is scripted and ready to re-execute (see
[`deployment-record.json`](./deployment-record.json)).

## Where the composition seams live (the architecture note)

The lane's task packet assigns the integration seams to
`apps/web/live-mission/**`; the merged P17-C structure suite
(`tests/real-observation/test/structure.test.ts`) pins that module as a
pure ambient-free UI module (no `process.env` / `Date.now` / raw `fetch`,
imports restricted to the shell + web-contracts + relative paths) AND
pins `pnpm-workspace.yaml` against ANY `live-mission` importer entry.
Both are frozen merged contracts this lane must not touch — so the seams
live in the lane's OTHER owned path: the colocated non-route module
`apps/web/app/mission/live-actions/` (beside the mission route — the
P18-C start-surface colocation precedent), with the workspace importer at
`apps/web/app/mission` (whose node_modules carries the merged packages
the seams import: `@sos-2/action-gateway`, `@sos-2/ask`,
`@sos-2/decision`, `@sos-2/authority`, `@sos-2/deployment-providers`,
`@sos-2/real-bodies`). The P17-C UI module stays byte-identical to its
base.

**Proposed ACR for the architect:** scope the P17-C structure suite's
ambient/import scan to the frozen P17-C files (the components/view-state/
envelope sources) instead of all of `apps/web/live-mission/src/**`, so
integration seams can join the surface library the task packet assigns —
or keep the colocated `live-actions` module as the standing pattern for
action wiring. Additionally: `@sos-2/action-gateway`,
`@sos-2/deployment-providers` and `@sos-2/real-bodies` are outside the
`@sos-2/web` build closure, and `apps/web/package.json` is outside this
lane's owned surface — this lane's deployment uses a PER-DEPLOYMENT
`projectSettings.buildCommand` override that extends the frozen closure
pattern with `pnpm --filter @sos-2/web-live-actions^... run build` (the
PROJECT's build command is unchanged — verified post-run). Folding the
dependencies into `apps/web/package.json` (one line each) is the
architect's cleaner integration.

## The deterministic suites (offline, seed 424242)

`tests/live-ux/actions` — 86 tests, run-to-run identical, zero network:
the endpoint contract (typed submissions form-encoded and JSON, derived
identity, idempotent double-submit, typed rejections —
`AUTHORITY_FIELD_SMUGGLED`, `ENVELOPE_MALFORMED`, `SUBMISSION_MALFORMED`
— never a silent 5xx; the HTML receipt mode; the GET contract), the
authority gates (granted / revoked / expired / never-held / scope /
at-action-time re-evaluation — the executor-never-invoked proof via a
counting model port), idempotency (per consequential family + the frozen
forms + the terminal ASK resolution), the ASK resolution contract (the
deterministic seeded ask, the derived receipt fields, the P17-C envelope
shape verbatim, the typed failures), receipt rendering (the safe-failure
denied UX, the evidence/rationale links, the JSON data island round-trip,
HTML escaping), the mount seams (both mission routes render the live
experience over the honest unwired seam — byte-identical to each other;
the forms POST to the endpoint; the honest disabled reasons), the
provider adapters (the honest four-state machine over scripted ports:
records reads, the model probe, the fail-closed executors, the rollback
verifier), and redaction (runtime env-NAME-only + the owned-path source
scan).

## How to reproduce

```bash
corepack enable && corepack prepare pnpm@10.0.0 --activate
pnpm install --frozen-lockfile
node scripts/verify-repo.mjs && node scripts/verify-productization.mjs
pnpm -r --if-present build
pnpm -r --if-present test        # the full repo suite (incl. the lane's 86)

# The REAL-provider run (env-gated; values NEVER committed — the P3
# typed-registry NAMES; LIVE_MISSION_GRANTS is the operator grant
# declaration — the authority model, not a credential):
RUN_REAL=1 LIVE_MISSION_BASE_URL=https://<the-deployed-preview-url> \
VERCEL_TOKEN=… VERCEL_PROJECT_ID=… \
pnpm --filter @sos-2/tests-live-ux-actions test

# The lane deploy (deploys THIS branch head to the Vercel project through
# the real API — gitSource bound to the exact sha — and records the
# deployment evidence; then set the project env vars env-only):
node tests/live-ux/actions/scripts/deploy-p18b.mjs
node tests/live-ux/actions/scripts/set-project-env.mjs

# Refresh the lane secrets audit after the run:
node tests/live-ux/actions/scripts/secret-scan-live-ux-actions.mjs \
  --json-out docs/evidence/production-connectivity/live-ux/actions-mission/secrets-audit.json
```

## Records

| File | What it records |
| --- | --- |
| [`deployment-record.json`](./deployment-record.json) | The honest deployment record: the Vercel credential reality (403 invalidToken at the recorded instants — env NAMES only), the exact reproduction commands for a valid credential, the per-deployment build-command disclosure, and the provider states of this run. |
| [`action-receipts.json`](./action-receipts.json) | Every consequential action type against the running production build: the real body summon (OpenRouter-backed, real provider facts), the idempotent replay, the promotion + rollback (the honest reference mode with the exact limitations), the ASK resolution (the minted Decision record), the fail-closed denial — envelope in, authority decision, receipt out, evidence ids, provider facts. |
| [`http-transcripts.json`](./http-transcripts.json) | The real HTTP round-trips of the run (method + url + status + ms — never bodies, never credentials), including the transcripts recorded INSIDE the deployed function (the endpoint's own provider reads). |
| [`provider-states.json`](./provider-states.json) | The honest provider states at runtime, per action (the four-state machine — never fabricated). |
| [`secrets-audit.json`](./secrets-audit.json) | The committed output of the lane secrets audit: every owned path scanned with the merged lane corpora, 0 findings (pattern ids + positions only — never matched text). |
| [`ARCHITECTURE-DELTA.json`](./ARCHITECTURE-DELTA.json) | The architecture delta for the lane (the frozen 8-key schema; work order `P18-B`). |

## A pre-existing defect this lane observed (honestly recorded, not fixed)

The console's stylesheet (`apps/web/shell/styles/globals.css`) is not
imported by any layout — every app page (at base AND with this lane's
changes) serves without the Tailwind styles. The lane's own receipt
documents carry their own inlined tokens, so the receipt flow renders
styled regardless. The fix is a one-line import in
`apps/web/shell/components/root-layout.tsx` — a frozen shell path outside
this lane's owned surface (left to the architect; noted in the PR).
