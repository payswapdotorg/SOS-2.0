# P17-C — Real Observation + Product UX Wiring

Dependencies: P16  
Owned paths: packages/real-observation, apps/web/live-mission, tests/real-observation, docs/evidence/production-connectivity/observation-ux  
Lane of P17 (observation/UX); Workers deliver, Architect gates

## Goal

Connect real observation sources and wire the existing production web UI to live state.

## Scope

- Real observation sources feeding the existing Observation Plane: GitHub events, CI
  results, deployment events, runtime telemetry, scheduled probes, provider health.
- Observation flows into System State / Evidence per the frozen contracts — no permanent
  body required.
- Production web UI wired to live state: onboarding discoverable as a first-class entry
  point; mission becomes actionable (Start mission / Import system / Resume existing
  mission — replacing the read-only mission view).
- Consequential action wiring where contracts permit: ASK resolution, execution, promotion,
  rollback, package composition — through the authority-gated action paths.
- Preserve the existing rationale/evidence/uncertainty presentation.
- The user computer remains optional (cloud-first).

## Evidence requirements

- Real event transcripts ingested end-to-end (source → Observation Plane → System State).
- UI wiring evidence: real state transitions triggered from the web surface with authority
  gates and evidence links.
- Honest states for every source (`CONNECTED` / `UNKNOWN` / `UNAVAILABLE` / `DEGRADED`).

## Acceptance

Real events flow into System State and Evidence; the first-user path is operational
(onboarding → mission start → live observation); consequential UI actions produce real,
authority-gated transitions; deterministic reference-mode tests remain green.

## Completion

Branch + independent architect gate + PR + CI + squash-merge + machine-state reconcile.
Workers stop at WAITING_FOR_ARCHITECT on contract ambiguity or cross-owned-path needs.
