/**
 * Meta-evolution stage 1 — OBJECT/META SEPARATION (W16).
 *
 * The OBJECT loop treats a TARGET SYSTEM: this stage PROBES the object loop
 * by actually RUNNING the W15 brownfield loop over the golden fixtures
 * (buildBrownfieldLoopInput + runBrownfieldLoop — the merged object-loop
 * authority, consumed not duplicated) and anchoring its ImplementationModel
 * and CandidateState ids. The META loop is anchored at the initial
 * MetaProcess revision. The constraining Mission is minted through
 * @sos-2/mission (R3: mission evolution is explicit, versioned,
 * authority-controlled — the meta loop operates UNDER the mission, never
 * above it: mission outranks architecture, §18).
 *
 * The lane rules are machine-checked in both directions with typed
 * rejections retained in the record: the object candidate routes to the
 * OBJECT lane only, and the first meta change routes to the META lane only —
 * each is ALSO routed through the WRONG lane once, and the conflation
 * rejection is retained (the structural invariant runs on every execution,
 * not only in tests).
 *
 * The object system's health signal is ingested through @sos-2/telemetry's
 * RawObservation -> @sos-2/evidence ingestObservation (the W3 pattern) with
 * the evidence OBSERVING the ImplementationModel — the meta loop is grounded
 * in real object-system evidence.
 *
 * Links: mission --CONSTRAINS--> process; process --CONSTRAINS-->
 * ImplementationModel; object evidence --OBSERVES--> ImplementationModel.
 */

import {
  buildBrownfieldLoopInput,
  implementationModelId,
  runBrownfieldLoop,
} from '@sos-2/brownfield';
import type { BrownfieldLoopResult } from '@sos-2/brownfield';
import { createMission } from '@sos-2/mission';
import type { MissionArtifact } from '@sos-2/mission';
import { EvidenceGraph, ingestObservation } from '@sos-2/evidence';
import type { EvidenceRecordW3 } from '@sos-2/evidence';
import { MetaEvolutionError } from './errors.js';
import type { MetaEvolutionInput } from './input.js';
import type { SeparationStageRecord } from './stages.js';
import { metaTraceLink } from './trace.js';
import { routeToMetaPipeline, routeToObjectPipeline } from './routing.js';

export interface SeparationStageOutput {
  record: SeparationStageRecord;
  objectLoop: BrownfieldLoopResult;
  mission: MissionArtifact;
  objectEvidence: EvidenceRecordW3;
}

/** Run the OBJECT probe + anchor both lanes (deterministic, pure). */
export function runSeparationStage(
  input: MetaEvolutionInput,
  processId: string,
  firstMetaChangeId: string | null,
): SeparationStageOutput {
  // 1. The OBJECT loop probe: run the W15 brownfield loop over the golden
  //    fixtures (the object pipeline itself — consumed, never duplicated).
  let objectLoop: BrownfieldLoopResult;
  try {
    const built = buildBrownfieldLoopInput(input.object.fixture, input.object.variant);
    objectLoop = runBrownfieldLoop(built.input);
  } catch (cause) {
    throw new MetaEvolutionError('OBJECT_PROBE_FAILED', `the object loop probe failed: ${(cause as Error).message}`);
  }
  const objectAnchor = objectLoop.artifacts.implementation_model.id;
  const objectCandidate = objectLoop.artifacts.candidate_state.envelope.id;

  // 2. The constraining mission (R3) — the meta loop operates under it.
  const mission = createMission({
    content: input.mission.content,
    provenance: [...input.provenance, 'meta-evolution:mission'],
    created_at: input.now,
    authority_ref: input.authority_ref,
    status: 'ACTIVE',
  });

  // 3. The object-system health evidence (W3 telemetry ingestion): one
  //    runtime observation of the object system, mapped onto the
  //    ImplementationModel (the semantic subject).
  const observation = input.object.fixture.snapshot.runtime_observations[0];
  if (observation === undefined) {
    throw new MetaEvolutionError('INVALID_META_INPUT', 'the object fixture carries no runtime observations to ground the meta loop');
  }
  let objectEvidence: EvidenceRecordW3;
  try {
    objectEvidence = ingestObservation({
      observation,
      subject: objectAnchor,
      subjectRevision: null,
      sourceRevision: input.object.fixture.snapshot.revision,
      deploymentRevision: null,
    });
  } catch (cause) {
    throw new MetaEvolutionError('OBJECT_PROBE_FAILED', `object telemetry ingestion failed: ${(cause as Error).message}`);
  }
  const evidenceGraph = new EvidenceGraph();
  const observeLink = evidenceGraph.observe(objectEvidence);

  // 4. The lane rules, machine-checked in BOTH directions (retained).
  const objectLaneForObject = routeToObjectPipeline(objectCandidate);
  const metaLaneForObject = routeToMetaPipeline(objectCandidate);
  const laneProbes: SeparationStageRecord['lane_probes'] = [
    { lane: 'OBJECT', artifact_id: objectCandidate, accepted: objectLaneForObject.accepted, rejection: objectLaneForObject.rejection },
    { lane: 'META', artifact_id: objectCandidate, accepted: metaLaneForObject.accepted, rejection: metaLaneForObject.rejection },
  ];
  if (firstMetaChangeId !== null) {
    const metaLaneForMeta = routeToMetaPipeline(firstMetaChangeId);
    const objectLaneForMeta = routeToObjectPipeline(firstMetaChangeId);
    laneProbes.push(
      { lane: 'META', artifact_id: firstMetaChangeId, accepted: metaLaneForMeta.accepted, rejection: metaLaneForMeta.rejection },
      { lane: 'OBJECT', artifact_id: firstMetaChangeId, accepted: objectLaneForMeta.accepted, rejection: objectLaneForMeta.rejection },
    );
  }
  const conflationRejections = laneProbes.filter((probe) => probe.rejection !== null).length;

  // 5. The stage handoff links.
  const links = [
    // The mission CONSTRAINS the process (mission outranks architecture).
    metaTraceLink({
      source: mission.envelope.id,
      target: processId,
      type: 'CONSTRAINS',
      provenance: [...input.provenance, 'meta-evolution:stage:separation', 'meta-evolution:mission-constrains-process'],
    }),
    // The meta process CONSTRAINS the object loop (process parameters govern
    // how the object pipeline runs).
    metaTraceLink({
      source: processId,
      target: objectAnchor,
      type: 'CONSTRAINS',
      provenance: [...input.provenance, 'meta-evolution:stage:separation', 'meta-evolution:process-constrains-object-loop'],
    }),
    observeLink,
  ];

  const record: SeparationStageRecord = {
    stage: 'SEPARATION',
    input_refs: [processId],
    output_refs: [mission.envelope.id, objectEvidence.id, objectAnchor],
    links,
    object_probe: {
      variant: input.object.variant,
      system_name: objectLoop.summary.system_name,
      implementation_model_id: objectAnchor,
      candidate_state_id: objectCandidate,
      decision: objectLoop.stages.promotion.decision,
      chain_complete: objectLoop.chain.complete,
      trace_links: objectLoop.trace.length,
    },
    meta_anchor: processId,
    mission_id: mission.envelope.id,
    object_evidence_id: objectEvidence.id,
    lane_probes: laneProbes,
    conflation_rejections: conflationRejections,
  };

  return { record, objectLoop, mission, objectEvidence };
}

/** The deterministic object anchor id of a fixture (no loop execution). */
export function objectAnchorOf(input: MetaEvolutionInput): string {
  return implementationModelId(input.object.fixture.snapshot);
}
