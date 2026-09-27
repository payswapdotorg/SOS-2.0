# P18-C — UX Discoverability + Journeys

Dependencies: P18-A  
Owned paths: apps/web/app/page.tsx, tests/live-ux/journeys, docs/evidence/production-connectivity/live-ux/discoverability  
Lane C of P18 (UX discoverability + journey instrumentation); Workers deliver, Architect gates

## Goal

The root first-user surface ("What are you trying to accomplish?") with
first-class discovery of onboarding + mission entry, and the journey suites
that instrument the eight mandatory product journeys end-to-end.

## Scope

- apps/web/app/page.tsx: the rewritten root surface — server-rendered,
  progressive disclosure, links to real routes only.
- tests/live-ux/journeys: the journey + discoverability suites
  (90-route-full-path with the requires-p18b-mount capability gates,
  helpers, 16-journey spec fixtures).
- docs/evidence/production-connectivity/live-ux/discoverability: evidence.

## Delivery

Merged as 65a2562 (PR #40). State: COMPLETE.
