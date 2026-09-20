/**
 * @sos-2/meta-evolution — the SOS 2.0 Self-Evolution + Meta-Adaptation
 * orchestrator (Work Order W16, parallel slot A).
 *
 * EXPORT DISCIPLINE (binding, mirrors W0.5-W15): core identifiers,
 * envelopes, trace links, canonical serialization and every frozen
 * vocabulary are ALWAYS obtained from @sos-2/semantic-spine and the merged
 * authorities (@sos-2/authority, @sos-2/autonomy, @sos-2/decision,
 * @sos-2/ask, @sos-2/experiments, @sos-2/promotion, @sos-2/assurance,
 * @sos-2/verification, @sos-2/evidence, @sos-2/telemetry,
 * @sos-2/provenance, @sos-2/mission, @sos-2/packages, @sos-2/registry,
 * @sos-2/retrieval, @sos-2/optimization, @sos-2/ecology, @sos-2/memory,
 * @sos-2/transfer, @sos-2/brownfield). The two W16 extension kinds
 * (MetaProcess, MetaChange) are registered through the spine's ONLY
 * sanctioned add-only extension point. Nothing is duplicated; invalid input
 * always fails loudly.
 */

export * from './errors.js';
export * from './kinds.js';
export * from './parameters.js';
export * from './process.js';
export * from './change.js';
export * from './guard.js';
export * from './routing.js';
export * from './trace.js';
export * from './stages.js';
export * from './input.js';
export * from './separation.js';
export * from './propose.js';
export * from './effectiveness.js';
export * from './decision-stage.js';
export * from './revision.js';
export * from './liability.js';
export * from './loop.js';
export * from './fixture.js';
export * from './golden-scenario.js';
