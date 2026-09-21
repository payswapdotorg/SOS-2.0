/**
 * @sos-2/web-contracts — the SOS 2.0 product web console view-model
 * contracts (Work Order P1).
 *
 * Pure types + pure projection functions for the production shell: the
 * mission hero, system condition, shortfall/opportunity and next allowed
 * action; the active autonomous work surface (tasks, body leases,
 * observation status); the overview cards; the first-class state-block
 * model; navigation and authority-mode view states; and the six product
 * review questions every consequential surface answers.
 *
 * DISCIPLINE (mirrors @sos-2/ui-contracts): ZERO domain logic and ZERO DOM
 * dependencies. Every vocabulary (truth states, trace types, phases,
 * classifications, permissions, uncertainty classes) is IMPORTED from the
 * owning @sos-2/* package — never redefined. Every consequential view model
 * carries what, why (a rationale chain of typed spine trace links), evidence
 * refs, uncertainty, authority and next allowed action, plus an explicit
 * DEMO-vs-LIVE data-source marker: demo fixture state can never render as
 * live state (a projection that drops the demo marker fails its test).
 *
 * The DEMO dataset (./demo/demo-world.ts) is deterministic and
 * revision-pinned: no Date.now, no Math.random, static literal timestamps,
 * fixed-seed simulation, spine-minted deterministic ids.
 */

export * from './errors.js';
export * from './data-source.js';
export * from './state-block.js';
export * from './authority-view.js';
export * from './next-action.js';
export * from './vm-core.js';
export * from './navigation.js';
export * from './hero.js';
export * from './autonomous-work.js';
export * from './overview-cards.js';
export * from './review-questions.js';
export * from './demo/demo-world.js';
