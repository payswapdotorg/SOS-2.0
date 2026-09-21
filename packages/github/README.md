# @sos-2/github — the provider-neutral GitHub/project adapter (Work Order P4)

The typed `GitHubPort` project-adapter contract and its implementations:

| Surface | What it is |
| --- | --- |
| `GitHubPort` (src/port.ts) | The provider-neutral project adapter: connection, repository discovery, branch/revision selection, empty-repository detection, snapshot/metadata import, webhook registration (where supported), PR/commit operations. Zero vendor SDK. |
| `GitHubRequestPort` (src/port.ts) | The injectable HTTP/request transport seam. NO network call is ever made by this package — the port is always injected. |
| `GitHubCapabilitySurface` (src/capabilities.ts) | The typed capability surface: unsupported operations answer with an explicit typed `UNSUPPORTED` outcome, never a silent failure, never a fabricated success. |
| `InMemoryGitHubProvider` (src/reference.ts) | The in-memory reference implementation (deterministic, offline, fixtures revision-pinned). Its states are explicitly `simulated: true`. |
| `RequestPortGitHubProvider` (src/transport.ts) | The transport-backed read path over an injected request port (write path typed `UNSUPPORTED` until the vendor-backed implementation lands). |
| `resolveGitHubEnvironment` (src/environment.ts) | Configuration through `@sos-2/infra-deployment`'s environment contract: the GitHub-scope variables (`GITHUB_ACCESS_TOKEN`, `GITHUB_WEBHOOK_SECRET`) read from an INJECTED source record — never ambient `process.env`. Names pinned by test against the actual registry; secret values never echoed. |

## Honest status

- The real-system connection state is **NOT_YET_CONNECTED** (validation
  GitHub account pending). `CONNECTED` is never fabricated: configured
  credentials are PREPARED, not connected, until a real handshake
  completes on the backing provider.
- The reference provider's connection is **SIMULATED** (`simulated: true`
  on every state it produces) and can never render as a real connection.
- The connection handshake (`beginConnection` / `completeConnection`) is
  the **CONTRACT** — a provider-neutral least-privilege OAuth/GitHub-App
  shape — not a live vendor flow.

## Determinism

No `Date.now` / `Math.random` / `fetch` / ambient `process.env` in
package source: every instant is a caller-supplied RFC3339 literal, and
the fixture dataset (repository slugs, branch heads, commit shas, trees)
is static. Deterministic suites run with vitest seed 424242.

## Zero dependencies (lockfile byte-identity rule)

This package declares ZERO dependencies of any kind (P3 precedent:
`infra/deployment`). A zero-dep importer leaves `pnpm-lock.yaml`
byte-identical. The test toolchain is BORROWED at run time from the
frozen W17 adversarial suite:

```
pnpm --filter @sos-2/adversarial exec vitest run --config ../../packages/github/vitest.config.ts
pnpm --filter @sos-2/adversarial exec tsc -p ../../packages/github/tsconfig.json
```

The package `test` script also runs the two sibling P4 suites (the
onboarding view-model contracts under `packages/web-contracts/onboarding`
and the onboarding product-surface render smoke tests under
`apps/web/onboarding`) through their own P4-owned configs.
