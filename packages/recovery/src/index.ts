/**
 * @sos-2/recovery — SOS 2.0 Brownfield Architecture Recovery (Work Order W4).
 *
 * Competing ArchitectureGraph hypotheses recovered from an observed
 * ImplementationModel with retained provenance, uncertainty and ambiguity
 * markers; declared-graph comparison reusing the merged W2 reconciliation
 * (@sos-2/conformance — classification itself is never reimplemented); and
 * a deterministic human-readable reconciliation report.
 *
 * EXPORT DISCIPLINE (binding, mirrors W0.5/W2/W3): core identifiers,
 * envelopes, trace links, canonical serialization, the conformance
 * classifier and the ImplementationModel contract are ALWAYS obtained from
 * @sos-2/semantic-spine; graph construction from @sos-2/architecture;
 * reconciliation from @sos-2/conformance. Nothing is duplicated.
 */

export * from './errors.js';
export * from './markers.js';
export * from './hypothesis.js';
export * from './compare.js';
export * from './report.js';

// Re-export the most commonly needed pieces for recovery consumers (same
// single semantic registry — no duplication).
export { classifyDifferences } from '@sos-2/semantic-spine';
export type {
  ClassificationConfig,
  ConformanceClass,
  ConformanceFinding,
  ImplementationModel,
  TraceLink,
  TraceLinkType,
} from '@sos-2/semantic-spine';
export { createArchitectureGraph } from '@sos-2/architecture';
export type { ArchitectureGraphArtifact } from '@sos-2/architecture';
export { reconcile } from '@sos-2/conformance';
export type {
  DriftEvidenceRecord,
  ReconciliationConfig,
  ReconciliationRecord,
  ReconciliationResult,
} from '@sos-2/conformance';
export type { SystemStateRevisionRef } from '@sos-2/system-state';
