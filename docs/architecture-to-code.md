# Architecture -> Code Integrity

Architecture-to-code is semantic refinement, not documentation copying.

Required chain:
Mission -> Goal -> Capability -> Architecture element -> Implementation realization -> Verification -> Runtime evidence -> Outcome

Architecture Delta:
affected artifacts, added/removed/modified elements, preserved invariants, boundary changes, rationale reference, Work Order.

Implementation-only changes must explicitly declare architecture significance as none when appropriate.

Proof ladder:
static conformance -> types/interfaces -> contracts -> properties -> integration -> replay/simulation -> runtime monitoring -> controlled experiment.

Generated code retains provenance to generator, source architecture, generation run and validation.

A PR is not architecturally reviewable from prose alone.
