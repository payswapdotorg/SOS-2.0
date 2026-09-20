/**
 * Brownfield stage 3 — PACKAGE RETRIEVAL (W15).
 *
 * Context-conditioned retrieval over the injected registry through the
 * merged W7 facade (@sos-2/retrieval — the registry stays THE data
 * authority): the diverse candidate set with uncertainty VERBATIM (never
 * stripped), evidence context, learned limitations and failure contexts
 * surfaced per candidate. The stage record carries one surfaced entry per
 * candidate (the uncertainty column is part of the loop's typed output).
 *
 * Links: retrieval evidence --OBSERVES--> the selected recovery hypothesis
 * (the search context is conditioned on the recovered architecture).
 */

import { RetrievalFacade } from '@sos-2/retrieval';
import type { SearchContext } from '@sos-2/retrieval';
import { createEvidence } from '@sos-2/evidence';
import type { EvidenceRecordW3 } from '@sos-2/evidence';
import type { RecoveryHypothesis } from '@sos-2/recovery';
import type { SystemStateArtifact } from '@sos-2/system-state';
import { BrownfieldError } from './errors.js';
import type { BrownfieldLoopInput } from './input.js';
import type { RetrievalStageRecord } from './stages.js';
import { brownfieldTraceLink } from './trace.js';

/** Everything stage 3 produces. */
export interface RetrievalStageOutput {
  record: RetrievalStageRecord;
  searchContext: SearchContext;
  facade: RetrievalFacade;
  retrievalEvidence: EvidenceRecordW3;
}

/** Run the package retrieval stage (deterministic, pure). */
export function runRetrievalStage(input: BrownfieldLoopInput, selectedHypothesis: RecoveryHypothesis, systemState: SystemStateArtifact): RetrievalStageOutput {
  const facade = new RetrievalFacade(input.registry);
  let searchContext: SearchContext;
  try {
    searchContext = facade.query({
      capability: input.goal.capability,
      context: input.goal.query_context,
    });
  } catch (cause) {
    throw new BrownfieldError('RETRIEVAL_EMPTY', `registry retrieval failed: ${(cause as Error).message}`);
  }
  if (searchContext.candidates.length === 0) {
    throw new BrownfieldError(
      'RETRIEVAL_EMPTY',
      `no reusable candidates were retrieved for capability "${input.goal.capability}" — the package population cannot support this goal`,
    );
  }

  // Uncertainty surfacing guard: every candidate entry carries its
  // uncertainty verbatim (the record type enforces the field, the loop
  // asserts it is present and non-degenerate).
  for (const candidate of searchContext.candidates) {
    const uncertaintyClass: unknown = candidate.uncertainty?.uncertainty_class;
    if (typeof uncertaintyClass !== 'string' || uncertaintyClass.length === 0) {
      throw new BrownfieldError('RETRIEVAL_EMPTY', `retrieved candidate ${candidate.id} lost its uncertainty payload — uncertainty must be surfaced, never stripped`);
    }
  }

  const retrievalEvidence = createEvidence({
    kind: 'brownfield-retrieval',
    subject_ref: selectedHypothesis.artifact.envelope.id,
    availability: 'SUCCESS',
    evidence_class: 'OBSERVATIONAL',
    method: 'brownfield:registry-retrieval',
    provenance: [
      ...input.provenance,
      `brownfield:capability:${input.goal.capability}`,
      `brownfield:candidates:${searchContext.candidates.length}`,
      `brownfield:families:${searchContext.families.join('|')}`,
    ],
    window: { start: input.now, end: input.now },
    subject_revision: `${systemState.envelope.id}@v${systemState.envelope.version}`,
    producer: input.producer,
  });

  const links = [
    brownfieldTraceLink({
      source: retrievalEvidence.id,
      target: selectedHypothesis.artifact.envelope.id,
      type: 'OBSERVES',
      provenance: [...input.provenance, 'brownfield:stage:retrieval'],
    }),
    // Every retrieved candidate is asserted COMPATIBLE_WITH the recovered
    // hypothesis context it was retrieved for (the diverse candidate set is
    // part of the chain — not just the selected package).
    ...searchContext.candidates.map((candidate) =>
      brownfieldTraceLink({
        source: candidate.id,
        target: selectedHypothesis.artifact.envelope.id,
        type: 'COMPATIBLE_WITH',
        provenance: [...input.provenance, `brownfield:retrieved:${candidate.family}`],
      }),
    ),
  ];

  const record: RetrievalStageRecord = {
    stage: 'RETRIEVAL',
    input_refs: [selectedHypothesis.artifact.envelope.id],
    output_refs: [retrievalEvidence.id, ...searchContext.candidates.map((candidate) => candidate.id)],
    links,
    query: { capability: input.goal.capability, context: input.goal.query_context },
    candidate_count: searchContext.candidates.length,
    families: [...searchContext.families],
    altitudes_present: [...searchContext.altitudes_present],
    matched_count: searchContext.matched_count,
    retrieval_evidence_id: retrievalEvidence.id,
    candidates: searchContext.candidates.map((candidate) => ({
      id: candidate.id,
      kind: candidate.kind,
      family: candidate.family,
      altitude: candidate.altitude,
      context_match: candidate.retrieval.context_match,
      uncertainty: candidate.uncertainty,
    })),
  };

  return { record, searchContext, facade, retrievalEvidence };
}
