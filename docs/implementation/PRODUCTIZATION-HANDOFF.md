# SOS 2.0 Productization Tech Lead Handoff

The SOS W0-W18 core program is COMPLETE and frozen. Do not reopen it for ordinary product work.

Productization starts at P0 and is governed by:
- spec/productization-requirements.md
- spec/productization-roadmap.md
- spec/productization-state/implementation-state.json
- spec/productization-work-orders/*
- docs/ux/user-journey-simulation.md
- docs/ux/sharenet-inspired-design.md
- docs/deployment/free-tier-plan.md

## Important distinction

apps/console is the proven deterministic W11 reference harness.
It is not the production deployment surface.

apps/web becomes the production user-facing console.

The production web layer must consume the same domain packages and ui-contracts. It may not recreate SOS semantics.

## Current user-facing findings

The existing console successfully exposes all twelve architectural journeys and its tests cover them, but the journey simulation found four product-level problems:

1. fixture/live-state confusion is possible because the self-evolution view uses an intentionally frozen W11/W12 machine snapshot;
2. mission and brownfield onboarding are too engineering-oriented;
3. evidence, reconciliation and assurance are too table-heavy for primary navigation;
4. change lifecycle surfaces are individually correct but not yet one coherent task flow.

The productization plan addresses these without weakening the core semantics.

## First worker wave

After P0:

Worker A -> P1 Production Web Console Shell
Worker B -> P2 Live Persistence + API Boundary
Worker C -> P3 Free-Tier Deployment Foundation

Second wave:
A -> P4 Onboarding
B -> P5 Evidence + Reality Workspace
C -> P6 Candidate + Assurance + Experiment + ASK

Third wave:
A -> P7 Package/History/Self-Evolution UX
B -> P8 Live Actions + Identity/Authority
C -> P9 Production Hardening

Then all workers -> P10 Product Dogfood.
Architect -> P11 Product Release Gate.

## Product architecture

The production user loop is:

Mission
-> Current System State
-> Shortfall/Opportunity
-> Candidates
-> Assurance
-> Experiment
-> Decision or ASK
-> Promotion/Rollback
-> Evidence
-> Learning
-> Package/Repertoire update

The UI should make this loop visible.

## ShareNet-inspired interaction language

Use:
- calm warm-light shell;
- sparse content;
- persistent left rail on desktop;
- bottom navigation on mobile;
- dominant current-state hero;
- concise status blocks;
- timeline/topology for relationships;
- detail drawers/sheets;
- explicit loading/error/unknown/unavailable/partial states.

Do not copy ShareNet branding or semantics.

## Deployment

Target validation topology:
Vercel Hobby + Neon Free + Upstash Redis Free + Cloudflare R2 Free.

Provider roles are documented in docs/deployment/free-tier-plan.md.

No provider becomes a semantic authority.
Redis is never canonical.
Raw evidence payloads may live in R2, while semantic metadata remains in the Evidence Graph/durable database.

## Release standard

A productization Work Order is complete only after:
Architect gate
-> exact reviewed head merged
-> productization machine state reconciled.

P10 must simulate the product as a fresh human user, not merely execute unit tests.
