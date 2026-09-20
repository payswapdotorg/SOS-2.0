/**
 * @sos-2/recovery-control — SOS 2.0 Recovery Control (Work Order W8, owned
 * path packages/recovery-control).
 *
 * The rollback contract: RecoveryDeclaration artifacts (extension kind
 * registered through the spine) declaring a bounded recovery mechanism,
 * trigger, authority and evidence for every live change; validation that
 * rejects unbounded/unspecified recovery unless an explicit governed
 * exception record exists; the trusted recovery policy whose ONLY mutation
 * path is authority-gated (origin TRUSTED_OPERATORS + a valid
 * @sos-2/authority grant carrying REVISE over this policy, plus a governed
 * exception to weaken), with candidate-originated attempts ALWAYS rejected
 * (spec/architecture-lock.md); and the RecoveryGate performing full
 * declaration + policy + authority + evidence verification for live change
 * registration.
 *
 * EXPORT DISCIPLINE (binding, mirrors W0.5/W2/W3/W4/W5): identities,
 * envelopes and canonical serialization come from @sos-2/semantic-spine;
 * authorization from @sos-2/authority (W1 — authorize/grants are never
 * re-implemented); evidence records validated by @sos-2/evidence (W3).
 * Nothing is duplicated; invalid input always fails loudly.
 */

export * from './errors.js';
export * from './declaration.js';
export * from './policy.js';
export * from './gate.js';

// Re-export the most commonly needed pieces for recovery-control consumers
// (same single semantic registry — no duplication).
export { canonicalSerialize, contentHash } from '@sos-2/semantic-spine';
export type { ArtifactEnvelope } from '@sos-2/semantic-spine';
export { authorize } from '@sos-2/authority';
export type { AuthorityGrantArtifact, GrantEvaluationInput } from '@sos-2/authority';
export type { EvidenceRecordW3 } from '@sos-2/evidence';
