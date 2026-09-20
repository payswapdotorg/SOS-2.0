# @sos-2/brownfield — SOS 2.0 Brownfield Optimization Loop (W15)

A pure, deterministic, typed orchestration of the merged SOS planes over an
existing-system snapshot (Work Order W15, parallel slot C; spec/architecture.md
§6 and §15, docs/code-to-architecture.md, R6/R23):

```
INGESTION -> COMPETING RECOVERY -> RETRIEVAL -> EVOLUTION -> ASSURANCE
-> SIMULATED EXPERIMENT -> PROMOTION/ROLLBACK -> RECONCILIATION -> PACKAGE LEARNING
```

followed by the TRACEABILITY INVARIANT self-check: the collected typed spine
trace links must form ONE connected semantic subgraph rooted at the
normalized ImplementationModel and reaching every learned ecology update —
a missing link fails the pipeline before the result is returned.

## The nine stages

| Stage | Authority consumed | Guarantee |
| --- | --- | --- |
| 1. Ingestion | `@sos-2/semantic-spine` (ImplementationModel), `@sos-2/telemetry` + `@sos-2/adapters` (runtime ingestion), `@sos-2/runtime-conformance` + `@sos-2/conformance` (invariant evaluation), `@sos-2/system-state`/`@sos-2/architecture` (declared graph + SystemState) | snapshot -> normalized ImplementationModel + declared graph + SystemState + runtime conformance evidence; declared-but-unobserved components recorded as UNAVAILABLE gaps (never silence) |
| 2. Competing recovery | `@sos-2/recovery` | multiple ArchitectureGraph hypotheses whenever evidence is ambiguous; ambiguity NEVER collapses (assertCompetingHypotheses) |
| 3. Package retrieval | `@sos-2/registry` + `@sos-2/retrieval` | context-conditioned diverse candidate set, uncertainty surfaced verbatim per candidate |
| 4. Candidate evolution | `@sos-2/search` + `@sos-2/optimization` + `@sos-2/architecture` + `@sos-2/conformance` + `@sos-2/experiments` (W9 bridge) | bounded REPLACE_COMPONENT LocalCandidate; Pareto front + MAP-Elites repertoire; the applied graph must preserve every declared invariant; CandidateState fixture + candidate architecture artifact |
| 5. Assurance | `@sos-2/assurance` + `@sos-2/verification` | living case over the candidate with a runtime monitor; objections retained; INVALID blocks promotion (verdict projection to the W9 gate: VALID->SATISFIED, OBJECTIONED->INCOMPLETE, INVALID->REFUTED) |
| 6. Experiment | `@sos-2/experiments` | fixed-seed SIMULATED experiment (SHADOW->CANARY->CONTROLLED lifecycle); the simulated marker is machine-checked — never intervention evidence |
| 7. Promotion / rollback | `@sos-2/promotion` + `@sos-2/authority` | evidence-gated decision from the frozen six; live guardrail triggers drive ROLLBACK (safety first); bounded recovery declaration always built — ROLLBACK without it REJECTS; the honest nominal decision is EXPERIMENT (no real intervention evidence exists in a deterministic simulation) |
| 8. Reconciliation | `@sos-2/conformance` | implementation-vs-declared drift classification over the selected hypothesis' model view (interface projection included); zero-filled counts over all 7 frozen classes; drift retained as evidence |
| 9. Package learning | `@sos-2/transfer` + `@sos-2/ecology` + `@sos-2/memory` | transfer evidence (source context from the package's own registry entry; claim strength CORRELATIONAL), decay signals into the read-only maturity review queue, architecture memory with retained failure/rollback contexts and learned rules |

## Determinism

- single caller-supplied `now` (no hidden clocks), fixed simulator seed;
- content-addressed ids, canonical serialization, sorted input normalization
  (order-independent digests);
- injected fresh stores per run — identical input produces a byte-identical
  `canonicalBrownfieldText(result)`.

## The golden scenario

`GOLDEN_BROWNFIELD_SCENARIO` (exported pure JSON) is a fake legacy system
("merch-catalog-legacy"): six modules, five dependencies, one interface,
structural runtime observations and OTel-shaped telemetry traces; the
declared "as-documented" architecture (deliberately drifted: a declared
reporting component that no longer exists, an undeclared cache module); an
intentionally AMBIGUOUS observation model (service kinds + grouped shard
realizations) so recovery produces competing hypotheses; a three-family
package population (incumbent legacy-monolith, durable-queue, edge-cache);
and a fixed-seed experiment specification with two worlds (nominal and
degraded — the degraded world breaches the error-rate guardrail and drives
the ROLLBACK path variant).

## Usage

```ts
import {
  GOLDEN_BROWNFIELD_SCENARIO,
  buildBrownfieldLoopInput,
  runBrownfieldLoop,
  formatBrownfieldSummary,
} from '@sos-2/brownfield';

const { input } = buildBrownfieldLoopInput(GOLDEN_BROWNFIELD_SCENARIO, 'nominal');
const result = runBrownfieldLoop(input);
console.log(formatBrownfieldSummary(result)); // decision: EXPERIMENT (evidence-gated)

const degraded = buildBrownfieldLoopInput(GOLDEN_BROWNFIELD_SCENARIO, 'degraded');
const rollback = runBrownfieldLoop(degraded.input);
// rollback.summary.decision.action === 'ROLLBACK' (+ bounded recovery declared)
```

See `W15.architecture-delta.json` for the Architecture Delta record (declared
in-package because `spec/**` is outside W15's owned paths). The runnable
end-to-end harness lives in `apps/brownfield-harness`.
