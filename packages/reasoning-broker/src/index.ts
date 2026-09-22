/**
 * @sos-2/reasoning-broker — the non-authoritative reasoning plane
 * (Work Order P6).
 *
 *  - ReasoningProviderPort: the INJECTABLE PORT every reasoning provider
 *    answers (managed default + optional BYO, same shape — real
 *    providers attach later without contract change).
 *  - THE MANAGED DEFAULT IS ALWAYS PRESENT with zero user configuration:
 *    a user never needs a personal LLM to start (pinned by tests).
 *  - BYO slots report honest NOT_YET_CONNECTED statuses — availability
 *    is never fabricated.
 *  - Routing is capability/cost/context driven; every selection is a
 *    typed, recorded RoutingDecision.
 *  - Model/version provenance rides every output; ALL output is typed
 *    NonAuthoritativeAnalysis with the structural non_authoritative:true
 *    marker — it can inform decomposition/planning/summaries but can
 *    NEVER enter authority, semantic-identity or verification-verdict
 *    paths.
 *  - Deterministic reference providers are SIMULATED with explicit
 *    markers; zero real network in src.
 *
 * Determinism: no Date.now / Math.random / fetch / process.env in this
 * package's src — the clock is injected; analysis and routing ids are
 * content-derived.
 */

export * from './errors.js';
export * from './port.js';
export * from './analysis.js';
export * from './routing.js';
export * from './providers/managed-reference.js';
export * from './providers/byo-slot.js';
export * from './broker.js';
