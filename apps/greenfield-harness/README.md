# @sos-2/greenfield-harness

The SOS 2.0 **Greenfield harness** (Work Order W14): a runnable end-to-end
harness executing the greenfield pipeline (`@sos-2/greenfield`) on a golden
demo scenario.

**Zero domain logic of its own** — everything is imported from the
`@sos-2/*` packages (the import-only discipline is enforced by a static
test: no import specifiers outside `@sos-2/*` / `node:*` / relative app
modules, and no local declaration ever shadows the frozen domain
vocabulary).

## The golden scenario (fixed inputs, fixed seed)

- **The package ecology** (built through the merged packages' own APIs): two
  VALIDATED member packages (edge storage + edge transform), one VALIDATED
  composition of them for the `image-resize` capability with its OWN
  evidence (observational SUCCESS + INTERVENTIONAL) and a calibrated
  edge-context applicability estimate, one VALIDATED durable-queue package
  with RETAINED failure memory (negative evidence is never dropped), and one
  FORMING privacy-local package.
- **The mission**: fast, resilient image resizing under bounded hard
  constraints (monthly cost ≤ 600, p99 ≤ 100ms), two measurable goals + one
  proposed.
- **The authority**: one covering grant (KIND-scoped to PackageComposition,
  PROMOTE permission) — the golden run decides ACT.
- **The realization plan**: exact revision `fba1a657…` (the W14 base SHA),
  production environment, one config, one deployment, one policy.
- **The observations**: two SUCCESS telemetry captures + one UNAVAILABLE
  gap (truthful states — the gap is reported as UNAVAILABLE, never folded
  into success or zero).

## Determinism

No network, no time dependence — every instant is a literal in the
scenario. The full pipeline result — **including the trace graph** — is
canonically serialized (the spine's canonical form) and snapshot-tested
against the committed golden fixture
([`fixtures/golden-run.json`](./fixtures/golden-run.json)): rebuilding the
scenario reproduces the fixture byte-for-byte, and two independent runs are
byte-identical (pinned by tests).

## Usage

```bash
pnpm start          # run the harness: print the summary report, exit 0 on success
pnpm test           # golden fixture + determinism + import-only + report tests
pnpm golden:write   # regenerate fixtures/golden-run.json (deterministic)
```

The harness **exits 0 only if every stage succeeded and the trace chain is
complete** — the Mission → SystemState chain assertion is re-verified before
exit 0; any stage failure, broken stage handoff or incomplete chain exits 1
with a failure report (no silent success).

## The report

```text
--- 1. MISSION FORMALIZATION ---   the formalized mission + goals/measure statuses
--- 2. CANDIDATE COMPOSITION ---   the search ladder, the composed candidate + members
--- 3. HUMAN DECISION FLOW ------- the engine outcome, the rule trace, the ask (if any)
--- 4. REALIZATION --------------- the SystemState revision + declared graph + impl model
--- 5. RECONCILIATION ----------- the classification counts (all seven classes, honest)
--- 6. EVIDENCE INGESTION ------- the truthful availability summary + freshness
--- TRACE CHAIN ----------------- the directed SystemState -> Mission traceability path
```

## Architecture delta

The W14 Architecture Delta record covering this app and
`packages/greenfield` lives at
[`../../packages/greenfield/ARCHITECTURE-DELTA.json`](../../packages/greenfield/ARCHITECTURE-DELTA.json).
