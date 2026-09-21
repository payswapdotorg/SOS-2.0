/**
 * @sos-2/web-contracts/ecology — the SOS 2.0 package-ecology, history and
 * self-evolution deep view models (Work Order P10).
 *
 * Pure types + pure projections for the deepened product surfaces:
 *   - the PACKAGES workspace (package discovery as a composition surface:
 *     contextual applicability, uncertainty, retained failures and
 *     assurance obligations visible — never collapsed into a single score —
 *     and compositions with their OWN independent evidence);
 *   - the HISTORY workspace (the revision timeline plus the revision diff,
 *     with the exact-restore case visible);
 *   - the EVOLUTION surface (self-evolution state: process revisions, the
 *     non-disableable governance guard, retained failure memory, learned
 *     rules and the machine state — a READ-ONLY projection reading
 *     canonical live state through @sos-2/live-store repositories).
 *
 * DISCIPLINE (mirrors the P1 core): ZERO domain logic and ZERO DOM
 * dependencies. Every vocabulary is IMPORTED from the owning @sos-2/*
 * package — never redefined. Every consequential view model carries the
 * P1 product core (what, why, evidence refs, uncertainty, authority, next
 * allowed action) plus the explicit DEMO-vs-LIVE data-source marker: demo
 * fixture state can never render as live state.
 *
 * The ONE impure module is ./live-read.ts (documented there): the
 * live-state read adapter over the @sos-2/live-store repository ports. The
 * DEMO dataset (./demo/demo-ecology-world.ts) is deterministic and
 * revision-pinned: no Date.now, no Math.random, static literal timestamps,
 * spine-minted deterministic ids — and it seeds the in-memory reference
 * live store through the repositories' own validated writes.
 */

export * from './ecology-vm.js';
export * from './history-vm.js';
export * from './evolution-vm.js';
export * from './live-read.js';
export * from './demo/demo-ecology-world.js';
