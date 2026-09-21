# P10 — Product Dogfood + Accessibility + Deployment Rehearsal

Dependencies: P7, P8, P9
Owned paths: tests/product-dogfood, tests/accessibility, docs/evidence/productization

All three workers participate.

Goal:
Simulate the full product as a human user and verify discoverability, truthfulness and action safety.

Required journeys:
greenfield onboarding
brownfield onboarding
reality/drift investigation
evidence investigation
candidate selection
assurance objection
experiment
ASK resolution
promotion
rollback
package composition
history
self-evolution

Required negative scenarios:
stale state
missing evidence
provider outage
expired authority
contradictory evidence
unsafe candidate
failed rollback
demo/live-state confusion

Acceptance:
Fresh user can complete representative greenfield and brownfield tasks without developer knowledge.
All consequential states expose rationale/evidence/authority.
Accessibility checks pass.
Deployment rehearsal produces deterministic evidence bundle.
