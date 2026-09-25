# Abuse response

A task exhibiting abuse signatures is **suspended pending ASK** — the
suspension is observed evidence, never a silent termination. The
system contains; the human decides.

## What abuse looks like (the signature vocabulary)

Signatures are typed observations attributed to a task/body (the audit
discipline carries the trace links):

| Signature | Meaning | Severity class |
| --- | --- | --- |
| `rapid-failed-actions` | a burst of failing actions in a short window (hammering a target) | HIGH |
| `secret-probe-rate` | an anomalous rate of secret-shaped probes/emissions (credential hunting or exfiltration attempts) | SEVERE |
| `budget-sprint` | consuming the budget at an anomalous rate (resource exhaustion behavior) | HIGH |
| `replay-hammering` | abnormal idempotency-key reuse rate (replay attacks) | MODERATE |
| `scope-creep-attempts` | repeated attempts to act beyond held scopes | SEVERE |

The reference containment policy suspends on: `rapid-failed-actions`,
`secret-probe-rate` (extensible; the policy is injected data — a
mechanism, never an authority).

## The response procedure

1. **Containment (autonomous, bounded).** The containment decision is
   SUSPEND_PENDING_ASK when any configured signature matches. The task
   is suspended — its durable state (checkpoints, artifacts, evidence,
   §6) is preserved. Nothing is deleted; the body lease may be
   released; the suspension is reversible by decision.
2. **Record the evidence.** The typed `TaskSuspensionRecord` carries
   the task/mission/body identities, the matched signature ids, the
   suspension instant and the ASK deduplication key. The audit trail
   records the DENY decision — the suspension itself is observed
   evidence.
3. **Escalate to ASK (first-class).** The ask is severity-ordered in
   the queue, deduplicated by input digest. It presents: the matched
   signatures, the supporting audit records, the task's history, and
   the decision alternatives (resume / restrict / terminate).
4. **Human decision.** The ask is resolved by the authority: resume
   the task (signature was benign), restrict it (narrow scopes, tighten
   budgets), or terminate it (abuse confirmed). The resolution is a
   decision record with provenance — it is the human's call, made on
   evidence.
5. **Post-incident.** If abuse is confirmed, tighten the signature
   vocabulary (the learning is a deliberate policy edit, not an
   autonomous rewrite). The suspension record, the ask and the
   resolution are retained as evidence.

## What abuse response never does

- Never terminates autonomously — the final call is a human decision
  on evidence (the suspension is containment, not execution).
- Never silently drops the task's durable state (§6 survives).
- Never uses LLM-produced suspicion as signature evidence —
  signatures are typed observations from the measurement surfaces
  (action outcomes, rate counters, emission scans).
- Never leaves the task suspended without an ask (pendingAsk is part
  of the record contract).

## Honest status

The containment decision, the suspension record and the ask
escalation record are machine-verified offline (deterministic
suites). The real-time signature DETECTION feeds (live action
outcome streams, live rate counters) attach as adapters; the
reference implementations operate over injected observations.
