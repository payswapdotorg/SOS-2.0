# P9 — Production Hardening + Observability

Dependencies: P3, P4, P5, P6, P7, P8
Owned paths: infra/observability, docs/operations, tests/production

Worker: C

Goal:
Make the deployed product observable, diagnosable and safe under provider/runtime failures.

Acceptance:
- deployment health checks
- DB/Redis/R2 health checks
- structured request and decision tracing
- provider outage truth states
- rate limits
- audit trail
- backup/restore rehearsal
- preview isolation
- no secret leakage
- operational runbook
