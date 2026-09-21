# Provider Roles and Configuration Contracts

Provider roles come from `docs/deployment/free-tier-plan.md` (the topology
contract). The machine-checked configuration modules live under
`infra/deployment/src/providers/`; this page summarizes each role and the
parts of the contract operators rely on. Providers remain adapters, never
semantic authorities — every module here is pure configuration contracts
with zero imports from `packages/*`.

## Vercel (Hobby) — console + lightweight APIs

Hosts `apps/web` (the production Next.js console) and lightweight
request/response APIs. The configuration contract
(`providers/vercel.ts`) pins:

- the monorepo app root: **`apps/web`** (the P1 production target — a
  different root is typed-rejected);
- the framework preset: **`nextjs`**;
- preview/production separation through the Vercel environment dimension
  (same project, `production` vs `preview` deployments); store isolation
  comes from the per-tier environment variables, never from shared
  runtime state;
- the **local tier has no Vercel target** by contract;
- the request-lifetime budget: a conservative **10,000 ms** budget for
  request-scoped work against the **60,000 ms Hobby hard cap** — the
  boundary consumed by the delegation rule (see
  [long-running-delegation.md](long-running-delegation.md)).

## Neon (Free) — the canonical durable store

Canonical durable PostgreSQL state: mission, System State projections,
evidence metadata, task state, authority, decisions, experiments,
packages, history. The contract (`providers/neon.ts`) fixes the naming
conventions that make isolation structural:

| Tier | Database | Branch |
| --- | --- | --- |
| production | `sos` | `main` |
| preview | `sos_preview` | `preview/<slug>` (isolated branch) |
| local | `sos_local` | `main` (local adapter) |

Connections go through the injected `DATABASE_URL` (a secret; the
contract carries the variable NAME, never a value), pooled. Migrations
run in GitHub Actions against the target tier, in lexical filename
order, preview-first (production migrates only after preview evidence),
and every applied run is recorded as a deployment revision record (see
[revision-registration.md](revision-registration.md)). Rollback is
forward-only migrations plus the documented restore path (see
[rollback.md](rollback.md)).

## Upstash (Redis Free) — acceleration and coordination ONLY

Cache, idempotency, rate limiting, leases, lightweight queue
coordination. **Redis is never canonical** — encoded, not aspirational
(`providers/upstash.ts`):

- namespaces are tier-prefixed: `sos:production:*`, `sos:preview:*`,
  `sos:local:*` (one namespace per purpose: `cache`, `idempotency`,
  `rate-limit`, `leases`, `queue`);
- every namespace declaration carries `canonical: false` — a declaration
  claiming canonicity is typed-rejected (`assertNeverCanonical`);
- every namespace carries a bounded TTL (cache 5 min, idempotency 24 h,
  rate-limit 1 min, leases 1 min, queue 1 h);
- all semantic writes go to Neon first; Redis entries are derivable and
  ephemeral. Losing the entire Redis database costs a cold cache and
  re-acquired leases — never semantic state.

## Cloudflare R2 (Free) — large immutable artifacts

Evidence, import and report objects. Semantic metadata and content
hashes stay in the durable semantic layer; R2 holds the bytes. The
contract (`providers/r2.ts`) fixes a single bucket with tier-isolated
prefixes — `production/`, `preview/<slug>/`, `local/` — and the immutable
object rules:

- objects are **write-once**: overwrite-mode operations are typed-rejected;
- object names carry a **content anchor** (hex, >= 8 chars) so identical
  content maps to identical keys;
- deletion happens only through the documented retention path, never from
  request handlers;
- keys may never cross tier prefixes — a preview operation referencing
  `production/` is typed-rejected.

## GitHub — source control, CI, observation feed

Source control and project state through the GitHub adapter (an adapter,
never an authority); webhooks/events feed the Observation Plane. The CI
topology contract (`providers/github.ts`) records the rules this Work
Order itself follows: GitHub auto-discovers workflows only at top-level
`.github/workflows/*.yml`, so deployment definitions live under
`.github/workflows/deployment/**` behind thin top-level callers; the
frozen `verify.yml` is never modified; deployment contract verification
runs offline with no credentials (see
[ci-contract-verification.md](ci-contract-verification.md)).

## Execution/body providers — replaceable execution mechanisms

Configuration contract in `infra/deployment/src/execution/body-providers.ts`
(structurally isolated from `packages/*` — pinned by tests that scan the
module source for forbidden import specifiers). A body advertises:
capabilities (`terminal`, `filesystem`, `repository-operations`,
`browser-ui`, `runtime-cloud-apis`, `ide-desktop`,
`deployment-operations`), isolation level (`none`…`account`), network
policy (none/allowlist/open — `none`+`open` is typed-rejected),
filesystem scope, cost envelope (bounded duration/memory/cost), task
lifecycle support (create mandatory; checkpoints or resume mandatory —
task state outlives body leases), and placement (`cloud`/`remote`/
`user-device`). Selection is capability-based, never vendor-based;
cloud/remote bodies keep working while the user's device is offline.
