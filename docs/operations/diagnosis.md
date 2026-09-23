# Diagnosis: symptom → responsible task/body/provider

Every consequential policy decision appends a durable audit record
(content-addressed, replay-safe) carrying the trace links
`taskId / bodyId / providerId`. Diagnosis is the disciplined read of
those links — never prose inference, never guessing.

## The diagnosis procedure

1. **Name the symptom surface** (from the audit trail's `surface`
   field or the operator's observation):
   `credential-scope | workspace-isolation | secret-isolation | budget |
   rate-limit | provider-health | dead-letter | abuse-containment |
   deployment-hardening`.
2. **Query the audit trail** for the symptom class, filtered by what
   you know (task id, body id, provider id, time window). The typed
   diagnosis groups matching records into responsibility attributions
   (task → body → provider) with denial/redaction/unknown counts and
   the first/last occurrence instants.
3. **Read the attribution, not the narrative.** The responsible task,
   body and provider are the identities the RECORDS name. If the
   records name none, the verdict is INSUFFICIENT_EVIDENCE — that is
   an honest answer, not a dead end: it means the next step is
   observation (add/repair probes), not suspicion.
4. **Correlate with the observation plane (P7).** The audit trail
   tells you WHO; the observation events (repository, CI, deployment,
   telemetry) tell you WHAT the world was doing at the same instants.
   Neither rewrites the other.
5. **Act through the action plane (P9).** Any consequential
   remediation (pause, replace, rollback) is an authority-gated
   action — current authority is re-evaluated at action time; a stale
   diagnosis never carries authority.

## Denied actions (surface: credential-scope, workspace-isolation)

- **Symptom**: actions fail closed; receipts say
  `ACTION_AUTHORITY_DENIED`.
- **Diagnosis**: the audit records carry the denial reason:
  - `CREDENTIAL_EXPIRED` — stale authority failed closed (by design).
    Resolution is a fresh credential mint or an ASK — never a grace
    period, never re-running until it works.
  - `SCOPE_EXCEEDED` — the credential is scoped to families that do
    not include the requested action family. Check the scope record;
    widen scope only through the human/authority path (the broker
    cannot silently escalate — that is a typed violation).
  - `CROSS_PROJECT_WORKSPACE_ACCESS` — a task context reached for
    another project's workspace. This is a hard isolation violation:
    check whether the task graph mis-declared its project scope
    (task bug) or a body attempted cross-project access (body bug).
    The responsible task/body is in the audit payload.

## Secret redactions (surface: secret-isolation)

- **Symptom**: artifacts/logs contain `[REDACTED:<pattern-id>]`
  markers; the audit trail records `REDACT` decisions.
- **Diagnosis**: the audit payload names the emission id, the
  destination (artifact/log), the emitting task/body and the matched
  pattern ids — but NEVER the matched text. Identify the emitting body
  via the trace links; the leak source is upstream of the observation
  boundary.
- **If a denial fired instead (`DENIED_SECRET_LEAK`)**: the emission
  was blocked entirely. Find the emitting body; fix the emission; the
  redaction/denial is already observed evidence for the incident
  record.
- **Never** attempt to "recover" the redacted content from the audit
  trail — it was never stored.

## Rate limiting (surface: rate-limit)

- **Symptom**: operations return typed `RATE_LIMITED` outcomes with a
  computed retry-after.
- **Diagnosis**: the limit policy id is in the decision; the audit
  records attribute the load to the responsible task/body. Distinguish
  legitimate sustained work (raise the policy limit deliberately) from
  hammering (look at abuse signatures next).

## Budget exhaustion (surface: budget)

See [budget-exhaustion.md](budget-exhaustion.md) — the diagnosis is
the same audit-trail read; the response differs.

## Provider degradation (surface: provider-health)

- **Symptom**: provider-dependent operations degrade or fail.
- **Diagnosis**: the health record carries the LATEST observed probe
  reports. UNKNOWN means no observation exists (add probes — do not
  guess); UNAVAILABLE means an observation says so; DEGRADED means
  usable with impairments. Statuses change only through observed
  reports.

## Dead-lettered work (surface: dead-letter)

- **Symptom**: operations landed in the dead-letter state.
- **Diagnosis**: the dead-letter record carries the task identity, the
  subject, the attempt count, the last error type and the escalation
  (ASK) reference. See [outage-playbooks.md](outage-playbooks.md) §
  task failure.

## What diagnosis NEVER does

- It never names a responsible party the records do not name
  (INSUFFICIENT_EVIDENCE is a valid, honest verdict).
- It never treats LLM-produced analysis as evidence — model output
  about "who did it" is a lead, not a conclusion.
- It never reads demo fixture state as live state.
