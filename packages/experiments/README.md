# @sos-2/experiments

SOS 2.0 Experiments (Work Order W9, parallel slot C). The **controlled
evolution plane**: experiment artifacts, lifecycle, results and the
deterministic simulator — everything the promotion gate
(`@sos-2/promotion`) consumes to make evidence-gated decisions
(spec/architecture.md §5 "Experiment", §14; requirements R13, R14, R21).

## What lives here

| Export | Purpose |
| --- | --- |
| `ExperimentArtifact` | a Semantic Spine envelope (frozen core kind `Experiment`) plus content: the design, the current lifecycle stage, the canary ladder, the candidate under test (`sos://CandidateState/…`), the causal hypothesis under test (`sos://CausalHypothesis/…` — typed and validated), and the producer |
| `createExperiment` / `assertValidExperiment` | deterministic content-addressed minting (`sos://Experiment/<32 hex>` over the creation address) with full design/lifecycle/typed-link validation |
| `ExperimentDesign` | TREATMENT_CONTROL (exactly one control + one treatment) or ALTERNATIVES (≥ 2 distinct candidates); POPULATION (description + typed unit + ≥ 1 context fact); ALLOCATION (typed unit — must EQUAL the population unit — RANDOM or DETERMINISTIC_HASH assignment, arms, positive integer ratios); PRIMARY (≥ 1), SECONDARY (≥ 0) and GUARDRAIL (≥ 1, mandatory, explicit thresholds) metrics; typed STOPPING criteria (MAX_SAMPLES, MAX_DURATION_SECONDS, EARLY_SUCCESS, SAFETY — ≥ 1); ROLLBACK criteria (≥ 1, each wired to explicit guardrail metric ids) |
| `EXPERIMENT_PHASES` / `advanceExperimentStage` | the strict lifecycle **SHADOW → CANARY → CONTROLLED_EXPERIMENT** — no skips, no backwards moves, no re-entry; typed staged exposure: SHADOW is exactly 0% (mirrors never serve live traffic), CANARY is strictly inside (0, 100) AND on the declared ladder, CONTROLLED_EXPERIMENT is exactly 100%; exposure is monotonic non-decreasing (a decrease is a ROLLBACK, not a transition) |
| `CandidateStateFixture` / `createCandidateState` / `candidateStateFromLocalCandidate` | the frozen-kind CandidateState contract shape consumed by the promotion gate (W7 integrates here without contract changes); the W2 bridge adapts a merged `LocalCandidate` verbatim |
| `ExperimentResultRecord` / `createExperimentResult` / `resultTraceLinks` | typed result records (`sos://Evaluation/<32 hex>`) **linked to the candidate AND the causal hypothesis AND the experiment** — reference fields plus VERIFIES (→ candidate), OBSERVES (→ hypothesis), CAUSED_BY (→ experiment) trace links; truthful 6-state availability per metric (UNKNOWN/UNAVAILABLE/UNSUPPORTED outcomes carry null values — the states stay distinct) |
| `evaluateExperimentResult` / `evaluateGuardrail` / `evaluateMetric` | fail-closed guardrail evaluation — SATISFIED / BREACHED / NOT_ESTABLISHED: a SUCCESS outcome beyond the threshold is BREACHED, a **FAILING guardrail is a breach, an UNKNOWN/UNAVAILABLE guardrail is NOT_ESTABLISHED and is never silently treated as success**; overall availability maps honestly to the 6 frozen truth states (SUCCESS only when every primary AND every guardrail is satisfied) |
| `TriggerRecord` / stopping + rollback evaluation | typed trigger records with EXACT conditions (every condition listed with its satisfied flag); rollback triggers are wired to guardrail metric ids and fire on BREACHED **or** NOT_ESTABLISHED (fail-closed) |
| `simulateExperiment` / `SIMULATOR_VERSION` / `mulberry32` | the deterministic fixed-seed simulator (mulberry32 PRNG, fixed arm-major/metric-minor stream order, Box-Muller noise) producing outcome records from DECLARED effect parameters; every simulated record is marked `simulated: true` + `{version, seed}` — **evaluation infrastructure, never intervention evidence** (the promotion gate rejects simulated records loudly) |

## Identity discipline

Ids are ALWAYS minted by `@sos-2/semantic-spine` (deterministic
content-addressing over the creation address — envelope fields minus `id`,
plus content — exactly the `@sos-2/causal` pattern):

```
sos://Experiment/<first 32 hex of sha-256 over the creation address>
sos://CandidateState/<first 32 hex of sha-256 over the creation address>
sos://Evaluation/<first 32 hex>   (result records — the meta-model's
                                  "Evaluation: benchmark/scenario/protocol/
                                  results" carries experiment results)
```

`Experiment`, `CandidateState`, `CausalHypothesis` and `Evaluation` are
frozen core kinds — no registration is performed and none is needed. The
golden fixtures (`fixtures/*.json`) reproduce bit-exactly from the
documented sample inputs (pinned by tests; regenerate with
`node scripts/make-fixtures.mjs` after `pnpm run build`).

## Parallelization

This package consumes only MERGED authorities: `@sos-2/semantic-spine`
(identity, envelopes, trace links, truth states), `@sos-2/architecture`
(the W2 LocalCandidate bridge), `@sos-2/evidence` (the Confidence
contract), `@sos-2/provenance` (Producer). It has **no dependency on W7
(search) or W8 (assurance) source** — candidates arrive through the
frozen-kind CandidateState contract fixture.

## The fail-closed guardrail rule (locked)

A guardrail outcome is exactly one of three DISTINCT statuses:
`SATISFIED` (SUCCESS within threshold), `BREACHED` (SUCCESS beyond
threshold, or the guardrail reported FAILURE — a failing guardrail is a
breach, never a pass), `NOT_ESTABLISHED` (UNKNOWN / UNAVAILABLE /
UNSUPPORTED / PARTIAL / missing outcome — safety cannot be certified and
is never silently treated as success). Rollback triggers fire on
BREACHED **and** NOT_ESTABLISHED: a live change whose guardrail signal is
lost rolls back (fail-closed). Overall SUCCESS requires every primary
metric satisfied AND every guardrail SATISFIED.
