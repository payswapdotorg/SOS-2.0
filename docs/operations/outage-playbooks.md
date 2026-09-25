# Outage playbooks: provider / network / task / user failure

Status: **reference-implementation playbooks** — the procedures run
against the P14 typed records (dead-letter, provider health, rate/budget
policies) and the merged observation plane. The real provider status
feeds and probes are NOT_YET_CONNECTED (adapters attach later); the
playbooks are exercised offline against the deterministic reference
implementations.

The one rule that governs all four playbooks: **provider outages
remain truthful UNKNOWN/UNAVAILABLE where appropriate** — a provider
with no observations is UNKNOWN, a provider an observation says is
down is UNAVAILABLE, and NOTHING fabricates HEALTHY. Cloud work never
depends on the user's device being online; local work queues safely
while the device is offline (§7 user device model).

## Provider failure (a cloud provider is failing)

1. **Observe first.** Check the provider health record (surface
   `provider-health`). The status is the LATEST observed probe
   evidence:
   - `UNKNOWN` — no observation exists: schedule/run probes; do NOT
     assume either health or failure while unobserved.
   - `UNAVAILABLE` — an observation confirms the outage.
   - `DEGRADED` — usable with impairments.
2. **Freeze non-essential work against that provider.** Budget/rate
   policies continue to answer typed decisions; work targeting the
   failed provider fails into the dead-letter path with bounded
   retries — never hammering, never silent.
3. **Let bounded retry do its work.** The retry policy (bounded
   attempts, capped exponential backoff) runs its schedule. Provider
   outages usually exceed it — that is correct behavior, not a bug:
   the outcome escalates to ASK with the dead-letter record attached.
4. **Escalate to ASK.** The ASK carries the task identity, the failed
   subject, the attempts and the last error. The human decides: wait
   it out, reroute (different provider/region), or abandon the task.
   The system never decides a provider-reroute autonomously where
   authority does not exist.
5. **Recovery is observed, not assumed.** The provider returns to
   HEALTHY only through new probe reports — never through elapsed
   time, never through a successful single request that could be a
   fluke, never through silence.
6. **Truthful bookkeeping.** Tasks interrupted by the outage resume
   from durable state (§6): checkpoints, produced artifacts and the
   retry state survive; body leases may have been replaced.

## Network failure (connectivity is broken)

1. **Distinguish scope**: sandbox egress denied (policy — see below) vs
   transit outage (the world).
2. **Sandbox egress denied**: the network policy declaration names the
   allowlist; the denial is typed at the body seam. If the task
   legitimately needs a host outside the allowlist, that is an ASK
   (policy change is a human decision), never a silent allowlist
   edit.
3. **Transit outage**: symptoms land in the dead-letter path exactly
   like provider failure (bounded retry then ASK). Cloud bodies
   affected together point at a common network path — the diagnosis
   procedure attributes by provider, not guesswork.
4. **Local companion offline**: local-only work queues durably; cloud
   work continues unaffected (the device is optional — §7). When the
   device returns, the queue drains through the same bounded-retry
   discipline.

## Task failure (a task is crashing/looping/failing)

1. **Read the dead-letter record**: task identity, subject, attempts,
   last error type. The §6 durable state (checkpoints, artifacts,
   authority context) survives.
2. **Body crash**: the body lease is ephemeral by design — a
   replacement body resumes the task from its checkpoint. The
   dead-letter state is the resume point; nothing is lost by the
   crash itself.
3. **Non-retryable errors** (contract violations, authority denials)
   escalate to ASK immediately — never retried.
4. **Retryable errors** run the bounded schedule; exhaustion
   escalates to ASK with the full attempt history.
5. **Repeated identical failures** are an abuse signature (see
   [abuse-response.md](abuse-response.md)) — the containment policy
   suspends the task pending ASK; the suspension record is the
   evidence pack.

## User failure (the human is unavailable/unresponsive)

1. **Cloud work continues.** No cloud task blocks on user presence
   (§7): ASKs queue, work within existing authority proceeds.
2. **ASKs accumulate honestly.** Every escalation is a first-class ask
   in the queue — severity-ordered, deduplicated by input digest.
   Nothing silently resolves, nothing expires silently.
3. **On return**: the user works the ask queue (the only decisions
   that needed them); paused tasks resume; suspended tasks await the
   abuse-response decision.
4. **User device offline**: local queues hold; nothing fabricated as
   done. When the device returns, the local queue drains through the
   same bounded-retry discipline.

## What these playbooks never do

- Never fabricate health, completion or success during an outage.
- Never retry infinitely (bounded by construction) and never drop
  silently (dead-letter + ASK always).
- Never treat the user's absence as permission to widen authority.
- Never let the queue infrastructure become a semantic authority
  (§13) — it moves work; it never decides it.
