/**
 * @sos-2/assurance — SOS 2.0 Living Assurance (Work Order W8, owned path
 * packages/assurance).
 *
 * AssuranceCase artifacts (spine envelopes, frozen core kind) carrying
 * claims, arguments, assumptions, hazards, controls, evidence references,
 * validity conditions and first-class objections; deterministic validity
 * evaluation against implementation/dependency/environment revisions,
 * evidence freshness (delegated to the merged W3 authority) and assumption
 * checks, with DISTINCT tracked invalidation reasons; adoption of merged
 * conformance evidence through spine trace links.
 *
 * EXPORT DISCIPLINE (binding, mirrors W0.5/W2/W3/W4/W5): identities,
 * envelopes, canonical serialization, trace links and truth states come
 * from @sos-2/semantic-spine; evidence records and freshness evaluation
 * from @sos-2/evidence (W3); the conformance evidence kinds from
 * @sos-2/conformance (W2) and @sos-2/runtime-conformance (W4). Nothing is
 * duplicated; invalid input always fails loudly.
 */

export * from './errors.js';
export * from './case.js';
export * from './evolve.js';
export * from './evaluate.js';
export * from './conformance.js';

// Re-export the most commonly needed pieces for assurance consumers (same
// single semantic registry — no duplication).
export { canonicalSerialize, contentHash } from '@sos-2/semantic-spine';
export type { ArtifactEnvelope, TraceLink, EvidenceTruthState } from '@sos-2/semantic-spine';
export { evaluateFreshness } from '@sos-2/evidence';
export type { EvidenceRecordW3, FreshnessStatus } from '@sos-2/evidence';
