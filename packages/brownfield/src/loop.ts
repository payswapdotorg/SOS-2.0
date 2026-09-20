/**
 * The brownfield optimization loop orchestrator (W15).
 *
 * runBrownfieldLoop executes the nine merged stages IN ORDER over one
 * existing-system snapshot and returns ONE typed, pure-JSON loop result:
 *   INGESTION -> COMPETING RECOVERY -> RETRIEVAL -> EVOLUTION -> ASSURANCE
 *   -> SIMULATED EXPERIMENT -> PROMOTION/ROLLBACK -> RECONCILIATION
 *   -> PACKAGE LEARNING
 * followed by the TRACEABILITY INVARIANT self-check: the collected typed
 * trace links must form ONE connected semantic subgraph rooted at the
 * ImplementationModel reaching every learned ecology update — a missing
 * link FAILS the pipeline (assertBrownfieldTraceChain throws before the
 * result is returned).
 *
 * Determinism: single caller-supplied `now`, fixed seed, deterministic
 * ids everywhere — identical input (fresh stores) produces a
 * byte-identical canonical serialization (pinned by property tests).
 */

import { contentHash, canonicalSerialize, TraceLinkStore } from '@sos-2/semantic-spine';
import type { TraceLink } from '@sos-2/semantic-spine';
import { BrownfieldError } from './errors.js';
import { assertValidBrownfieldLoopInput } from './input.js';
import type { BrownfieldLoopInput } from './input.js';
import type { BrownfieldStageRecords } from './stages.js';
import { runIngestionStage } from './ingestion.js';
import type { IngestionStageOutput } from './ingestion.js';
import { runRecoveryStage } from './competing.js';
import { runRetrievalStage } from './retrieval-stage.js';
import { runEvolutionStage } from './evolution.js';
import { runAssuranceStage } from './assurance-stage.js';
import { runExperimentStage } from './experiment-stage.js';
import { runPromotionStage } from './promotion-stage.js';
import { runReconciliationStage } from './reconciliation-stage.js';
import { runLearningStage } from './learning.js';
import { normalizeSnapshot, sortObservations } from './snapshot.js';
import { assertBrownfieldTraceChain } from './trace.js';
import type { TraceChainVerification } from './trace.js';

class BrownfieldChainError extends BrownfieldError {
  constructor(message: string) {
    super('BROKEN_TRACE_CHAIN', message);
  }
}

/** The canonical, deterministic loop summary (pure data). */
export interface BrownfieldLoopSummary {
  system_name: string;
  source_revision: string;
  ingested: { modules: number; dependencies: number; interfaces: number; runtime_observations: number; telemetry_ingested: number; telemetry_gaps: number };
  hypotheses: { count: number; ambiguity_detected: boolean; strategies: string[] };
  retrieved: { candidates: number; families: string[]; altitudes: string[] };
  candidate: { target_component: string; replacement_component: string; package_id: string; family: string; bounded_nodes: number; bounded_edges: number; invariants_preserved: number };
  assurance: { verdict: 'VALID' | 'OBJECTIONED' | 'INVALID'; objections_retained: number; blocks: boolean };
  experiment: { overall_availability: string; simulated: true; seed: number; guardrails_breached: number; rollback_triggers_fired: number };
  decision: { action: string; guardrails_tripped: boolean; recovery_declared: boolean };
  drift: Record<string, number>;
  learned: { memory_entries: number; transfer_outcome: string; decay_signals: number; ecology_packages: number };
  trace: { links: number; artifacts_reachable: number; complete: boolean };
}

/** The full brownfield loop result (pure JSON; everything is retained). */
export interface BrownfieldLoopResult {
  input_digest: string;
  stages: BrownfieldStageRecords;
  artifacts: {
    implementation_model: IngestionStageOutput['implementationModel'];
    declared_architecture: IngestionStageOutput['declared'];
    system_state: IngestionStageOutput['systemState'];
    system_state_anchor: string;
    ingestion_evidence: IngestionStageOutput['ingestionEvidence'];
    runtime_conformance: IngestionStageOutput['runtimeConformance'];
    recovery: ReturnType<typeof runRecoveryStage>['recovery'];
    selected_hypothesis: ReturnType<typeof runRecoveryStage>['selectedHypothesis'];
    search_context: ReturnType<typeof runRetrievalStage>['searchContext'];
    search: ReturnType<typeof runEvolutionStage>['search'];
    pareto: ReturnType<typeof runEvolutionStage>['pareto'];
    repertoire: ReturnType<typeof runEvolutionStage>['repertoire'];
    local_candidate: ReturnType<typeof runEvolutionStage>['localCandidate'];
    applied_content: ReturnType<typeof runEvolutionStage>['appliedContent'];
    applied_diff: ReturnType<typeof runEvolutionStage>['appliedDiff'];
    candidate_architecture: ReturnType<typeof runEvolutionStage>['candidateArchitecture'];
    candidate_state: ReturnType<typeof runEvolutionStage>['candidateState'];
    hypothesis_id: string;
    assurance_case: ReturnType<typeof runAssuranceStage>['assuranceCase'];
    assurance_evaluation: ReturnType<typeof runAssuranceStage>['evaluation'];
    monitor: ReturnType<typeof runAssuranceStage>['monitor'];
    assurance_promotion_fixture: ReturnType<typeof runAssuranceStage>['promotionFixture'];
    experiment: ReturnType<typeof runExperimentStage>['experiment'];
    experiment_result: ReturnType<typeof runExperimentStage>['result'];
    experiment_evaluation: ReturnType<typeof runExperimentStage>['evaluation'];
    promotion_grant: ReturnType<typeof runPromotionStage>['grant'];
    promotion_evaluation: ReturnType<typeof runPromotionStage>['evaluation'];
    promotion_recovery: ReturnType<typeof runPromotionStage>['recovery'];
    reconciliation: ReturnType<typeof runReconciliationStage>['reconciliation'];
    outcome_evidence: ReturnType<typeof runLearningStage>['outcomeEvidence'];
    transfer_record: ReturnType<typeof runLearningStage>['transfer'];
    decay_signals: ReturnType<typeof runLearningStage>['decaySignals'];
    memory: ReturnType<typeof runLearningStage>['memory'];
  };
  trace: TraceLink[];
  chain: TraceChainVerification;
  summary: BrownfieldLoopSummary;
}

/** A canonical projection of the loop input for the evidence-binding digest. */
function inputProjection(input: BrownfieldLoopInput): unknown {
  return {
    snapshot: {
      system_name: input.snapshot.system_name,
      revision: input.snapshot.revision,
      created_at: input.snapshot.created_at,
      normalized_model: normalizeSnapshot(input.snapshot),
      runtime_observations: sortObservations(input.snapshot.runtime_observations),
      telemetry_counts: {
        spans: input.snapshot.telemetry_traces.spans?.length ?? 0,
        metrics: input.snapshot.telemetry_traces.metrics?.length ?? 0,
        logs: input.snapshot.telemetry_traces.logs?.length ?? 0,
      },
    },
    declared: {
      nodes: [...input.declared.nodes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
      edges: [...input.declared.edges].sort(
        (a, b) =>
          a.source < b.source ? -1 : a.source > b.source ? 1 : a.target < b.target ? -1 : a.target > b.target ? 1 : a.kind < b.kind ? -1 : 1,
      ),
      provenance: input.declared.provenance,
      created_at: input.declared.created_at,
    },
    invariants: input.invariants,
    goal: {
      capability: input.goal.capability,
      query_context: input.goal.query_context,
      constraints: input.goal.constraints,
      mission_ref: input.goal.mission_ref,
      objective_axes: input.goal.objective_axes,
      predicted_estimates: input.goal.predicted_estimates,
      repertoire_edges: input.goal.repertoire_edges,
      fitness_axis: input.goal.fitness_axis,
      target_component: input.goal.target_component,
      replacement_id: input.goal.replacement_id,
      replacement_kind: input.goal.replacement_kind,
      hypothesis_statement: input.goal.hypothesis_statement,
      predicted_effects: input.goal.predicted_effects,
    },
    experiment: input.experiment,
    authority: input.authority,
    learning: {
      transfer_target_context: input.learning.transfer_target_context,
      decay_signals: input.learning.decay_signals,
      package_ids: input.learning.package_ids,
      nominal_rule: input.learning.nominal_rule,
      rollback_rule: input.learning.rollback_rule,
    },
    now: input.now,
    producer: input.producer,
    provenance: input.provenance,
    authority_ref: input.authority_ref,
  };
}

/** Run the complete brownfield optimization loop (deterministic, pure). */
export function runBrownfieldLoop(input: BrownfieldLoopInput): BrownfieldLoopResult {
  assertValidBrownfieldLoopInput(input);
  const inputDigest = contentHash(inputProjection(input));

  // Stage 1 — repository/runtime ingestion.
  const ingestion = runIngestionStage(input, inputDigest);

  // Stage 2 — COMPETING architecture recovery (ambiguity never collapses).
  const recovery = runRecoveryStage(input, ingestion.implementationModel, ingestion.systemStateAnchor);

  // Stage 3 — context-conditioned package retrieval.
  const retrieval = runRetrievalStage(input, recovery.selectedHypothesis, ingestion.systemState);

  // Stage 4 — bounded, invariant-preserving candidate evolution.
  const evolution = runEvolutionStage(input, recovery.selectedHypothesis, retrieval.facade, ingestion.systemState, ingestion.systemStateAnchor);

  // Stage 5 — assurance case evaluation (objections retained; invalid blocks).
  const assurance = runAssuranceStage(
    input,
    evolution.candidateState,
    evolution.candidateArchitecture,
    recovery.selectedHypothesis,
    ingestion.systemState,
    ingestion.runtimeConformance,
    evolution.invariantCheckResults,
  );

  // Stage 6 — deterministic SIMULATED experiment (never intervention evidence).
  const experiment = runExperimentStage(input, evolution.candidateState, evolution.hypothesisId, ingestion.systemState);

  // Stage 7 — evidence-gated promotion / rollback with bounded recovery.
  const promotion = runPromotionStage(
    input,
    evolution.candidateState,
    experiment.experiment,
    experiment.result,
    experiment.evaluation,
    assurance.promotionFixture,
    ingestion.systemState,
  );

  // Stage 8 — implementation vs declared drift reconciliation (through the
  // selected recovery hypothesis' exact model interpretation, which includes
  // the interface projection — the richest honest comparison).
  const reconciliation = runReconciliationStage(recovery.selectedHypothesis.model_view, ingestion.declared, [
    ...input.provenance,
    'brownfield:stage:reconciliation',
  ]);

  // Stage 9 — package learning (transfer evidence, decay signals, failure memory).
  const learning = runLearningStage(
    input,
    promotion.record.decision,
    promotion.record.decision_artifact_id,
    evolution.candidateState,
    evolution.selectedPackageId,
    recovery.selectedHypothesis,
    evolution.candidateArchitecture,
    experiment.result,
    ingestion.runtimeConformance,
  );

  // --- The traceability invariant: collect + verify the trace chain. ---
  const stages: BrownfieldStageRecords = {
    ingestion: ingestion.record,
    recovery: recovery.record,
    retrieval: retrieval.record,
    evolution: evolution.record,
    assurance: assurance.record,
    experiment: experiment.record,
    promotion: promotion.record,
    reconciliation: reconciliation.record,
    learning: learning.record,
  };
  const linkStore = new TraceLinkStore();
  for (const stageRecord of Object.values(stages)) {
    for (const link of stageRecord.links) {
      try {
        linkStore.add(link);
      } catch (cause) {
        throw new BrownfieldChainError(`duplicate trace link in stage ${String(stageRecord.stage)}: ${(cause as Error).message}`);
      }
    }
  }
  const trace = linkStore.all();
  const requiredEndpoints = [
    ...ingestion.record.output_refs,
    ...recovery.record.output_refs,
    ...retrieval.record.output_refs,
    ...evolution.record.output_refs,
    ...assurance.record.output_refs,
    ...experiment.record.output_refs,
    ...promotion.record.output_refs,
    ...reconciliation.record.output_refs,
    ...learning.record.output_refs,
    ...learning.record.ecology_package_ids,
  ];
  const chain = assertBrownfieldTraceChain(trace, ingestion.implementationModel.id, requiredEndpoints);

  const summary: BrownfieldLoopSummary = {
    system_name: input.snapshot.system_name,
    source_revision: input.snapshot.revision,
    ingested: {
      modules: ingestion.record.module_count,
      dependencies: ingestion.record.dependency_count,
      interfaces: ingestion.record.interface_count,
      runtime_observations: ingestion.record.runtime_observation_count,
      telemetry_ingested: ingestion.record.telemetry.ingested,
      telemetry_gaps: ingestion.record.telemetry.gaps,
    },
    hypotheses: {
      count: recovery.record.hypothesis_count,
      ambiguity_detected: recovery.record.ambiguity_detected,
      strategies: recovery.record.strategies,
    },
    retrieved: {
      candidates: retrieval.record.candidate_count,
      families: retrieval.record.families,
      altitudes: retrieval.record.altitudes_present,
    },
    candidate: {
      target_component: input.goal.target_component,
      replacement_component: input.goal.replacement_id,
      package_id: evolution.selectedPackageId,
      family: evolution.record.selected_family,
      bounded_nodes: evolution.record.bounded.nodes.length,
      bounded_edges: evolution.record.bounded.edges.length,
      invariants_preserved: evolution.record.invariant_results.filter((result) => result.status === 'PASS' || result.status === 'NOT_APPLICABLE').length,
    },
    assurance: {
      verdict: assurance.record.verdict,
      objections_retained: assurance.record.objections.length,
      blocks: assurance.record.blocks,
    },
    experiment: {
      overall_availability: experiment.record.overall_availability,
      simulated: true,
      seed: experiment.record.seed,
      guardrails_breached: experiment.record.guardrails.filter((guardrail) => guardrail.status === 'BREACHED').length,
      rollback_triggers_fired: experiment.record.rollback_triggers.filter((trigger) => trigger.triggered).length,
    },
    decision: {
      action: promotion.record.decision,
      guardrails_tripped: promotion.record.guardrails_tripped,
      recovery_declared: promotion.record.recovery !== null,
    },
    drift: { ...(reconciliation.record.classifications as Record<string, number>) },
    learned: {
      memory_entries: learning.record.memory_entries.length,
      transfer_outcome: learning.record.transfer_outcome,
      decay_signals: learning.record.decay_signal_ids.length,
      ecology_packages: learning.record.ecology_package_ids.length,
    },
    trace: { links: trace.length, artifacts_reachable: chain.reachable.length, complete: chain.complete },
  };

  return {
    input_digest: inputDigest,
    stages,
    artifacts: {
      implementation_model: ingestion.implementationModel,
      declared_architecture: ingestion.declared,
      system_state: ingestion.systemState,
      system_state_anchor: ingestion.systemStateAnchor,
      ingestion_evidence: ingestion.ingestionEvidence,
      runtime_conformance: ingestion.runtimeConformance,
      recovery: recovery.recovery,
      selected_hypothesis: recovery.selectedHypothesis,
      search_context: retrieval.searchContext,
      search: evolution.search,
      pareto: evolution.pareto,
      repertoire: evolution.repertoire,
      local_candidate: evolution.localCandidate,
      applied_content: evolution.appliedContent,
      applied_diff: evolution.appliedDiff,
      candidate_architecture: evolution.candidateArchitecture,
      candidate_state: evolution.candidateState,
      hypothesis_id: evolution.hypothesisId,
      assurance_case: assurance.assuranceCase,
      assurance_evaluation: assurance.evaluation,
      monitor: assurance.monitor,
      assurance_promotion_fixture: assurance.promotionFixture,
      experiment: experiment.experiment,
      experiment_result: experiment.result,
      experiment_evaluation: experiment.evaluation,
      promotion_grant: promotion.grant,
      promotion_evaluation: promotion.evaluation,
      promotion_recovery: promotion.recovery,
      reconciliation: reconciliation.reconciliation,
      outcome_evidence: learning.outcomeEvidence,
      transfer_record: learning.transfer,
      decay_signals: learning.decaySignals,
      memory: learning.memory,
    },
    trace,
    chain,
    summary,
  };
}

/** Canonical (byte-stable) serialization of a loop result. */
export function canonicalBrownfieldText(result: BrownfieldLoopResult): string {
  return canonicalSerialize(result);
}

/**
 * A deterministic, human-readable one-screen summary of the loop (the
 * harness prints exactly this). Byte-identical for identical results.
 */
export function formatBrownfieldSummary(result: BrownfieldLoopResult): string {
  const summary = result.summary;
  const driftEntries = Object.entries(summary.drift).filter(([, count]) => count > 0);
  const lines = [
    `SOS 2.0 Brownfield Optimization Loop — ${summary.system_name} @ ${summary.source_revision.slice(0, 12)}`,
    `ingested: ${summary.ingested.modules} modules, ${summary.ingested.dependencies} dependencies, ${summary.ingested.interfaces} interfaces, ${summary.ingested.runtime_observations} runtime observations (telemetry: ${summary.ingested.telemetry_ingested} ingested, ${summary.ingested.telemetry_gaps} gaps recorded)`,
    `hypotheses: ${summary.hypotheses.count} (ambiguity: ${summary.hypotheses.ambiguity_detected ? 'yes' : 'no'}; strategies: ${summary.hypotheses.strategies.join(', ')})`,
    `retrieved: ${summary.retrieved.candidates} candidates across ${summary.retrieved.families.length} families (${summary.retrieved.families.join(', ')}) at altitudes ${summary.retrieved.altitudes.join(' < ')}`,
    `candidate: ${summary.candidate.target_component} -> ${summary.candidate.replacement_component} (package ${summary.candidate.package_id}, family ${summary.candidate.family}; bounded: ${summary.candidate.bounded_nodes} nodes / ${summary.candidate.bounded_edges} edges; invariants preserved: ${summary.candidate.invariants_preserved})`,
    `assurance: ${summary.assurance.verdict} (objections retained: ${summary.assurance.objections_retained}; blocks promotion: ${summary.assurance.blocks ? 'yes' : 'no'})`,
    `experiment: ${summary.experiment.overall_availability} (SIMULATED, seed ${summary.experiment.seed}; guardrails breached: ${summary.experiment.guardrails_breached}; rollback triggers fired: ${summary.experiment.rollback_triggers_fired})`,
    `decision: ${summary.decision.action} (guardrails tripped: ${summary.decision.guardrails_tripped ? 'yes' : 'no'}; bounded recovery declared: ${summary.decision.recovery_declared ? 'yes' : 'no'})`,
    `drift: ${driftEntries.length > 0 ? driftEntries.map(([classification, count]) => `${classification}=${count}`).join(', ') : 'none'}`,
    `learned: ${summary.learned.memory_entries} memory entries, transfer ${summary.learned.transfer_outcome}, ${summary.learned.decay_signals} decay signals, ${summary.learned.ecology_packages} ecology packages updated`,
    `trace chain: ${summary.trace.complete ? 'COMPLETE' : 'BROKEN'} (${summary.trace.links} links, ${summary.trace.artifacts_reachable} artifacts reachable from the ImplementationModel)`,
  ];
  return lines.join('\n');
}
