/**
 * @sos-2/decision — SOS 2.0 Decision Engine (Work Order W10).
 *
 * evaluate(request) -> DecisionRecord: exactly one of the frozen six
 * outcomes (ACT, EXPERIMENT, GATHER_EVIDENCE, ASK, REJECT, ROLLBACK —
 * consumed from @sos-2/authority's DECISION_ACTIONS, never redefined),
 * reproducible (exact input digest + ordered rule trace; byte-identical on
 * re-evaluation), with deterministic rule ordering (authority first, then
 * safety, then evidence, then uncertainty).
 *
 * Authority/escalation policy is delegated to @sos-2/autonomy; evidence
 * classification and freshness to @sos-2/evidence; the simulation mark to
 * @sos-2/experiments. Resolution records (an ASK resolved by an authority)
 * are minted through this package's record machinery with the provenance of
 * who resolved it.
 */

export * from './engine.js';
export * from './errors.js';
export * from './record.js';
export * from './request.js';
export * from './resolution.js';
