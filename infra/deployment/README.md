# @sos-2/infra-deployment — Free-Tier Deployment Foundation (Work Order P3)

Configuration-as-code + infrastructure contracts + CI + deterministic
tests for the free-tier validation topology
(`docs/deployment/free-tier-plan.md`): **Vercel Hobby** (console +
lightweight APIs), **Neon Free** (canonical durable store), **Upstash
Redis Free** (never-canonical acceleration/coordination), **Cloudflare
R2 Free** (immutable artifacts), **GitHub Actions** (source/CI).
Execution — long-running work and body providers — is external to the
web deployment by contract.

**Honest status: NOT_YET_DEPLOYED.** No validation accounts exist for
this Work Order; no real provider credentials, no deployment evidence —
and none fabricated. This package verifies CONTRACTS. Runtime operations
documentation: `docs/deployment/runtime/`.

## Module map

| Path | Contract |
| --- | --- |
| `src/core/types.ts` | Tiers, providers, the fail-closed error hierarchy |
| `src/environment/schema.ts` | The typed variable registry (required/optional per tier, secret classification, local fixture defaults) |
| `src/environment/load.ts` | `loadEnvironment(tier, source)` — fail-closed loading; secret values live in a closure and are never serializable |
| `src/environment/isolation.ts` | Resource footprints; preview NEVER mutates production (typed cross-tier rejections) |
| `src/providers/vercel.ts` | Project scope (apps/web, nextjs), preview/prod dimension split, request-lifetime budgets |
| `src/providers/neon.ts` | Database/branch naming per tier, connection plan (variable names only), migration contract |
| `src/providers/upstash.ts` | Tier-prefixed namespaces with bounded TTLs; the encoded NEVER-CANONICAL gate |
| `src/providers/r2.ts` | Tier prefixes, write-once immutable objects, content anchoring |
| `src/providers/github.ts` | CI topology contract (thin callers, frozen verify.yml, offline verification) |
| `src/secrets/policy.ts` | Secret-shape detection, redaction, names-only presence validation |
| `src/revisions/registrar.ts` | Deployment revision record contract + append-only reference registrar with rollback pointers |
| `src/health/diagnostics.ts` | UNKNOWN/UNAVAILABLE/DEGRADED/HEALTHY with injectable probes; never a fabricated HEALTHY |
| `src/execution/body-providers.ts` | Body provider config schema — capabilities, isolation, network policy, filesystem scope, cost envelope, lifecycle (ZERO imports from packages/*, pinned by tests) |
| `src/execution/delegation.ts` | Long-running work delegation boundary (request runtime never owns long-running work) |

## Zero-dependency discipline (why there is no build here)

This workspace package declares **ZERO dependencies** — that is what
keeps `pnpm-lock.yaml` byte-identical (a dependency-free importer adds
nothing to the lockfile; any declared dependency would change it). The
test toolchain is **borrowed at run time** from the frozen W17
adversarial suite:

```bash
pnpm --filter @sos-2/infra-deployment run typecheck     # tsc via the borrowed toolchain
pnpm --filter @sos-2/infra-deployment run test          # vitest via the borrowed toolchain
pnpm --filter @sos-2/infra-deployment run verify:zero-deps
pnpm --filter @sos-2/infra-deployment run verify:secrets
pnpm --filter @sos-2/infra-deployment run verify:contracts  # all of the above
```

`pnpm -r --if-present test` from the repository root includes this
package's suites (the `pnpm-workspace.yaml` wiring line, W17 precedent).
There is no `build` step by design: the package is consumed as
configuration contracts; later waves that need a `dist` add their own
build wiring when they wire real apps in.

Node `>= 22.18` is required (native TypeScript type stripping — the
CI scripts import `.ts` modules directly; no build step, no loader).

## Determinism rules (hard)

No `Date.now`, `Math.random`, `fetch` or `process.env` in library
source — clocks, sources, probes and entropy are always injected. All
tests are offline and deterministic (fixed seed 424242, fixed fixture
instants). The full verification protocol must produce identical
results on a second run.

## Structural isolation

Providers remain adapters: no imports from or into `packages/*` anywhere
in this package. The execution modules' import graphs are pinned by
tests that scan the module source (`?raw` imports) for forbidden
specifiers — the isolation is machine-checked, not aspirational.

## Later waves consume this

- **P1 (web shell)**: build runtime configuration from loaded
  environment records; consume `assertDelegationBoundary` before
  accepting task-creation intents.
- **P2 (live data)**: provision Neon/Upstash/R2 resources FROM these
  naming conventions; register deployment revisions through the
  registrar interface into durable System State.
- **P9/P10 (body broker / cloud-first execution)**: register real body
  providers as validated `BodyProviderConfig` records; real health
  probes arrive as injectable probe functions with real credentials.

The Architecture Delta for this Work Order lives at
`infra/deployment/ARCHITECTURE-DELTA.json`.
