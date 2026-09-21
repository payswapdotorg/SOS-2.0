# P8 — Live Actions + Identity/Authority Integration

Dependencies: P2, P3, P4, P6
Owned paths: packages/auth-adapter, packages/action-gateway, apps/web action components
Worker: B

Goal:
Connect real actions to identity, AuthorityGrant and execution adapters.

Acceptance:
- authentication identity separated from SOS authority
- every action re-evaluates current authority
- expired/revoked grants fail closed
- ASK resolution produces DecisionRecord
- execution produces Evidence
- rollback produces Evidence
- action idempotency and replay protection
