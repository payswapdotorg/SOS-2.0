# SOS 2.0 Deployment Runtime Operations

Status: **NOT_YET_DEPLOYED** — configuration contracts and operating rules
only. Validation accounts for Vercel / Neon / Upstash / R2 are **pending**;
no real deployment or provider evidence exists yet, and none is fabricated
anywhere in this tree. Everything here is contract-verified (machine-checked
by the deterministic suites in `infra/deployment` and enforced by the
`deploy-contract.yml` CI workflow); real-system evidence arrives when the
validation accounts exist and later waves wire real applications into these
contracts.

## What this directory is

This directory is the runtime operations documentation for the free-tier
validation topology defined by `docs/deployment/free-tier-plan.md` (the
topology contract — Vercel Hobby / Neon Free / Upstash Redis Free /
Cloudflare R2 Free / GitHub Actions). Work Order P3 delivered the
configuration-as-code foundation: typed environment contracts, provider
configuration modules, preview isolation, secret policy, deployment
revision registration, provider health diagnostics, execution/body
provider configuration, and the long-running work delegation boundary.

Later waves (live data, web console, execution fabric) consume these
contracts — they do not redefine them. When a rule in these pages and the
machine-checked contract in `infra/deployment/src` ever disagree, the code
is the authority and the docs are a defect; file it.

## Pages

| Page | What it covers |
| --- | --- |
| [environment-matrix.md](environment-matrix.md) | The local/preview/production variable matrix, secret classification, fail-closed loading |
| [provider-roles.md](provider-roles.md) | Vercel / Neon / Upstash / R2 / GitHub / body provider roles and configuration contracts |
| [preview-production-isolation.md](preview-production-isolation.md) | Preview NEVER mutates production: footprints, typed rejections |
| [revision-registration.md](revision-registration.md) | Deployment revision records, the registrar flow, System State wiring |
| [provider-health-runbook.md](provider-health-runbook.md) | UNKNOWN / UNAVAILABLE / DEGRADED / HEALTHY semantics and the probe runbook |
| [long-running-delegation.md](long-running-delegation.md) | Vercel request lifetime never owns long-running work |
| [rollback.md](rollback.md) | The rollback path per provider and the rollback pointer chain |
| [secret-handling.md](secret-handling.md) | Secret classification, redaction, CI scanning, never-echo rules |
| [ci-contract-verification.md](ci-contract-verification.md) | What `deploy-contract.yml` verifies and why it needs no credentials |

## The three rules everything else derives from

1. **Preview never mutates production.** Separate stores per environment
   tier; cross-tier resource references are typed-rejected before any
   provider client exists.
2. **Redis is never canonical.** Neon is the durable semantic store;
   Upstash is acceleration and coordination with bounded TTLs. Losing
   Redis costs a cold cache, never semantic state.
3. **The web request runtime never owns long-running work.** Durable
   tasks delegate to an external worker/body provider; the request
   runtime records intent, reads state, reports progress — nothing more.
