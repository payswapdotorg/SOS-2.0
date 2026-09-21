# P2 — Live Persistence + API + Observation Boundary

Dependencies: P0  
Owned paths: packages/live-store, packages/api-contracts, apps/api  
Worker: B in wave 1

## Goal

Replace fixture-only production reads/writes with durable provider-neutral repositories and the event boundary used by the persistent Spirit and Observation Plane.

## Support

Mission, Context, SystemState, Evidence, Architecture, Candidate, Assurance, Experiment, Decision, AuthorityGrant, Package, history, development state, task state, body lease state and observation events.

## Acceptance

- semantic IDs and exact revisions preserved
- truth states and provenance preserved
- idempotent writes and stale-revision detection
- durable task/checkpoint records
- event ingestion with replay protection
- provider adapters can target Neon, Upstash and R2 without changing domain packages
- Redis is never canonical
- webhook/telemetry/provider failure remains explicit UNKNOWN/UNAVAILABLE where appropriate
