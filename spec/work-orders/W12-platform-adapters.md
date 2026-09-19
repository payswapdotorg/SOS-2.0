# W12 — Platform + Runtime Adapters

Dependencies: W2, W3, W8, W10
Owned paths: packages/adapters, packages/runtimes, packages/deployment
Parallel slot: C

Goal:
Implement replaceable repository, runtime, deployment, telemetry and execution adapters.

Acceptance:
- adapters cannot redefine semantics
- execution is authority checked
- runtime feeds System State and Evidence
- platform behavior is Context/Adapter data
- failures preserve truth states
