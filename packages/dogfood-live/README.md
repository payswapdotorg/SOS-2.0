# @sos-2/dogfood-live — the Real-World Dogfood Harness (P19)

The real-system composition that drives the **P13 flagship journey
engine** (`packages/greenfield-runtime`, consumed **never modified**)
through **REAL external systems** — the point where "persistent Spirit,
replaceable bodies" becomes demonstrably real.

## What it composes

| Surface | Binding |
| --- | --- |
| Journey engine | `GreenfieldJourney` + the merged reference formalizer/planner/approval (unchanged) |
| Repository connection | `RealGitHubProvider` (`@sos-2/real-github`) — the PAT-backed whoami handshake, real discovery, REAL empty-repository detection (the P4 structural binding behind `JourneyGitHubPort`) |
| Gateway executors | commit / push / pull-request / deployment behind the frozen `ActionExecutor` seam over STAGED real outcomes (the documented P8 staged-outcome composition boundary — `staging.ts`) |
| Cloud body | `HostedCodingBody` (`@sos-2/real-bodies`) behind the journey's `TaskImplementationPort` — REAL OpenRouter completions (default `qwen/qwen3-coder-flash`, override `SOS_DOGFOOD_BODY_MODEL`) |
| Deployment | the dogfood-scoped Vercel REST client (the §0b-verified shapes: `POST /v9/projects` with `gitRepository`, `PATCH ssoProtection: null`, `POST /v13/deployments` with `gitSource {repoId, ref}`) |
| Independent evaluation | the real dogfood probes — repo-contents-at-revision, deployment-state, runtime-HTTP, security-scan (+ REAL node execution of the generated test); the body never certifies itself (§10) |
| Store selection | honest Neon/Upstash probes; the reference in-memory live store with the EXPLICIT marker when unreachable (the live-data-plane precedent) |
| Package learning | data-only learned records through `@sos-2/packages` + `@sos-2/composition` + `@sos-2/ecology` carrying the REAL evidence refs (PR sha, deployment URL, evaluator verdicts) |

## The sync/async composition boundary

The frozen `ActionExecutor`, `TaskImplementationPort` and
`EvaluatorProbe` seams are **synchronous by design**, while the real
GitHub/Vercel/OpenRouter operations are async network calls. Following
the documented P8 seam discipline (the `github-bridge`
staged-outcome precedent and the model port's documented composition):
the **harness operator** drives the REAL API calls asynchronously and
stages the outcomes; the sync seams answer **exactly** the staged real
outcomes. An operation that was never prepared answers a typed honest
failure — never a fabricated success, never a silent pass-through.

## Honest states

`CONNECTED` / `UNKNOWN` / `UNAVAILABLE` / `DEGRADED` derive from REAL
probes only. A pre-existing repository/project of the same name is a
typed abort with cleanup instructions (never silently reused). Secrets
arrive env-only and appear by NAME only in every record, note and
transcript (dual redaction before write; the evidence writers live in
`tests/real-dogfood`).

## Determinism discipline

No ambient environment, network or time in `src` — every credential
arrives from an injected source record, every network seam (the GitHub
request port, the Vercel FetchPort, the model port, the runtime fetch,
the DNS lookup) and the clock/sleep are **injectable**. The
deterministic suites (`tests/real-dogfood`) script the seams offline
with a fixed vitest seed (424242); the env-gated RUN_REAL suite (default
OFF) binds the real fetch/clock at the process boundary.
