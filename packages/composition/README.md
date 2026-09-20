# @sos-2/composition

The SOS 2.0 Package Composition model (Work Order W6; requirements R25,
R27): first-class reusable compositions with independent evidence and the
independence discipline.

## EXPORT DISCIPLINE (binding)

Envelope logic and identifiers from `@sos-2/semantic-spine`; the
applicability/assurance/diversity/maturity machinery from `@sos-2/packages`
(the same W6 realization — no duplication); evidence records from
`@sos-2/evidence`. Zero external runtime dependencies.

## First-class compositions

A `PackageCompositionArtifact` is a spine envelope (frozen core kind
`PackageComposition`) plus the composition content: members (≥ 2 packages
bound into unique roles), typed bindings (the frozen wiring vocabulary
`PROVIDES_TO / CONSUMES_FROM / CONFIGURES / DATA_FLOW / CONTROL_FLOW`),
contracts, preconditions/postconditions, applicability, OWN evidence refs,
failure refs, assurance obligations, learned limitations, diversity profile,
maturity and justified independence assessments. Ids are content-addressed
over the creation address; explicit ids support the random-minting flow.

## OWN evidence (the locked invariant, machine-checked)

Compositions require their own evidence — **member success never implies
composition success**. `evaluateOwnEvidence` / `assertOwnEvidence` accept
exactly the evidence whose subject is one of the composition's own spine
ids (its chain); refs pointing at member evidence are rejected with an
explicit independence message. Composition validity does NOT derive from
member validity in either direction: a composition can be validated while a
member is still FORMING, and fully-validated members never validate a
composition without its own evidence.

Two sanctioned creation flows resolve the identity/evidence circularity:
(a) **form-then-promote** — create at DISCOVERED/FORMING (deterministic id,
provisional refs), then promote with own evidence about the chain through
the registry; (b) **explicit-id** — mint a random composition id first,
create evidence about it, then create the composition with that explicit id.

## Independence discipline (never P(A+B)=P(A)P(B) by default)

`combineMemberProbabilities(members)` WITHOUT an
`IndependenceJustification` is REJECTED loudly — there is no code path that
multiplies member probabilities silently (docs/probabilistic-learning.md;
spec/architecture-lock.md). WITH a justification (frozen bases:
`DESIGNED_ISOLATION`, `MEASURED_NON_CORRELATION`,
`DISJOINT_FAILURE_MODES`, `ARCHITECTURAL_PARTITION`), the product carries
the justification and the method mark `INDEPENDENCE_JUSTIFIED_PRODUCT`;
recorded assessments must reference THIS composition's members and hold the
exact product.

## Composition failures

Composition failures are retained like package failures: `failure_refs`
are monotonic across revisions (enforced by the registry layer) and surface
as failure contexts in retrieval results.
