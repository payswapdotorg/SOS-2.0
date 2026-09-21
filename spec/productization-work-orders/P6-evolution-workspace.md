# P6 — Candidate + Assurance + Experiment + ASK Workspace

Dependencies: P1, P2
Owned paths: apps/web/changes, apps/web/assurance, apps/web/experiments, apps/web/ask
Worker: C

Goal:
Connect the change lifecycle as one user journey.

Flow:
shortfall -> candidates -> assurance -> experiment -> decision/ASK -> promote/rollback.

Acceptance:
- no artificial global winner
- uncertainty and evidence visible
- assurance objections have next actions
- experiment exposes current allowed action
- ASK has resolution control
- production actions are AuthorityGrant gated
- rollback is actionable when authorized
