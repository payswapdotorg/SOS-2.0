# P19 Real-World Dogfood — Evidence Package

Work Order **P19** (Real-World Dogfood). The §11 flagship journey driven
end-to-end against **REAL external systems** — GitHub (repository, commits,
pull request), Vercel (fresh project, production deployment), OpenRouter
(the hosted coding body) — twice, on fresh repositories, with the exact
revision recorded at **every** stage.

Every record here is machine-written by the env-gated RUN_REAL suite
(`tests/real-dogfood`, `RUN_REAL=1`, default OFF), passes through
**fail-closed dual redaction** (the deployment corpus + the observation
corpus) before it is serialized, and references credentials by
environment-variable **NAMES only** — never values.

---

## The honest provider states (the real preflight probes)

| Provider | State | The real evidence |
| --- | --- | --- |
| github | **CONNECTED** | the authenticated whoami probe answered HTTP 200 (login `payswapdotorg`, API revision `2022-11-28`) |
| vercel | **CONNECTED** | the authenticated `/v2/user` probe answered (user `ekonplacide-5312`) |
| openrouter | **CONNECTED** | the authenticated key check (`GET /api/v1/key`) answered HTTP 200 |
| neon | **UNAVAILABLE** | the DNS probe failed for `api.neon.tech` (`getaddrinfo ENOTFOUND`) — recorded verbatim, no DATABASE_URL exists in the P19 runtime |
| upstash | **UNAVAILABLE** | the DNS probe failed for `upstash.io` (`getaddrinfo ENOTFOUND`) — recorded verbatim |
| durable store | **REFERENCE_FALLBACK** | the canonical store did not answer a real probe, so both journeys ran on the reference in-memory live store — **explicitly NOT production durable state** (the live-data-plane `REFERENCE_FALLBACK` precedent; machine-checkable marker) |

Body model: `qwen/qwen3-coder-flash` (the §1 default; overridable by
`SOS_DOGFOOD_BODY_MODEL`).

## The two runs

| | RUN 1 | RUN 2 |
| --- | --- | --- |
| Repository (created this run) | [payswapdotorg/sos-dogfood-r1](https://github.com/payswapdotorg/sos-dogfood-r1) | [payswapdotorg/sos-dogfood-r2](https://github.com/payswapdotorg/sos-dogfood-r2) |
| Harness / stores | fresh | **fresh** (a completely new harness instance + fresh stores) |
| Mission | Build a markdown notes service with a public API | the SAME mission |
| Final state | **COMPLETED / COMPLETED** (13/13 stages, 0 asks) | **COMPLETED / COMPLETED** (13/13 stages, 0 asks) |
| Pull request | [#1](https://github.com/payswapdotorg/sos-dogfood-r1/pull/1) at head `d10264db6e013360dcc79d0fb77610d5c5841c19` | [#1](https://github.com/payswapdotorg/sos-dogfood-r2/pull/1) at head `767c474c3e22c0d807bb44883df6ae7c63139f3f` |
| Production deployment | `sos-dogfood-r1-3ho4np5l7-ekonplacidegmailcoms-projects.vercel.app` — **READY** at the exact PR head | `sos-dogfood-r2-43ry34xrp-ekonplacidegmailcoms-projects.vercel.app` — **READY** at the exact PR head |
| Runtime verification | `GET /sos-manifest.json` → **200**, served body **byte-identical** to the repository content at the deployed revision | the same, at run 2's own deployed revision |
| Model calls (real OpenRouter completions) | 2 (each with a real response id + usage) | 2 |
| Repairs (the engine's bounded repair discipline, exercised for real) | 1 (first body output failed a check → the repair revision → the FULL fresh evaluator suite re-ran → pass) | 1 |
| Independent evaluation (the completion gate) | **5 passed / 0 failed / 0 unknown** — the body never certifies itself | 5 / 0 / 0 |
| Store mode | REFERENCE_FALLBACK (explicit marker) | REFERENCE_FALLBACK (the same honest class) |

The **reproducibility record** ([reproducibility.json](reproducibility.json)):
the SAME stage sequence (the frozen `GREENFIELD_JOURNEY_STAGES`), the same
per-stage outcome classes, the same evaluation verdict classes, the same
store mode — with the honest differences (repositories, workspace heads,
PRs, deployments, timestamps, provider-real model output, each run's own
repair state) **recorded, never fabricated into equality**.

## The records

| File | What it is |
| --- | --- |
| [preflight.json](preflight.json) | the honest provider-state probes BEFORE any journey ran (probe-only; no repository/project created) + the GitHub transport telemetry + the store selection |
| [run-1/](run-1/) / [run-2/](run-2/) `journey-record.json` | the full journey record: mission, repository, every stage (with its EXACT revision), every tick (each with `userDeviceOnline=false` — the §7 pin), model calls, repairs, asks, PR, deployment, runtime verification, honest notes |
| `provider-states.json` | the per-run honest provider states (CONNECTED derives from real probes only) |
| `action-receipts.json` | every consequential action's gateway receipt (the authority-gated action gateway's own evidence-bound records) |
| `deployment-record.json` | the fresh Vercel project + production deployment (readyState, the exact commit sha binding, poll attempts) |
| `runtime-verification.json` | the real HTTP GETs of the deployed URL (root + the manifest binding basis) |
| `learning-record.json` | the post-journey package learning (data-only records carrying the REAL evidence refs: PR sha, deployment URL, evaluator verdict refs) |
| `completion-report.json` | the completion the INDEPENDENT evaluation suite granted (5 evaluator types; certified-by ≠ produced-by; the completion id recomputes) |
| [reproducibility.json](reproducibility.json) | the run-2 equivalence record (same outcome classes + the honest differences) |
| [ARCHITECTURE-DELTA.json](ARCHITECTURE-DELTA.json) | the frozen 8-key delta — P19 adds NO semantic changes (mechanism adapters + harness only) |
| [secrets-audit.json](secrets-audit.json) | the owned-paths secrets audit through BOTH merged redaction corpora — **0 findings** (pattern ids + positions only) |

## Reproducing the runs

The real suite is env-gated (`RUN_REAL=1`, default OFF — the honest exit-0
skip without credentials). The credentials arrive via the environment,
NAMES only:

```
GITHUB_ACCESS_TOKEN   (or PAYSWAP_GITHUB_TOKEN)   the program PAT
OPENROUTER_API_KEY                                the hosted-model key
VERCEL_TOKEN                                      the deployment token
VERCEL_ORG_ID                                     the team/org scope
SOS_DOGFOOD_BODY_MODEL   (optional)              body-model override
```

The P19 runtime declares **no `DATABASE_URL`** — the store selection is the
honest reference fallback (run with the ambient `DATABASE_URL` unset so the
run matches this contract).

```
cd tests/real-dogfood
env -u DATABASE_URL RUN_REAL=1 \
  GITHUB_ACCESS_TOKEN=… OPENROUTER_API_KEY=… VERCEL_TOKEN=… VERCEL_ORG_ID=… \
  pnpm run test:real
```

(`test:real` = build + `vitest run --config vitest.real.config.ts`: the
preflight probes, run 1 on `payswapdotorg/sos-dogfood-r1`, run 2 on
`payswapdotorg/sos-dogfood-r2` with a fresh harness + the equivalence
record. A pre-existing repository/project of the same name is a typed
abort with cleanup instructions — never silently reused; the run artifacts
are the evidence and are never deleted.)

## The two real-provider behaviors the runs themselves discovered

Both were found by the RUN_REAL runs, fixed at the P19 composition seams
(`packages/dogfood-live`), with the provider-owned packages untouched:

1. **Real GitHub reports a would-be default branch on an EMPTY repository.**
   A freshly created repository with zero commits answers
   `default_branch: "main"` and a non-null `pushed_at` (the creation
   instant), so the P17-B discovery heuristic (`size === 0 && pushed_at ===
   null`) misread the fresh empty repository as non-empty and the frozen
   journey honestly refused to continue. The fix
   (`packages/dogfood-live/src/journey-github.ts`): the dogfood's
   `DogfoodJourneyGitHubProvider` re-derives the TARGET repository's
   emptiness with the authoritative probe — the branches listing (a real
   empty repository has no branches at all).
2. **Real Vercel never serves the file NAMED `README.md` on a zero-config
   static deployment.** Verified empirically against a scratch
   direct-upload deployment (deleted after the probe):
   `notes.md` / `data.json` / `plain.txt` / `page.html` all serve HTTP 200
   while `README.md` answers 404 — repository metadata is excluded. The
   runtime-verification binding basis is therefore the root-level planned
   artifact `sos-manifest.json`, which serves **byte-exact**; the README
   behavior and the root 404 (no planned index.html) are recorded as
   documented limitations in every runtime verdict.

## Honesty notes

- The §7 device pin: **every** cloud tick in both runs recorded
  `userDeviceOnline=false` (presence recorded, never consulted).
- The store selection is honestly `REFERENCE_FALLBACK` in both runs —
  the explicit marker, machine-checkable, never presented as production
  durable state.
- Each evidence record carries the exact `repo_head` it was produced at
  (run 1 at `ccd191f`, run 2 at `ce22ef5`; the harness code is identical
  at both — the intermediate commits are the composition-seam fixes above).
- Redaction is fail-closed and dual (deployment + observation corpora) —
  a credential value that leaked into ANY field would be redacted before
  write, with the redaction itself reported by pattern id; the committed
  [secrets-audit.json](secrets-audit.json) proves 0 findings across the
  owned paths.
