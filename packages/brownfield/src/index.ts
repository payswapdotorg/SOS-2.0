/**
 * @sos-2/brownfield — the SOS 2.0 Brownfield Optimization Loop (Work Order
 * W15, parallel slot C).
 *
 * A pure, deterministic, typed orchestration of the merged SOS planes over
 * an existing-system snapshot: repository/runtime ingestion, COMPETING
 * architecture recovery, context-conditioned package retrieval, bounded
 * candidate evolution, assurance, fixed-seed SIMULATED experiment,
 * evidence-gated promotion/rollback with bounded recovery, drift
 * reconciliation and package learning — one connected trace-linked semantic
 * subgraph from the ImplementationModel to the learned ecology updates.
 *
 * EXPORT DISCIPLINE (binding, mirrors W0.5-W13): core identifiers,
 * envelopes, trace links, canonical serialization and the ImplementationModel
 * contract are ALWAYS obtained from @sos-2/semantic-spine; graphs from
 * @sos-2/architecture; reconciliation from @sos-2/conformance; recovery from
 * @sos-2/recovery; runtime ingestion from @sos-2/telemetry/@sos-2/adapters;
 * runtime conformance from @sos-2/runtime-conformance; the registry and
 * retrieval from @sos-2/registry/@sos-2/retrieval; candidate search from
 * @sos-2/search; multi-objective evaluation from @sos-2/optimization;
 * assurance from @sos-2/assurance; runtime verification from
 * @sos-2/verification; experiments from @sos-2/experiments; promotion and
 * the bounded recovery declaration from @sos-2/promotion; authority grants
 * from @sos-2/authority; evidence from @sos-2/evidence; producers from
 * @sos-2/provenance; the ecology from @sos-2/ecology; transfer evidence from
 * @sos-2/transfer; architecture memory from @sos-2/memory. Nothing is
 * duplicated; invalid input always fails loudly.
 */

export * from './errors.js';
export * from './snapshot.js';
export * from './input.js';
export * from './stages.js';
export * from './trace.js';
export * from './ingestion.js';
export * from './competing.js';
export * from './retrieval-stage.js';
export * from './evolution.js';
export * from './assurance-stage.js';
export * from './experiment-stage.js';
export * from './promotion-stage.js';
export * from './reconciliation-stage.js';
export * from './learning.js';
export * from './loop.js';
export * from './fixture.js';
export * from './golden-scenario.js';
