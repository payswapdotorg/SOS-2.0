# P17-C Evidence — Real Observation + Product UX Wiring

Work Order: **P17-C** (Production Connectivity, observation/UX lane).
Base: `efd44494d37580ebe4cf9e54bc188351642ae3fb`. Lane branch:
`wo/p17c-real-observation-ux`.

Everything in this directory is machine-readable evidence produced by the
P17-C suites. Deterministic reference-mode evidence (scripted providers,
run-to-run identical) lives in the suites; the records here are the
REAL-provider integration outcomes (`RUN_REAL=1`, honest — including
failures). Credentials are referenced by environment-variable NAMES only;
transcripts are redacted (Authorization → env-name references; bodies
through the P17-C redaction corpus, pattern ids aligned with the merged
`@sos-2/security` corpus).

## Records

| File | What it records |
| --- | --- |
| `ARCHITECTURE-DELTA.json` | the architecture delta for the lane (validated against `spec/contracts/architecture-delta.schema.json`, `work_order: P17-C`) |
| `sources/github-events.json` | GitHub repository events: endpoint (`GET /repos/payswapdotorg/SOS-2.0/events`, github.v3), redacted transcript, honest state, real observed branch head |
| `sources/ci-results.json` | CI results (GitHub Actions runs per commit): endpoint, transcript, honest state, latest runs with statuses verbatim |
| `sources/deployment-events.json` | Deployment events: `GET /v6/deployments` (vercel.v6, read directly — no sibling dependency), transcript, honest state (CONNECTED with ZERO SOS-2.0 deployment events: no Vercel project exists yet — the P17-A topology) |
| `sources/runtime-telemetry.json` | Runtime telemetry: GitHub rate-limit budget + live Upstash Redis (PING/DBSIZE), W3 captures preserved verbatim |
| `sources/scheduled-probes.json` | The real fallback probes: which ran, which stood down (SKIPPED_COVERED), per-probe honest states |
| `sources/provider-health.json` | Real per-provider probes + the aggregate honest state (github / vercel / upstash) |
| `event-flow.json` | The end-to-end event→System State flow: source summaries → durable events → projections → claims → findings → detections, replay safety, the no-body rule |
| `webhook-transport.json` | The webhook-shaped receiver over a REAL HTTP transport: signed delivery accepted, tampering fails closed, replay is typed DUPLICATE (honest origin note inside) |
| `ux-wiring.json` | The UI action wiring: envelopes derived from the REALLY observed head executing through the real action gateway with authority gates (held/revoked/replay) + ASK resolution through the merged queue |

## The honest states (the program-defining rule)

Every source reports one of `CONNECTED` / `UNKNOWN` / `UNAVAILABLE` /
`DEGRADED`, derived ONLY from real probe records. Unprobed is `UNKNOWN`
(never health); a down provider is `UNAVAILABLE` with the real error
recorded; a throttled provider is `DEGRADED`. Nothing is ever fabricated.

## How to reproduce

```bash
corepack pnpm install --prefer-offline
node scripts/verify-repo.mjs
node scripts/verify-productization.mjs
pnpm install --frozen-lockfile
pnpm -r --if-present build
pnpm -r --if-present test                 # deterministic reference mode
PAYSWAP_GITHUB_TOKEN=… PAYSWAP_VERCEL_TOKEN=… UPSTASH_REDIS_REST_URL=… \
UPSTASH_REDIS_REST_TOKEN=… PAYSWAP_GITHUB_OWNER=payswaporg \
PAYSWAP_GITHUB_REPO=SOS-2.0 PAYSWAP_GITHUB_BRANCH=main \
RUN_REAL=1 pnpm --filter @sos-2/tests-real-observation test
```
