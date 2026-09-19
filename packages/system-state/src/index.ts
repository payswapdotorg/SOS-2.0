/**
 * @sos-2/system-state — the SOS 2.0 System State model (Work Order W2).
 *
 * Typed, versioned System State binding architecture, implementation,
 * configuration, deployment, policy, environment relationships, active
 * experiments and package realizations (spec/architecture.md §5), with the
 * W2 exact-revision discipline: every referenced implementation/deployment/
 * configuration carries an exact revision, and a SystemState without exact
 * revisions is invalid.
 *
 * EXPORT DISCIPLINE (binding, mirrors W0.5): core identifiers and envelope
 * logic are ALWAYS obtained from @sos-2/semantic-spine. This package never
 * mints ids itself and never duplicates envelope logic.
 */

export * from './errors.js';
export * from './revision.js';
export * from './model.js';
export * from './artifact.js';
export * from './store.js';

// Re-export the spine pieces downstream SystemState consumers most often
// need (still the same single semantic registry — no duplication).
export { canonicalSerialize, contentHash } from '@sos-2/semantic-spine';
export type { ArtifactEnvelope, ArtifactStatus } from '@sos-2/semantic-spine';
