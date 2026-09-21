# P15 — Full Product Dogfood + Autonomous Build Rehearsal

Dependencies: P10, P12, P13, P14  
Owned paths: tests/product-dogfood, tests/accessibility, tests/autonomous-build, docs/evidence/productization  
All 3 workers participate

## Goal

Exercise SOS as a real product, not as a fixture-driven semantic demo.

## Required journeys

- first-time greenfield mission
- empty GitHub repository -> implementation
- brownfield repository onboarding
- continuous observation while no body is active
- anomaly -> summoned body -> evidence -> repair
- body interruption -> replacement -> resume
- provider outage
- user computer offline during cloud execution
- candidate / assurance / experiment / ASK
- promotion
- rollback
- package composition
- history
- self-evolution
- optional local companion / IDE/browser path

## Required negative cases

- stale state
- missing evidence
- contradictory evidence
- unknown/unavailable telemetry
- expired authority
- revoked authority
- unsafe candidate
- failed evaluation
- body crash
- task resume from checkpoint
- failed rollback
- demo/live-state confusion
- cross-project access attempt
- secret leakage attempt
- budget exhaustion

## Acceptance

A fresh user can start and complete the flagship journey without developer knowledge. The resulting repository, runtime, deployment and evidence graph are linked to exact revisions and all unresolved uncertainty is visible.
