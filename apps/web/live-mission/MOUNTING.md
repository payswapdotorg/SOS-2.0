# apps/web/live-mission — Mounting (Work Order P17-C)

This directory is the **live mission UX surface** delivered by P17-C as a
self-contained module (the P4 `apps/web/onboarding` precedent): components +
view-state + action envelopes + render tests, all under
`apps/web/live-mission/**` (a P17-C owned path). The existing shell files,
routes and navigation are **read-only** for the P17-C lane, so the actual
mount is the architect's **P18 integration pass**. Nothing outside this
directory needs to change EXCEPT the one thin route file below.

## What this surface is

- `src/components/live-mission-page.tsx` — the actionable mission page:
  `Start mission` / `Import system` / `Resume existing mission` entry
  points, the live observation view (honest source states, branch heads,
  CI runs, deployments, reconciliation findings, detections, provider
  health) and the consequential action panel (authority-gated through the
  merged action gateway).
- `src/view-state/live-mission-dto.ts` — the serializable data contract +
  the producer `liveObservationFromDrain()` (structural input: the merged
  observation plane's drain report + the P17-C connectivity snapshot).
- `src/view-state/live-mission-view.ts` — pure view-model projections
  (LIVE provenance, six-question review core, sorting/labels).
- `src/actions/envelopes.ts` — the pure action-envelope builders
  (body-lifecycle / promotion / rollback in the merged
  `@sos-2/action-gateway` raw input shape; ASK resolution in the merged
  `@sos-2/ask` AskQueue `resolve()` shape).

## Exact integration steps (P18)

1. **Mount the route** — create `apps/web/app/live-mission/page.tsx`
   (NOT owned by P17-C; the one file the architect adds):

   ```tsx
   import { LiveMissionPage } from '../../live-mission/src/components/live-mission-page';
   import { emptyLiveObservation } from '../../live-mission/src/view-state/live-mission-dto';

   export const metadata = { title: 'Mission — live' };
   export const dynamic = 'force-dynamic'; // live data — no static caching of live state

   export default async function Page() {
     // Data plane (P18): drain the real observation plane and map:
     //   const report = await plane.drain();
     //   const data = liveObservationFromDrain({ report, connectivity: { sources: plane.connectivity() }, ... });
     // Until the data plane is mounted server-side, render the honest empty state:
     const data = emptyLiveObservation('unwired', 'never', 'github:repo:payswapdotorg/SOS-2.0');
     return <LiveMissionPage data={data} />;
   }
   ```

   Optionally point the existing `apps/web/app/mission/page.tsx` at
   `LiveMissionPage` to complete the "replacing the read-only mission
   view" structural fix (P18 owns that call).

2. **Mount the action endpoint** — create the route handler the action
   forms POST to (`LIVE_ACTION_ENDPOINT` = `/api/live-mission/actions`,
   see `src/actions/envelopes.ts`): validate + execute each envelope
   through the merged `ActionGateway` (authority re-evaluated at action
   time, fail-closed), resolve ASK envelopes through the merged
   `AskQueue.resolve()`, and return the typed receipts. The gateway
   wiring precedent is `apps/actions/src/composition.ts` (`buildHost`).

3. **Data plane** — the server component drains the real observation
   plane composed by `@sos-2/real-observation`
   (`createRealObservationPlane`) on the host's tick, reading events from
   the same durable store P17-A deploys (the in-memory P2 store is the
   reference; the Neon-backed adapter is the P17-A/P18 upgrade).

4. **Navigation (optional, P18)** — `desktopRailItems()` /
   `mobileBottomNavItems()` in `@sos-2/web-contracts` are frozen for this
   lane; the surface is reachable via `/live-mission` and its in-page
   onboarding entry. Adding a dedicated nav entry is a P18 decision.

## What is deliberately NOT done here

- No modification of `apps/web/shell/**`, `apps/web/onboarding/**`,
  `apps/web/ecology/**`, `apps/web/app/**` or `apps/web/package.json`
  (P1/P4/P10-owned paths — read-only for P17-C).
- No client components, no client fetches: the page is fully
  server-rendered (the P1 discipline); live data enters through props
  produced server-side.
- No fabricated live state: without data the page renders the honest
  UNKNOWN / NO_DATA states (`emptyLiveObservation`).
