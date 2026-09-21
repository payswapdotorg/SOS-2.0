# SOS 2.0 — Architect Start Here

The W0-W18 SOS core is complete and frozen.

For core architecture questions, use:
spec/architecture.md
spec/architecture-lock.md
spec/meta-model.md
docs/evidence/final-gate/final-gate-audit.md

For current implementation/product work, use the post-W18 productization program:
spec/productization-roadmap.md
spec/productization-state/implementation-state.json
spec/productization-work-orders/*
docs/ux/user-journey-simulation.md
docs/ux/sharenet-inspired-design.md
docs/deployment/free-tier-plan.md
docs/implementation/PRODUCTIZATION-HANDOFF.md

## Productization rule

Do not modify frozen SOS semantics to make the UI easier.

Production UI, persistence adapters, provider integrations and identity adapters consume the existing domain contracts.

## First dispatch

After P0 is accepted:
Worker A -> P1
Worker B -> P2
Worker C -> P3

Maintain up to three workers with disjoint owned paths.

## Product review

The user journey must always answer:
What is happening?
Why does SOS believe this?
What evidence supports it?
What uncertainty remains?
What authority is required?
What can happen next?

The product must never make demo fixture state look like live state.
