# @sos-2/ui-contracts — SOS 2.0 View-Model Contracts (W11)

Pure types + pure projection functions: typed projections of domain records for
human display, with the W11 acceptance structurally enforced — **every
view-model for a consequential decision carries an upstream/downstream
rationale chain of typed spine trace links plus evidence refs**.

## Design

- **Zero domain logic, zero DOM dependencies.** Every vocabulary (truth
  states, trace types, conformance classes, experiment phases, assurance
  verdicts, recovery mechanisms, diversity dimensions, ...) is IMPORTED from
  the owning `@sos-2/*` package — never redefined. The package is
  deterministic and canonical: projections sort stably, and the canonical
  serialization/hashing helpers run over the spine's own canonical JSON
  serializer.
- **Rationale chains (`rationale.ts`).** A `RationaleChain` explains one
  subject artifact: `upstream` (origins, inputs, supports), `downstream`
  (consequences, outputs) and exact `evidence_refs`. Links are classified by
  a documented direction typology — DEPENDENT types (`DERIVED_FROM`,
  `REFINES`, `SPECIALIZES`, `SATISFIES`, `IMPLEMENTS`, `GENERALIZES`,
  `CAUSED_BY`) are upstream for their source; ACTING types (`VERIFIES`,
  `SUPPORTS`, `OBSERVES`, `COMPOSES`, `REALIZES`, `CONSTRAINS`, `CAUSED`, ...)
  are upstream for their target. **A rationale chain without trace links is
  rejected.**
- **View-model contracts.** `MissionVM`, `SystemStateVM` (system import),
  `ReconciliationVM` (declared vs observed vs classification + why),
  `EvidenceVM` (truth state + provenance + uncertainty + freshness),
  `CandidateComparisonVM` (side-by-side, no single winner),
  `AssuranceVM` (claims/objections/derived verdict), `ExperimentVM`
  (lifecycle + guardrails + stopping triggers), `AskVM` (the full ASK
  contract + rule trace), `RollbackVM` (recovery declaration),
  `PackageVM`/`RepertoireVM` (diverse repertoire with limitations and
  failures retained), `HistoryVM` (supersedes chains over time),
  `MetaStateVM` (read-only self-evolution projection).
- **Projection = validation.** Every `project*` function validates its
  domain inputs through the owning packages' own validators, projects, and
  re-validates the view-model before returning: an invalid view-model can
  never be emitted. View-models that drop truth states, uncertainty or
  provenance are REJECTED by the validators (pinned by negative tests).

## Determinism helpers (`canonical.ts`)

- `canonicalVMJson(vm)` — canonical JSON text (the spine serializer).
- `vmHash(vm)` — sha-256 of the canonical serialization.
- `canonicalRoundTripStable(vm)` — serialize → parse → serialize stability.

## Tests

```bash
pnpm --filter @sos-2/ui-contracts test
```

- **Unit tests** — every projection over fixtures built through the domain
  packages' own builders.
- **Negative tests** — the W11 rejection disciplines: truth-state /
  uncertainty / provenance drops rejected; rationale chains without trace
  links rejected; mismatched subjects rejected loudly.
- **Property tests** (fast-check, pinned seed) — randomized domain fixtures
  → projection determinism + canonical round trips + order-insensitive
  rationale chain construction.
