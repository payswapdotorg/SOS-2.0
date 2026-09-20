/**
 * Brownfield stage 8 — RECONCILIATION (W15).
 *
 * Implementation vs declared architecture drift classification through the
 * merged W2 authority (@sos-2/conformance reconcile over the spine
 * classifier): the observed ImplementationModel is compared with the
 * DECLARED ArchitectureGraph; every difference is classified into one of
 * the 7 frozen conformance classes; DRIFT/CONTRADICTION findings become
 * Evidence-shaped drift records (drift is classified and retained, never
 * silently resolved — it may trigger remediation, evidence gathering, ASK
 * or incident handling downstream).
 *
 * Links: the reconciliation's own typed links (model -> declared graph per
 * classification, CONFORMANCE_LINK_TYPES).
 */

import { reconcile } from '@sos-2/conformance';
import type { ReconciliationResult } from '@sos-2/conformance';
import type { ArchitectureGraphArtifact } from '@sos-2/architecture';
import type { ImplementationModel } from '@sos-2/semantic-spine';
import type { ConformanceClass, TraceLink } from '@sos-2/semantic-spine';
import { CONFORMANCE_CLASSES } from '@sos-2/semantic-spine';
import { BrownfieldError } from './errors.js';
import type { ReconciliationStageRecord } from './stages.js';
import { brownfieldTraceLink } from './trace.js';

/** Everything stage 8 produces. */
export interface ReconciliationStageOutput {
  record: ReconciliationStageRecord;
  reconciliation: ReconciliationResult;
  links: TraceLink[];
}

/** Zero-filled counts over ALL 7 frozen conformance classes. */
export function zeroClassifications(): Record<ConformanceClass, number> {
  const counts = {} as Record<ConformanceClass, number>;
  for (const classification of CONFORMANCE_CLASSES) {
    counts[classification] = 0;
  }
  return counts;
}

/** Run the reconciliation stage (deterministic, pure). */
export function runReconciliationStage(implementationModel: ImplementationModel, declared: ArchitectureGraphArtifact, driftProvenance: string[]): ReconciliationStageOutput {
  let reconciliation: ReconciliationResult;
  try {
    reconciliation = reconcile(implementationModel, declared, {
      dependencyKindMap: { uses: 'Dependency', owns: 'Owns', Provides: 'Provides', Consumes: 'Consumes' },
    });
  } catch (cause) {
    throw new BrownfieldError('RECONCILIATION_FAILED', `implementation-vs-declared reconciliation failed: ${(cause as Error).message}`);
  }

  const classifications = zeroClassifications();
  for (const record of reconciliation.records) {
    classifications[record.classification] += 1;
  }

  // Drift/contradiction evidence CONTRADICTS the declared architecture's
  // claim of conformance (drift is classified, retained and traceable —
  // never silently resolved).
  const links = [
    ...reconciliation.links,
    ...reconciliation.drift.map((drift) =>
      brownfieldTraceLink({
        source: drift.id,
        target: declared.envelope.id,
        type: 'CONTRADICTS',
        provenance: [...driftProvenance, `brownfield:drift:${drift.classification}`],
      }),
    ),
  ];
  const record: ReconciliationStageRecord = {
    stage: 'RECONCILIATION',
    input_refs: [implementationModel.id, declared.envelope.id],
    output_refs: reconciliation.drift.map((drift) => drift.id),
    links,
    declared_architecture_id: declared.envelope.id,
    implementation_model_id: implementationModel.id,
    classifications,
    findings: reconciliation.records.map((record) => ({
      classification: record.classification,
      subject: record.subject,
      reason: record.reason,
    })),
    drift_evidence_ids: reconciliation.drift.map((drift) => drift.id),
  };

  return { record, reconciliation, links };
}
