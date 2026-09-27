# P18-INT — The Seam Swap Diff Record

Work Order: **P18-INT** (the architect integration pass, the A→B→C seam).
Base: `c2dc1ac` (main, post lane-A/B/C merges). Swap commit: `5e103a7`
(`P18-INT: THE SEAM SWAP — data-seam body now calls the lane-A producer`).

The swapped file: `apps/web/app/live-mission/data-seam.ts` — the
architect-defined binding between lane A (the live data plane) and lane B
(the mission UX mounts). One function, one file, before AND after.

## Before (lane P18-B, `c2dc1ac`) — the honest placeholder

```ts
import { emptyLiveObservation } from '../../live-mission/src/view-state/live-mission-dto';
import type { LiveObservationData } from '../../live-mission/src/view-state/live-mission-dto';

export const LIVE_MISSION_REPOSITORY_SUBJECT = 'github:repo:payswapdotorg/SOS-2.0';

export async function getLiveMissionData(): Promise<LiveObservationData> {
  // P18-B default: the honest unwired state (storeRef 'unwired', asOf
  // 'never' — no drain has run on this wiring). The architect's A→B→C
  // integration swaps this body for the real producer; every consumer
  // stays behind this one function.
  return emptyLiveObservation('unwired', 'never', LIVE_MISSION_REPOSITORY_SUBJECT);
}
```

Provenance semantics (before): NOTHING had run — no drain, no probe, no
selection. The `'unwired'` storeRef and `'never'` asOf were the honest
truth of an un-wired seam; the surfaces rendered UNKNOWN/NO_DATA with a
statically fabricated-free empty DTO.

## After (P18-INT, `5e103a7`) — the real producer

```ts
import { createLiveMissionDataProducer } from '../../live-data/src/producer';
import type { LiveObservationData } from '../../live-mission/src/view-state/live-mission-dto';

export const LIVE_MISSION_REPOSITORY_SUBJECT = 'github:repo:payswapdotorg/SOS-2.0';

/** THE SEAM PRODUCER (lane P18-A), composed ONCE at module scope. */
const produceLiveMissionData = createLiveMissionDataProducer();

export async function getLiveMissionData(): Promise<LiveObservationData> {
  return produceLiveMissionData();
}
```

Provenance semantics (after): every call is ONE bounded honest data-plane
pass (`runLiveDataPlane`): the durable-store selection behind the frozen
P17-A adapters, the real Vercel deployment-state read, the real observation
drain, the exact provenance and the honest provider states. The DTO fields'
per-field provenance is recorded in [`provenance-matrix.json`](./provenance-matrix.json).

## The behavioral delta (both sides honest, never fabricated)

| Aspect | Before | After |
| --- | --- | --- |
| `storeRef` | `'unwired'` (nothing ran) | the REAL selection: `neon:postgres:<db>@<branch>` when the canonical store answered a probe (PRODUCTION_DURABLE); the EXPLICIT `reference:in-memory-observation-store` marker otherwise (REFERENCE_FALLBACK — never masquerading as production durable state) |
| `asOf` | `'never'` | the real pass instant (RFC3339, the injected clock — the app boundary's system clock) |
| `drainedAt` | always `null` | the drain instant when the observation environment is complete; `null` on the honest unwired path (no drain ran) |
| `sources` | `[]` | the plane's connectivity rows — each one of CONNECTED/UNKNOWN/UNAVAILABLE/DEGRADED, derived from real probes only |
| `repository` / `ci` / `deployments` / `findings` / `detections` | all empty / NO_DATA | the real observed state (GitHub events, CI runs, Vercel deployments, reconciliation findings) when the env is complete; honestly empty otherwise |
| `missingEnv` (on the data-plane result) | not applicable (no pass) | the env NAMES the pass found absent (never values) |
| route rendering | static honest empty state | server-rendered live observed state (dynamic rendering allowed; no client fetches — the P1 discipline preserved) |

## The compatibility surface (unchanged)

- The exported names (`getLiveMissionData`,
  `LIVE_MISSION_REPOSITORY_SUBJECT`) and the signature
  `(): Promise<LiveObservationData>` are byte-identical — every consumer
  (the `/mission` route body, the `/live-mission` route mount, the test
  aliases) stays behind the one function.
- `LiveObservationData` remains the P17-C DTO imported read-only — the
  module stays semantically frozen.
- The producer is composed ONCE at module scope (never a construction per
  request) — pinned by the deterministic suite
  (`seam-integration.test.tsx`: `composeCalls` stays flat while
  `produceCalls` grows).

## The one consumer-visible consequence (the flagged deviation)

Lane B's `tests/live-ux/actions/test/mount-seams.test.tsx` pinned the
pre-swap body's literal outputs (`storeRef === 'unwired'`,
`asOf === 'never'`, byte-equal repeated calls). The swap necessarily
obsoletes exactly those three pins; they were re-pinned to the post-swap
honest states with equal assertion strength (see the file header + the
README's flagged-deviation section — the architect's ruling is requested;
the revert/re-pin is a one-commit change).
