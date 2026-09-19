/**
 * @sos-2/architecture — the SOS 2.0 Architecture Graph model (Work Order W2).
 *
 * Typed nodes and edges over the ten spec/architecture.md §5 categories,
 * architecture as a VERSIONED HYPOTHESIS over an exact SystemState revision,
 * deterministic graph diffs with strict application, and bounded
 * LocalCandidate subgraph replacement (§8 evolution operators).
 *
 * EXPORT DISCIPLINE (binding, mirrors W0.5): core identifiers and envelope
 * logic are ALWAYS obtained from @sos-2/semantic-spine.
 */

export * from './errors.js';
export * from './kinds.js';
export * from './graph.js';
export * from './artifact.js';
export * from './diff.js';
export * from './candidates.js';

// Re-export the spine pieces downstream architecture consumers most often
// need (still the same single semantic registry — no duplication).
export { canonicalSerialize, contentHash } from '@sos-2/semantic-spine';
export type { ArtifactEnvelope, ArtifactStatus, JsonValue } from '@sos-2/semantic-spine';
export { isSystemStateRevisionRef } from '@sos-2/system-state';
export type { SystemStateRevisionRef } from '@sos-2/system-state';
