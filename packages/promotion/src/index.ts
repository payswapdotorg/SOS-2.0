/**
 * @sos-2/promotion — SOS 2.0 Promotion (Work Order W9, parallel slot C).
 *
 * The evidence-gated promotion/rollback gate:
 *   - `evaluatePromotion(candidate, { authority, assurance, evidence })` —
 *     CURRENT authority (valid, unexpired, unrevoked AuthorityGrant
 *     consumed from the merged @sos-2/authority; confidence is NOT
 *     authorization), CURRENT assurance (an AssuranceCase-shaped fixture
 *     with claims + verdict + validity — validated and truthfully
 *     evaluated, NEVER assumed valid) and CURRENT evidence
 *     (intervention-grade for causal claims, fresh through
 *     @sos-2/evidence's evaluateFreshness, subject-bound, never simulated,
 *     never LLM-produced);
 *   - decision outcomes are EXACTLY the frozen six (ACT, EXPERIMENT,
 *     GATHER_EVIDENCE, ASK, REJECT, ROLLBACK), consumed from
 *     @sos-2/authority's DECISION_ACTIONS — never invented;
 *   - promotion records are Decision-kind spine artifacts carrying the
 *     bounded recovery declaration: rollback mechanism + bounded time (or
 *     a governed containment exception) + rollback triggers WIRED to
 *     @sos-2/experiments guardrail trigger records (a structural mirror of
 *     the unmerged W8 @sos-2/recovery-control contract — no W8 source is
 *     imported);
 *   - live changes without bounded recovery are rejected
 *     (spec/architecture.md §13).
 *
 * PARALLELIZATION: this package consumes the MERGED W0.5/W1/W3 authorities
 * (@sos-2/semantic-spine, @sos-2/authority, @sos-2/evidence,
 * @sos-2/provenance) and W9's own @sos-2/experiments. It has NO dependency
 * on W7 (search — unmerged) or W8 (assurance — unmerged): candidates and
 * assurance cases are consumed through their frozen contract shapes.
 */

export * from './errors.js';
export * from './assurance-fixture.js';
export * from './recovery.js';
export * from './evidence-gate.js';
export * from './record.js';
export * from './gate.js';
