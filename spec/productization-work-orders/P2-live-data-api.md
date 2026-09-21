# P2 — Live Persistence + API Boundary

Dependencies: P0
Owned paths: packages/live-store, packages/api-contracts, apps/api
Worker: B

Goal:
Replace fixture-only production reads/writes with durable provider-neutral repositories and APIs.

Support:
Mission, Context, SystemState, Evidence, Architecture, Candidate, Assurance, Experiment, Decision, AuthorityGrant, Package, history and development-state projections.

Acceptance:
- semantic IDs preserved
- exact revisions preserved
- truth states preserved
- provenance preserved
- idempotent writes
- stale revision detection
- provider adapters can target Neon, Upstash and R2 without changing domain packages
