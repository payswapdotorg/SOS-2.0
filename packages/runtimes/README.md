# @sos-2/runtimes

SOS 2.0 Runtimes (Work Order W12, parallel slot C). The **runtime
contract**: typed runtime descriptors plus a `RuntimeHost` that executes
**DECLARED operations against DECLARED runtimes** — authority-checked,
observed and traced.

> Note: this package is the *runtime execution* contract and is distinct
> from `@sos-2/runtime-conformance` (W4), which evaluates declared
> executable invariants against runtime observations. The two are
> complementary: W4 consumes runtime behavior as evidence; this package is
> where that behavior is produced under authority.

## What lives here

| Export | Purpose |
| --- | --- |
| `RuntimeDescriptor` | typed descriptor: `id`, `kind` (`in-memory` / `process` / `container` / `edge-function` / `vm-isolate`), `version`, `capabilities` (the DECLARED operation names) and typed `constraints` (`MAX_DURATION_MS`, `MAX_MEMORY_MB`, `MAX_OUTPUT_BYTES`, `NETWORK_ACCESS`, `FILESYSTEM_ACCESS`) |
| `RuntimeHost` / `InMemoryRuntimeHost` | registers declared runtimes + handlers and executes requests: authority gate → declaration checks → run → observation |
| `ExecutionRequest` / `ExecutionResult` | requests carry the **grant reference + evaluation point + window** (no hidden clocks); results are `EXECUTED` (with the observation) or `EXECUTION_DENIED` (with a structured denial) |
| `EXECUTION_DENIAL_CODES` | `GRANT_MISSING`, `GRANT_UNKNOWN`, `GRANT_EXPIRED`, `GRANT_REVOKED` — expired/revoked/missing grants never run anything |
| `RuntimeObservation` | the typed, evidence-shaped record of one execution: truthful availability (frozen 6 states, verbatim), output/error, window, producer, grant ref, observed SystemState ref and the OBSERVES/VERIFIES trace links |
| `toRawObservation` | bridges an observation into a `@sos-2/telemetry` `RawObservation` so the merged evidence layer (`ingestObservation`) can mint evidence — availability is carried VERBATIM |
| `runtimeMatchesContext` / `selectRuntimesForContext` | **platform behavior is Context/Adapter data**: runtimes declare typed `context_constraints` over REGISTERED `@sos-2/context` dimensions; selection matches dimension values by their declared types |

## Execution is authority checked

`execute` validates the grant through the merged W1 authority
(`evaluateGrant`) **before** anything runs:

1. **GRANT_MISSING** — a forged request without a grant reference is denied.
2. **GRANT_UNKNOWN** — the grant is not in the operator-supplied pool.
3. **GRANT_EXPIRED / GRANT_REVOKED** — the grant is not `VALID` at the
   request's evaluation point.

Every denial is a structured result (`{ code, grant_ref, reason }`) and the
operation provably never runs (no observation, no trace link). Unknown
runtimes, undeclared operations and malformed requests fail **loudly**
(`RuntimeError` / `RuntimeRequestError`) — contract violations, not
operational denials.

## Runtime feeds System State and Evidence

Every execution emits a `RuntimeObservation` linked to the SystemState
revision it observed: when the request carries a subject and an observed
SystemState id, the host mints an **OBSERVES** (or **VERIFIES** for
verification executions) trace link through the spine's
`createTraceLink`. **Runtime observations never mutate System State
directly** — they are input to reconciliation: the observation carries the
SystemState *reference* only, and the host exposes no system-state write
path at all (pinned by tests: a SystemState artifact is bit-identical
before and after executions observing it).

## Platform behavior is Context/Adapter data

Runtime/platform specifics live in typed context dimensions consumed from
`@sos-2/context`; the *execution* path never reads context — there is no
semantic branch on platform anywhere in this package. `MAX_OUTPUT_BYTES`
is enforced deterministically by the in-memory host (canonical output
size); duration/memory/access bounds are declarations concrete runtimes
enforce — the in-memory substrate cannot honor wall-clock bounds without a
hidden clock, so it does not pretend to.

## Layering

```
@sos-2/semantic-spine  ─┐
@sos-2/provenance       ─┤
@sos-2/telemetry        ─┼──  @sos-2/runtimes  (this package)
@sos-2/authority        ─┤     (dev-only: @sos-2/evidence for the bridge
@sos-2/context          ─┘      tests, @sos-2/system-state for the
                                 no-mutation pin)
```
