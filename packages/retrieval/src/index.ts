/**
 * @sos-2/retrieval — the SOS 2.0 retrieval facade (Work Order W7;
 * requirements R26, R27, R29; spec/architecture.md §10, §12, §18;
 * docs/package-ecology.md, docs/probabilistic-learning.md).
 *
 *   - RETRIEVAL FACADE over @sos-2/registry: the registry stays THE data
 *     authority (injected, never duplicated); the facade composes registry
 *     results into SEARCH CONTEXT — the diverse candidate set with
 *     uncertainty (verbatim, never stripped), evidence context (resolved
 *     where possible; unresolved never reported as zero), learned
 *     limitations and failure contexts (verbatim, UNAVAILABLE gaps
 *     included) surfaced per candidate;
 *   - COMPOSITION OUTCOMES LEARNED INDEPENDENTLY: composition candidates
 *     carry their OWN-evidence view (own refs, members, justified
 *     independence assessments; member evidence never substitutes — locked
 *     invariant, surfaced as data and machine-checkable through
 *     evaluateCompositionOwnEvidence, which delegates to the W6 authority);
 *     member probabilities are never multiplied without an explicit
 *     IndependenceJustification (combinedCompositionProbability rejects
 *     the unjustified path);
 *   - BAYESIAN UPDATE PATH: Beta/Dirichlet-style posterior updates for
 *     binary/counts outcomes with sample size and time window preserved
 *     (the Beta math delegates to @sos-2/packages' betaQuantile — the W6
 *     authority); numeric outputs are marked UNCALIBRATED unless
 *     calibration evidence is attached, and an uncalibrated numeric
 *     posterior is never minted as a CALIBRATED applicability estimate.
 *
 * EXPORT DISCIPLINE (binding): retrieval types, the altitude ladder and
 * the registry itself come from @sos-2/registry; applicability/uncertainty
 * vocabularies from @sos-2/packages and @sos-2/evidence; composition
 * disciplines from @sos-2/composition; time windows from
 * @sos-2/provenance; spine ids and canonical serialization from
 * @sos-2/semantic-spine. Nothing here duplicates an authority.
 */

export * from './errors.js';
export * from './facade.js';
export * from './composition-evidence.js';
export * from './bayes.js';

// Re-export the registry retrieval surface downstream search consumers
// need (still the same single registry authority — no duplication).
export {
  ALTITUDE_RANK,
  RETRIEVAL_ALTITUDES,
} from '@sos-2/registry';
export type {
  CandidateUncertainty,
  EvidenceContext,
  EvidenceResolver,
  FailureContext,
  RegistryEntryKind,
  RetrievalAltitude,
  RetrievalCandidate,
  RetrievalQuery,
  RetrievalResult,
} from '@sos-2/registry';
export type { EvidenceRecordW3 } from '@sos-2/evidence';
