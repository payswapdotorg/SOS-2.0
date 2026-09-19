# @sos-2/conformance

The SOS 2.0 **executable conformance layer** (Work Order W2, owned path 3 of
3): the typed architecture invariant DSL, code-to-architecture
reconciliation over the merged W0.5 spine classifier, and minimal
Evidence-shaped drift records.

> **Architecture Delta**: the W2 Architecture Delta record for all three W2
> packages lives at
> [`packages/system-state/W2.architecture-delta.json`](../system-state/W2.architecture-delta.json).

## Spec alignment

| Aspect | Authority |
| --- | --- |
| "architecture invariants are machine checked" | `spec/architecture.md` §7 |
| Difference classification (7 frozen classes) and reconciliation | `spec/architecture.md` §6, `docs/code-to-architecture.md` |
| Architecture/code reconciliation | `spec/requirements.md` R23 |
| Classifier + ImplementationModel contract + trace links | `@sos-2/semantic-spine` (imported, never duplicated) |
| "Drift itself becomes Evidence" | `docs/code-to-architecture.md` |

## Invariant DSL (typed, small, frozen at four kinds)

| Kind | Check |
| --- | --- |
| `REQUIRED_INTERFACE` | every node of `componentKind` exposes the interface node `interfaceId` via a `Provides` edge |
| `FORBIDDEN_DEPENDENCY` | no edge of `edgeKind` (default `Dependency`) from a `fromKind` node to a `toKind` node |
| `LAYERING` | layers ordered bottom → top; a dependency edge pointing to a HIGHER layer (upward dependency) is a violation — forbidding upward edges also forbids upward paths (any upward path contains an upward edge) |
| `DATA_OWNERSHIP` | every `DataStore` node is targeted by exactly one `Owns` edge |

`checkInvariant(invariant, graph)` → `{ status: PASS | FAIL |
NOT_APPLICABLE, evidence: subject ids, reason }` — total, deterministic,
graph-validated. `checkInvariants` checks lists in order.

## Reconciliation

`reconcile(observed: ImplementationModel, declared: ArchitectureGraphArtifact, config?)`:

1. validates both inputs (the model id must be a well-formed
   `sos://ImplementationModel/…` id — links need real semantic ids);
2. **normalizes** the observed model into graph vocabulary
   (`componentKindMap` / `dependencyKindMap`; defaults: registered node/edge
   kinds pass through, everything else maps to `Component` / `Dependency`);
   declared edges are projected pair-unique per the spine classifier's
   contract (deterministic representative choice, documented in
   `reconcile.ts`);
3. runs the merged spine classifier `classifyDifferences`;
4. emits typed records `{ classification, subject, reason, link }` where the
   link binds the two compared semantic ids with a frozen type
   (`CONFORMANCE_LINK_TYPES`): OBSERVES (details/variations), REFINES
   (preserving refinements), DERIVED_FROM (intentional evolution, unknown),
   CONTRADICTS (drift, contradiction);
5. emits minimal **drift evidence records** for DRIFT/CONTRADICTION findings
   (see below).

## Drift evidence (scope boundary with W3)

`DriftEvidenceRecord` is Evidence-record-SHAPED: it satisfies the
`@sos-2/contracts` `EvidenceRecord` contract (open extension point) plus the
W2 fields `classification`, `subject`, `reason`. Ids are minted through the
spine's deterministic minter (kind `Evidence`), so identical findings
reproduce identical record ids. The FULL Evidence Graph (telemetry,
incidents, provenance model, rollback) is Work Order W3's scope — W2 emits
only these minimal records referencing the subject id.
