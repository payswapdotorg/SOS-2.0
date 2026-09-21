/**
 * @sos-2/web-contracts/onboarding — the onboarding view-model contracts
 * (Work Order P4): pure types + pure projections for the greenfield
 * mission journey (purpose → outcomes → stakeholders → measures →
 * constraints → review → authority confirmation → GitHub connection),
 * the brownfield import journey (repository/runtime import → evidence
 * scan → competing architecture hypotheses → confirmation), and the
 * advanced raw-JSON import mode (typed, clearly secondary).
 *
 * DISCIPLINE (mirrors the P1 core/ contract exactly): zero domain
 * logic, zero DOM; every vocabulary (uncertainty classes, grant
 * permissions, truth states, mission content) is imported from the
 * owning @sos-2/* packages — never redefined. Every view model carries
 * the six product review questions (what, why, evidence refs,
 * uncertainty, authority, next allowed action) plus the structural
 * DEMO-vs-LIVE data-source marker; the spine-bound result view models
 * carry the full P1 ProductVmCore with a typed rationale chain.
 *
 * The persistence engine (./persistence.ts) formalizes a completed
 * greenfield journey into the frozen domain artifacts (Mission,
 * ImplementationModel, SystemState with the exact repository revision
 * linked as { kind: 'git-sha', value }, Evidence, trace links) through
 * the owning packages' own builders — the durable write itself is
 * Work Order P2's live-store business (exercised end-to-end by the
 * journey integration test in packages/github).
 */

export * from './review-core';
export * from './connection-view';
export * from './greenfield';
export * from './greenfield-projections';
export * from './brownfield';
export * from './advanced-import';
export * from './persistence';
export * from './demo/onboarding-world';
