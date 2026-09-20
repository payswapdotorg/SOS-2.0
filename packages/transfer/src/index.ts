/**
 * @sos-2/transfer — the SOS 2.0 Transfer layer (Work Order W13;
 * docs/package-ecology.md: transfer evidence class, applicability
 * discipline, specialization/generalization, failure memory).
 *
 *   - TRANSFER EVIDENCE RECORDS: applying a package/composition in a NEW
 *     context is a distinct evidence class; outcomes are context-conditioned
 *     and NEVER update the source package's applicability estimate — they
 *     feed the TARGET-context estimate (machine-checked at construction and
 *     on every restore); numeric transfer probabilities exist only as
 *     calibrated applicability estimates (calibration ref mandatory);
 *   - SPECIALIZATION/GENERALIZATION as typed lineage operations (the frozen
 *     SPECIALIZES / GENERALIZES trace types) creating new package records
 *     with copied-forward evidence, failures and learned limitations; the
 *     lineage preserves provenance (who/what/which evidence); derived
 *     packages start DISCOVERED — promotion stays governed;
 *   - NEGATIVE EVIDENCE RETAINED: failed transfers, invalidated assumptions
 *     and contexts-of-failure are first-class records; the store has no
 *     removal API.
 *
 * EXPORT DISCIPLINE (binding): spine identities, trace links and canonical
 * serialization come from @sos-2/semantic-spine; packages, contexts,
 * applicability and maturity discipline come from @sos-2/packages; evidence
 * records and the strong-causal-claim rule come from @sos-2/evidence; the
 * claim-strength vocabulary comes from @sos-2/causal. Nothing here
 * duplicates an authority.
 */

export * from './errors.js';
export * from './record.js';
export * from './lineage.js';
export * from './store.js';

// Re-export the pieces downstream transfer consumers most often need
// (still the same single semantic registry — no duplication).
export { canonicalSerialize, contentHash, fullContentHash } from '@sos-2/semantic-spine';
export type { TraceLink } from '@sos-2/semantic-spine';
export type { EvidenceRecordW3 } from '@sos-2/evidence';
export type {
  ApplicabilityEstimate,
  AssuranceObligation,
  ContextCondition,
  DiversityProfile,
  PackageArtifact,
  PackageRealization,
} from '@sos-2/packages';
