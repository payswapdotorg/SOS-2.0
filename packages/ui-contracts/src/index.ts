/**
 * @sos-2/ui-contracts — the SOS 2.0 view-model contracts (Work Order W11).
 *
 * Pure types + pure projection functions: typed projections of domain
 * records for human display, with the W11 acceptance structurally enforced
 * — every view-model for a consequential decision carries an
 * upstream/downstream rationale chain of typed spine trace links plus
 * evidence refs, projections that drop truth states, uncertainty or
 * provenance are REJECTED, and rationale chains without trace links are
 * REJECTED.
 *
 * ZERO domain logic and ZERO DOM dependencies: every vocabulary (truth
 * states, trace types, classifications, phases, verdicts, mechanisms, ...)
 * is IMPORTED from the owning @sos-2/* package — never redefined. The
 * package is deterministic and canonical: projections sort stably and the
 * canonical serialization/hashing helpers (over the spine's own canonical
 * JSON serializer) support byte-identical snapshot tests.
 */

export * from './canonical.js';
export * from './errors.js';
export * from './rationale.js';

export * from './mission-vm.js';
export * from './system-state-vm.js';
export * from './reconciliation-vm.js';
export * from './evidence-vm.js';
export * from './candidate-vm.js';
export * from './assurance-vm.js';
export * from './experiment-vm.js';
export * from './ask-vm.js';
export * from './rollback-vm.js';
export * from './package-vm.js';
export * from './history-vm.js';
export * from './meta-vm.js';
