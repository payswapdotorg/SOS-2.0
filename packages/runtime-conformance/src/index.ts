/**
 * @sos-2/runtime-conformance — SOS 2.0 Runtime Conformance (Work Order W4).
 *
 * The runtime conformance evidence layer: a RuntimeViewAdapter contract
 * consuming @sos-2/telemetry raw observations, evaluation of declared
 * executable invariants at an exact SystemState revision, and typed
 * conformance evidence records with truthful availability
 * (PASS/FAIL/UNKNOWN never conflated) traceable through OBSERVES/VERIFIES
 * links.
 *
 * EXPORT DISCIPLINE (binding, mirrors W0.5/W2/W3): identities, canonical
 * serialization, trace links and truth states come from
 * @sos-2/semantic-spine; the invariant DSL and checker from
 * @sos-2/conformance (W2 — built over @sos-2/architecture graph shapes);
 * evidence records from @sos-2/evidence (W3); raw observations from
 * @sos-2/telemetry (W3); producers/time windows from @sos-2/provenance
 * (W3); SystemState artifacts from @sos-2/system-state (W2). Nothing is
 * duplicated; invalid input always fails loudly.
 */

export * from './errors.js';
export * from './adapter.js';
export * from './evaluate.js';

// Re-export the most commonly needed pieces for runtime conformance
// consumers (same single semantic registry — no duplication).
export { canonicalSerialize, contentHash } from '@sos-2/semantic-spine';
export type { EvidenceTruthState, TraceLink, TraceLinkType } from '@sos-2/semantic-spine';
export { assertValidInvariant, checkInvariant } from '@sos-2/conformance';
export type { Invariant, InvariantCheckResult } from '@sos-2/conformance';
export type { GraphShape } from '@sos-2/architecture';
export { createEvidence, validateEvidenceRecord } from '@sos-2/evidence';
export type { Confidence, EvidenceRecordW3 } from '@sos-2/evidence';
export type { RawObservation } from '@sos-2/telemetry';
export type { Producer, TimeWindow } from '@sos-2/provenance';
export type { SystemStateArtifact } from '@sos-2/system-state';
export type { ArchitectureGraphArtifact } from '@sos-2/architecture';
