# @sos-2/self-evolution-harness — SOS 2.0 Self-Evolution Harness (W16)

A runnable end-to-end harness over the golden self-evolution scenario
(SOS-process fixtures: the W15 golden object system + the golden
meta-strategy state), executing BOTH paths deterministically:

- **HEALTHY** — a governance-preserving MetaChange measured, decisioned
  (ACT), promoted (ACT), revision applied;
- **ADVERSARIAL** — a governance-weakening proposal REJECTED by the
  non-disableable guard; a failed/effectiveness-negative change ROLLED BACK
  with an exact parameter restore AND retained in liability memory;
- **ASK** — an authority-insufficient org-wide change escalated to the
  first-class ASK path (pending human authority).

The object loop runs over the W15 golden fixtures in both worlds (the
nominal world inside the meta loop's separation probe; the degraded world
standalone — guardrail breach → ROLLBACK).

**Zero domain logic**: everything is imported from `@sos-2/meta-evolution`.

Run: `pnpm start` — prints the deterministic summary (proposals → guard
verdicts → measurements → decisions → retained failures → process revision)
and exits 0 ONLY if every stage succeeded and every trace chain is complete.

`pnpm demo:build` regenerates the committed `fixtures/golden-run.json`
deterministic snapshot (including the full trace graph); the vitest suite
re-runs the harness twice asserting byte-identical output and exact
reproduction of the committed fixture. No network, no time dependence
(single caller-supplied instant, fixed seed).
