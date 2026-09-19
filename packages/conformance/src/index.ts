/**
 * @sos-2/conformance — the SOS 2.0 executable conformance layer (Work Order
 * W2, owned path 3 of 3): the typed architecture invariant DSL
 * (REQUIRED_INTERFACE, FORBIDDEN_DEPENDENCY, LAYERING, DATA_OWNERSHIP) with
 * machine-checkable results, code-to-architecture reconciliation over the
 * merged W0.5 spine classifier, and minimal Evidence-shaped drift records.
 *
 * EXPORT DISCIPLINE (binding, mirrors W0.5): core identifiers, envelope
 * logic, the conformance classifier and the ImplementationModel contract
 * are ALWAYS obtained from @sos-2/semantic-spine; graph types from
 * @sos-2/architecture. Nothing is duplicated.
 */

export * from './errors.js';
export * from './invariants.js';
export * from './drift.js';
export * from './reconcile.js';

// Re-export the most commonly needed spine/architecture pieces for
// conformance consumers (same single semantic registry — no duplication).
export { classifyDifferences } from '@sos-2/semantic-spine';
export type {
  ClassificationConfig,
  ConformanceClass,
  ConformanceFinding,
  ImplementationModel,
  TraceLink,
  TraceLinkType,
} from '@sos-2/semantic-spine';
export { assertValidGraphShape } from '@sos-2/architecture';
export type { GraphShape } from '@sos-2/architecture';
