/**
 * @sos-2/registry — the SOS 2.0 Package/Composition registry (Work Order W6;
 * requirements R24, R26, R28, R29).
 *
 * THE registry (no second package authority):
 *   - versioned entries keyed by SPINE identities (content-addressed
 *     sos://Package/... and sos://PackageComposition/... ids);
 *   - supersession chains: linear, contiguous, no branching; SUPERSEDED
 *     entries are NEVER returned as current (retrieval only sees chain
 *     heads with non-terminal maturity and ACTIVE envelopes); failure
 *     memory is monotonic across revisions (negative evidence is retained);
 *   - maturity changes happen ONLY through the evidence-gated promote()
 *     (the frozen gates; one-lucky-success promotion rejected; no silent
 *     autonomy) — validated-or-beyond roots must pass the entering gates;
 *   - composition registration checks member registration and contract
 *     compatibility (reuse never bypasses compatibility) and mints the
 *     spine COMPOSES trace links; validated compositions enforce the
 *     OWN-EVIDENCE discipline (member evidence never substitutes);
 *   - retrieval by capability + context: results carry the typed §10
 *     altitude (validated composition -> validated package -> adaptation),
 *     uncertainty (calibrated only with calibration + sample size + window;
 *     qualitative classes otherwise), evidence context (resolved classes,
 *     unresolved counts — never zero), learned limitations and failure
 *     contexts; the candidate set is DIVERSE by declared family — every
 *     matching family's best candidate is always present, never collapsed
 *     to one winner.
 *
 * EXPORT DISCIPLINE (binding): identities and envelope logic from
 * @sos-2/semantic-spine; package/composition models from the W6
 * @sos-2/packages and @sos-2/composition realizations; evidence records
 * from @sos-2/evidence (resolved through caller-supplied resolvers — this
 * registry never stores evidence, so it never duplicates the Evidence
 * Graph authority).
 */

export * from './errors.js';
export * from './altitude.js';
export * from './retrieval.js';
export * from './registry.js';

// Re-export the pieces downstream registry consumers most often need
// (still the same single semantic registry — no duplication).
export { canonicalSerialize, contentHash } from '@sos-2/semantic-spine';
export type { ArtifactEnvelope, ArtifactStatus, PackageMaturity, TraceLink, TraceLinkType } from '@sos-2/semantic-spine';
export type { EvidenceRecordW3 } from '@sos-2/evidence';
