# P7 — Continuous Observation + System Monitoring Plane

Dependencies: P2, P3  
Owned paths: packages/observation, packages/event-ingestion, packages/telemetry-runtime, apps/observation, tests/observation  
Worker: A in wave 3

## Goal

Allow SOS to continuously understand system state without keeping a permanent coding body alive.

## Inputs

- GitHub repository/webhook events
- CI/build/test/security events
- deployment events
- runtime logs, metrics and traces
- incidents/provider health
- scheduled repository/runtime probes
- explicit user observations

## Behavior

Observation -> Evidence -> System State reconciliation -> shortfall/opportunity detection.

Use scheduled probes only where event/telemetry coverage is insufficient.

## Acceptance

- a complete observation loop works while no body is active
- GitHub push/PR events update live projections
- runtime/CI evidence preserves truth states and provenance
- stale/unavailable observation is distinguishable from success
- observation events are replay-safe
- observation does not mutate semantic truth outside authoritative domain stores
