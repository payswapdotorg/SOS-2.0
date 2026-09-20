/**
 * @sos-2/packages — the SOS 2.0 Package model (Work Order W6; requirements
 * R24, R26, R28, R29 partially — the registry layer completes them).
 *
 * The evidence-backed reusable package:
 *   - PackageArtifact: a Semantic Spine envelope (kind "Package", frozen
 *     core kind) + the exact §5 content field set — contracts,
 *     preconditions/postconditions, realizations, context-conditioned
 *     applicability, evidence refs, failure refs, compatibility refs,
 *     composition refs, assurance obligations, declaring context, learned
 *     limitations, diversity profile, maturity, version note, superseded_by;
 *   - the NORMATIVE projection toPackageRecord: the closed 8-key record of
 *     spec/contracts/package.schema.json (additionalProperties: false),
 *     ajv-validated in tests and reproducing the W0.5 golden fixture
 *     bit-exactly;
 *   - the strict maturity lifecycle (DISCOVERED -> FORMING -> VALIDATED ->
 *     MATURE -> CONTEXTUALIZED -> SUPERSEDED/RETIRED) with frozen
 *     evidence-gated promotion requirements — promotion after ONE LUCKY
 *     SUCCESS (a single SUCCESS evidence with no comparative/intervention
 *     evidence) is REJECTED;
 *   - context-conditioned applicability estimates: qualitative uncertainty
 *     class by default; numeric probability ONLY with calibration ref +
 *     sample size + time window + context (never a universal score — an
 *     empty context condition is rejected); Beta-posterior baseline for
 *     binary package outcomes (deterministic, zero dependencies);
 *   - package evidence classification over the merged @sos-2/evidence
 *     records (observational success / comparative / interventional /
 *     failure / transfer / composition / longevity / unclassified).
 *
 * EXPORT DISCIPLINE (binding, mirrors W0.5/W2/W3): core identifiers,
 * envelope logic, maturity vocabulary and truth states are ALWAYS obtained
 * from @sos-2/semantic-spine; evidence records and the uncertainty-class
 * vocabulary come from @sos-2/evidence; time windows from
 * @sos-2/provenance. Nothing here duplicates an authority.
 */

export * from './errors.js';
export * from './context.js';
export * from './beta.js';
export * from './applicability.js';
export * from './evidence-classes.js';
export * from './maturity.js';
export * from './assurance.js';
export * from './diversity.js';
export * from './content.js';
export * from './artifact.js';

// Re-export the spine pieces downstream package consumers most often need
// (still the same single semantic registry — no duplication).
export { canonicalSerialize, contentHash } from '@sos-2/semantic-spine';
export type { ArtifactEnvelope, ArtifactStatus, PackageMaturity, PackageRecord } from '@sos-2/semantic-spine';
export type { EvidenceRecordW3, UncertaintyClass } from '@sos-2/evidence';
export type { TimeWindow } from '@sos-2/provenance';
