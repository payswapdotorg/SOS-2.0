# SOS 2.0 Free-Tier Deployment Plan

Status: planned. No provider deployment is currently evidenced in the SOS-2.0 repository.

## Target topology

Vercel Hobby -> production web console and lightweight API
Neon Free -> durable PostgreSQL state
Upstash Redis Free -> cache, idempotency, rate limiting and lightweight queues
Cloudflare R2 Free -> large evidence/import/report artifacts
GitHub Actions -> source/CI

## Provider roles

Vercel:
Host apps/web. Current official Hobby documentation lists a $0 plan with previews and automatic CI/CD, but Hobby is for personal/non-commercial use. Revisit plan before commercialization.

Neon:
Store structured durable application state. Current Free plan documentation lists free projects/branches/compute/storage allowances and scale-to-zero.

Upstash:
Use only for ephemeral acceleration/coordination. Current Free Redis includes 256 MB data, 10 GB monthly bandwidth and 500K monthly commands.

Cloudflare R2:
Use for unstructured artifacts. Current free allowance includes 10 GB-month Standard storage, 1M Class A requests and 10M Class B requests monthly, with free Internet egress.

## Web architecture

Create apps/web as the production Next.js app.
Keep apps/console as the deterministic reference harness.
Both consume the same domain and ui-contract packages.
Never copy domain semantics into the web layer.

## Persistence

Neon stores:
mission projections
context projections
System State projections
artifact indexes
evidence metadata
authority grants
decisions
experiments
package registry metadata
history

R2 stores:
repository snapshots
import files
telemetry batches
experiment artifacts
generated reports
large immutable evidence objects

Store content hashes and R2 object references in the semantic/evidence layer.

Upstash stores:
short-lived cache
idempotency keys
rate limits
job leases
lightweight queue state

Redis is never canonical.

## Environment isolation

Local: fixtures plus local adapters.
Preview: isolated Neon branch, isolated Redis namespace/database, R2 preview prefix.
Production: isolated Neon project/branch, Redis database, R2 production prefix.

Preview must never mutate production state.

## Scheduled work

Vercel Hobby Cron is acceptable only for low-frequency maintenance because Hobby scheduling is once per day. Higher-frequency orchestration moves to another worker/provider or a paid tier.

## Deployment acceptance

- UI production smoke tests
- database connectivity
- Redis connectivity
- R2 read/write
- evidence persistence
- exact deployment revision in System State
- rollback path
- preview isolation
- no secret leakage
- representative journey smoke suite
