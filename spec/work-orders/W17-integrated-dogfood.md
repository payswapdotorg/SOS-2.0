# W17 — Integrated Dogfood + Adversarial Verification

Dependencies: W11, W12, W13, W14, W15, W16
Owned paths: tests/dogfood, tests/adversarial, docs/evidence/dogfood
Parallel: all workers

Required adversarial classes:
stale System State; missing telemetry; contradictory evidence; unavailable dependency; malicious generated change; assurance monitor failure; rollback failure; package interaction failure; misleading confidence; architectural drift; diversity collapse; invalid authority; governance-weakening self-evolution.

Acceptance:
Every R1-R31 exercised with exact revision traceability.
