# P18-B — Live Actions + Mission UX

Dependencies: P18-A  
Owned paths: apps/web/app/live-mission, apps/web/app/mission, apps/web/app/api/live-mission, tests/live-ux/actions, docs/evidence/production-connectivity/live-ux/actions-mission  
Lane B of P18 (live actions + mission UX); Workers deliver, Architect gates

## Goal

Mount the live Mission experience on the real routes and wire consequential
actions through the merged action gateway: typed envelopes, authority
re-evaluated at action time (fail-closed), ASK resolution through the real
AskQueue, typed receipts, evidence links.

## Scope

- apps/web/app/live-mission: the route mount + the data seam binding (the
  seam module itself is swapped by P18-INT).
- apps/web/app/mission: the real Mission page (the P17-C live experience
  mounted; server-rendering discipline, no client fetches).
- apps/web/app/api/live-mission: LIVE_ACTION_ENDPOINT
  (/api/live-mission/actions) — validate + execute typed envelopes, receipts.
- apps/web/live-mission integration seams (endpoint constants, receipt
  wiring, entry links; the P17-C components/view-state stay semantically
  frozen — that tree remains registered to P17-C).
- tests/live-ux/actions: the deterministic mount-seams + action suites.
- docs/evidence/production-connectivity/live-ux/actions-mission: evidence.

## Delivery

Merged as e7219da (PR #41). State: COMPLETE.
