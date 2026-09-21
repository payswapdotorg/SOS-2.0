# SOS 2.0 — Architect Start Here

The W0-W18 SOS core is complete and frozen.

For core architecture questions, use:
spec/architecture.md
spec/architecture-lock.md
spec/meta-model.md
docs/evidence/final-gate/final-gate-audit.md

For current implementation/product work, use the post-W18 program:
spec/productization-requirements.md
spec/productization-execution-architecture.md
spec/productization-roadmap.md
spec/productization-state/implementation-state.json
spec/productization-work-orders/*
docs/ux/user-journey-simulation.md
docs/ux/sharenet-inspired-design.md
docs/deployment/free-tier-plan.md
docs/implementation/PRODUCTIZATION-HANDOFF.md

## Productization rule

Do not modify frozen SOS semantics to make the product or execution fabric easier.

Production UI, persistence adapters, observation adapters, reasoning providers, harnesses, body runtimes, GitHub adapters and identity adapters consume existing domain contracts and may not redefine them.

## Spirit / brain / body rule

- SOS is the persistent Spirit/control plane.
- LLMs/planners are replaceable reasoning mechanisms, never authorities.
- Harnesses/bodies are replaceable execution mechanisms, never authorities.
- A body lease is ephemeral; task state and evidence are durable.
- Cloud/remote bodies must not depend on the user's computer being online.
- Continuous observation must work without an active body.

## First dispatch

After P0:
Wave 1 -> Worker A P1, Worker B P2, Worker C P3.

Then follow the exact dependency graph in spec/productization-roadmap.md and implementation-state.json.

Workers stop at WAITING_FOR_ARCHITECT whenever they discover a possible frozen-contract change, semantic ambiguity, authority gap, or cross-owned-path dependency not already represented by the Work Order.

## Product review

The user journey must always answer:
What is happening?
Why does SOS believe this?
What evidence supports it?
What uncertainty remains?
What authority is required?
What can happen next?

The product must never make demo fixture state look like live state.
