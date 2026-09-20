/**
 * @sos-2/composition — the SOS 2.0 Package Composition model (Work Order W6;
 * requirements R25, R27).
 *
 * First-class reusable compositions:
 *   - PackageCompositionArtifact: a Semantic Spine envelope (frozen core kind
 *     "PackageComposition") + the composition content — members (>= 2
 *     packages bound into roles), typed bindings (the frozen wiring
 *     vocabulary), contracts, applicability, OWN evidence refs, failure
 *     refs, assurance obligations, learned limitations, diversity profile,
 *     maturity, justified independence assessments;
 *   - OWN-EVIDENCE discipline (machine-checked): composition evidence is
 *     evidence about the composition's own chain of spine ids — member
 *     evidence NEVER substitutes (composition validity does not derive from
 *     member validity; independence cuts both ways);
 *   - INDEPENDENCE discipline (machine-checked): there is no code path that
 *     multiplies member probabilities without an explicit
 *     IndependenceJustification — never P(A+B)=P(A)P(B) by default. Justified
 *     combinations carry the justification and the method mark
 *     'INDEPENDENCE_JUSTIFIED_PRODUCT';
 *   - composition failures are retained like package failures (monotonic
 *     failure refs across revisions, enforced by the registry layer).
 *
 * EXPORT DISCIPLINE (binding): envelope logic and identifiers from
 * @sos-2/semantic-spine; applicability/assurance/diversity/maturity
 * machinery from @sos-2/packages (the same W6 realization — no duplication);
 * evidence records from @sos-2/evidence.
 */

export * from './errors.js';
export * from './binding.js';
export * from './independence.js';
export * from './own-evidence.js';
export * from './content.js';
export * from './artifact.js';

// Re-export the pieces downstream composition consumers most often need
// (still the same single semantic registry — no duplication).
export { canonicalSerialize, contentHash, mintRandomArtifactId } from '@sos-2/semantic-spine';
export type { ArtifactEnvelope, ArtifactStatus, JsonValue, PackageMaturity } from '@sos-2/semantic-spine';
export type { EvidenceRecordW3 } from '@sos-2/evidence';
