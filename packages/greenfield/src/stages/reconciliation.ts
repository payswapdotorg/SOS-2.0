/**
 * STAGE 5 — Reconciliation (Work Order W14).
 *
 * The observed implementation vs the declared architecture -> typed
 * reconciliation records through @sos-2/conformance (the W2 executable
 * conformance layer over the merged W0.5 spine classifier): every finding
 * is a typed record { classification, subject, reason } linked to the two
 * compared semantic ids by a frozen trace-link type (OBSERVES for
 * details/variations, REFINES for preserving refinements, DERIVED_FROM for
 * intentional evolution/unknown, CONTRADICTS for drift/contradiction), and
 * DRIFT/CONTRADICTION findings additionally produce Evidence-shaped drift
 * records (drift itself becomes evidence).
 *
 * THE GREENFIELD CORRESPONDENCE (established by the realization stage,
 * consumed here): the realized ImplementationModel's components declare
 * which declared ArchitectureGraph nodes they (partially) REALIZE (the W0.5
 * contract) and its dependency graph mirrors the declared wiring — so a
 * clean greenfield realization classifies the declared non-Component nodes
 * (Capability, Interface, Deployment) as PRESERVING_REFINEMENT (realized by
 * refinement components), reports undeclared implementation glue as
 * IMPLEMENTATION_DETAIL (the classifier's documented default policy), and
 * finds DRIFT/CONTRADICTION only where the implementation genuinely
 * diverges (a missing declared component, a missing dependency, a critical
 * node with no realizing component). Everything is reported honestly — the
 * stage never hides a finding.
 */

import { reconcile } from '@sos-2/conformance';
import type { ReconciliationConfig, ReconciliationRecord, DriftEvidenceRecord } from '@sos-2/conformance';
import type { ConformanceClass, TraceLink } from '@sos-2/semantic-spine';
import type { GreenfieldRunContext } from '../context.js';
import { GreenfieldError } from '../errors.js';
import type { RealizationStageRecord } from './realization.js';

/** The typed stage record of reconciliation (plain JSON, spine-traceable). */
export interface ReconciliationStageRecord {
  stage: 'RECONCILIATION';
  /** All findings as typed records (spine order). */
  records: ReconciliationRecord[];
  /** Deduplicated trace links binding the observed model to the declared graph. */
  links: TraceLink[];
  /** Evidence-shaped drift records (DRIFT and CONTRADICTION only). */
  drift: DriftEvidenceRecord[];
  /** Findings per frozen classification class (ALL seven classes, always reported). */
  classification_counts: Record<ConformanceClass, number>;
  /** True iff no DRIFT and no CONTRADICTION was found. */
  clean: boolean;
}

export interface ReconciliationStageInput {
  realization_stage: RealizationStageRecord;
  run: GreenfieldRunContext;
  /** Optional classifier configuration (kind maps, expected variations, ...). */
  config?: ReconciliationConfig;
}

const ALL_CLASSES: ConformanceClass[] = [
  'IMPLEMENTATION_DETAIL',
  'EXPECTED_VARIATION',
  'PRESERVING_REFINEMENT',
  'INTENTIONAL_EVOLUTION',
  'DRIFT',
  'UNKNOWN',
  'CONTRADICTION',
];

/** Run the reconciliation stage. Deterministic and pure. */
export function runReconciliationStage(input: ReconciliationStageInput): ReconciliationStageRecord {
  const { realization_stage, config } = input;
  const observed = realization_stage.implementation_model;
  const declared = realization_stage.architecture_graph;

  let result: ReturnType<typeof reconcile>;
  try {
    result = config === undefined ? reconcile(observed, declared) : reconcile(observed, declared, config);
  } catch (cause) {
    throw new GreenfieldError(`reconciliation failed: ${(cause as Error).message}`, { cause });
  }

  const classificationCounts = {} as Record<ConformanceClass, number>;
  for (const classification of ALL_CLASSES) {
    classificationCounts[classification] = result.records.filter(
      (record) => record.classification === classification,
    ).length;
  }
  const driftCount = classificationCounts['DRIFT']! + classificationCounts['CONTRADICTION']!;

  if (result.records.length > 0 && result.links.length === 0) {
    throw new GreenfieldError(
      'internal invariant: reconciliation produced findings but no trace links — every finding must be linked',
    );
  }

  return {
    stage: 'RECONCILIATION',
    records: result.records.map((record) => ({
      classification: record.classification,
      subject: record.subject,
      reason: record.reason,
      link: { ...record.link },
    })),
    links: result.links.map((link) => ({ ...link })),
    drift: result.drift.map((record) => structuredClone(record)),
    classification_counts: classificationCounts,
    clean: driftCount === 0,
  };
}
