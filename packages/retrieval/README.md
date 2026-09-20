# @sos-2/retrieval

The SOS 2.0 retrieval facade (Work Order W7; requirements R26, R27, R29):
the search-facing composition layer over `@sos-2/registry`, plus the
Bayesian update path.

## The facade (the registry stays the data authority)

`RetrievalFacade` holds an INJECTED `PackageRegistry` — there is no second
registry here. Every query delegates to `registry.retrieve()` (W6's
altitude-ordered, diversity-preserving, honest-uncertainty retrieval) and
composes the result into **search context**:

- the **diverse candidate set** (every matching family's best candidate
  present — never a single winner), in registry rank order (§10 ladder
  first);
- per candidate, surfaced: the **uncertainty view** (verbatim — calibrated
  probability with sample size, window and calibration ref when calibrated,
  qualitative class otherwise; never stripped), the **evidence context**
  (resolved through the caller's resolver; unresolved refs are reported as
  unresolved, never as zero), **learned limitations** (verbatim) and
  **retained failure contexts** (verbatim, UNAVAILABLE gaps included);
- for compositions, the **own-evidence view**: the composition's OWN cited
  evidence refs (read verbatim from the registered entry), its members,
  and its justified independence assessments — with the locked invariant
  surfaced as data: member evidence NEVER substitutes.

## Composition outcomes are learned independently

- `evaluateCompositionOwnEvidence(candidate, resolver, chainIds?)` —
  evaluates a composition candidate's own-evidence discipline THROUGH the
  W6 authority (`@sos-2/composition`): evidence about the composition's
  chain counts; evidence about a MEMBER package is FOREIGN and makes the
  verdict invalid (negative-tested).
- `combinedCompositionProbability(members, justification?)` — delegates to
  the W6 independence discipline and REJECTS the call without an explicit
  `IndependenceJustification`: never P(A+B)=P(A)·P(B) by default
  (docs/probabilistic-learning.md; spec/architecture-lock.md).

## The Bayesian update path (docs/probabilistic-learning.md baseline)

- `betaUpdate(prior, batch, calibration?)` — the Beta-Binomial conjugate
  update; the posterior math (mean, variance, 90% credible interval)
  delegates to `@sos-2/packages`' `betaQuantile` (the W6 Beta authority);
  with the default `Beta(1,1)` prior this is EXACTLY the authority's
  `betaPosterior` (property-tested). Sample size and the observation time
  window are preserved; `mergeWindows` unions windows.
- `updateApplicabilityEstimate(estimate, batch, newCalibration?)` — the
  learning path for context-conditioned applicability: a CALIBRATED
  estimate enters as its implied-counts prior (probability·n successes
  over the Beta(1,1) baseline) and stays calibrated (sample size
  accumulates, window merges, calibration ref carries or is replaced); a
  QUALITATIVE estimate contributes NO numeric prior and — without newly
  attached calibration evidence — stays QUALITATIVE with sample size and
  window preserved.
- `dirichletUpdate(counts, prior?, calibration?)` — the Dirichlet-multinomial
  conjugate update over K ≥ 2 outcome categories (posterior alphas = prior
  + counts; means sum to 1).
- **Calibration discipline**: numeric outputs are marked `calibrated:
  false` with a null ref unless calibration evidence is attached — an
  uncalibrated numeric posterior is NEVER minted as a CALIBRATED
  applicability estimate (spec/meta-model.md: numeric confidence is valid
  only where calibration exists).

## Export discipline

Retrieval types, the §10 altitude ladder and the registry come from
`@sos-2/registry`; applicability/uncertainty vocabularies from
`@sos-2/packages` and `@sos-2/evidence`; composition disciplines from
`@sos-2/composition`; time windows from `@sos-2/provenance`; spine ids and
canonical serialization from `@sos-2/semantic-spine`. Nothing here
duplicates an authority; invalid input always fails loudly.
