# W17 Integrated Dogfood Report — SOS 2.0

**Work Order:** W17 — Integrated Dogfood + Adversarial Verification
**Base commit:** `152eff1b5e01adc3ac3742552e0477aad3209578` (main head at dispatch; "gov: reconcile state after W16 merge")
**Evidence binds to:** the exact W17 head SHA of branch `wo/w17-dogfood` (AGENTS.md rule 10 — verify against the PR head, not this prose)
**Owned paths:** `tests/dogfood/`, `tests/adversarial/`, `docs/evidence/dogfood/` (+ the single one-line test-wiring entry described below)
**Suites:** `tests/dogfood/test/dogfood.test.ts` (17 cases), `tests/dogfood/test/coverage-ledger.test.ts` (8 machine checks), `tests/adversarial/test/01..13-*.test.ts` (61 cases across the 13 frozen classes)

---

## 1. The integrated scenario — one journey, every stage

ONE connected end-to-end dogfood scenario drives **every stage of the merged system** through the public exports of the three harness apps' underlying packages — `@sos-2/greenfield` (W14), `@sos-2/brownfield` (W15), `@sos-2/meta-evolution` (W16) — plus the merged authorities they orchestrate. The scenario is PURE and DETERMINISTIC: fixed instants, fixed seeds, spine-minted content-addressed identities, zero I/O, zero hidden clocks; the determinism case pins a byte-identical canonical projection across two full runs, and the two complete `pnpm -r --if-present test` executions (§5) produced identical per-package results.

### 1.1 Mission formalization (W14 stage 1) — R1, R2

A raw mission input ("Deliver fast, resilient image-resize for a global catalogue (W17 integrated dogfood).", capability `image-resize`, 2 hard constraints: `monthly-cost` MAX 600, `p99-latency` MAX 100) is formalized into the governing Mission artifact:

- Mission v1: `sos://Mission/b4ff8c7e66edc1973e4d986686366229` (ACTIVE, authority root of the chain)
- Progressive formalization: 2 goals with measures → `MEASURABLE`, the trust goal without measures stays `PROPOSED` — never forced.

**Mission evolution (R3):** after the chain completes, the mission owner revises the mission explicitly under a real `AuthorityGrant` (KIND `Mission`, `REVISE`) → Mission v2 `sos://Mission/4345416a2bbc7b69490c0a72c590b57b` (`supersedes` v1, `authority_ref` = the grant id, +1 hard durability constraint); the revision chain is queryable through `MissionStore.history()` → `[v1, v2]`.

**Separate Value Model (R4):** a ValueModel `sos://ValueModel/106b9ff45d47bd9d881be6441bee8971` is created SUBORDINATED to the mission (budgets 550 € ≤ 600 and 90 ms ≤ 100 → `SUBORDINATE`, zero conflicts). A conflicting variant (budget 700 € > the mission's hard 600 €) is **surfaced** as `CONFLICT` with 2 typed conflicts (the oversized budget AND the oversized typed constraint) and a `CONFLICTS_WITH` trace link — never silently accepted.

**Context (R5/R17):** a Context artifact `sos://Context/8d88e48f6a00f32e5637a88abc898716` (environment `production`, platform `edge-runtime`, cohort `beta-testers`, geography `eu-west-1`, regulatory `[GDPR]`) conditions the realization; the same context conditions the brownfield retrieval (`MATCHED` candidates carry estimates conditioned ON the query context).

**Causal grounding (R10):** an observational correlation `sos://CorrelationRecord/d7005d578f94a8a1baea18261c4483b6` (cache-hit-ratio ↔ p99-latency, NEGATIVE) over the greenfield SUCCESS evidence is promoted to a CORRELATIONAL hypothesis `sos://CausalHypothesis/f06b4f154025acbb00688509c9d2955d` through the only sanctioned path (`hypothesize`); a strong CAUSAL claim would require interventional evidence (the claim gate — see adversarial class 9).

### 1.2 Greenfield realization (W14 stages 1–6) — R1, R6, R7, R8, R15, R16, R23, R29

The greenfield pipeline runs TWICE — the two decision variants:

| Run | Authority presented | Engine outcome | Outcome path |
| --- | --- | --- | --- |
| **ASK path (primary chain)** | no grants | `ASK` (escalation `AUTHORITY_INSUFFICIENT`) | AskRequest `sos://AskRequest/4d20dc9500e7343890dc5c98886f98d8` composed + enqueued (deduplicated by the origin's exact input digest), resolved by the human decider (`human:w17-mission-owner`) → resolution DecisionRecord `sos://Decision/4c8f968c2d7c01c445ecd71edc3070b1` with action `ACT` → candidate approved |
| **ACT path (decision point)** | covering grant (KIND `PackageComposition`, `READ`/`REVISE`/`PROMOTE`, valid at the evaluation instant) | `ACT` directly | no ask, no resolution |

Both runs are `ok: true` with complete trace chains. The ASK is a SUCCESS state (R16) — a first-class outcome, never an error; the covering grant is what makes the engine act directly (R15). The candidate was composed at the **highest validated altitude** `VALIDATED_COMPOSITION` (R29): a first-class composition (R25) of two VALIDATED member packages (`image-resize-storage` + `image-resize-transform`, edge-cache family) with a typed `DATA_FLOW` binding, carrying its OWN evidence obligations (R27) and the mission's hard constraints machine-checked against predicted estimates (`SATISFIED`: 431 € ≤ 600, 62 ms ≤ 100).

**Realization (R7/R8/R30):** the approved candidate is realized at the exact revision `31f2a9c07d9e5b864a2c0f7d3e8b1a6c95d4f0e2` (40-hex git sha) into:

- SystemState v1 (ACTIVE, root of a complete, queryable revision chain): `sos://SystemState/7d0aeb162db0b713dac9db5d63c3e3d0` — `architecture_ref` → the declared graph, exact `git-sha` implementation reference, config/deployment/policy exact revisions, and both member packages recorded with their exact registry versions;
- the DECLARED ArchitectureGraph hypothesis: `sos://ArchitectureGraph/71b32c005563179c152eb0fe57235573` (projects the state revision; mutually consistent in both directions — machine-checked by `assertRealizationRevision`);
- the observed ImplementationModel: `sos://ImplementationModel/62c70f5eee7f48689b15877e3815ca29` (every source artifact at the exact realized revision).

**Reconciliation (R23):** the realized implementation vs the declared architecture classifies honestly: `PRESERVING_REFINEMENT` (member components realize declared nodes by refinement) + `IMPLEMENTATION_DETAIL` (the undeclared observability glue), zero drift in the freshly realized system (`clean: true`).

**Evidence ingestion (R21/R18):** 3 records OBSERVE the realized state — 2 SUCCESS + **1 truthful UNAVAILABLE gap** (the cold-start probe was not captured: raw `observed: null`, ingested verbatim as `UNAVAILABLE`, never folded into success or zero), all bound to the exact source revision.

### 1.3 Brownfield optimization loop (W15 stages 1–9) over the REALIZED system — R6, R11, R12, R13, R23, R26, R28, R29

**The object of the brownfield loop is literally the system greenfield produced.** The existing-system snapshot is DERIVED from the greenfield realization: 5 observed modules (the 3 realized components + a backing datastore `store:resized-objects` + an undeclared hot-path cache), 8 dependencies and 2 interfaces projected from the realized ImplementationModel, structural runtime observations keyed by module id, an OTel batch (2 spans + 1 metric + 1 log → 4 ingested, platform-neutral through the W12 adapter pattern, R18), the declared architecture = the realized ArchitectureGraph, at the SAME exact revision `31f2a9c0…`. The goal's `mission_ref` IS the greenfield Mission id — the loops are governed by one mission.

Engineered honest drift (retained + classified, never hidden): no module realizes the declared `deploy:production` node; the backing datastore and cache are undeclared; the cache realizes exactly one declared node (the capability) — the grouped-realization ambiguity.

Stage outcomes (nominal world, `now = 2025-09-15T00:00:00.000Z`):

1. **INGESTION** — 5 modules, 8 dependencies, 2 interfaces, 5 runtime observations, telemetry 4 ingested / 0 fabricated gaps (all declared components observed).
2. **COMPETING RECOVERY** — the ambiguous evidence (observed kind `service` → Component/Adapter; `datastore` → DataStore/Component; grouped realization) yields **8 competing hypotheses across both strategies** (`DIRECT`, `MERGED_REALIZATIONS`); ambiguity markers retained (`GROUPED_REALIZATION@capability:image-resize`, `KIND_AMBIGUITY@datastore`, `KIND_AMBIGUITY@service`); the working hypothesis is selected deterministically, the alternatives are never discarded.
3. **RETRIEVAL** — 4 candidates across 4 families (`durable-queue`, `edge-cache`, `premium-mirror`, `regional-mirror`) at altitudes `VALIDATED_PACKAGE < PACKAGE_ADAPTATION`; the query context (`environment=production, deployment=edge`) MATCHES the regional-mirror/premium/edge estimates (R26); uncertainty carried verbatim.
4. **EVOLUTION** — the §10 ladder descends `VALIDATED_COMPOSITION → VALIDATED_PACKAGE` with a recorded justification (R29); the multi-objective evaluation produces **2 Pareto fronts** (front 0: durable-queue + regional-mirror — never a single winner; front 1: the dominated premium-mirror control) and a 2-cell, 2-family MAP-Elites repertoire (R12); the bounded `REPLACE_COMPONENT` of `component:image-resize-storage` → `component:image-resize-storage-optimized` (package `sos://Package/cfc79f33bc32464fc24d5eb17453dbe3`, family `regional-mirror`) preserves BOTH executable invariants (`FORBIDDEN_DEPENDENCY` Component→DataStore, `DATA_OWNERSHIP`) over the APPLIED graph (R8/R13).
5. **ASSURANCE** — verdict `VALID` with 1 retained objection (objections are never dropped); an INVALID case would block.
6. **EXPERIMENT** — the fixed-seed SIMULATED experiment (seed 20250915, canary 5%, marked `simulated: true` — simulation is NEVER intervention evidence): overall `SUCCESS`, 0 guardrails breached.
7. **PROMOTION** — the honest evidence gate: with simulated-only evidence the healthy outcome is **`EXPERIMENT`** (run the real controlled experiment), never `ACT`; a bounded recovery declaration (300 s, triggers wired to the error-rate guardrail) is always built.
8. **RECONCILIATION** — the engineered drift is classified: `DRIFT=5` (incl. the un-realized `deploy:production` node), `IMPLEMENTATION_DETAIL=4` (the glue, the datastore, the cache), `PRESERVING_REFINEMENT=1` — with typed drift evidence records.
9. **LEARNING (the ecology updates)** — 4 architecture-memory entries, a `TRANSFER_SUCCESS` transfer record (source = the selected package; a TransferStore record, queryable, deliberately not a spine artifact), 1 decay signal (`USAGE_DECAY` on the realized incumbent), **2 ecology packages updated**.

**Degraded world (decision point, R13/R14):** the same loop with the degraded effect set breaches the error-rate guardrail (treatment 0.089 > 0.05): experiment `FAILURE`, 1 guardrail breached, 1 rollback trigger fired → decision **`ROLLBACK`** with the bounded recovery declaration (300 s, triggers wired) — chain complete.

### 1.4 Self-evolution meta loop (W16 stages 1–7) over the SAME object system — R15, R16, R19, R20, R31

The meta scenario's object lane IS the greenfield-derived brownfield fixture (nominal world): the separation stage re-runs the object loop internally — the object probe anchors the SAME ImplementationModel `sos://ImplementationModel/da8ed003f438f36a3f7c2596087e4744` (content-addressed identity), and the lane rules reject the object/meta conflation attempts in both directions (2 typed rejections retained).

Four meta-changes exercise every W16 stage outcome:

| Meta-change | Guard | Measurement | Decision | Outcome |
| --- | --- | --- | --- | --- |
| `weakening-fast-lane` (governance off, guard off, traceability optional, ASK disabled) | **REJECTED** (`NON_EVOLVABLE_KEY`, invariant `ASK_FIRST_CLASS`; typed rejection + FAILURE evidence retained) | never measured | — | contained before any effect |
| `regressive-pruning` | passed | measured NEGATIVE (RESILIENCE 28 < floor 40 → guardrail breached) | **`ROLLBACK`** | bounded recovery + EXACT parameter restore + retained failure memory (`FAILURE`, `ROLLBACK`, `LIABILITY`, `LEARNED_RULE`) with the R19 penalty demonstrated |
| `org-wide-rollout` (ORGANIZATION blast radius) | passed | measured positive | **`ASK`** (SUPERVISED authority required) | first-class AskRequest `sos://AskRequest/f2d34da1267b15d997eb47a955ffac5` enqueued, `PENDING` |
| `healthy-tuning` | passed | measured positive (prior interventional evidence) | **`ACT`** → promotion | applied: process revision advances v1 → v3 |

Process revision chain: `sos://MetaProcess/1fa206136ea379d5ec38192e5df025e3@v1 → …@v2 → sos://MetaProcess/7a6d7d8ec2e09e5a7c6fe9611296990d@v3` (restore exact: yes). The meta loop runs UNDER its own mission `sos://Mission/2f332e74689bc013a097b68f601999d7` (R31: the same discipline — mission, packages, registry, evidence, decisions, promotion — applied to itself), and the guard's rejections are pure functions outside the evolvable surface (adversarial class 13 pins this under accumulation).

### 1.5 The integrated trace chain — R9, R30

The W17 connective tissue (typed handoff links, all spine-minted):

- brownfield ImplementationModel —`DERIVED_FROM`→ greenfield SystemState (the brownfield system IS the realized system at the same exact revision);
- brownfield declared architecture —`DERIVED_FROM`→ greenfield ArchitectureGraph;
- brownfield ImplementationModel —`DERIVED_FROM`→ greenfield ImplementationModel;
- ValueModel —`DERIVED_FROM`→ Mission; Context —`CONSTRAINS`→ SystemState; Mission v2 —`DERIVED_FROM`→ Mission v1; the conflicting ValueModel's `CONFLICTS_WITH` link; the causal store's SUPPORTS/derivation links.

The combined graph: **142 typed trace links over 98 artifacts in ONE undirected connected component** containing the greenfield Mission, the realized SystemState, every brownfield artifact (incl. the learned memory `sos://ArchitectureMemory/226aa45a501ecf0b9202fbccd6f1f46b`, the outcome evidence and both updated ecology packages) and every meta artifact (incl. the final process revision and the retained failure memory `sos://ArchitectureMemory/3d70863b4ef8d5b05aac47437677eddf`). Directed query paths (the chain is queryable, not merely asserted):

1. SystemState → Mission (walkable through the W14 chain),
2. brownfield ImplementationModel → greenfield SystemState (the W17 handoff),
3. **the self-evolution Mission → the product Mission** (meta mission `CONSTRAINS` process → process `CONSTRAINS` object model → handoff → realized state → candidate → mission).

The learned transfer record is a TransferStore record (queryable through the store, `TRANSFER_SUCCESS`, source = the selected package) — deliberately NOT a spine trace link: the spine refuses to mint links over non-spine ids, which is the identity discipline working.

### 1.6 Explainability + determinism — R22, R30

- The realized SystemState exposes a valid rationale chain (upstream: the 3 evidence records + the conditioning Context; downstream: the approved candidate + the declared architecture) and the evidence pool projects onto a deterministic evidence view model (`vmHash` stable, all six truth states counted: SUCCESS 2, UNAVAILABLE 1).
- The ENTIRE scenario is a pure function of its input: two full executions produce byte-identical canonical projections and identical input digests for both brownfield worlds and the meta loop.

---

## 2. Requirement coverage ledger

`docs/evidence/dogfood/coverage-ledger.json` maps **R1–R31 → exact test case(s) + stage + revision token** — 31 entries, zero gaps. The machine check (`tests/dogfood/test/coverage-ledger.test.ts`) enforces: exact R1–R31 key coverage; every referenced test case is a REAL test title (the suite renders its titles from the same `DOGFOOD_CASES` constants the ledger is generated from); the ledger equals the code-side manifest exactly; stage labels match; revision tokens are the exact in-scenario tokens; no orphan dogfood cases. **Coverage: 31/31.**

---

## 3. Adversarial outcomes — the 13 frozen classes

Each suite (`tests/adversarial/test/`) CONSTRUCTS the fault, asserts DETECTION or CONTAINMENT (typed rejection/failure record — never a silent pass, never a crash), and asserts the trace chain stays queryable afterward. **13/13 with typed detect/contain outcomes:**

| # | Class | Outcome (typed record) |
| --- | --- | --- |
| 1 | Stale System State | **detected** — promotion gate `REJECT` (incompatible system-state gate, reasons listed); freshness `SUPERSEDED_SUBJECT_REVISION`; store `isLatest=false`, history queryable |
| 2 | Missing telemetry | **truthful** — synthesized `UNAVAILABLE` gap (`observed: null`), ingested verbatim, distinct truth states preserved (`assertTruthStateIs`); covered windows return data, uncovered windows return gaps |
| 3 | Contradictory evidence | **surfaced** — assurance verdict `INVALID` with `CONTRADICTED_BY_EVIDENCE` (fresh FAILURE contradiction ≠ cancelled by SUCCESS support); ecology `canCoexist` → `compatible:false` with the conflicting pair + evidence listed |
| 4 | Unavailable dependency | **truthful** — execution adapter `EXECUTION_DENIED` (`GRANT_EXPIRED`, `GRANT_REVOKED` typed denials, revocation retained); retrieval keeps unresolved evidence honestly (resolved 0/2, zeroed availability counts, no invented probability) |
| 5 | Malicious generated change | **rejected + retained** — governance guard `NON_EVOLVABLE_KEY` typed rejection BEFORE any measurement; rejected artifact + provenance retained; structural bypass (`applyParametersPatch`/`applyMetaChange`) throws `GUARD_BYPASS_ATTEMPT` |
| 6 | Assurance monitor failure | **surfaced** — no-events ALWAYS monitor `INCONCLUSIVE`/`UNAVAILABLE` (monitor-down ≠ monitor-green); unsupported property `UNSUPPORTED`; violated monitor `VIOLATED`/`FAILURE`; frozen verdict↔availability mapping refuses dishonest pairings |
| 7 | Rollback failure | **caught + contained** — rollback of a never-deployed (or already-rolled-back) deployment throws `DeploymentLifecycleError`; record keeps its lifecycle state, transitions retained + queryable, no fabricated outcomes |
| 8 | Package interaction failure | **contained** — COMPATIBLE_WITH + fresh CONFLICTS_WITH both retained, `canCoexist` false with pairs listed; `INTERFERENCE` recorded with FAILURE evidence; unevidenced `SYNERGY`/`INTERFERENCE` claims rejected with `EcologyError` and NOT recorded |
| 9 | Misleading confidence | **rejected** — LLM producer + CALIBRATED confidence throws; CAUSAL claim over observational-only evidence throws (claim gate; honest form is CORRELATIONAL); the decision engine REJECTS simulated evidence despite a glowing 0.99 calibrated confidence (confidence never consulted, rule `R3_EVIDENCE`/`SIMULATED_EVIDENCE`) |
| 10 | Architectural drift | **classified** — DRIFT (un-realized normal node), CONTRADICTION (missing critical node), PRESERVING_REFINEMENT (declared node realized by refinement), IMPLEMENTATION_DETAIL (undeclared components), UNKNOWN (kind mismatch); typed drift evidence records (kind `architecture-drift`, availability SUCCESS) + `CONTRADICTS` links; invariant violation is a typed `FAIL` |
| 11 | Diversity collapse | **rejected** — single-survivor selection: `FamilyPreservationCheck` `preserved:false` with collapsed families listed; asserting form throws `DiversityError`; identical-candidate single-family set likewise rejected; the sanctioned per-family-representative reduction passes; archive coverage retained |
| 12 | Invalid authority | **rejected** — `authorize()` throws `AuthorityError` (missing permission / expired / artifact-scope→kind escalation); autonomy verdict `DENIED`/`NO_GRANT`; decision engine escalates `ASK` (`AUTHORITY_INSUFFICIENT` — typed record, never silent); promotion gate refuses without a grant (`REJECT`/`ASK`, authority gate reasons) |
| 13 | Governance-weakening self-evolution | **held under accumulation** — 6 governance-weakening patches (governance off, guard off, traceability optional, ASK disabled, decision records off, audit none) each rejected with a typed record across a 6-step accumulation of applied healthy changes (version v1→v7, guard pure at every step, bypass always throws); value-level weakening rejected too (`VALIDATED_ALTITUDE_ZEROED`, `DIVERSITY_COLLAPSE`) |

---

## 4. Verification gates (run at the exact head; see §5 for the raw sequence)

| Gate | Result |
| --- | --- |
| `node scripts/verify-repo.mjs` | **PASS** (19 work orders, frontier W17) |
| `pnpm install` | **PASS** (workspace links incl. `tests/*`) |
| `pnpm -r --if-present build` | **PASS** (46 workspace projects) |
| `pnpm -r --if-present test` (run 1) | **PASS** — 223 test files, **2374 tests**, 0 failed |
| `pnpm -r --if-present test` (run 2) | **PASS** — 223 test files, **2374 tests**, 0 failed |
| Determinism re-run | **PASS** — per-package results byte-identical across the two runs (interleaved console ordering differs; results do not) |
| Requirement coverage | **31/31** (ledger: `docs/evidence/dogfood/coverage-ledger.json`) |
| Adversarial classes | **13/13** typed detect/contain outcomes (61 tests) |

Suite split: 2288 pre-existing unit/property tests (unchanged, all still green) + 25 dogfood (17 scenario cases + 8 evidence-pack machine checks) + 61 adversarial.

---

## 5. Notes, scope and honesty

- **Test wiring (the only change outside the owned paths):** the W17 task packet instructs "vitest at the repository root (extend the root vitest workspace so `pnpm -r test` includes your suites)". `pnpm -r` excludes the workspace root, so the minimal, convention-consistent wiring is ONE added line in `pnpm-workspace.yaml` (`tests/*`), making `tests/dogfood` and `tests/adversarial` ordinary workspace packages whose `test` scripts (`build && vitest run`) run exactly like every other package's. No package source, app, spec or script was touched. The untracked `pnpm-lock.yaml` is not committed (matching repository state).
- **No core identifiers invented:** every id, envelope, kind, trace type and vocabulary is consumed from the merged packages' public exports; the W17-only connective tissue uses the spine's `createTraceLink`/`deriveDeterministicArtifactId`.
- The dogfood pins EXACT deterministic outcomes (ids, counts, decisions, drift classes) — the values in this report are the values the assertions verify.
- The adversarial suites deliberately do NOT double as requirement coverage: they prove detection/containment of faults; the happy-path proof is the dogfood ledger.
- CI on the branch runs the repository contract check (`verify.yml`); the full build+test sequence above was executed locally at the exact head (logs summarized in §4).

**Status: WAITING_FOR_ARCHITECT** — no merge, no self-approve, no state reconciliation, no successor work.
