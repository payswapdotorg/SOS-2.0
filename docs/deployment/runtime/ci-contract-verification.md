# CI Contract Verification

The deployment CI verifies **contracts, not deployments**: environment
schema validation, secret policy, preview isolation, provider config
sanity and revision-record shape — all offline, with **no credentials**.
No real cloud accounts exist for Work Order P3, and nothing in CI
fabricates deployment or provider evidence.

## Topology (and why it looks like this)

GitHub auto-discovers workflows only at top-level
`.github/workflows/*.yml`. Therefore:

```
.github/workflows/deploy-contract.yml        <- thin top-level caller (auto-discovered)
.github/workflows/deployment/contract-verify.yml   <- reusable workflow definition (workflow_call)
.github/workflows/deployment/actions/setup-toolchain/action.yml  <- shared composite setup
```

The caller is deliberately thin: it names the job and delegates. The
reusable definition owns the steps. The frozen
`.github/workflows/verify.yml` (W0-W18 output) is untouched — this
addition runs alongside it on every pull request and push to main.

## What the job verifies (in order)

| Step | What it proves |
| --- | --- |
| Toolchain setup | Checkout at the exact head; Node 24 (native TS type stripping, matching `engines: >=22.18`); corepack-pinned pnpm; `pnpm install` |
| `verify-repo.mjs` + `verify-productization.mjs` | The frozen repository contract checks still pass (work orders, machine state, owned paths) |
| `verify:zero-deps` | `infra/deployment` declares ZERO dependencies — the root cause of lockfile byte-identity (any declared dep would change `pnpm-lock.yaml`) |
| `verify:secrets` | The secret-shape scan over P3-owned files passes — findings would report names/positions/pattern ids, never values |
| `typecheck` | Strict TypeScript over the contract source (borrowed toolchain: `pnpm --filter @sos-2/adversarial exec tsc`) |
| `test` | The 113 deterministic contract tests: environment schema (fail-closed per tier), secret policy (detection/redaction/never-echo), preview isolation (typed cross-tier rejections), provider config sanity (Vercel/Neon/Upstash/R2/GitHub), revision records (round-trip + chain), provider health (honest statuses, no fabricated HEALTHY), body-provider config (envelope validation + structural isolation from `packages/*`), delegation boundary (typed rejection of request-lifetime long-running work) |
| Install determinism | A second `pnpm install` leaves the lockfile hash unchanged |

## Determinism guarantees

The suites run under a fixed seed (repo convention `424242`), use
injected clocks/sources/probes (no `Date.now`, `Math.random`, `fetch` or
`process.env` anywhere in library source), and the protocol requires the
full verification to produce identical results on a second run — locally
and in CI.

## The zero-dependency discipline

`infra/deployment` is a workspace package (so `pnpm -r --if-present test`
includes its suites, the W17 precedent) that declares **zero
dependencies**: a dependency-free importer leaves `pnpm-lock.yaml`
byte-identical (empirically pinned by the install-determinism step), so
the Work Order's hard lockfile rule holds with no lockfile edits at all.
The test toolchain is borrowed at run time from the frozen W17
adversarial suite (`vitest`, `tsc` via `pnpm --filter ... exec`), which
is already in the dependency graph — runtime borrowing, not a declared
dependency.

## What would FAIL this workflow (by design)

- A new dependency anywhere in `infra/deployment` (zero-deps check).
- A secret-shaped value in any P3-owned deliverable file (secret scan).
- A type error in the contract source (typecheck).
- Any contract regression the suites pin (tests) — e.g. a preview
  footprint allowed to reference production stores, a Redis namespace
  declaring canonicity, a HEALTHY without probe evidence, or a
  long-running task accepted into the request runtime.

None of these need credentials to catch — which is the point: contract
violations are caught in CI before any real system exists to violate.
