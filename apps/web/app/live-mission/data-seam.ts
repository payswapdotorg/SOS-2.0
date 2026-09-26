/**
 * THE LIVE-MISSION DATA SEAM (Work Order P18-B; the architect-defined
 * binding for lanes A and B — neither lane references the other's files).
 *
 * The mission routes consume ONLY this function. The default body returns
 * the HONEST empty state: the live data producer lands via lane P18-A
 * (apps/web/live-data/src/producer.ts, createLiveMissionDataProducer) and
 * the architect's integration pass swaps this seam's body to call it —
 * keep it a one-function, one-file seam.
 *
 * Until then 'unwired' provenance is the honest truth on this branch: no
 * drain has run, no source has been probed, and the surface renders the
 * UNKNOWN / NO_DATA states (never fabricated live state).
 */

import { emptyLiveObservation } from '../../live-mission/src/view-state/live-mission-dto';
import type { LiveObservationData } from '../../live-mission/src/view-state/live-mission-dto';

/** The repository subject this deployment observes. */
export const LIVE_MISSION_REPOSITORY_SUBJECT = 'github:repo:payswapdotorg/SOS-2.0';

/**
 * The live mission observation for the mission surfaces.
 * `LiveObservationData` is the P17-C serializable DTO (read-only import —
 * the module stays semantically frozen).
 */
export async function getLiveMissionData(): Promise<LiveObservationData> {
  // P18-B default: the honest unwired state (storeRef 'unwired', asOf
  // 'never' — no drain has run on this wiring). The architect's A→B→C
  // integration swaps this body for the real producer; every consumer
  // stays behind this one function.
  return emptyLiveObservation('unwired', 'never', LIVE_MISSION_REPOSITORY_SUBJECT);
}
