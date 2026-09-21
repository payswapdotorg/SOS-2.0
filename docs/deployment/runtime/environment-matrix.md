# Environment Matrix

The typed environment variable registry lives in
`infra/deployment/src/environment/schema.ts` (the machine-checked
authority). This page documents the matrix and the loading rules that the
deterministic suites in `infra/deployment/test/environment.test.ts` pin.

## Tiers

| Tier | Purpose | Required variables | Fixture defaults |
| --- | --- | --- | --- |
| `local` | Deterministic local runs: fixture adapters, local stores, no cloud accounts | **none** | Yes — documented, visibly marked, credential-free |
| `preview` | Isolated validation deployment: isolated Neon branch, isolated Redis namespaces, R2 preview prefix | full provider set | **never** |
| `production` | The production console/API with isolated durable stores | full provider set | **never** |

Local is deliberately the zero-requirement tier: a fresh checkout runs
with documented fixture values (`http://localhost:3000` origin,
credential-free `postgres://localhost:5432/sos_local`, `apps/web` app
root, `sos-artifacts-local` bucket). Every applied fixture is recorded in
the loaded record's `fixtureNames` so any log line or serialized view can
say exactly which values are fixtures — a fixture origin is never
presentable as live state.

## Variable matrix (registry order)

| Variable | Provider | Secret | Shape | local | preview | production |
| --- | --- | --- | --- | --- | --- | --- |
| `APP_BASE_URL` | app | no | https URL | fixture | required | required |
| `VERCEL_PROJECT_ID` | vercel | no | identifier | — | required | required |
| `VERCEL_ORG_ID` | vercel | no | identifier | — | required | required |
| `VERCEL_TOKEN` | vercel | **yes** | token | — | required | required |
| `VERCEL_APP_ROOT` | vercel | no | relative path | fixture | required | required |
| `DATABASE_URL` | neon | **yes** | postgres URL | fixture (credential-free) | required | required |
| `NEON_DATABASE_NAME` | neon | no | identifier | fixture | required | required |
| `NEON_BRANCH_NAME` | neon | no | non-empty | fixture | required | required |
| `NEON_API_KEY` | neon | **yes** | token | — | required | required |
| `UPSTASH_REDIS_REST_URL` | upstash | no | https URL | — | required | required |
| `UPSTASH_REDIS_REST_TOKEN` | upstash | **yes** | token | — | required | required |
| `UPSTASH_REDIS_CONNECTION_URL` | upstash | **yes** | URL | — | optional | optional |
| `R2_ACCOUNT_ID` | r2 | no | identifier | — | required | required |
| `R2_ACCESS_KEY_ID` | r2 | **yes** | token | — | required | required |
| `R2_SECRET_ACCESS_KEY` | r2 | **yes** | token | — | required | required |
| `R2_BUCKET_NAME` | r2 | no | identifier | fixture | required | required |
| `GITHUB_ACCESS_TOKEN` | github | **yes** | token | — | required | required |
| `GITHUB_WEBHOOK_SECRET` | github | **yes** | token | — | required | required |
| `BODY_PROVIDER_ID` | execution-body | no | non-empty | optional | optional | optional |
| `BODY_PROVIDER_API_KEY` | execution-body | **yes** | token | — | optional | optional |

## Loading rules (fail-closed)

`loadEnvironment(tier, source)` in `infra/deployment/src/environment/load.ts`
implements the contract; callers inject the raw record (no `process.env`
access exists anywhere in the package):

1. **Missing REQUIRED variable → typed error naming the variable.** The
   failure message lists every missing name for the tier. There is no
   silent default, no empty-string fallback — an empty value for a
   required variable is missing.
2. **Shape validation.** URLs must be well-formed (`https` for deployed
   origins, with the documented `http://localhost` local-fixture
   exception), tokens must be non-trivial and whitespace-free, paths must
   be relative and non-traversing. Error messages carry the variable name
   and the violated shape — never the value.
3. **Local fixtures are tier-gated.** The registry declares fixture
   defaults for the local tier only, and the loader independently enforces
   the gate: preview/production can never receive a fixture value even if
   the registry were edited to offer one.
4. **Secret values are structurally non-serializable.** Loaded secrets
   live in a closure, reachable only via `getSecretValue(name)`;
   `serializeEnvironment()` emits names with `[REDACTED]` values. See
   [secret-handling.md](secret-handling.md).
5. **Unknown variables are recorded, not ignored.** Extras are kept and
   classified; an unregistered variable whose NAME looks secret-shaped
   (`*_TOKEN`, `*_SECRET`, `*_KEY`, ...) is treated as a secret — the
   conservative, fail-closed classification.

## What this means for later waves

P1 (web shell) and P2 (live data) read configuration through this
contract: build the runtime configuration from a loaded environment
record, never from ambient `process.env` reads scattered through
application code. Deployment surfaces (CI, Vercel project settings) are
provisioned FROM the same matrix so the repository stays the single
authority for what each tier requires.
