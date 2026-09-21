# P14 — Production Hardening, Security, Cost + Reliability

Dependencies: P3, P6, P7, P8, P9, P11  
Owned paths: infra/production-hardening, packages/security, packages/cost-policy, tests/production-hardening, docs/operations  
Worker: C in wave 5

## Goal

Make autonomous execution safe and diagnosable under real provider, network, task and user failure.

## Scope

- sandbox/resource limits
- secrets isolation
- credential scoping
- body network policy
- task concurrency/cost budgets
- rate limiting
- audit trail
- provider health
- backups/restore
- dead-letter/retry handling
- abuse containment
- deployment rollback
- preview/production isolation

## Acceptance

- no cross-project workspace access
- no secret leakage through artifacts/logs
- bounded execution cost
- stale/expired authority fails closed
- body crash and provider outage recover cleanly
- preview cannot mutate production
- operational diagnostics identify the responsible task/body/provider
- complete runbook exists
