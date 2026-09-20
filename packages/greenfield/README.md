# @sos-2/greenfield

The SOS 2.0 **Greenfield pipeline orchestrator** (Work Order W14, parallel
slot B): mission-only onboarding becomes an executable system realization
with semantic traceability and package reuse (spec/architecture.md §15
"Greenfield starts from mission... Both converge on System State";
requirements R6, R29).

> **Architecture Delta**: the W14 Architecture Delta record for this
> package and the harness app lives at
> [`ARCHITECTURE-DELTA.json`](./ARCHITECTURE-DELTA.json).

## Spec alignment

| Aspect | Authority |
| --- | --- |
| Greenfield starts from mission and converges on System State | `spec/architecture.md` §15 |
| Greenfield and brownfield | `spec/requirements.md` R6 |
| Reasoning at the highest safe abstraction level | `spec/requirements.md` R29; `spec/architecture.md` §10 |
| Semantic Spine traceability (one connected Mission→SystemState subgraph) | `spec/requirements.md` R9; `spec/architecture.md` §4 |
| Envelope, identity, kinds, trace links, canonical serialization | `@sos-2/semantic-spine` (imported, never duplicated) |
| Mission model + progressive formalization | `@sos-2/mission` (W1) |
| Package registry/retrieval, compositions, own evidence | `@sos-2/registry` + `@sos-2/packages` + `@sos-2/composition` (W6) |
| Candidate search at altitude + Pareto ranking | `@sos-2/search` + `@sos-2/retrieval` (W7) + `@sos-2/optimization` |
| Human decision flow (ACT/ASK per authority + risk) | `@sos-2/decision` + `@sos-2/ask` (W10) + `@sos-2/autonomy` + `@sos-2/authority` |
| System State + Architecture Graph + reconciliation | `@sos-2/system-state` + `@sos-2/architecture` + `@sos-2/conformance` (W2) |
| Evidence ingestion with truthful states | `@sos-2/evidence` (W3) + `@sos-2/telemetry` |

## The pipeline (six stages, one trace chain)

```text
raw mission input
  │ 1. MISSION FORMALIZATION (@sos-2/mission)
  ▼        goals with measures -> MEASURABLE; without -> PROPOSED (R2)
formalized Mission artifact (ACTIVE, deterministic id)
  │ 2. CANDIDATE COMPOSITION (@sos-2/search + @sos-2/retrieval
  ▼        + @sos-2/registry + @sos-2/composition + @sos-2/optimization)
  │        search STARTS at VALIDATED_COMPOSITION (§10); the mission's REAL
  │        MissionConstraint objects machine-filter before evaluation (W7);
  │        the diverse survivor set is Pareto-ranked (R12, §11 — a dominated
  │        candidate never becomes the primary); the greenfield candidate
  │        composition is composed from the VALIDATED members with its OWN
  │        evidence obligations (member evidence never substitutes)
candidate PackageComposition (DISCOVERED, DRAFT)
  │ 3. HUMAN DECISION FLOW (@sos-2/decision + @sos-2/ask)
  ▼        the W10 engine decides ACT/ASK/... per authority + risk;
  │        ASK produces a structured AskRequest through @sos-2/ask and the
  │        queue resolves it with the provenance of who resolved it (R16)
DecisionRecord (ACT or an ASK + resolution)
  │ 4. REALIZATION (@sos-2/system-state + @sos-2/architecture)
  ▼        the APPROVED candidate -> a System State revision (root of a
  │        complete, queryable chain; exact git-sha revisions) + the declared
  │        ArchitectureGraph hypothesis + the ImplementationModel; realizing
  │        an unapproved candidate is REJECTED (no silent autonomy)
SystemState + ArchitectureGraph + ImplementationModel
  │ 5. RECONCILIATION (@sos-2/conformance)
  ▼        implementation vs declared architecture -> typed records linked
  │        OBSERVES/REFINES/DERIVED_FROM/CONTRADICTS + drift evidence
reconciliation records
  │ 6. EVIDENCE INGESTION (@sos-2/evidence)
  ▼        raw telemetry observations -> truthful evidence records (UNAVAILABLE
  │        stays UNAVAILABLE), OBSERVES-linked to the realized SystemState,
  │        freshness evaluated at the fixed run instant
one connected semantic subgraph Mission -> SystemState
```

**The traceability invariant** (machine-checked at every stage boundary AND
over the final result — a missing link fails the pipeline):

```text
candidate --SATISFIES--> mission
candidate --COMPOSES---> each member package
decision  --SUPPORTS-->  candidate
ask       --DERIVED_FROM-> decision        (ASK path)
resolution--SUPPORTS-->  candidate        (ASK path)
state     --REALIZES-->  candidate
state     --REALIZES-->  declared architecture graph
implModel --IMPLEMENTS-> declared architecture graph
implModel --OBSERVES/REFINES/DERIVED_FROM/CONTRADICTS--> graph  (findings)
evidence  --OBSERVES-->  system state revision
```

Every pipeline artifact lives in ONE undirected connected component
containing the Mission and the SystemState revision, and the directed
traceability path SystemState → candidate → Mission is walkable (the chain
is queryable through the spine, not merely asserted). See `trace.ts` and
`assertTraceChainComplete`.

## Purity and determinism

The orchestrator is a PURE function of its input: no I/O, no network, no
hidden clocks (every instant is caller-supplied and non-decreasing in
pipeline order), no randomness (every identity is spine-minted and
content-addressed). Identical input produces a byte-identical result —
pinned by the harness's committed golden snapshot and the package's
property tests (randomized mission inputs → pipeline determinism).

## The declared-hypothesis identity note

The ArchitectureGraph hypothesis is DECLARED before the SystemState
revision is committed; its id is content-addressed by the spine over its
DECLARATION address (mission + candidate + declared shape + run provenance)
and minted through the spine's sanctioned explicit-id flow (the same
discipline as W2's fixture ids and `@sos-2/packages`' explicit-id path).
The pair is mutually consistent (state.architecture_ref ↔
graph.projects_system_state), machine-verified by the exported
`assertRealizationRevision`.

## Key exports

| Export | Purpose |
| --- | --- |
| `runGreenfieldPipeline` | the orchestrator: six stages + the machine-checked trace chain; throws on any stage failure, broken handoff or incomplete chain |
| `runMissionStage` / `runCandidateStage` / `runDecisionStage` / `runRealizationStage` / `runReconciliationStage` / `runEvidenceStage` | the individual stages (typed records, composable and independently testable) |
| `assertTraceChainComplete` / `checkTraceChain` / `directedPath` / `connectedComponent` | the traceability invariant + spine queries |
| `assertCandidateOwnEvidence` | the own-evidence discipline gate (member evidence never substitutes) |
| `assertRealizationRevision` | the realization revision gate (state ↔ graph consistency, complete chain root) |
| `deriveMemberRoles` | the deterministic member-role derivation |
| `GreenfieldRunContext` / `GreenfieldWorld` / `GreenfieldMissionInput` / `GreenfieldRiskProfile` / `GreenfieldRealizationPlan` / `GreenfieldAskDecider` | the typed pipeline inputs (every vocabulary consumed from its owning authority) |

## Negative disciplines (pinned by tests)

- a pipeline result with a broken trace link is REJECTED (removing any
  chain-critical handoff link breaks `assertTraceChainComplete`);
- a candidate without its own evidence (obligations, or citing member
  evidence as composition evidence) is REJECTED;
- a decision that bypassed the authority (ASK without a resolution) is
  REJECTED at the realization gate;
- a realization without a System State revision (unregistered, dangling or
  state↔graph-inconsistent) is REJECTED;
- a search that descends below the validated altitudes is REJECTED
  (greenfield composes from validated reusable members).
