# @sos-2/cost-policy — cost + reliability policy contracts (Work Order P14)

Status: **contracts + deterministic reference implementations**. Real
billing systems, distributed rate-limit infrastructure and provider
status feeds attach later as adapters behind the same typed decisions;
those endpoints are **NOT_YET_CONNECTED**, and a policy that cannot be
evaluated honestly reports **UNKNOWN** — never a fabricated result.

## What this package owns

| Module | Contract |
| --- | --- |
| `src/budgets/budgets.ts` | Task concurrency/cost budgets — typed `ALLOW` / `BUDGET_EXCEEDED` / `ACCOUNTING_UNKNOWN` (incomplete accounting is honest UNKNOWN, never a guessed allowance; exceeded budgets are hard typed denials with no 11th-hour fabrication) |
| `src/rate-limit/limiter.ts` | Rate limiting over action/executor invocations — typed policies, deterministic fixed-window reference limiter, computed retry-after hints (the P2 typed-outcome discipline) |
| `src/health/provider-health.ts` | Provider health — `UNKNOWN \| UNAVAILABLE \| DEGRADED \| HEALTHY` with honest UNKNOWN during outage windows; HEALTHY only with complete positive probe evidence (aligned with the merged P3 aggregate, pinned by the acceptance suite) |
| `src/dead-letter/dead-letter.ts` | Dead-letter/retry handling — bounded retry with capped exponential backoff, then a typed ASK escalation; never a silent drop, never an infinite retry; durable §6 recovery state survives body replacement |
| `src/abuse/containment.ts` | Abuse containment — abuse signatures suspend the task pending ASK; the suspension is observed evidence (typed record), never silent termination |

## Non-negotiables encoded

- **Never silently guessed**: incomplete budget accounting answers
  `ACCOUNTING_UNKNOWN`; an unprobed provider answers `UNKNOWN`.
- **Never silent drop / never infinite retry**: every failure lands in
  a typed dead-letter record; retries are bounded by construction; the
  exit is a first-class ASK (W10 discipline), never an exception.
- **Suspended, not terminated**: abuse containment suspends pending a
  human ASK — autonomous containment never makes the final call.
- **Redis/queues never canonical** (§13): the rate limiter is a
  coordination mechanism; the typed decisions are the contract.

## Zero-dependency discipline

This workspace package declares ZERO dependencies so `pnpm-lock.yaml`
remains byte-identical and `pnpm install --frozen-lockfile` passes at
this base (the P3 `infra/deployment` precedent). The test toolchain
(tsc, vitest) is borrowed at run time from the frozen W17 adversarial
suite:

```
pnpm --filter @sos-2/cost-policy run typecheck
pnpm --filter @sos-2/cost-policy run test
pnpm --filter @sos-2/cost-policy run verify:zero-deps
```

## Determinism

No `Date.now`, no `Math.random`, no `fetch`, no `process.env`, no
ambient timers, no `child_process` in `src` — time is injected
(`Clock`), and every test run uses the fixed vitest seed (424242).
