# @sos-2/brownfield-harness — SOS 2.0 Brownfield Harness (W15)

The runnable end-to-end harness over the golden brownfield scenario (the
fake `merch-catalog-legacy` legacy system: modules, dependencies, runtime
observations and OTel-shaped telemetry traces).

**Zero domain logic** — everything is imported from `@sos-2/brownfield`
(the orchestrator) and its merged `@sos-2/*` authorities. The harness only
executes, prints and exits.

## Run it

```bash
pnpm --filter @sos-2/brownfield-harness start
```

Prints the deterministic one-screen summary of BOTH golden worlds:

- **NOMINAL** — the healthy simulated experiment; the honest, evidence-gated
  `EXPERIMENT` decision (no real intervention evidence exists in a
  deterministic simulation, so promotion stays gated);
- **DEGRADED** — the error-rate guardrail breaches; `ROLLBACK` decision with
  the bounded recovery declaration, failure memory and the rollback event
  (the ROLLBACK path variant).

```
ingested -> hypotheses (N) -> retrieved -> candidate -> assurance verdict
-> experiment outcome -> decision -> drift classes -> learned updates
-> trace chain
```

**Exit code 0 ONLY if both loops form one complete connected trace chain**
from the ImplementationModel to the learned ecology updates.

## Determinism

- fixed seed, single caller-supplied instant, fresh registry + learning
  stores per run;
- `fixtures/golden-run.json` is the committed deterministic snapshot of the
  run (including the full trace graph of both variants); the test suite
  asserts byte-identical reproduction and that two independent runs are
  identical;
- regenerate the fixture with `pnpm --filter @sos-2/brownfield-harness
  demo:build` (byte-stable: re-running produces the identical file).

No network, no time dependence.
