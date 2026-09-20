/**
 * @sos-2/causal — SOS 2.0 Causal Knowledge (Work Order W5).
 *
 * CausalHypothesis artifacts (frozen core kind) with intervention
 * description, mechanism, predicted outcomes, retained ASSUMPTIONS, context,
 * ALTERNATIVE EXPLANATIONS (never collapsed) and refutation conditions; the
 * STRICT evidence-class separation (ObservationalEvidenceRef and
 * InterventionalEvidenceRef are distinct types — a strong causal claim
 * requires intervention evidence and causal upgrades backed only by
 * observational evidence are REJECTED at construction and at every
 * revision); CorrelationRecords typed distinctly from causal claims and
 * promoted only explicitly and evidence-gated (hypothesisFromCorrelation);
 * the minimal causal graph (factors + contributes-to/confounds edges — full
 * causal inference is out of scope); every hypothesis carrying exact
 * evidence provenance (which records, which revisions) and
 * calibrated-or-qualitative uncertainty.
 *
 * All identities, envelopes, truth states and canonical serialization come
 * from @sos-2/semantic-spine; the confidence/calibration discipline and the
 * §18 strong-claim rule (supportsStrongCausalClaim) come from
 * @sos-2/evidence; producers and time windows come from @sos-2/provenance.
 * Nothing here duplicates an authority; invalid causal knowledge always
 * fails loudly.
 */

export * from './errors.js';
export * from './evidence-refs.js';
export * from './graph.js';
export * from './hypothesis.js';
export * from './correlation.js';
export * from './store.js';
