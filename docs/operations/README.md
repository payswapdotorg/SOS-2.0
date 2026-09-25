# SOS 2.0 Operations Runbook (Work Order P14)

Status: **reference-implementation runbook**. The procedures below are
written against the P14 hardening contracts
(`packages/security`, `packages/cost-policy`,
`infra/production-hardening`) and the merged observation/action planes
(P7, P9). Where a step depends on a real enforcement endpoint that is
**NOT_YET_CONNECTED** (real platform sandboxing, real secret stores,
real network policy engines, real provider backup APIs, real billing
feeds), the runbook says so explicitly — a real deployment MUST wire
that adapter before relying on the step.

Demo fixtures are never production state; nothing in this runbook
treats them as such.

## What this directory is

The complete operational runbook for running autonomous execution
safely and diagnosably under real provider, network, task and user
failure: diagnosis procedures, outage playbooks, backup/restore,
rollback, abuse response and budget exhaustion.

When a rule here and the machine-checked contract in the owning package
ever disagree, the code is the authority and this page is a defect;
file it.

## Pages

| Page | What it covers |
| --- | --- |
| [diagnosis.md](diagnosis.md) | Symptom → responsible task/body/provider: the audit + observation diagnosis procedure |
| [outage-playbooks.md](outage-playbooks.md) | Provider / network / task / user failure playbooks (honest UNKNOWN discipline) |
| [backup-restore.md](backup-restore.md) | Backup schedules, restore procedure, restore drills |
| [rollback.md](rollback.md) | Deployment rollback through the P9 rollback action family |
| [abuse-response.md](abuse-response.md) | Abuse signature response: suspension pending ASK |
| [budget-exhaustion.md](budget-exhaustion.md) | Budget exhaustion: typed denial, checkpoint, ASK |

## The five rules everything else derives from

1. **Fail closed.** Cross-project workspace access, secret leakage,
   scope escalation and budget exhaustion are typed denials — never
   silent passes, never guessed allowances.
2. **Honest UNKNOWN.** A provider with no observations, a budget with
   incomplete accounting and a policy that cannot be evaluated
   honestly report UNKNOWN — never a fabricated HEALTHY, a guessed
   UNAVAILABLE or a silently guessed allowance.
3. **Every decision is audited.** Every allow/deny/redact/unknown
   policy decision appends a durable, replay-safe, content-addressed
   audit record through the P7 event discipline. The audit trail is
   never a second source of truth — but it is always the first place
   to look.
4. **Bounded, then ASK.** Retries are bounded with capped backoff;
   budget exhaustion checkpoints; abuse suspends. The exit is always a
   first-class ASK — never a silent drop, never an infinite loop,
   never an autonomous final call.
5. **Preview never mutates production.** Separate stores per tier;
   cross-tier mutations are typed rejections before any provider
   client exists.

## What is reference-implementation only (honest status)

The following are contracts + deterministic reference implementations,
verified offline. A real deployment must wire the real adapter:

| Surface | Reference today | Real deployment must wire |
| --- | --- | --- |
| Workspace isolation | typed decision over task/project context | platform filesystem/container isolation per project |
| Secrets isolation | pattern corpus + redaction at the observation boundary | real secret store + platform-level egress redaction |
| Credential scoping | typed scope records | real credential issuance with the same scope discipline |
| Rate limiting | deterministic in-process limiter | distributed limiter (coordination store — never canonical) |
| Budgets | injected accounting ledger | real cost feeds (provider billing, metered usage) |
| Provider health | injectable probe reports | real probes against provider status endpoints |
| Sandbox limits / network policy | declarations + offline verification | container/VM limits, real network policy engine |
| Backups | schedules + typed restore records | provider backup APIs + scheduled restore drills |
| Dead-letter queue | typed records + bounded retry policy | durable queue infrastructure (never canonical) |

## Quick index by symptom

| Symptom | Start at |
| --- | --- |
| Actions denied, nothing executes | [diagnosis.md](diagnosis.md) § denied actions |
| Secret-shaped content in an artifact/log | [diagnosis.md](diagnosis.md) § secret redactions |
| Task stopped, "budget exceeded" | [budget-exhaustion.md](budget-exhaustion.md) |
| Actions throttled, "rate limited" | [diagnosis.md](diagnosis.md) § rate limiting |
| Provider behaving oddly | [outage-playbooks.md](outage-playbooks.md) § provider failure |
| Task dead-lettered | [outage-playbooks.md](outage-playbooks.md) § task failure |
| Task suspended for abuse | [abuse-response.md](abuse-response.md) |
| Deployment must come out | [rollback.md](rollback.md) |
| Data must come back | [backup-restore.md](backup-restore.md) |
