# P3 — Free-Tier Deployment Foundation

Dependencies: P0
Owned paths: infra, deployment configs, apps/web deployment files, docs/deployment

Worker: C

Goal:
Prepare Vercel Hobby + Neon Free + Upstash Redis Free + Cloudflare R2 Free.

Acceptance:
- local/preview/production environment contracts
- Vercel monorepo configuration
- Neon migrations/connectivity
- Redis configuration
- R2 configuration
- secret checks
- preview isolation
- deployment revision registration
- provider health diagnostics

Providers remain adapters, never semantic authorities.
