# @sos-2/security — security hardening contracts (Work Order P14)

Status: **contracts + deterministic reference implementations**. Real
platform enforcement (container-level workspace isolation, real secret
stores, real network policy engines) attaches later as adapters behind
the same typed decisions; those endpoints are **NOT_YET_CONNECTED**, and
a policy that cannot be evaluated honestly reports **UNKNOWN** — never a
fabricated enforcement result.

## What this package owns

| Module | Contract |
| --- | --- |
| `src/isolation/workspace.ts` | Workspace isolation — cross-project workspace access is a typed `ISOLATION_DENIED` (fail-closed, terminal, no override path) |
| `src/secrets/redaction.ts` | Secrets isolation — secret-shaped emissions into artifacts/logs are `PASSED_REDACTED` or `DENIED_SECRET_LEAK`; findings carry pattern ids/positions, never matched text; the redaction itself is observed (audit fact) |
| `src/credentials/scopes.ts` | Credential scoping over the P9 action families — scoped-to-X cannot mint Y (`SCOPE_EXCEEDED`), expired fails closed (`CREDENTIAL_EXPIRED`), broker escalation is a typed violation |
| `src/audit/audit.ts` | The policy audit trail — every ALLOW/DENY/REDACT/UNKNOWN decision appends a replay-safe, content-addressed record through the P7 event discipline (the P2 `ObservationEventInput` field set) |
| `src/diagnostics/diagnostics.ts` | Operational diagnostics — symptom → responsible task/body/provider attribution from audit trace links; `INSUFFICIENT_EVIDENCE` when the records do not say |

## Non-negotiables encoded

- **Policies are mechanisms, never authorities** (ARCHITECT_START_HERE):
  a policy record is injected data; enforcement never mints authority.
- **Fail-closed**: malformed requests, unknown credentials and incomplete
  evaluations are denials/UNKNOWN — never silent passes.
- **Stale authority fails closed**: an expired credential is denied with
  no grace period (composed with the P9 gateway in the acceptance suite).
- **Secrets by reference, never value**: this package contains no
  credential values by construction; findings never carry matched text.
- **The audit trail is not a second source of truth**: audit events are
  pre-semantic observations about decisions; they never mint authority
  and never redefine state.
- **LLM output is never authoritative** evidence for any decision here.

## Zero-dependency discipline

This workspace package declares ZERO dependencies so `pnpm-lock.yaml`
remains byte-identical and `pnpm install --frozen-lockfile` passes at
this base (the P3 `infra/deployment` precedent, empirically re-verified
for P14). The test toolchain (tsc, vitest) is borrowed at run time from
the frozen W17 adversarial suite:

```
pnpm --filter @sos-2/security run typecheck
pnpm --filter @sos-2/security run test
pnpm --filter @sos-2/security run verify:zero-deps
```

Cross-package composition (the real P9 gateway, the P3 secrets corpus,
the P2 event-record contract) is verified in
`tests/production-hardening` (the acceptance suite), which imports the
merged packages directly at test time.

## Determinism

No `Date.now`, no `Math.random`, no `fetch`, no `process.env`, no
ambient timers, no `child_process` in `src` — time is injected
(`Clock`), identities are content addresses, and every test run uses the
fixed vitest seed (424242).
