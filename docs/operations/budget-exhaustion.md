# Budget exhaustion

Bounded execution cost is a hard contract: when a task exceeds a
declared budget, the answer is a typed BUDGET_EXCEEDED denial — there
is no 11th-hour fabrication, no grace budget, no silent continuation.

## The budget surfaces

| Counter | Meaning | Exhaustion behavior |
| --- | --- | --- |
| `concurrentTasks` | simultaneously running tasks per mission | new task start is denied |
| `costUnits` | cumulative cost (provider-metered units) | further consumption is denied |
| `elapsedMs` | wall-clock duration per task | the task must checkpoint and stop |

## The exhaustion procedure

1. **The denial is typed.** The decision names the counter, the limit,
   the consumed amount and the task. The audit trail records the DENY.
   Nothing continues past the limit "just to finish" — that path is
   unrepresentable.
2. **Checkpoint the task (§6).** A duration-exhausted task
   checkpoints: plan state, produced artifacts, observations and
   unresolved uncertainty persist. The task is resumable by decision,
   not lost.
3. **Incomplete accounting is honest UNKNOWN.** A budget decision over
   incomplete accounting is ACCOUNTING_UNKNOWN — never a guessed
   allowance, never a guessed denial. The operational response is to
   REPAIR the accounting feed (the real cost feeds are
   NOT_YET_CONNECTED reference seams today), then re-evaluate.
4. **Escalate to ASK when more budget is genuinely needed.** Raising a
   budget is a human decision (it is spending authority): the ask
   carries the task, the exhausted counter, the consumed amounts and
   the justification. The system never grants itself more budget.
5. **Distinguish exhaustion from abuse.** A task that repeatedly burns
   its budget may be exhibiting `budget-sprint` (see
   [abuse-response.md](abuse-response.md)) — the signature path
   applies; exhaustion alone is a normal, typed outcome.

## Mission-level view

Budgets are per task with mission-level concurrency caps: a mission's
aggregate spend is the sum of its tasks' ledgers. Mission exhaustion
denies new task starts (concurrency) and further consumption (cost)
across the mission's tasks.

## What budget exhaustion never does

- Never fabricates an allowance when the ledger says the limit is
  reached (no "almost done" exceptions).
- Never guesses when accounting is incomplete (UNKNOWN is the honest
  answer; repairing the feed is the fix).
- Never widens its own limits (the ask queue is the only path).
- Never treats demo fixture budgets as production limits.
