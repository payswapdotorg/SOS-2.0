# P3 — Free-Tier Deployment Foundation

Dependencies: P0  
Owned paths: infra/deployment, .github/workflows/deployment, docs/deployment/runtime  
Worker: C in wave 1

## Goal

Prepare the validation deployment and execution infrastructure boundaries.

## Acceptance

- local/preview/production environment contracts
- Vercel monorepo configuration
- Neon migrations/connectivity
- Redis configuration
- R2 configuration
- secret checks
- preview isolation
- deployment revision registration
- provider health diagnostics
- execution/body provider configuration isolated from semantic packages
- long-running work can be delegated to an external worker/provider rather than depending on Vercel request lifetime

Providers remain adapters, never semantic authorities.
