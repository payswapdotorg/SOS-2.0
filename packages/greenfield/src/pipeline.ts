/**
 * The greenfield pipeline orchestrator (Work Order W14).
 *
 *   mission formalization
 *     -> capability derivation + candidate composition (highest validated
 *        altitude, package reuse, own evidence obligations)
 *     -> human decision flow (ACT / ASK per authority + risk)
 *     -> realization (approved candidate -> System State revision +
 *        declared ArchitectureGraph hypothesis + ImplementationModel)
 *     -> reconciliation (implementation vs declared architecture)
 *     -> evidence ingestion (truthful realization evidence, OBSERVES-linked)
 *
 * "Greenfield starts from mission... Both converge on System State"
 * (spec/architecture.md section 15). The TRACEABILITY INVARIANT is
 * machine-checked at every stage boundary AND over the final result:
 * every stage-to-stage handoff is a typed trace link, and the full result
 * is ONE connected semantic subgraph from Mission to SystemState — a
 * missing link fails the pipeline (assertTraceChainComplete).
 *
 * The orchestrator is PURE and DETERMINISTIC: no I/O, no network, no
 * clocks, no randomness — identical input produces a byte-identical
 * result (pinned by the harness's golden snapshot and the property tests).
 */

import type { ExplorationPolicy } from '@sos-2/search';
import type { ReconciliationConfig } from '@sos-2/conformance';
import { TraceLinkStore } from '@sos-2/semantic-spine';
import type { TraceLink } from '@sos-2/semantic-spine';
import type { AvailabilitySummary } from '@sos-2/evidence';
import type { RawObservation } from '@sos-2/telemetry';
import {
  assertValidGreenfieldAskDecider,
  assertValidGreenfieldMissionInput,
  assertValidGreenfieldRealizationPlan,
  assertValidGreenfieldRiskProfile,
  assertValidGreenfieldRunContext,
  assertValidGreenfieldWorld,
} from './context.js';
import type {
  GreenfieldAskDecider,
  GreenfieldMissionInput,
  GreenfieldRealizationPlan,
  GreenfieldRiskProfile,
  GreenfieldRunContext,
  GreenfieldWorld,
} from './context.js';
import { GreenfieldError } from './errors.js';
import { runCandidateStage } from './stages/candidate.js';
import type { CandidateStageRecord } from './stages/candidate.js';
import { runDecisionStage } from './stages/decision.js';
import type { DecisionStageRecord } from './stages/decision.js';
import { runEvidenceStage } from './stages/evidence.js';
import type { EvidenceStageRecord } from './stages/evidence.js';
import { runMissionStage } from './stages/mission.js';
import type { MissionStageRecord } from './stages/mission.js';
import { runRealizationStage } from './stages/realization.js';
import type { RealizationStageRecord } from './stages/realization.js';
import { runReconciliationStage } from './stages/reconciliation.js';
import type { ReconciliationStageRecord } from './stages/reconciliation.js';
import { assertTraceChainComplete, canonicalLinkOrder } from './trace.js';
import type { TraceChainCheck } from './trace.js';

/** The full pipeline input (every part explicit — no implicit defaults). */
export interface GreenfieldPipelineInput {
  mission_input: GreenfieldMissionInput;
  world: GreenfieldWorld;
  risk: GreenfieldRiskProfile;
  realization: GreenfieldRealizationPlan;
  observations: readonly RawObservation[];
  decider?: GreenfieldAskDecider | null;
  search_policy: ExplorationPolicy;
  /** Predicted measures per candidate id (axis -> estimate) fed to the search. */
  estimates_by_id?: Record<string, Record<string, number>>;
  reconciliation_config?: ReconciliationConfig;
  run: GreenfieldRunContext;
}

/** The six stage records, in pipeline order. */
export interface GreenfieldStageRecords {
  mission: MissionStageRecord;
  candidate: CandidateStageRecord;
  decision: DecisionStageRecord;
  realization: RealizationStageRecord;
  reconciliation: ReconciliationStageRecord;
  evidence: EvidenceStageRecord;
}

/** The summary the harness report renders (plain JSON). */
export interface GreenfieldPipelineSummary {
  mission_id: string;
  capability: string;
  goals: { total: number; measurable: number; proposed: number };
  candidate_id: string;
  candidate_altitude: string;
  candidate_family: string;
  members: number;
  own_evidence_obligations: number;
  decision: {
    action: string;
    approved: boolean;
    input_digest: string;
    ask_id: string | null;
    resolution_id: string | null;
  };
  realization: {
    system_state_id: string;
    architecture_graph_id: string;
    implementation_model_id: string;
    revision: string;
    revision_chain_length: number;
  };
  reconciliation: { records: number; drift: number; clean: boolean };
  evidence: { records: number; observes: number; availability: AvailabilitySummary };
  trace: { links: number; artifacts: number; path_state_to_mission: string[] };
}

/** The full pipeline result (plain JSON; byte-identical across runs). */
export interface GreenfieldPipelineResult {
  run: GreenfieldRunContext;
  stages: GreenfieldStageRecords;
  /** The complete trace chain: all links in canonical order + the artifact set. */
  trace: {
    links: TraceLink[];
    artifacts: string[];
    path_state_to_mission: string[];
  };
  /** The machine-checked completeness of the Mission->SystemState chain. */
  trace_chain: TraceChainCheck;
  summary: GreenfieldPipelineSummary;
  ok: true;
}

/**
 * Run the greenfield pipeline end to end. Throws GreenfieldError on ANY
 * stage failure, ANY broken stage handoff, or an incomplete trace chain —
 * a result is returned ONLY when every stage succeeded and the chain is
 * complete.
 */
export function runGreenfieldPipeline(input: GreenfieldPipelineInput): GreenfieldPipelineResult {
  assertValidGreenfieldRunContext(input.run);
  assertValidGreenfieldMissionInput(input.mission_input);
  assertValidGreenfieldWorld(input.world);
  assertValidGreenfieldRiskProfile(input.risk);
  assertValidGreenfieldRealizationPlan(input.realization);
  if (input.decider !== undefined && input.decider !== null) {
    assertValidGreenfieldAskDecider(input.decider);
  }
  if (!Array.isArray(input.observations)) {
    throw new GreenfieldError('pipeline input observations must be an array of RawObservation objects');
  }

  // The accumulating spine trace store (duplicate (source, target, type)
  // triples throw — a bug guard, since distinct stages mint distinct types).
  const store = new TraceLinkStore();
  const addLinks = (links: readonly TraceLink[]): void => {
    for (const link of links) {
      if (!store.has(link.source, link.target, link.type)) {
        store.add({ ...link });
      }
    }
  };
  const requireLink = (source: string, target: string, type: TraceLink['type'], handoff: string): void => {
    if (!store.has(source, target, type)) {
      throw new GreenfieldError(
        `broken stage handoff at ${handoff}: the trace link ${source} -${type}-> ${target} is missing — ` +
          'every stage-to-stage handoff is a typed trace link (the traceability invariant)',
      );
    }
  };

  // --- Stage 1: mission formalization ------------------------------------
  const mission = runMissionStage({ mission_input: input.mission_input, run: input.run });
  addLinks(mission.links);

  // --- Stage 2: capability derivation + candidate composition ------------
  const candidate = runCandidateStage({
    mission_stage: mission,
    world: input.world,
    run: input.run,
    policy: input.search_policy,
    estimates_by_id: input.estimates_by_id,
  });
  addLinks(candidate.links);
  requireLink(
    candidate.candidate.envelope.id,
    mission.mission.envelope.id,
    'SATISFIES',
    'mission -> candidate',
  );
  for (const member of candidate.members) {
    requireLink(
      candidate.candidate.envelope.id,
      member.package_id,
      'COMPOSES',
      'candidate -> member',
    );
  }

  // --- Stage 3: human decision flow ---------------------------------------
  const decision = runDecisionStage({
    mission_stage: mission,
    candidate_stage: candidate,
    world: input.world,
    run: input.run,
    risk: input.risk,
    decider: input.decider ?? null,
  });
  addLinks(decision.links);
  requireLink(
    decision.record.envelope.id,
    candidate.candidate.envelope.id,
    'SUPPORTS',
    'candidate -> decision',
  );

  // --- Stage 4: realization (requires the approved candidate) -------------
  const realization = runRealizationStage({
    mission_stage: mission,
    candidate_stage: candidate,
    decision_stage: decision,
    plan: input.realization,
    run: input.run,
  });
  addLinks(realization.links);
  requireLink(
    realization.system_state.envelope.id,
    candidate.candidate.envelope.id,
    'REALIZES',
    'decision -> realization',
  );
  requireLink(
    realization.system_state.envelope.id,
    realization.architecture_graph.envelope.id,
    'REALIZES',
    'realization state -> declared architecture',
  );
  requireLink(
    realization.implementation_model.id,
    realization.architecture_graph.envelope.id,
    'IMPLEMENTS',
    'realization implementation -> declared architecture',
  );

  // --- Stage 5: reconciliation --------------------------------------------
  const reconciliation = runReconciliationStage({
    realization_stage: realization,
    run: input.run,
    config: input.reconciliation_config,
  });
  addLinks(reconciliation.links);
  for (const record of reconciliation.records) {
    requireLink(
      record.link.source,
      record.link.target,
      record.link.type,
      'realization -> reconciliation',
    );
  }

  // --- Stage 6: evidence ingestion ----------------------------------------
  const evidence = runEvidenceStage({
    realization_stage: realization,
    run: input.run,
    observations: input.observations,
  });
  addLinks(evidence.links);
  for (const record of evidence.records) {
    requireLink(
      record.id,
      realization.system_state.envelope.id,
      'OBSERVES',
      'realization -> evidence',
    );
  }

  // --- The traceability invariant over the FULL result --------------------
  const missionId = mission.mission.envelope.id;
  const stateId = realization.system_state.envelope.id;
  const artifacts = [
    missionId,
    ...candidate.members.map((member) => member.package_id),
    candidate.candidate.envelope.id,
    decision.record.envelope.id,
    ...(decision.ask !== null ? [decision.ask.envelope.id] : []),
    ...(decision.resolution !== null ? [decision.resolution.envelope.id] : []),
    stateId,
    realization.architecture_graph.envelope.id,
    realization.implementation_model.id,
    ...evidence.records.map((record) => record.id),
  ];
  const links = canonicalLinkOrder(store.all());
  const chain = assertTraceChainComplete({
    artifacts,
    links,
    mission_id: missionId,
    system_state_id: stateId,
  });

  const summary: GreenfieldPipelineSummary = {
    mission_id: missionId,
    capability: mission.capability,
    goals: {
      total: mission.mission.content.goals.length,
      measurable: mission.formalization.filter((entry) => entry.status === 'MEASURABLE').length,
      proposed: mission.formalization.filter((entry) => entry.status === 'PROPOSED').length,
    },
    candidate_id: candidate.candidate.envelope.id,
    candidate_altitude: candidate.search.final_altitude ?? '',
    candidate_family: candidate.candidate.content.diversity_profile.family,
    members: candidate.members.length,
    own_evidence_obligations: candidate.own_evidence_obligations.length,
    decision: {
      action: decision.action,
      approved: decision.approved,
      input_digest: decision.input_digest,
      ask_id: decision.ask?.envelope.id ?? null,
      resolution_id: decision.resolution?.envelope.id ?? null,
    },
    realization: {
      system_state_id: stateId,
      architecture_graph_id: realization.architecture_graph.envelope.id,
      implementation_model_id: realization.implementation_model.id,
      revision: realization.revision,
      revision_chain_length: realization.revision_chain.length,
    },
    reconciliation: {
      records: reconciliation.records.length,
      drift: reconciliation.drift.length,
      clean: reconciliation.clean,
    },
    evidence: {
      records: evidence.records.length,
      observes: evidence.observes.length,
      availability: evidence.availability,
    },
    trace: {
      links: links.length,
      artifacts: artifacts.length,
      path_state_to_mission: chain.path_state_to_mission ?? [],
    },
  };

  return {
    run: input.run,
    stages: {
      mission,
      candidate,
      decision,
      realization,
      reconciliation,
      evidence,
    },
    trace: {
      links,
      artifacts: [...new Set(artifacts)].sort(),
      path_state_to_mission: chain.path_state_to_mission ?? [],
    },
    trace_chain: chain,
    summary,
    ok: true,
  };
}
