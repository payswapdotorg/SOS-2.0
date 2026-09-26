/**
 * @sos-2/web-live-data — the live data plane (Work Order P18-A, lane A).
 *
 *   - data-plane.ts  the bounded honest pass: durable-store selection
 *                    (Neon canonical / Upstash never-canonical — real
 *                    probes), the real Vercel deployment-state read
 *                    (source_revision_sha), the real observation-plane
 *                    drain (no body, §5), the snapshot durability
 *                    binding (canonical store only) and the data-plane
 *                    view projections (per-field provenance)
 *   - producer.ts    THE LIVE-MISSION DATA SEAM PRODUCER —
 *                    createLiveMissionDataProducer() with the exact
 *                    architect seam signature; the defaults (ambient
 *                    env, system clock, global fetch, real sleep) are
 *                    the app's single impure boundary
 *
 * Server-only: no client components, no client fetches (the P1
 * discipline). Source-only module (the live-mission precedent):
 * consumed as TypeScript source by the app route (through the seam) and
 * by the data-plane suites; typecheck-only (no build/dist).
 */

export * from './data-plane';
export * from './producer';
