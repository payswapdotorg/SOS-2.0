# P9 — Authority-Gated Actions + Independent Evaluation

Dependencies: P5, P6, P7, P8  
Owned paths: packages/action-gateway, packages/evaluator, packages/evaluation-orchestration, apps/web/action-components, tests/actions-and-evaluation  
Worker: C in wave 4

## Goal

Connect real-world actions and completion checks to the existing Authority, Assurance, Decision and Evidence semantics.

## Actions

- commit/push/PR
- deployment
- configuration changes
- remediation
- promotion
- rollback
- body lifecycle actions

## Evaluation

Independent evaluators may use:

- tests
- static/contract checks
- browser journeys
- runtime verification
- security checks
- mission metrics
- deployment checks

## Acceptance

- every consequential action re-evaluates current authority
- expired/revoked grants fail closed
- body cannot approve its own output
- evaluation evidence is linked to exact source/deployment revisions
- failed evaluations feed repair/retry or ASK
- rollback produces evidence
- action idempotency and replay protection work
