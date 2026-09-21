# Productization Work Orders

These Work Orders productize the frozen W0-W18 SOS core and add the post-W18 execution fabric without redefining frozen semantics.

One Work Order = one branch/PR.
Owned paths are disjoint across the entire productization program.
Unmerged siblings are never dependencies.

Every PR must include:
- exact base/head
- user journey or product requirement traceability
- implementation/productization delta
- deterministic tests
- real-system evidence where applicable
- deployment impact
- rollback impact
- authority impact

## Frozen-core rule

Workers do not modify:
- Constitution semantics
- Mission/value/context semantics
- System State identity
- Semantic Spine identity/trace semantics
- Evidence truth states
- causal evidence semantics
- Candidate/Assurance/Experiment/Decision semantics
- package maturity/diversity guarantees
- self-evolution boundary

A proposed change to those contracts becomes:
Architecture Change Request -> impact analysis -> evidence/research -> Architect approval -> reconciled Work Orders.

## Execution-fabric rule

- SOS is the persistent Spirit/control plane.
- Reasoning providers are replaceable mechanisms.
- Harnesses/bodies are replaceable execution mechanisms.
- Bodies cannot mint or widen authority.
- Body leases are ephemeral; task state/evidence are durable.
- Continuous observation does not require a body.
- Cloud/remote execution must not require the user's computer to stay online.
- Local companion/browser/IDE bridges are optional adapters.
- Independent evaluation gates completion.
- A body cannot certify its own work.

Workers stop at WAITING_FOR_ARCHITECT for frozen-contract changes, semantic ambiguity, authority gaps, cross-owned-path dependencies or vendor assumptions not covered by the Work Order.
