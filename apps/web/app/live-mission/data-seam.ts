/**
 * THE LIVE-MISSION DATA SEAM (Work Order P18-INT — the architect
 * integration pass, the A→B→C seam).
 *
 * Lane B defined this seam (Work Order P18-B: the architect-defined binding
 * for lanes A and B — neither lane references the other's files); the
 * mission routes consume ONLY this function. The P18-INT swap (this file)
 * replaces the honest 'unwired' empty-state body with lane P18-A's real
 * producer (apps/web/live-data/src/producer.ts,
 * createLiveMissionDataProducer) — one function, one file, composed ONCE at
 * module scope:
 *
 *   getLiveMissionData(): Promise<LiveObservationData>
 *     -> createLiveMissionDataProducer()  (module scope, ONE composition)
 *       -> runLiveDataPlane()             (ONE bounded honest pass per call:
 *                                          real observation drain, real
 *                                          durable-store selection behind the
 *                                          frozen P17-A adapters, real
 *                                          Vercel deployment-state read,
 *                                          exact provenance, honest provider
 *                                          states)
 *
 * Honesty after the swap (binding, the program-defining rule):
 *   - with a COMPLETE environment the mission routes render the REAL
 *     observed state (LIVE provenance, honest source states, real receipts);
 *   - with an INCOMPLETE environment the producer returns the honest empty
 *     state (UNKNOWN/NO_DATA + missingEnv on the data-plane result — never a
 *     fabricated snapshot): storeRef degrades to the EXPLICIT
 *     'reference:in-memory-observation-store' marker (reference state never
 *     masquerading as production durable state), asOf is the real probe
 *     instant, drainedAt is null (no drain ran);
 *   - Neon/Upstash unreachability degrades to that same explicit
 *     reference-store marker with the real transport fact carried verbatim.
 *
 * Server-rendering discipline is preserved: the routes call this seam on the
 * server (dynamic rendering allowed for live state — no static caching of
 * live state, no client fetches; live data enters through server-produced
 * props only).
 */

import { createLiveMissionDataProducer } from '../../live-data/src/producer';
import type { LiveObservationData } from '../../live-mission/src/view-state/live-mission-dto';

/** The repository subject this deployment observes. */
export const LIVE_MISSION_REPOSITORY_SUBJECT = 'github:repo:payswapdotorg/SOS-2.0';

/**
 * THE SEAM PRODUCER (lane P18-A), composed ONCE at module scope. Every
 * `getLiveMissionData()` call is one bounded honest data-plane pass through
 * this composition (the producer's injectable options stay untouched here —
 * the app's impure boundaries are the documented producer defaults: the
 * ambient process environment as the source, the real system clock, the
 * global fetch, the real sleep).
 */
const produceLiveMissionData = createLiveMissionDataProducer();

/**
 * The live mission observation for the mission surfaces.
 * `LiveObservationData` is the P17-C serializable DTO (read-only import —
 * the module stays semantically frozen).
 */
export async function getLiveMissionData(): Promise<LiveObservationData> {
  return produceLiveMissionData();
}
