# Rollback Path

The rollback story composes three layers, all contract-first: the
deployment revision chain (where we were), the provider-level restore
mechanisms (how we go back), and the bounded-recovery discipline
inherited from the frozen core (who may trigger it).

## Layer 1 — the revision chain (authoritative record)

Deployment revision records form an append-only chain per
environment+provider (see
[revision-registration.md](revision-registration.md)). The rollback
target for any current deployment is the **previous deployment revision
id** — resolvable via `registrar.rollbackTarget(environment, provider)`.
The chain cannot lie: a record whose rollback pointer does not extend
the actual chain is rejected at registration time, and re-registration
of an existing revision id is rejected (append-only). Rolling back
therefore means: resolve the pointer, redeploy the source sha recorded
for that revision, then register the rollback as a NEW revision record
(history grows; nothing is rewritten).

## Layer 2 — provider-level restore mechanisms

| Provider | Rollback mechanism | Notes |
| --- | --- | --- |
| Vercel | Instant rollback to the previous production deployment (built-in per-project deployment history) | The fastest path for the web tier; still recorded as a new revision record afterwards |
| Neon | Forward-only migrations + point-in-time restore | Schema changes are forward-only; data-level recovery uses Neon's PITR window on the free tier; preview migrations run first so production rollback needs are minimized |
| Upstash | None required — never canonical | Redis loss costs a cold cache / re-acquired leases / replayed idempotency checks; the never-canonical gate guarantees no semantic state needs restoring |
| R2 | Objects are immutable + content-anchored | Old object versions never disappear by overwrite; a rollback never needs R2 mutation — consumers re-resolve keys through the semantic layer |
| GitHub | Git revert / redeploy from the reverted head | Source control is inherently revisioned; CI re-runs the contract verification on the reverted head |

## Layer 3 — authority (inherited, not redefined)

Live changes require bounded recovery (the frozen W8/W12 discipline):
rollback declarations carry mechanism, trigger and authority. The
deployment revision record's rollback pointer records WHERE to roll back
to; the decision to roll back still belongs to the authority chain
defined by the frozen core (`packages/recovery-control`,
`packages/deployment` — consumed, not duplicated here). P3 deliberately
adds no new authority: rolling back production remains an
authority-gated action, never autonomous.

## Preview rollback

Preview environments roll back freely (they are disposable validation
surfaces): redeploy the previous revision or rebuild the preview branch.
The isolation contract (see
[preview-production-isolation.md](preview-production-isolation.md))
guarantees a preview rollback can never touch production stores — the
typed gates reject cross-tier references before any provider client
exists.

## Status

NOT_YET_DEPLOYED: no real rollback has been exercised — no deployment
exists to roll back. The contract-verified parts: the rollback pointer
chain semantics (typed rejections for broken chains), the
provider-mechanism table above (documented from provider capabilities),
and the discipline that every rollback registers a new revision record.
First live rollback drill happens when the validation accounts exist —
and it starts in preview, like everything else.
