/**
 * Comparison of recovered hypotheses against the DECLARED ArchitectureGraph
 * (Work Order W4; spec/architecture.md §6, R23, docs/code-to-architecture.md).
 *
 * Classification is NEVER reimplemented here: every hypothesis comparison
 * delegates to the merged W2 `reconcile` (@sos-2/conformance), which runs
 * the spine classifier `classifyDifferences` over the hypothesis' model_view
 * and the declared graph, producing typed reconciliation records
 * `{ classification, subject, reason, link }`. Drift is classified, never
 * silently resolved — the W2 CONFORMANCE_LINK_TYPES mapping binds each
 * record to the two compared semantic ids.
 *
 * On top of the per-record classification, each comparison carries a derived
 * VERDICT (a summary, explicitly NOT a re-classification) and a single
 * hypothesis→declared trace link whose type is derived from the verdict
 * through the frozen mapping below:
 *
 *   CONFORMANT       no finding contradicts the declared architecture
 *                    (matches produce no findings; details, expected
 *                    variations, preserving refinements and pre-authorized
 *                    evolutions remain)             → COMPATIBLE_WITH
 *   DRIFT_DETECTED   at least one DRIFT or CONTRADICTION finding
 *                                                    → CONFLICTS_WITH
 *   AMBIGUOUS        no drift, but at least one UNKNOWN finding
 *                    (correspondence ambiguous)     → DERIVED_FROM
 *
 * Verdict precedence (deterministic): DRIFT_DETECTED > AMBIGUOUS >
 * CONFORMANT.
 */

import {
  createTraceLink,
  isArtifactId,
  isImplementationModel,
} from '@sos-2/semantic-spine';
import { assertValidArchitectureGraphArtifact } from '@sos-2/architecture';
import type { ArchitectureGraphArtifact } from '@sos-2/architecture';
import { reconcile } from '@sos-2/conformance';
import type {
  ReconciliationConfig,
  ReconciliationRecord,
  ReconciliationResult,
} from '@sos-2/conformance';
import type { ConformanceClass, TraceLink, TraceLinkType } from '@sos-2/semantic-spine';
import { RecoveryError } from './errors.js';
import type { RecoveryHypothesis, RecoveryResult, RecoveryStrategy } from './hypothesis.js';

export const COMPARISON_VERDICTS = ['CONFORMANT', 'DRIFT_DETECTED', 'AMBIGUOUS'] as const;
export type ComparisonVerdict = (typeof COMPARISON_VERDICTS)[number];

/** The frozen verdict → trace-link-type mapping (documented above). */
export const VERDICT_LINK_TYPES: Readonly<Record<ComparisonVerdict, TraceLinkType>> = {
  CONFORMANT: 'COMPATIBLE_WITH',
  DRIFT_DETECTED: 'CONFLICTS_WITH',
  AMBIGUOUS: 'DERIVED_FROM',
};

/** Classes that contradict the declared architecture (produce drift evidence). */
export const DRIFTING_CLASSES = ['DRIFT', 'CONTRADICTION'] as const;

/**
 * A hypothesis comparison: the full W2 ReconciliationResult for the
 * hypothesis' model_view against the declared graph, plus the hypothesis
 * binding and the derived verdict.
 */
export interface HypothesisComparison extends ReconciliationResult {
  /** The recovered hypothesis artifact id this comparison is about. */
  hypothesis_id: string;
  /** The strategy that produced the hypothesis. */
  hypothesis_strategy: RecoveryStrategy;
  /** The declared ArchitectureGraph artifact id compared against. */
  declared_id: string;
  /** The derived verdict (summary — classification stays in `records`). */
  verdict: ComparisonVerdict;
  /** The hypothesis→declared trace link derived from the verdict. */
  verdictLink: TraceLink;
}

/**
 * Derive the deterministic verdict for a set of reconciliation records.
 * Exported for tests and downstream consumers.
 */
export function verdictFor(records: readonly ReconciliationRecord[]): ComparisonVerdict {
  const classes = new Set<ConformanceClass>(records.map((record) => record.classification));
  const drifting = (DRIFTING_CLASSES as readonly ConformanceClass[]).some((classification) => classes.has(classification));
  if (drifting) return 'DRIFT_DETECTED';
  if (classes.has('UNKNOWN')) return 'AMBIGUOUS';
  return 'CONFORMANT';
}

/**
 * Compare one recovered hypothesis against the declared architecture.
 * Deterministic and total on valid inputs.
 */
export function compareHypothesisWithDeclared(
  hypothesis: RecoveryHypothesis,
  declared: ArchitectureGraphArtifact,
  config: ReconciliationConfig = {},
): HypothesisComparison {
  if (typeof hypothesis !== 'object' || hypothesis === null || !('model_view' in hypothesis)) {
    throw new RecoveryError('hypothesis must be a RecoveryHypothesis record');
  }
  if (!isImplementationModel(hypothesis.model_view)) {
    throw new RecoveryError('hypothesis.model_view does not match the ImplementationModel contract');
  }
  if (!isArtifactId(hypothesis.artifact.envelope.id)) {
    throw new RecoveryError(
      `hypothesis artifact id is not well formed, received: ${JSON.stringify(hypothesis.artifact.envelope.id)}`,
    );
  }
  try {
    assertValidArchitectureGraphArtifact(declared);
  } catch (cause) {
    throw new RecoveryError(`declared architecture graph is invalid: ${(cause as Error).message}`);
  }

  const result = reconcile(hypothesis.model_view, declared, config);
  const verdict = verdictFor(result.records);
  const declaredId = declared.envelope.id;
  const verdictLink = createTraceLink({
    source: hypothesis.artifact.envelope.id,
    target: declaredId,
    type: VERDICT_LINK_TYPES[verdict],
    provenance: [
      `W4:compare:${hypothesis.artifact.envelope.id}->${declaredId}`,
      `recovery:strategy:${hypothesis.strategy}`,
      `verdict:${verdict}`,
    ],
  });

  return {
    ...result,
    hypothesis_id: hypothesis.artifact.envelope.id,
    hypothesis_strategy: hypothesis.strategy,
    declared_id: declaredId,
    verdict,
    verdictLink,
  };
}

/**
 * Compare every retained hypothesis of a recovery result against the
 * declared architecture (recovery-order preserved). Deterministic.
 */
export function compareWithDeclared(
  recovery: RecoveryResult,
  declared: ArchitectureGraphArtifact,
  config: ReconciliationConfig = {},
): HypothesisComparison[] {
  if (typeof recovery !== 'object' || recovery === null || !Array.isArray(recovery.hypotheses)) {
    throw new RecoveryError('recovery must be a RecoveryResult record');
  }
  return recovery.hypotheses.map((hypothesis) => compareHypothesisWithDeclared(hypothesis, declared, config));
}

/** Structural guard for consumers that want to check comparison records. */
export function isHypothesisComparison(value: unknown): value is HypothesisComparison {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (!isArtifactId(record['hypothesis_id'])) return false;
  if (!isArtifactId(record['declared_id'])) return false;
  if (!COMPARISON_VERDICTS.includes(record['verdict'] as ComparisonVerdict)) return false;
  if (!Array.isArray(record['records'])) return false;
  for (const entry of record['records'] as unknown[]) {
    if (typeof entry !== 'object' || entry === null) return false;
    const finding = entry as Record<string, unknown>;
    if (typeof finding['classification'] !== 'string' || finding['classification'].length === 0) return false;
    if (typeof finding['subject'] !== 'string' || (finding['subject'] as string).length === 0) return false;
    if (typeof finding['reason'] !== 'string' || (finding['reason'] as string).length === 0) return false;
  }
  if (!Array.isArray(record['drift'])) return false;
  if (!isImplementationModel(record['normalizedModel'])) return false;
  const verdictLink = record['verdictLink'];
  if (typeof verdictLink !== 'object' || verdictLink === null) return false;
  const link = verdictLink as Record<string, unknown>;
  if (link['source'] !== record['hypothesis_id'] || link['target'] !== record['declared_id']) return false;
  return VERDICT_LINK_TYPES[record['verdict'] as ComparisonVerdict] === link['type'];
}
