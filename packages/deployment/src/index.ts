/**
 * @sos-2/deployment — SOS 2.0 Deployment (Work Order W12, parallel slot C).
 *
 * The deployment contract: typed deployment records (exact artifact
 * revision, target runtime ref, configuration, declared rollback
 * mechanism + trigger + authority MIRRORING the merged
 * @sos-2/recovery-control declarations — consumed, not duplicated), the
 * validated lifecycle PLANNED -> DEPLOYED -> ROLLED_BACK, truthful
 * outcome records (the frozen 6 truth states, never conflated), and the
 * deterministic deployment simulator (fixed seed, marked simulated, never
 * intervention evidence — the W9 discipline).
 */

export * from './errors.js';
export * from './record.js';
export * from './outcome.js';
export * from './store.js';
export * from './simulator.js';
