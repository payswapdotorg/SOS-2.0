# @sos-2/meta-evolution — SOS 2.0 Self-Evolution + Meta-Adaptation (W16)

A pure, deterministic **META-EVOLUTION orchestrator** that applies SOS to itself
WITHOUT allowing evolution to weaken governance (spec/architecture.md §16;
R3/R13/R14/R19/R20/R31; Work Order W16, parallel slot A).

## The seven stages

`runMetaEvolutionLoop(input)` executes, in order:

1. **SEPARATION** — the object/meta structural invariant. The stage runs the
   W15 brownfield golden loop over the golden object fixtures (the real
   object pipeline, consumed not duplicated) and anchors its
   ImplementationModel; the meta loop is anchored at the initial
   MetaProcess revision under the constraining Mission. Lane rules are
   machine-checked in both directions with typed rejections.
2. **META-PROPOSAL** — candidate self-changes generated through the package
   registry (R24 — SOS internals consume the same package mechanism), ranked
   by Pareto + quality-diversity over the frozen §11 axes (R12), with the
   R19 penalty: packages with recorded transfer failures carry reduced
   proposal probability.
3. **GOVERNANCE GUARD** — non-disableable. The guard is a pure function over
   a frozen invariant list and a frozen nine-key evolvable surface; anything
   touching authority gates, traceability, ASK, decision records or the
   guard itself is REJECTED with a typed record before any measurement or
   decision. The apply path re-runs the guard — bypass is impossible.
4. **EFFECTIVENESS** — each guard-passing change is trial-applied (a DRAFT
   revision) and measured before/after on the §11 axes through the
   fixed-seed simulator. Outcomes are machine-marked simulated — never
   intervention evidence.
5. **DECISION + PROMOTION** — authority-first through `@sos-2/decision`
   (ASK is first-class: authority-insufficient changes escalate and enqueue
   an AskRequest); on ACT, the `@sos-2/promotion` guardrails run and an ACT
   promotion activates the trial revision — the applied MetaChange produces
   the new MetaProcess revision (versioned, spine-traceable).
6. **ROLLBACK** — a tripped guardrail or negative-effectiveness result
   drives ROLLBACK with a bounded recovery declaration, and the process
   revision restores EXACTLY (byte-equal parameters; machine-checked).
7. **LIABILITY MEMORY** — failed self-changes are retained forever as
   failure memory (`@sos-2/memory`), negative transfer evidence
   (`@sos-2/transfer`) and decay signals (`@sos-2/ecology`); failed
   proposals reduce future proposal probability (R19).

Every stage handoff is a typed spine trace link; the full result is ONE
connected semantic subgraph from the MetaChange proposals to the applied
revisions or rollback restores plus retained failures (`assertMetaTraceChain`).
Identical input (fresh stores) produces a byte-identical canonical result.

## Export discipline

All core identifiers, envelopes, trace links and vocabularies come from the
merged authorities (`@sos-2/semantic-spine` and the W1–W15 packages); the two
extension kinds (`MetaProcess`, `MetaChange`) are registered through the
spine's only sanctioned add-only extension point. Nothing is duplicated; the
`W16.architecture-delta.json` in this directory is the Architecture Delta
record for the Work Order.

See `apps/self-evolution-harness` for the runnable end-to-end harness over
the golden self-evolution scenario.
