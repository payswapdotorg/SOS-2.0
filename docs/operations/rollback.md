# Deployment rollback

Production rollbacks go through the **P9 rollback action family**:
every rollback is an authority-gated action with current authority
re-evaluated at action time, a typed payload, and evidence produced for
the outcome. There is no out-of-band rollback path.

## The rollback payload (typed wiring)

A rollback is declared as a wiring record
(`infra/production-hardening/src/rollback-wiring.ts`) and submitted as
a P9 `rollback` action:

```
family:      rollback
deploymentId:      the provider-assigned deployment id being rolled back
fromSourceSha:     exact 40-hex sha currently deployed
toSourceSha:       exact 40-hex sha to return to
reason.code:       FAILED_VERIFICATION | INCIDENT | MANUAL_DIRECTIVE
reason.detail:     what happened
```

Contract rules (typed, fail-closed):

- source shas are exact 40-hex (the exact-head rule);
- `fromSourceSha` and `toSourceSha` must differ (a no-op rollback is
  malformed);
- reason codes are exactly the P9 vocabulary;
- the payload carries NO authority fields — the gateway re-evaluates
  current authority at action time. A stale or expired grant fails
  closed: the rollback is DENIED, never executed on planning-time
  authority.

## The rollback procedure

1. **Verify the trigger.** `FAILED_VERIFICATION` requires the failed
   verification evidence; `INCIDENT` requires the incident record;
   `MANUAL_DIRECTIVE` requires the human directive reference. Rollback
   without evidence is not representable.
2. **Build the wiring record** (environment, deployment id, from/to
   shas, reason, actor). Validation is offline and typed.
3. **Submit through the action gateway** under current authority. The
   gateway:
   - re-evaluates authority (deny → typed denial, executor never
     invoked);
   - executes the provider rollback through the executor seam;
   - emits `rollback.outcome` evidence bound to the exact revisions;
   - verifies the rollback (the observed post-rollback source sha vs
     the expected `toSourceSha`) — an unobserved rollback verifies as
     UNKNOWN, never as assumed success.
4. **Record the rollback** in the deployment revision chain (the
   rollback pointer must extend the actual chain — re-registration
   rules apply).
5. **Observe recovery.** Post-rollback health comes from observations,
   not from the rollback's own success receipt.

## When to roll back vs. roll forward

- Roll back when: verification failed on the deployed revision; an
  incident is active and the previous revision is the known-good
  state; a human directive says so.
- Roll forward when the failure is a fixable defect with a reviewed
  fix — through the normal action path (commit → PR → deploy), never
  by mutating the rollback chain.

## Honest status

The wiring contract and payload shape are machine-verified offline
(the acceptance suite validates a wiring-built payload through the
REAL P9 `validateRequest`); the real provider rollback executors are
NOT_YET_CONNECTED and attach as adapters behind the same action
family.
