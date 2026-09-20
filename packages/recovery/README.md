# @sos-2/recovery

The SOS 2.0 **brownfield architecture recovery** package (Work Order W4, owned
path 1 of 2): competing `ArchitectureGraph` hypotheses recovered from an
observed `ImplementationModel`, comparison against the declared architecture
reusing the merged W2 reconciliation, and a deterministic human-readable
reconciliation report.

> **Architecture Delta**: the W4 Architecture Delta record for both W4
> packages lives at
> [`packages/recovery/W4.architecture-delta.json`](./W4.architecture-delta.json).

## Spec alignment

| Aspect | Authority |
| --- | --- |
| "Code-to-architecture recovery may produce multiple competing hypotheses" | `spec/architecture.md` §6 |
| "Brownfield starts from mission plus existing-system evidence and recovers competing architecture hypotheses" | `spec/architecture.md` §15 |
| "Brownfield recovery must preserve multiple hypotheses when evidence is ambiguous" | `docs/code-to-architecture.md` |
| Pipeline position (observed → hypotheses → compare → classify) | `docs/code-to-architecture.md` |
| Greenfield and brownfield / Architecture/code reconciliation | `spec/requirements.md` R6, R23 |
| Classifier + ImplementationModel contract + trace links + ids | `@sos-2/semantic-spine` (imported, never duplicated) |
| Graph construction / ArchitectureGraph artifact | `@sos-2/architecture` (imported, never duplicated) |
| Classification and reconciliation records | `@sos-2/conformance` (imported, never duplicated) |

## Recovery: `recoverArchitectureHypotheses(input)`

```ts
recoverArchitectureHypotheses({
  model,                    // observed ImplementationModel (spine contract)
  projects_system_state,    // exact SystemState revision every hypothesis projects
  provenance,               // REQUIRED (who ran the recovery)
  created_at,               // RFC3339, caller-supplied
  config?,                  // componentKindMap / dependencyKindMap / kindAmbiguities /
                            // maxHypotheses (2..1024, default 16) / authority_ref / version
})
```

Ambiguity is **evidence-driven and always retained, never resolved**:

1. **Kind ambiguity** — an observed component kind admits more than one
   candidate node kind (explicit `config.kindAmbiguities`, or the documented
   `DEFAULT_KIND_AMBIGUITIES` heuristic vocabulary: `service` →
   Component|Adapter, `datastore` → DataStore|Component, …). One hypothesis is
   retained **per candidate**.
2. **Grouped realization** — components declare `realizes` refinements. Both
   readings stay possible: `DIRECT` (every component is its own node) and
   `MERGED_REALIZATIONS` (components realizing exactly one declared id
   collapse into that node).

The hypothesis space is the cross product (assignment-vector-major so
strategy diversity survives truncation), capped by `maxHypotheses`
(**minimum 2** — the cap bounds explosion, it can never collapse ambiguity to
a single architecture; truncation is retained as a
`TRUNCATED_HYPOTHESIS_SPACE` marker). Unambiguous evidence yields exactly ONE
hypothesis; ambiguous evidence yields SEVERAL — pinned by negative tests.

Each `RecoveryHypothesis`:

- is a real **DRAFT** `ArchitectureGraphArtifact` (recovery proposes, never
  activates) projecting the exact SystemState revision, created through
  `@sos-2/architecture`;
- carries a typed `HypothesisDerivation` (model id, exact revision, strategy,
  full kind assignment, input digest, counts, unresolved endpoints) — the
  full kind assignment is also stamped into the artifact's creation
  provenance so two different interpretations are always two distinct
  artifacts;
- carries **ambiguity/uncertainty markers** (`markers.ts`, frozen vocabulary)
  for every place evidence was ambiguous or unplaceable: unresolved
  dependency endpoints, multi-realizes components, mixed-kind merge groups,
  merge id collisions, duplicate dependency pairs, intra-node dependencies
  after merging;
- is linked to the source `ImplementationModel` id via spine trace links
  **DERIVED_FROM** and **OBSERVES** whose provenance records the exact source
  revision (`source-revision:<rev>`);
- exposes its **`model_view`** — the exact ImplementationModel interpretation
  it asserts.

**Interface projection (the W4 classification extension):** observed
interfaces become `Interface` pseudo-components with `Provides`/`Consumes`
edges inside the model view, so declared Interface nodes and Provides edges
become classifiable by the merged spine classifier (which classifies
components and dependency edges — see the W0.5 scope note in
`conformance-classifier.ts`). Classification logic itself is never
reimplemented here.

## Comparison: `compareWithDeclared(recovery, declared, config?)`

For each hypothesis, the W2 `reconcile` (@sos-2/conformance) runs the spine
classifier over the hypothesis' model view against the declared graph,
producing typed reconciliation records `{ classification, subject, reason,
link }` — **drift is classified, never silently resolved**. On top of the
per-record classification, each `HypothesisComparison` carries a derived
**verdict** (explicitly a summary, not a re-classification) and one
hypothesis→declared trace link:

| Verdict | Meaning | Link type |
| --- | --- | --- |
| `CONFORMANT` | no finding contradicts the declared architecture | `COMPATIBLE_WITH` |
| `DRIFT_DETECTED` | at least one DRIFT or CONTRADICTION finding | `CONFLICTS_WITH` |
| `AMBIGUOUS` | no drift, but correspondence is UNKNOWN somewhere | `DERIVED_FROM` |

## Report: `generateReconciliationReport(input)`

A **deterministic, structured text report** (pure function, no hidden clocks —
byte-identical on re-run, pinned by tests) organized exactly along
`docs/code-to-architecture.md`:

- **WHAT WE DECLARED** — the declared architecture, the observed model and its
  exact revision;
- **WHAT WE OBSERVED** — the interpretation labels under comparison
  (`sectionsFromComparisons` builds them from hypothesis comparisons);
- **WHAT DIFFERS** — every classification finding per section with its
  deterministic reason **and** the frozen per-class belief statement
  (`CLASSIFICATION_RATIONALE`: why the difference is believed to be detail,
  variation, refinement, intentional evolution, drift, unknown or
  contradiction);
- **RETAINED AMBIGUITY** — the recovery markers, verbatim;
- **SUMMARY** — zero-filled counts for all 7 frozen conformance classes and
  the subjects requiring human adjudication.

## Verification

- `pnpm run build` — TypeScript strict-mode compile (`dist/`)
- `pnpm test` — unit (recovery/compare/report), negative (input discipline,
  ambiguity-never-collapsed, malformed records, conflated guards, report
  validation) and property tests (fast-check, seed 424242: determinism,
  canonical round-trips, uniqueness, link discipline)
