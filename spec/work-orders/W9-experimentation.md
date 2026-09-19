# W9 — Experimentation + Promotion/Rollback

Dependencies: W2, W3, W6
Owned paths: packages/experiments, packages/promotion
Parallel slot: C

Goal:
Implement the controlled evolution plane against the frozen CandidateState, AssuranceCase and Evidence contracts.

Parallelization rule:
W9 must be implementable without W7/W8 source dependencies. Use contract fixtures/stubs for candidate generation and assurance results. Final integration is verified through W10 and later dogfood gates.

Acceptance:
- population/allocation/treatment/control semantics
- primary/secondary/guardrail metrics
- shadow/canary/experiment lifecycle
- stopping and rollback triggers
- results linked to candidate and causal hypothesis
- promotion checks current authority, assurance and evidence
- integration contracts remain compatible with W7 and W8
