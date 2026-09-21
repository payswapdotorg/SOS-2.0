# P16 — Product Release Gate

Dependencies: P15  
Owned paths: repository-wide release/reconciliation artifacts  
Owner: Architect

## Gate

- W0-W18 core remains frozen and green
- productization contracts and execution architecture are consistent
- production web is deployed
- durable live state works
- observation plane works without a permanent body
- harness/body broker works
- at least one cloud body is production-capable
- GitHub adapter supports the flagship mission-to-repo journey
- long-running tasks survive body loss and user-device shutdown
- actions remain authority gated
- independent evaluation gates completion
- ASK remains first-class
- package/history/self-evolution surfaces are live
- local companion path is clearly separated from cloud execution
- free-tier validation topology is rehearsed
- security/cost/recovery controls pass
- autonomous build dogfood passes
- full evidence bundle and rollback rehearsal exist

## Completion

Architect approval + actual merge + productization machine-state reconciliation.

The release gate must record the exact tested head and the production deployment revision.
