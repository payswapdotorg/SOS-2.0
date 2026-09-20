# @sos-2/runtime-conformance

The SOS 2.0 **runtime conformance evidence** package (Work Order W4, owned
path 2 of 2): a runtime-observation adapter contract, evaluation of declared
executable invariants at an exact SystemState revision, and typed conformance
evidence records with truthful availability.

> **Architecture Delta**: the W4 Architecture Delta record for both W4
> packages lives at
> [`packages/recovery/W4.architecture-delta.json`](../recovery/W4.architecture-delta.json).

## Spec alignment

| Aspect | Authority |
| --- | --- |
| "architecture invariants are machine checked … by runtime conformance monitors" | `spec/architecture.md` §7 |
| "Unknown, failed, unavailable and unsupported remain distinct" | `spec/architecture.md` §18 |
| "unavailable telemetry interpreted as zero" is a FORBIDDEN shortcut | `spec/architecture-lock.md` |
| Architecture as hypothesis and executable constraint / truthful failure states | `spec/requirements.md` R8, R21 |
| Architecture/code reconciliation at runtime / evidence reproducibility | `spec/requirements.md` R23, R30 |
| Invariant DSL and checker | `@sos-2/conformance` (W2 authority, built over `@sos-2/architecture` graphs — imported, never duplicated) |
| Raw observations (telemetry-shaped input) | `@sos-2/telemetry` (W3 — merged, so its types are consumed directly; no local interface was needed) |
| Evidence records (kind Evidence, truth states, method provenance) | `@sos-2/evidence` (W3 — imported, never duplicated) |
| Producers / time windows / SystemState artifacts | `@sos-2/provenance`, `@sos-2/system-state` |

## The adapter contract: `RuntimeViewAdapter`

`project(observations: RawObservation[]) → RuntimeView` converts runtime
observation records (W3 `RawObservation`s) into the observed runtime
structure: a validated `GraphShape`, per-subject observation tallies over
**all 6 truth states** (zero-filled — no state ever folded into another),
sighted nodes, and **unprojected observations with reasons** (retained, never
dropped).

The built-in `structuralRuntimeAdapter` interprets each usable observation as
a sighting of one runtime subject: `subject_ref` is the node id, the node kind
comes from attribute `runtime.node_kind` (default `Component`), outgoing edges
from attribute `runtime.edges` (`[{ target, kind }]`; edge targets become
indirectly sighted nodes with kinds implied by the edge kind).
`UNAVAILABLE`/`UNSUPPORTED` observations contribute no structure — they are
tallied only.

## Evaluation: `evaluateRuntimeConformance(input)`

```ts
evaluateRuntimeConformance({
  system_state,           // EXACT SystemState revision (W2 artifact)
  declared_architecture,  // MUST match system_state.content.architecture_ref (id + version)
  invariants,             // declared executable invariants (W2 DSL), unique
  observations,           // RawObservation[] (telemetry-shaped)
  adapter,                // RuntimeViewAdapter
  producer,               // WHO/WHAT produced this evaluation
  evaluated_at,           // RFC3339, caller-supplied
  confidence?,            // default qualitative UNQUANTIFIED
})
```

**Two honesty disciplines** (the core of the package):

1. **Witness discipline** — `FAIL` requires a *positively witnessed*
   violation. Absence of observation is never observation of absence:
   FORBIDDEN_DEPENDENCY/LAYERING static failures are edge-presence
   (witnessed); DATA_OWNERSHIP is witnessed only for multi-ownership;
   REQUIRED_INTERFACE failures are always absence-based → UNKNOWN.
2. **Coverage discipline** — `PASS` requires COMPLETE coverage of the
   invariant's declared subject universe. Buckets keep all truth states
   distinct: `SIGHTED` / `UNSUPPORTED` / `GAP` / `UNOBSERVED`, summarized as
   `COMPLETE` / `PARTIAL` / `UNSUPPORTED` / `GAP` / `NONE` / `EMPTY`.

Frozen verdict/availability table (PASS/FAIL/UNKNOWN never conflated with
each other or with the 6 evidence truth states):

| check | coverage | verdict | availability |
| --- | --- | --- | --- |
| FAIL | witnessed | `FAIL` | `FAILURE` |
| FAIL | absence-based | `UNKNOWN` | `UNKNOWN` |
| PASS | COMPLETE | `PASS` | `SUCCESS` |
| PASS | PARTIAL | `UNKNOWN` | `PARTIAL` |
| PASS | UNSUPPORTED | `UNKNOWN` | `UNSUPPORTED` |
| PASS | GAP / NONE | `UNKNOWN` | `UNAVAILABLE` |
| any | EMPTY (no declared subjects) | `UNKNOWN` | `UNSUPPORTED` |
| NOT_APPLICABLE | COMPLETE | `UNKNOWN` | `UNKNOWN` |
| NOT_APPLICABLE | other | `UNKNOWN` | per coverage |

A gap is data about missing data — never zero, never absence-of-violation
(`spec/architecture-lock.md`).

## Evidence records

Each evaluation emits one `EvidenceRecordW3` per declared invariant (minted by
`@sos-2/evidence createEvidence` — deterministic `sos://Evidence/` ids, kind
`runtime-conformance`, OBSERVATIONAL class, explicit method
`runtime-conformance:invariant-check`): truthful availability per the table
above, the enclosing observation window, `subject_revision` binding the exact
SystemState revision token (`<id>@v<version>`), and a provenance chain
carrying the architecture id/version, every implementation git-sha and
deployment revision, the adapter id, the invariant content hash, the
observation-set hash and the evaluation instant.

**Traceability** (W4 acceptance): every record carries spine trace links
**OBSERVES** (evidence → SystemState id) and **VERIFIES** (evidence →
declared ArchitectureGraph id), each with provenance.

**Exact-revision binding**: the SystemState must declare the declared
architecture through `architecture_ref` (validated loudly in both id and
version). The reverse reference (the graph's `projects_system_state` pointing
back at the SystemState id) is deliberately NOT required: both artifacts are
content-addressed, so a mutually-referencing pair is a hash fixed point and
is unconstructible by design — the same reason W2's own tests anchor graphs
at fixed SystemState ids.

**Guards**: `isRuntimeConformanceRecord` enforces the frozen
verdict/availability consistency (`VERDICT_AVAILABILITY`) — conflated records
(PASS with FAILURE, FAIL with SUCCESS, UNKNOWN with SUCCESS…) are rejected,
never normalized. Pinned by negative tests.

## Verification

- `pnpm run build` — TypeScript strict-mode compile (`dist/`)
- `pnpm test` — unit (verdict/coverage/witness table, adapter projection,
  links, provenance), negative (binding mismatches, duplicate invariants, LLM
  confidence, conflation rejection) and property tests (fast-check, seed
  424242: determinism, consistency, canonical round-trips)
