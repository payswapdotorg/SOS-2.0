/**
 * THE LIVE-MISSION DATA SEAM PRODUCER (Work Order P18-A, lane A).
 *
 * The architect-defined seam (binding for lanes A and B; neither lane
 * references the other's files): lane B owns
 * apps/web/app/live-mission/data-seam.ts exporting
 * `getLiveMissionData(): Promise<LiveObservationDto>`; THIS module owns
 * the real producer:
 *
 *   createLiveMissionDataProducer(): () => Promise<LiveObservationDto>
 *
 * The architect integration swaps the seam body to call this producer;
 * the signature MUST match exactly, and it does: each call runs ONE
 * bounded honest data-plane pass (apps/web/live-data/src/data-plane.ts
 * — real observation-plane drain, real durable-store selection behind
 * the frozen P17-A adapters, real Vercel deployment-state read, exact
 * revision/store provenance, freshness, honest provider states) and
 * returns the P17-C LiveObservationData DTO (imported from
 * apps/web/live-mission/src/view-state/live-mission-dto.ts — read-only;
 * apps may import from apps in this repo's layout).
 *
 * THE DEFAULTS ARE THE APP'S SINGLE IMPURE BOUNDARY (documented): the
 * ambient process environment as the source (P3 typed-registry names —
 * GITHUB_ACCESS_TOKEN, VERCEL_TOKEN, DATABASE_URL, NEON_API_KEY,
 * UPSTASH_REDIS_REST_URL/TOKEN, R2_*), the real system clock, the
 * global fetch and the real sleep. Every seam stays injectable: the
 * deterministic data-plane suites script all of them offline; the
 * env-gated real suite binds the same real defaults.
 *
 * Never fabricated: an incomplete observation environment returns the
 * honest empty state (emptyLiveObservation — UNKNOWN/NO_DATA, the
 * missing env NAMES carried in the result's missingEnv), never a
 * synthetic snapshot. Neon/Upstash unreachability degrades to the
 * explicit reference-store marker with the real DNS/transport fact —
 * reference state NEVER masquerades as production durable state.
 */

import type { Clock } from '@sos-2/live-store';
import type { FetchPort } from '@sos-2/real-persistence';
import { bindGlobalFetch } from '@sos-2/real-persistence';
import type { Sleep } from '@sos-2/deployment-providers';
import type { LiveDataPlaneSubjectDefaults } from '@sos-2/infra-production-connectivity';
import { runLiveDataPlane } from './data-plane';
import type { LiveObservationDto, LiveDataPlaneResult } from './data-plane';

/** The real system clock (the app's impure time boundary). */
export class SystemClock implements Clock {
  nowEpochMs(): number {
    return Date.now();
  }
}

/** The real sleep (the app's impure timer boundary). */
export const realSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** The ambient environment as the source record (the app's impure env boundary — P3 registry names). */
export function ambientSource(): Readonly<Record<string, string | undefined>> {
  return process.env;
}

/** The producer's injectable options (all optional; the defaults are the app boundary). */
export interface CreateLiveMissionDataProducerOptions {
  /** The environment source (DEFAULT: the ambient process environment). */
  readonly source?: Readonly<Record<string, string | undefined>>;
  /** The clock (DEFAULT: the real system clock). */
  readonly clock?: Clock;
  /** The inner network FetchPort (DEFAULT: the global fetch). */
  readonly fetch?: FetchPort;
  /** The sleep (DEFAULT: the real timer). */
  readonly sleep?: Sleep;
  /** The observation freshness window (milliseconds; DEFAULT: the plane's 10 minutes). */
  readonly freshAfterMs?: number;
  /** The observation subject overrides (DEFAULT: payswapdotorg/SOS-2.0@main). */
  readonly subjects?: LiveDataPlaneSubjectDefaults;
}

/** Run one full data-plane pass and return EVERYTHING (the DTO + the view + the evidence surfaces). */
export async function produceLiveMissionData(
  options: CreateLiveMissionDataProducerOptions = {},
): Promise<LiveDataPlaneResult> {
  return runLiveDataPlane({
    source: options.source ?? ambientSource(),
    clock: options.clock ?? new SystemClock(),
    fetch: options.fetch ?? bindGlobalFetch(),
    sleep: options.sleep ?? realSleep,
    ...(options.freshAfterMs !== undefined ? { freshAfterMs: options.freshAfterMs } : {}),
    ...(options.subjects !== undefined ? { subjects: options.subjects } : {}),
  });
}

/**
 * THE SEAM PRODUCER — the exact architect signature. Every call is one
 * bounded honest live data-plane pass; the returned DTO is what the
 * live-mission surface renders.
 */
export function createLiveMissionDataProducer(options: CreateLiveMissionDataProducerOptions = {}): () => Promise<LiveObservationDto> {
  return async () => {
    const result = await produceLiveMissionData(options);
    return result.data;
  };
}
