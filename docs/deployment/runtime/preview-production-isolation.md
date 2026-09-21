# Preview / Production Isolation

**Preview NEVER mutates production.** This is enforced at the environment
schema layer, before any provider client exists — the machine-checked
implementation is `infra/deployment/src/environment/isolation.ts`, pinned
by `infra/deployment/test/isolation.test.ts`.

## How isolation is structural

Every environment tier derives a **resource footprint**: the set of
concrete provider resource identities the tier's configuration
references. Identities are tier-namespaced **by construction** — they are
built from the naming conventions, not discovered at runtime:

| Provider | Production identity | Preview identity | Local identity |
| --- | --- | --- | --- |
| Neon | `neon:database:sos`, `neon:branch:main` | `neon:database:sos_preview`, `neon:branch:preview/<slug>` | `neon:database:sos_local` |
| Upstash | `upstash:namespace:sos:production:<purpose>` (×5) | `upstash:namespace:sos:preview:<purpose>` | `sos:local:*` |
| R2 | `r2:prefix:production` | `r2:prefix:preview/<slug>` | `r2:prefix:local` |
| Vercel | `vercel:project:<id>:production` | `vercel:project:<id>:preview` | `vercel:project:<id>:none` |

Two gates make cross-tier contamination unrepresentable as a passing
state:

1. **Tier-match gate** (`assertFootprintMatchesTier`): re-derives the
   EXACT expected identity set for the footprint's tier from the same
   naming conventions and rejects any identity outside it. A preview
   footprint carrying `neon:database:sos` (production's database) is a
   typed `PreviewIsolationError` — there is no configuration shape in
   which it passes.
2. **Isolation gate** (`assertTierIsolation`): a preview footprint and a
   production footprint must share **zero** identities. Any collision is
   a typed rejection naming the colliding identity.

The same Vercel project id appearing in both tiers is legal — the
identity includes the environment dimension (`:preview` vs
`:production`); what must never collide are the STORES (databases,
namespaces, prefixes).

## Connection strings: public identity only

`DATABASE_URL` is a secret, and isolation must still reason about it.
The contract extracts ONLY the public database-name segment
(`neonDatabaseNameFromConnectionUrl`) and compares it against the tier's
declared database name. A preview source whose connection string points
at the production database is typed-rejected; the rejection message
names the expected tier identity and never contains credentials. This is
also why `NEON_DATABASE_NAME` is declared as a public variable: the
database name is an identity, not a credential.

## Operational rules

- Preview databases are **isolated Neon branches** (`preview/<slug>`),
  not the production branch. Preview migrations run first; production
  follows only after preview evidence.
- Preview Redis keys live in `sos:preview:*` namespaces — a preview
  cache flush can never touch production namespaces.
- Preview R2 objects live under `preview/<slug>/` with the same
  write-once immutability rules as production.
- Preview execution workspaces are isolated per body provider
  configuration (`placement` + filesystem scope); preview bodies never
  receive production credentials.

## Status

NOT_YET_DEPLOYED: no preview or production environment exists yet. The
isolation contract is verified by deterministic tests (typed rejections
for every cross-tier contamination class: wrong-database connection
strings, foreign footprints, wrong Vercel dimensions, shared
identities). When validation accounts exist, the live preview
provisioning MUST be generated from these same conventions so the
runtime reality cannot drift from the contract.
