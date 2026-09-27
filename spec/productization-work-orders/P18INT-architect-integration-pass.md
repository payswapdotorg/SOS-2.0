# P18-INT — Architect Integration Pass (the A→B→C seam)

Dependencies: P18-A, P18-B, P18-C  
Owned paths: repository-wide integration-pass artifacts  
The architect integration pass over the three merged P18 lanes; the architect delivers + gates

## Goal

Turn the three merged lanes into ONE coherent live product: THE SEAM SWAP —
apps/web/app/live-mission/data-seam.ts delegates to lane A's real producer
(exported names byte-identical, ONE module-scope composition), lane C's
route-level journey suites ungated (the mounts exist), and the strictly
separated integration suites (deterministic 35-test offline suite + the
env-gated RUN_REAL=1 real integration suite) with the evidence package.

## Scope

- The seam swap itself is a deliberate cross-lane edit on a P18-B owned
  path — architect-authorized, flagged by the worker in the completion
  report + evidence README + ARCHITECTURE-DELTA (the mount-seams pins were
  re-pinned to the post-swap honest states with equal assertion strength;
  architect ruling: ACCEPTED).
- tests/live-ux/integration: the two strictly separated suites.
- docs/evidence/production-connectivity/live-ux/integration: the evidence
  package (README, seam diff record, provenance matrix, journey results,
  transcripts, ARCHITECTURE-DELTA.json, secrets audit).
- Branch wo/p18-integration; PR with per-requirement traceability; STATUS:
  WAITING_FOR_ARCHITECT — the architect gates, merges, reconciles P18.
