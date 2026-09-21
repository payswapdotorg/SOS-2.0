# SOS 2.0 Free-Tier Deployment + Execution Plan

Status: planned validation topology.

## Target control-plane topology

Vercel Hobby -> apps/web and lightweight API endpoints
Neon Free -> durable PostgreSQL semantic/application state
Upstash Redis Free -> cache, idempotency, rate limiting, leases and lightweight queue coordination
Cloudflare R2 Free -> large immutable evidence/import/report artifacts
GitHub Actions -> source/CI and bounded repository validation

Important: the control-plane web deployment must not be used as the hidden long-running worker. Autonomous execution is a replaceable external worker/body concern.

## Execution topology

```text
Vercel web/API
      |
      +---- durable task/state ----> Neon
      |
      +---- coordination ---------> Redis
      |
      +---- artifacts ------------> R2
      |
      +---- event/evidence <------- GitHub / CI / telemetry
      |
      +---- summon body ----------> Execution Fabric
                                      |
                              +-------+-------+
                              |               |
                         cloud body      remote/local body
```

The first reference body must be capable of bounded cloud execution. Higher-scale/long-running body providers remain adapters.

## Provider roles

Vercel:
Host the production Next.js console and lightweight request/response APIs. Do not rely on request lifetime for long-running autonomous work.

Neon:
Canonical durable product state: mission, System State projections, evidence metadata, task state, authority, decisions, experiments, packages and history.

Upstash:
Short-lived acceleration and coordination. Redis is never canonical.

Cloudflare R2:
Large immutable evidence/import/report objects. Semantic metadata and content hashes remain in the durable semantic layer.

GitHub:
Source control/project state through the GitHub adapter; webhooks/events feed Observation.

Execution body providers:
Provider-neutral adapters. A body must advertise capabilities, isolation, resource envelope and task lifecycle. User-device bodies are optional.

## Environment isolation

Local: deterministic fixtures plus local adapters.
Preview: isolated Neon branch, isolated Redis namespace/database, R2 preview prefix and isolated execution workspaces.
Production: isolated durable stores, execution workspaces and production artifact namespace.

Preview must never mutate production.

## User-device rule

Cloud/remote jobs continue while the user's computer is off.

Local-only jobs remain durable and queue until the local companion reconnects.

## Scheduled work

Low-frequency maintenance may use Vercel Hobby Cron. Long-running/high-frequency observation or orchestration belongs to an external worker/provider.

## Deployment acceptance

- UI production smoke tests
- durable DB
- Redis
- R2
- webhook/event ingestion
- observation/evidence persistence
- cloud body lease/execution smoke
- body-loss recovery
- exact deployment revision in System State
- rollback path
- preview isolation
- no secret leakage
- representative greenfield autonomous build smoke
