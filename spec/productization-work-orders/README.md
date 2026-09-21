# Productization Work Orders

These Work Orders productize the completed W0-W18 SOS core.

One Work Order = one branch/PR.
Owned paths are non-overlapping.
Unmerged siblings are never dependencies.

Every PR must include:
- exact base/head
- user journey or product requirement traceability
- Productization Delta
- deterministic tests
- real-system evidence where applicable
- deployment impact
- rollback impact

Workers stop at WAITING_FOR_ARCHITECT.
