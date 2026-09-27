# P18-A — Live Data Plane

Dependencies: P17-A, P17-B, P17-C  
Owned paths: apps/web/live-data, packages/web-contracts/live, tests/live-ux/data-plane, docs/evidence/production-connectivity/live-ux/data-plane  
Lane A of P18 (the live data plane); Workers deliver, Architect gates

## Goal

The server-only live data plane behind the seam: compose the real observation
drain, durable-store selection, and provider-health snapshot into the
live-mission data producer that every mission surface consumes through the
one-function seam.

## Scope

- apps/web/live-data: createLiveMissionDataProducer + the data-plane
  composition (honest provider states — CONNECTED / UNKNOWN / UNAVAILABLE /
  DEGRADED, never fabricated; freshness + provenance).
- packages/web-contracts/live: serializable live-action projections
  (pure, deterministic view types).
- infra/production-connectivity composition extensions behind the frozen
  P17-A adapters (that tree stays registered to P17-A; this lane's additions
  extend the composition without breaking its merged tests/evidence).
- tests/live-ux/data-plane: the two strictly separated suites — the
  deterministic reference-mode suite and the env-gated RUN_REAL=1 real
  data-plane evidence suite.

## Delivery

Merged as 780b75e (PR #39). State: COMPLETE.
