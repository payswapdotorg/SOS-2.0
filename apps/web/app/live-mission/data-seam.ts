/**
 * THE LIVE-MISSION DATA SEAM (architect-defined; binding for lanes A and B).
 *
 * This is the ONE place the mission routes read live observation data from:
 * `getLiveMissionData()` returns the serializable LiveObservationData DTO
 * (the P17-C contract, apps/web/live-mission/src/view-state/
 * live-mission-dto.ts — read-only for this lane). Lane A owns the real
 * producer (`apps/web/live-data/src/producer.ts` —
 * createLiveMissionDataProducer()); neither lane references the other's
 * files — the architect's integration pass swaps this seam's body to call
 * that producer (the signature matches exactly).
 *
 * THE HONEST DEFAULT (this branch, lane B): the seam body returns the
 * honest empty state — emptyLiveObservation('unwired', 'never', the
 * repository subject) — drainedAt null, every source list empty, every
 * freshness NO_DATA, watching without a body. NOTHING here fabricates
 * live state: 'unwired' provenance is the truthful state of this surface
 * until the data plane lands (lane A); the mission routes render exactly
 * what this function returns, never more.
 *
 * Keep it a one-function, one-file seam.
 */

import { emptyLiveObservation } from '../../live-mission/src/view-state/live-mission-dto';
import type { LiveObservationData } from '../../live-mission/src/view-state/live-mission-dto';

/** The repository subject this console observes (the P18 lanes' fixed subject). */
export const LIVE_MISSION_REPOSITORY_SUBJECT = 'github:repo:payswapdotorg/SOS-2.0';

/**
 * The live observation data for the mission surfaces.
 *
 * Until the architect wires lane A's producer, the honest answer is the
 * unwired empty state (never a fabricated snapshot).
 */
export async function getLiveMissionData(): Promise<LiveObservationData> {
  return emptyLiveObservation('unwired', 'never', LIVE_MISSION_REPOSITORY_SUBJECT);
}
