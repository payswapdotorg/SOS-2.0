# infra/production-hardening — deployment hardening contracts (Work Order P14)

Status: **contracts + offline verification only**. These are declarative
hardening contracts extending the merged P3 deployment contract
conventions; the real enforcement endpoints (container/VM sandbox
limits, network policy engines, provider backup APIs) are
**NOT_YET_CONNECTED** and attach later as adapters realizing the same
declarations without contract change. Nothing here fabricates
enforcement evidence.

This tree is **not a workspace package** (no package.json): it is
verified offline by the thin caller below and by the acceptance suite
(`tests/production-hardening`), which imports these contracts directly
at test time. The CI story is architect-assembled.

## Offline verification (the thin caller)

```
node infra/production-hardening/scripts/verify.mjs
```

Runs every contract validator over the repo-standard declarations plus
a fail-closed probe set (malformed declarations MUST be
typed-rejected). No credentials, no network, no clocks.

## The contracts

| Module | Contract (pinned rules) |
| --- | --- |
| `src/tiers.ts` | The shared tier vocabulary (`local / preview / production`, P3-aligned) + tier-namespaced resource identities |
| `src/sandbox-limits.ts` | Sandbox/resource limit declarations — preview/production bodies are FULLY BOUNDED (unbounded budgets are unrepresentable); local relaxations are explicit |
| `src/network-policy.ts` | Network policy declarations — production egress is ALLOWLIST ONLY (`open` in production is unrepresentable); empty allowlists are `none` |
| `src/backup-restore.ts` | Backup/restore schedules — every durable store declares frequency, retention and RESTORE DRILLS; an unverified restore is a claim, not a recovery; Redis is never a backup subject (never canonical) |
| `src/tier-isolation.ts` | **PREVIEW CANNOT MUTATE PRODUCTION** — a mutation targeting a production-owned identity under preview context is a typed violation before any provider client exists; footprints share no identity |
| `src/rollback-wiring.ts` | Deployment rollback wiring through the P9 rollback action family — reason codes are exactly the P9 vocabulary, source shas are exact 40-hex, payloads carry no authority fields |

## Alignment with merged waves

- **P3** (`infra/deployment`): tier vocabulary, resource-identity
  footprints, preview/production isolation, the secrets corpus.
- **P8** (`packages/sandbox`): budget counters and resource envelopes
  (the sandbox policy discipline).
- **P9** (`packages/action-gateway`): the rollback action family
  payload and the authority re-evaluation discipline.

All alignments are document-alignment with INDEPENDENT typed
vocabularies; the equality of the vocabularies and the real
composition (e.g. a wiring-built payload validated through the REAL
P9 `validateRequest`) are pinned by the acceptance suite.

## Determinism

Pure functions over injected declarations: no `Date.now`, no
`Math.random`, no `fetch`, no `process.env`, no ambient timers, no
`child_process` in `src` or `scripts`.
