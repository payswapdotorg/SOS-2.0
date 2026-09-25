# P18 — Live UX + Action Wiring

Dependencies: P17-A, P17-B, P17-C  
Owned paths: apps/web live-action wiring routes, packages/web-contracts live-action projections, apps/web/action-wiring, tests/live-ux, docs/evidence/production-connectivity/live-ux  
Architect-led integration pass over the three P17 lanes

## Goal

Make the existing UX actually operational: the current UX already expresses the right
concepts — now wire them to the real backends delivered by P17.

## First-user path

`/` → What are you trying to accomplish? → Start mission → Greenfield / Brownfield →
Connect GitHub → Formalize mission → Recover / plan → Candidate → Assurance → Run →
Live task → Body + observation → Independent evaluation → PR / deployment →
Runtime observation → Mission outcome → Learning / package.

## Structural fixes

- Mission view: `Start mission` / `Import system` / `Resume existing mission`
  (replacing read-only).
- Onboarding: first-class entry point (discoverable from the root surface).

## Acceptance

The first-user path runs end-to-end against the real persistence, GitHub, execution and
observation backends; every consequential step is authority-gated with visible
rationale/evidence/uncertainty; deterministic reference-mode tests remain green.

## Completion

Branch + independent architect gate + PR + CI + squash-merge + machine-state reconcile.
