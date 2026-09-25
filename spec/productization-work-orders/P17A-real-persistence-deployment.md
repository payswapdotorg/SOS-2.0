# P17-A — Real Persistence + Deployment

Dependencies: P16  
Owned paths: packages/real-persistence, packages/deployment-providers, infra/production-connectivity, tests/real-persistence, docs/evidence/production-connectivity/persistence-deployment  
Lane of P17 (persistence/deployment); Workers deliver, Architect gates

## Goal

Replace reference infrastructure with the actual free-tier topology already specified by the
existing deployment contracts: `Vercel → Neon → Upstash → R2 → GitHub Actions`.

## Scope

- Real persistence adapters behind the existing store contracts: Neon Postgres (durable live
  state), Upstash Redis (rate limiting / ephemeral coordination), Cloudflare R2 (objects,
  evidence bundles) — composition per the free-tier plan.
- Real deployment provider surface (Vercel) wired through the existing deployment contracts.
- Provider health/failure surfaces with honest machine-checkable states:
  `CONNECTED`, `UNKNOWN`, `UNAVAILABLE`, `DEGRADED` — never fabricated HEALTHY/CONNECTED.
- Secrets only via environment; never committed; never logged in evidence.
- Deterministic reference-mode tests remain green and untouched; real-provider integration
  tests are added separately and record real outcomes (including failures).

## Evidence requirements

- Exact provider identifiers, regions and revisions for every connected resource.
- Real connectivity transcripts (startup probes, health checks, failure paths).
- Deployment records carrying `source_revision_sha` bound to the deployed head.
- Connectivity evidence — not merely configuration validation.

## Acceptance

The live store, rate limiting, object storage and deployment are backed by the real free-tier
providers; every provider state is machine-checkable and honest; deterministic reference-mode
tests pass unchanged; real-provider integration tests run separately with recorded outcomes.

## Completion

Branch + independent architect gate + PR + CI + squash-merge + machine-state reconcile.
Workers stop at WAITING_FOR_ARCHITECT on contract ambiguity, provider lock-in risk or
cross-owned-path needs.
