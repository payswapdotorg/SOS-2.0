/**
 * STAGE 6 — Evidence ingestion (Work Order W14).
 *
 * Realization evidence records through @sos-2/evidence: the raw telemetry
 * observations of the realized system are ingested with TRUTHFUL states
 * (the capture-level availability passes through VERBATIM under the
 * explicit method provenance 'telemetry:capture-availability' — a gap
 * observation becomes UNAVAILABLE evidence and is counted as UNAVAILABLE,
 * never folded into success or zero), linked to the realization through
 * the EvidenceGraph's OBSERVES convention (the W3 traceability query:
 * evidenceObserving(systemStateId)), with freshness evaluated at the run's
 * fixed evidence instant (no hidden clocks) and the honest per-state
 * availability summary (ALL six truth states always reported).
 */

import {
  EvidenceGraph,
  evaluateFreshness,
  ingestObservation,
  summarizeAvailability,
} from '@sos-2/evidence';
import type { AvailabilitySummary, EvidenceRecordW3, FreshnessStatus } from '@sos-2/evidence';
import type { TraceLink } from '@sos-2/semantic-spine';
import type { RawObservation } from '@sos-2/telemetry';
import type { GreenfieldRunContext } from '../context.js';
import { GreenfieldError } from '../errors.js';
import type { RealizationStageRecord } from './realization.js';

/** The typed stage record of evidence ingestion (plain JSON, spine-traceable). */
export interface EvidenceStageRecord {
  stage: 'EVIDENCE_INGESTION';
  /** The ingested realization evidence records (truthful states, verbatim). */
  records: EvidenceRecordW3[];
  /** The OBSERVES links binding every record to the realized SystemState. */
  observes: TraceLink[];
  /** Freshness of every record at the run's evidence instant. */
  freshness: { evidence_id: string; status: FreshnessStatus; reason: string }[];
  /** The honest availability summary (all six truth states, always). */
  availability: AvailabilitySummary;
  /** The stage's trace links (the OBSERVES links). */
  links: TraceLink[];
}

export interface EvidenceStageInput {
  realization_stage: RealizationStageRecord;
  run: GreenfieldRunContext;
  /** The raw telemetry observations of the realized system (>= 1 required). */
  observations: readonly RawObservation[];
}

/** Run the evidence ingestion stage. Deterministic and pure. */
export function runEvidenceStage(input: EvidenceStageInput): EvidenceStageRecord {
  const { realization_stage, run, observations } = input;
  const systemState = realization_stage.system_state;

  if (!Array.isArray(observations) || observations.length === 0) {
    throw new GreenfieldError(
      'evidence ingestion requires at least one raw observation — a realization without evidence is not SOS ' +
        'discipline (spec/architecture.md section 18: evidence outranks assertion)',
    );
  }

  const graph = new EvidenceGraph();
  const records: EvidenceRecordW3[] = [];
  const observes: TraceLink[] = [];
  for (const observation of observations) {
    let record: EvidenceRecordW3;
    try {
      record = ingestObservation({
        observation,
        subject: systemState.envelope.id,
        subjectRevision: String(systemState.envelope.version),
        sourceRevision: realization_stage.revision,
      });
    } catch (cause) {
      throw new GreenfieldError(`evidence ingestion failed: ${(cause as Error).message}`, { cause });
    }
    const link = graph.observe(record);
    records.push(record);
    observes.push({ ...link });
  }

  const freshness = records.map((record) => {
    const evaluation = evaluateFreshness(record, {
      now: run.t_evidence,
      systemStateRevision: String(systemState.envelope.version),
    });
    return { evidence_id: record.id, status: evaluation.status, reason: evaluation.reason };
  });

  return {
    stage: 'EVIDENCE_INGESTION',
    records,
    observes,
    freshness,
    availability: summarizeAvailability(records),
    links: observes.map((link) => ({ ...link })),
  };
}
