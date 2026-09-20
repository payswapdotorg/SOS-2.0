# @sos-2/console — the SOS 2.0 Human Console (W11)

A runnable, deterministic, server-rendered console exposing the twelve SOS
journeys. **Zero domain logic of its own**: every domain behavior comes from
the `@sos-2/*` workspace packages and every page renders view-models
projected by `@sos-2/ui-contracts` (enforced by an import-only static test).

## Run

```bash
pnpm --filter @sos-2/console dev
```

The console listens on **http://localhost:8787** (override with the
`CONSOLE_PORT` environment variable). It runs standalone with **zero
network**: all pages render from the committed golden demo fixture
(`fixtures/demo.json`), and the only user inputs are the two forms below.

## The twelve journeys

| Journey | Route |
| --- | --- |
| Mission onboarding (view + create Mission via domain types) | `/mission` |
| System import (paste an ImplementationModel fixture → System State view) | `/import` |
| Architecture/reality reconciliation (declared vs observed vs classification + why) | `/reconciliation` |
| Evidence investigation (query by subject/truth state; provenance visible) | `/evidence` |
| Candidate comparison (side-by-side, uncertainty + evidence context) | `/candidates` |
| Assurance review (case with objections + derived verdict) | `/assurance` |
| Experiment monitoring (lifecycle + guardrails + stopping triggers) | `/experiments` |
| ASK (exact decision, alternatives, evidence quality, uncertainty, trade-offs, risk, authority insufficiency) | `/ask` |
| Rollback (recovery declaration view) | `/rollback` |
| Package discovery/composition (repertoire with diversity dimensions + limitations) | `/packages` |
| Architecture history (supersedes chains over time) | `/history` |
| SOS self-evolution review (read-only meta state projection) | `/evolution` |

Every consequential decision panel links to its **rationale chain page**
(`/rationale?id=<artifact>`): the typed upstream/downstream trace links and
the exact evidence refs behind the decision.

## Determinism

- The demo fixture is built **exclusively through the domain packages' own
  builders** (`createMission` + `MissionStore.revise`, `createSystemState` +
  `SystemStateStore.supersede`, `createArchitectureGraph`,
  `createEvidence`, `createAssuranceCase` + `evaluateAssuranceCase`,
  `createExperiment` + `simulateExperiment` + `evaluateExperimentResult`,
  the W10 decision engine `evaluate`, `composeAskContent` +
  `createAskRequest` + `assembleEscalationContext`, `evaluatePromotion`,
  `createRecoveryDeclaration`, `createPackageArtifact` +
  `PackageRegistry.put/promote/retrieve`, `createTraceLink`) with fixed
  instants and a fixed simulator seed — rebuilding reproduces the committed
  fixture byte-for-byte (pinned by a test).
- Rendering is a pure function of the view-models: same fixture →
  byte-identical pages, verified by double-render identity plus a committed
  golden hash snapshot (`test/golden/render-hashes.json`).
- To regenerate the fixture after an intentional demo change:
  `pnpm --filter @sos-2/console demo:build`, then regenerate the golden
  hashes (see `test/determinism.test.ts`).

## Tests

```bash
pnpm --filter @sos-2/console test
```

- **Determinism** — golden fixture reproducibility, double-assembly
  byte-identity, golden page hashes.
- **Import-only check** — the app defines no domain types and imports only
  `@sos-2/*`, node builtins and its own modules (the W11 negative
  discipline: redefining domain types is REJECTED).
- **Journeys** — the twelve journeys, their acceptance content (all six
  truth states distinct, uncertainty and provenance visible, simulated runs
  honestly marked, objections never dropped, families never collapsed) and
  the rationale-chain acceptance on every page.
- **Server smoke** — pages respond 200, both POST journeys work (mission
  creation via the domain types; system import with truthful failures),
  repeated requests render byte-identical HTML.

## Demo world (one coherent story)

A checkout platform evolving under SOS governance: mission v1 → v2, a legacy
baseline recovered into ArchitectureGraph v1 → v2, a live SystemState chain,
an observed ImplementationModel reconciled against the declared
architecture, evidence in all six truth states (including an LLM-produced
analysis marked never-authoritative), two candidates from different
diversity families, a canary experiment (simulated run, honestly marked),
two assurance cases (one OBJECTIONED with an open objection, one VALID), a
promotion decision (ACT, bounded recovery wired to guardrail triggers), an
ASK escalation (an evidence-backed, authority-granted legacy-adapter
retirement whose deciding uncertainty is irreducible), a package repertoire
(two packages + one composition with its own evidence), and the SOS-2.0
program's own machine state for the self-evolution review.
