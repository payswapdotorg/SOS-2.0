/**
 * @sos-2/verification — SOS 2.0 Runtime Verification (Work Order W8, owned
 * path packages/verification).
 *
 * The pluggable runtime monitor engine CONTRACT: typed monitor definitions
 * (ALWAYS / RESPONSE / CUSTOM properties), validated monitor events,
 * evaluation results as Evidence records with truthful availability under a
 * frozen verdict-to-truth-state mapping enforced by the contract (adapters
 * are never the authority), binding every result to an exact
 * SystemState/implementation revision. One in-memory reference engine is
 * included; real engines are adapters behind the same interface
 * (spec/architecture.md sections 13 and 17, R21).
 *
 * EXPORT DISCIPLINE (binding, mirrors W0.5/W2/W3/W4/W5): identities,
 * canonical serialization, trace links and truth states come from
 * @sos-2/semantic-spine; evidence records are minted and validated by
 * @sos-2/evidence (W3); producers from @sos-2/provenance (W3). Nothing is
 * duplicated; invalid input always fails loudly.
 */

export * from './errors.js';
export * from './monitor.js';
export * from './engine.js';
export * from './reference.js';

// Re-export the most commonly needed pieces for monitor consumers (same
// single semantic registry — no duplication).
export { canonicalSerialize, contentHash } from '@sos-2/semantic-spine';
export type { EvidenceTruthState, TraceLink } from '@sos-2/semantic-spine';
export { createEvidence, validateEvidenceRecord } from '@sos-2/evidence';
export type { EvidenceRecordW3 } from '@sos-2/evidence';
export type { Producer } from '@sos-2/provenance';
