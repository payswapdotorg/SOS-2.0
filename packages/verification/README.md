# @sos-2/verification

SOS 2.0 Runtime Verification (Work Order W8, parallel slot B). The
**pluggable monitor-engine adapter contract**: typed monitor definitions,
validated monitor events, and evaluation results as **Evidence records with
truthful availability** under a frozen verdict-to-truth-state mapping that
the contract — not the engine — enforces. **Adapters are not authority.**

## What lives here

| Export | Purpose |
| --- | --- |
| `MonitorDefinition` | a typed monitor: `{ id, property }` — a typed VALUE like `@sos-2/conformance`'s `Invariant`, deliberately not an artifact; the consequential artifacts are the minted Evidence records |
| `MonitorProperty` | the small typed property DSL: `ALWAYS` (invariant predicate), `RESPONSE` (trigger → response, optional deadline), `CUSTOM` (engine-specific payload — the platform-neutrality escape hatch for real external engines) |
| `MonitorEvent` | `{ predicate, holds, at }` — the minimal honest observation shape; events are INPUT, truth states are assigned only when evidence is minted (W3 discipline) |
| `RuntimeMonitorEngine` / `isRuntimeMonitorEngine` | the engine contract: `{ id, supportedProperties, evaluate(monitor, events, context) }` + structural guard |
| `MONITOR_VERDICT_AVAILABILITY` | the frozen mapping: `SATISFIED→SUCCESS`, `VIOLATED→FAILURE`, `INCONCLUSIVE→UNKNOWN\|UNAVAILABLE\|UNSUPPORTED\|PARTIAL` — each honest sub-cause stays distinct |
| `assertValidMonitorEvaluationResult` | the adapter guard: rejects any engine output that violates the mapping, mints non-W3 evidence, forges the revision binding or omits the OBSERVES link |
| `evaluateMonitor` | the **sanctioned entry point**: validates inputs, delegates to the engine, then validates the engine's output against the contract |
| `mintMonitorEvidence` / `monitorObservesLink` | shared helpers for third-party engines to mint contract-conformant results through the merged W3 authority |
| `createInMemoryReferenceEngine` | the in-memory reference implementation (ALWAYS + RESPONSE); CUSTOM properties are truthfully answered `UNSUPPORTED` |

## Semantics of the reference engine

- **ALWAYS**: any witnessed non-holding point → `VIOLATED`/`FAILURE`;
  ≥ 1 point, all holding → `SATISFIED`/`SUCCESS`; **no observations of the
  predicate at all → `INCONCLUSIVE`/`UNAVAILABLE`** (a gap is data about
  missing data — never read as satisfied).
- **RESPONSE**: a trigger whose deadline passed without a response →
  `VIOLATED`/`FAILURE` (witnessed deadline miss); all triggers answered →
  `SATISFIED`/`SUCCESS`; some answered, some open → `INCONCLUSIVE`/`PARTIAL`;
  all open → `INCONCLUSIVE`/`UNKNOWN`; **no trigger ever observed →
  `INCONCLUSIVE`/`UNKNOWN` with an explicit "never exercised" reason —
  vacuous satisfaction is never reported**.
- **CUSTOM** (or any property kind outside the engine's declared support) →
  `INCONCLUSIVE`/`UNSUPPORTED` — never folded into UNKNOWN, never read as
  satisfaction.

## Exact-revision binding

Every result binds to the evaluation context verbatim: evidence
`subject_ref` = the exact SystemState id, `subject_revision` = the exact
revision token, `source_revision`/`deployment_revision` = the exact
implementation/deployment revisions (null preserved, never defaulted), and
an `OBSERVES` link from the evidence to the monitored SystemState. A rogue
engine that forges these bindings is refused by the guard.

## Layering

```
@sos-2/semantic-spine (W0.5, frozen)  ←  @sos-2/verification (this package)
@sos-2/evidence       (W3, merged)    ←     (createEvidence, EvidenceRecordW3)
@sos-2/provenance     (W3, merged)    ←     (Producer)
```

No new artifact kinds are introduced: monitor definitions are typed values
(the `Invariant` precedent) and results are `Evidence` records of kind
`runtime-monitor` minted through the W3 authority.

## Invariants pinned by tests

- The frozen verdict/availability mapping holds for every reference-engine
  evaluation over randomized monitors and event lists (property tests,
  fixed seed).
- A rogue engine claiming `VIOLATED` with availability `SUCCESS` (or any
  mapping violation) is refused — adapters are not authority.
- Forged revision bindings, wrong evidence kinds, non-OBSERVES links,
  invalid W3 records and empty reasons are all refused loudly.
- Evaluation determinism: identical `(monitor, events, context)` triples
  reproduce byte-identical results and identical evidence ids.
- The four honest not-conclusive states (UNKNOWN / UNAVAILABLE /
  UNSUPPORTED / PARTIAL) arise each from its own truthful cause and are
  never conflated.
