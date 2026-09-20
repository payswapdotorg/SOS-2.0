/**
 * @sos-2/search — SOS 2.0 Candidate Search (Work Order W7; requirements
 * R11, R12, R28, R29; spec/architecture.md §9, §10; the reference stack:
 * "search/optimization engines implement candidate-search contracts").
 *
 *   - THE CONTRACT: `CandidateSearchEngine` — a stable interface with
 *     swappable implementations (`createLadderSearchEngine` — the §10
 *     ladder default; `createFixedAltitudeEngine` — a single-rung
 *     alternative). Engines are replaceable reasoning mechanisms, never
 *     authorities.
 *   - REASONING-ALTITUDE LADDER ENFORCED: candidate generation starts at
 *     VALIDATED_COMPOSITION (the highest safe validated abstraction) and
 *     descends one rung at a time only when the higher rung cannot satisfy
 *     mission + constraints; the engine records the altitude used and the
 *     descent justification of every step (unjustified descents are
 *     rejected by the trace discipline).
 *   - HARD CONSTRAINTS FILTER BEFORE EVALUATION: the typed constraint set
 *     is consumed from mission/value-shaped views (duck-typed — real
 *     @sos-2/mission MissionConstraint objects satisfy the view directly);
 *     only bounded HARD constraints are machine-checkable; UNCHECKED axes
 *     are surfaced, never conflated.
 *   - EXPLORATION/EXPLOITATION IS EXPLICIT: the typed policy knob is
 *     REQUIRED (greedy / seeded epsilon-greedy / UCB-shaped bandit using
 *     applicability-estimate uncertainty); it orders and annotates the
 *     candidate set — never drops candidates, never a single winner.
 *   - UNCERTAINTY PRESERVED END-TO-END: every candidate carries its
 *     applicability estimate's uncertainty (class, sample size, context
 *     match, calibrated probability with its §12 companions) through the
 *     result.
 *
 * EXPORT DISCIPLINE (binding): the §10 altitude ladder comes from
 * @sos-2/registry (through @sos-2/retrieval — never redefined); retrieval
 * and the registry stay the data authorities (search composes, never
 * duplicates); the uncertainty-class vocabulary comes from
 * @sos-2/evidence; applicability/context types from @sos-2/packages; spine
 * ids and canonical serialization from @sos-2/semantic-spine.
 */

export * from './errors.js';
export * from './candidate.js';
export * from './constraints.js';
export * from './policy.js';
export * from './ladder.js';
export * from './engine.js';

// Re-export the retrieval surface search consumers need (single authority
// chain: registry -> retrieval -> search; no duplication).
export { ALTITUDE_RANK, RETRIEVAL_ALTITUDES } from '@sos-2/retrieval';
export type { RetrievalAltitude } from '@sos-2/retrieval';
export type { RetrievalFacade, SearchContext, ContextCandidate, ContextQuery } from '@sos-2/retrieval';
