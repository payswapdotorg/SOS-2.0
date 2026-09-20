/**
 * The meta-evolution loop orchestrator (W16).
 *
 * runMetaEvolutionLoop executes the seven stages IN ORDER over the golden
 * self-evolution scenario and returns ONE typed, pure-JSON loop result:
 *   SEPARATION -> META-PROPOSAL -> GOVERNANCE GUARD -> (per guard-passing
 *   change: EFFECTIVENESS -> DECISION + PROMOTION -> ROLLBACK) -> LIABILITY
 * MEMORY, followed by the TRACEABILITY INVARIANT self-check: the collected
 * typed trace links must form ONE connected semantic subgraph rooted at the
 * initial MetaProcess revision reaching every consequential endpoint —
 * each MetaChange proposal, its decision record(s), and either the applied
 * revision or the rollback restore revision plus the retained failure
 * memory (a missing link FAILS the pipeline before the result is returned).
 *
 * Stage records are assembled in canonical stage order even though the
 * per-change processing (measure -> decide -> resolve) interleaves stages
 * 4-6: each change is measured against the CURRENT head, decided with
 * current authority, and resolved (applied / rolled back / asked) before
 * the next change is processed — the process revision chain advances
 * exactly as the decisions resolve it.
 *
 * Determinism: single caller-supplied `now`, fixed seed, deterministic ids
 * everywhere — identical input (fresh stores) produces a byte-identical
 * canonical serialization (pinned by property tests).
 */

import { contentHash, canonicalSerialize, TraceLinkStore } from '@sos-2/semantic-spine';
import type { TraceLink } from '@sos-2/semantic-spine';
import { AskQueue } from '@sos-2/ask';
import { createEvidence } from '@sos-2/evidence';
import type { EvidenceRecordW3 } from '@sos-2/evidence';
import type { BrownfieldLoopSummary } from '@sos-2/brownfield';
import type { MissionArtifact } from '@sos-2/mission';
import type { CandidateStateFixture, ExperimentArtifact, ExperimentResultRecord } from '@sos-2/experiments';
import type { DecisionRecord } from '@sos-2/decision';
import type { AuthorityGrantArtifact } from '@sos-2/authority';
import type { PromotionDecisionArtifact, BoundedRecoveryDeclaration } from '@sos-2/promotion';
import type { AssuranceCaseArtifact } from '@sos-2/assurance';
import type { ArchitectureMemoryArtifact } from '@sos-2/memory';
import { MetaEvolutionError } from './errors.js';
import { assertValidMetaEvolutionInput } from './input.js';
import type { MetaEvolutionInput } from './input.js';
import type { MetaEvolutionStageRecords } from './stages.js';
import { evaluateGovernanceGuard } from './guard.js';
import type { GuardRejection } from './guard.js';
import { createMetaProcess, MetaProcessStore } from './process.js';
import type { MetaProcessArtifact } from './process.js';
import { metaChangeArtifactId } from './change.js';
import type { MetaChangeArtifact } from './change.js';
import { runSeparationStage } from './separation.js';
import { runProposalStage, buildMetaChangeContent } from './propose.js';
import { measureChange, assembleEffectivenessRecord } from './effectiveness.js';
import type { EffectivenessMeasurement } from './effectiveness.js';
import { decideChange, assembleDecisionRecord } from './decision-stage.js';
import type { DecisionEntry } from './decision-stage.js';
import { executeRollback, assembleRollbackRecord } from './revision.js';
import type { RollbackExecution } from './revision.js';
import { retainFailure, assembleLiabilityRecord } from './liability.js';
import type { LiabilityRetention } from './liability.js';
import { assertMetaTraceChain, metaTraceLink } from './trace.js';
import type { TraceChainVerification } from './trace.js';
import { cloneParameters } from './parameters.js';

class MetaChainError extends MetaEvolutionError {
  constructor(message: string) {
    super('BROKEN_TRACE_CHAIN', message);
  }
}

/** The canonical, deterministic loop summary (pure data). */
export interface MetaEvolutionLoopSummary {
  scenario: string;
  object_loop: { system_name: string; variant: string; decision: string; chain_complete: boolean; trace_links: number };
  separation: { object_anchor: string; meta_anchor: string; mission_id: string; conflation_rejections: number };
  proposals: { count: number; families: string[]; pareto_fronts: number; repertoire_cells: number };
  guard: { passed: number; rejected: number; rejected_invariants: string[] };
  effectiveness: { measured: number; effective: number; negative: number; simulated: true; seed: number };
  decisions: { promote: number; rollback: number; ask: number; other: number };
  process_revision: {
    initial: string;
    final: string;
    final_version: number;
    restore_exact: boolean;
    history: string[];
  };
  retained_failures: {
    count: number;
    memory_entry_kinds: string[];
    transfer_outcomes: string[];
    penalty_demonstrated: boolean;
  };
  trace: { links: number; artifacts_reachable: number; complete: boolean };
}

/** The full meta-evolution loop result (pure JSON; everything is retained). */
export interface MetaEvolutionLoopResult {
  input_digest: string;
  stages: MetaEvolutionStageRecords;
  artifacts: {
    initial_process: MetaProcessArtifact;
    final_process: MetaProcessArtifact;
    /** Every minted process revision, in mint order (trials, restores, activations). */
    process_revisions: MetaProcessArtifact[];
    mission: MissionArtifact;
    object_loop_summary: BrownfieldLoopSummary;
    object_evidence: EvidenceRecordW3;
    changes: MetaChangeArtifact[];
    guard_rejections: GuardRejection[];
    guard_rejection_evidence: EvidenceRecordW3[];
    measurements: Array<{
      change: MetaChangeArtifact;
      candidate: CandidateStateFixture;
      hypothesis_id: string;
      trial: MetaProcessArtifact;
      experiment: ExperimentArtifact;
      result: ExperimentResultRecord;
    }>;
    decisions: Array<{
      change: MetaChangeArtifact;
      engine_record: DecisionRecord;
      revise_grant: AuthorityGrantArtifact;
      promotion_record: PromotionDecisionArtifact | null;
      promote_grant: AuthorityGrantArtifact | null;
      assurance_case: AssuranceCaseArtifact | null;
      recovery: BoundedRecoveryDeclaration | null;
      ask_id: string | null;
      activated_revision: MetaProcessArtifact | null;
    }>;
    rollbacks: Array<{
      change: MetaChangeArtifact;
      promotion_record: PromotionDecisionArtifact;
      promote_grant: AuthorityGrantArtifact;
      restore: MetaProcessArtifact;
      retired_trial: MetaProcessArtifact;
    }>;
    retentions: Array<{
      change_id: string;
      memory: ArchitectureMemoryArtifact;
      outcome_evidence: EvidenceRecordW3;
      transfer_record_id: string;
      decay_signal_id: string;
    }>;
    ask_queue: Array<{ id: string; origin_decision_ref: string; priority: string; status: string }>;
  };
  trace: TraceLink[];
  chain: TraceChainVerification;
  summary: MetaEvolutionLoopSummary;
}

/** A canonical projection of the loop input for the evidence-binding digest. */
function inputProjection(input: MetaEvolutionInput): unknown {
  return {
    object: { variant: input.object.variant, fixture: input.object.fixture },
    mission: input.mission,
    process: input.process,
    meta_context: input.meta_context,
    changes: input.changes,
    effectiveness: input.effectiveness,
    authority: input.authority,
    learning: input.learning,
    now: input.now,
    producer: input.producer,
    provenance: input.provenance,
    authority_ref: input.authority_ref,
  };
}

/** Run the complete meta-evolution loop (deterministic, pure). */
export function runMetaEvolutionLoop(input: MetaEvolutionInput): MetaEvolutionLoopResult {
  assertValidMetaEvolutionInput(input);
  const inputDigest = contentHash(inputProjection(input));

  // The initial process revision (the meta anchor).
  const initialProcess = createMetaProcess({
    content: {
      parameters: cloneParameters(input.process.parameters),
      mission_ref: null,
      notes: input.process.notes,
    },
    provenance: [...input.provenance, 'meta-evolution:initial-process'],
    created_at: input.now,
    authority_ref: input.authority_ref,
    status: 'ACTIVE',
  });
  const processStore = new MetaProcessStore();
  processStore.put(initialProcess);
  const processRevisions: MetaProcessArtifact[] = [initialProcess];

  // Stage 1 — SEPARATION (object probe + anchors + lane checks). The first
  // meta change id is precomputed deterministically for the cross-lane probe.
  const firstSpec = input.changes[0];
  if (firstSpec === undefined) {
    throw new MetaEvolutionError('INVALID_META_INPUT', 'loop input carries no change specs');
  }
  const firstMetaChangeId = metaChangeArtifactId({
    content: buildMetaChangeContent(input, initialProcess, firstSpec),
    provenance: [...input.provenance, 'meta-evolution:proposal', `meta-evolution:spec:${firstSpec.key}`],
    created_at: input.now,
    authority_ref: input.authority_ref,
    status: 'ACTIVE',
  });
  const separation = runSeparationStage(input, initialProcess.envelope.id, firstMetaChangeId);

  // Stage 2 — META-PROPOSAL (registry-driven, Pareto + quality-diversity).
  const proposal = runProposalStage(input, initialProcess);
  const specOfChange = new Map<string, (typeof input.changes)[number]>();
  for (let index = 0; index < proposal.changes.length; index += 1) {
    const change = proposal.changes[index];
    const spec = input.changes[index];
    if (change === undefined || spec === undefined) {
      throw new MetaEvolutionError('INVALID_META_INPUT', 'change specs and minted changes are misaligned');
    }
    specOfChange.set(change.envelope.id, spec);
  }

  // Stage 3 — GOVERNANCE GUARD (every proposal, against its proposal base).
  const guardVerdicts: Array<{ change_id: string; passed: boolean; rejection: GuardRejection | null }> = [];
  const guardRejections: GuardRejection[] = [];
  const guardRejectionEvidence: EvidenceRecordW3[] = [];
  const guardLinks: TraceLink[] = [];
  for (const change of proposal.changes) {
    const verdict = evaluateGovernanceGuard(change, initialProcess.content.parameters);
    let rejection: GuardRejection | null = null;
    if (!verdict.passed && verdict.rejection !== null) {
      rejection = verdict.rejection;
      guardRejections.push(rejection);
      // The rejection is retained as FAILURE evidence OBSERVING the change —
      // spine-traceable, never dropped.
      const evidence = createEvidence({
        kind: 'meta-governance-rejection',
        subject_ref: change.envelope.id,
        availability: 'FAILURE',
        evidence_class: 'OBSERVATIONAL',
        method: 'meta-evolution:governance-guard',
        provenance: [...input.provenance, 'meta-evolution:guard', `meta-evolution:change:${change.envelope.id}`],
        window: { start: input.now, end: input.now },
        producer: input.producer,
      });
      guardRejectionEvidence.push(evidence);
      guardLinks.push(
        metaTraceLink({
          source: evidence.id,
          target: change.envelope.id,
          type: 'OBSERVES',
          provenance: [...input.provenance, 'meta-evolution:stage:guard', `meta-evolution:evidence:${evidence.id}`],
        }),
      );
    }
    guardVerdicts.push({ change_id: change.envelope.id, passed: verdict.passed, rejection });
  }
  const guardRecord: MetaEvolutionStageRecords['guard'] = {
    stage: 'GUARD',
    input_refs: proposal.changes.map((change) => change.envelope.id),
    output_refs: guardRejectionEvidence.map((evidence) => evidence.id),
    links: guardLinks,
    verdicts: guardVerdicts,
    passed_count: guardVerdicts.filter((verdict) => verdict.passed).length,
    rejected_count: guardRejections.length,
    rejection_evidence_ids: guardRejectionEvidence.map((evidence) => evidence.id),
  };

  // Stages 4-6, per guard-passing change (fixture order; the head advances).
  let head = initialProcess;
  const askQueue = new AskQueue();
  const measurements: EffectivenessMeasurement[] = [];
  const decisionEntries: DecisionEntry[] = [];
  const rollbackExecutions: RollbackExecution[] = [];

  for (const change of proposal.changes) {
    const verdict = guardVerdicts.find((candidate) => candidate.change_id === change.envelope.id);
    if (verdict === undefined || !verdict.passed) {
      continue; // guard-rejected changes never reach measurement
    }
    const spec = specOfChange.get(change.envelope.id);
    if (spec === undefined) {
      throw new MetaEvolutionError('INVALID_META_INPUT', `unreachable: spec resolved for change ${change.envelope.id}`);
    }

    // Stage 4 — EFFECTIVENESS (trial application + simulated measurement).
    const measurement = measureChange(input, change, spec, head, processStore);
    measurements.push(measurement);
    processRevisions.push(measurement.trial);

    // Stage 5 — DECISION (+ PROMOTION on ACT; ASK first-class).
    const entry = decideChange(input, measurement, head, processStore, askQueue);
    decisionEntries.push(entry);

    if (entry.activated !== null) {
      // The applied MetaChange produced the new MetaProcess revision.
      head = entry.activated;
      processRevisions.push(entry.activated);
    } else if (entry.engine.action === 'ROLLBACK') {
      // Stage 6 — ROLLBACK (recovery declaration + EXACT restore).
      const rollback = executeRollback(input, measurement, entry, head, processStore);
      rollbackExecutions.push(rollback);
      head = rollback.restore;
      processRevisions.push(rollback.restore);
    }
    // ASK: the trial stays DRAFT pending authority — nothing advances.
  }

  // Stage 7 — LIABILITY MEMORY (failures retained forever; R19 penalty).
  const retentions: LiabilityRetention[] = [];
  for (const rollback of rollbackExecutions) {
    const entry = decisionEntries.find((candidate) => candidate.change.envelope.id === rollback.change.envelope.id);
    const measurement = measurements.find((candidate) => candidate.change.envelope.id === rollback.change.envelope.id);
    if (entry === undefined || measurement === undefined) {
      throw new MetaEvolutionError('LIABILITY_RETENTION_VIOLATION', `unreachable: decision/measurement resolved for rollback ${rollback.change.envelope.id}`);
    }
    retentions.push(retainFailure(input, measurement, entry, rollback, proposal.record));
  }

  // --- Assemble the stage records in canonical stage order. ---
  const effectivenessRecord = assembleEffectivenessRecord(input, measurements);
  const decisionRecord = assembleDecisionRecord(input, decisionEntries);
  const rollbackRecord = assembleRollbackRecord(input, rollbackExecutions);
  const liabilityRecord = assembleLiabilityRecord(input, retentions);
  const stages: MetaEvolutionStageRecords = {
    separation: separation.record,
    proposal: proposal.record,
    guard: guardRecord,
    effectiveness: effectivenessRecord,
    decision: decisionRecord,
    rollback: rollbackRecord,
    liability: liabilityRecord,
  };

  // --- The traceability invariant: collect + verify the trace chain. ---
  const linkStore = new TraceLinkStore();
  for (const stageRecord of Object.values(stages)) {
    for (const link of stageRecord.links) {
      try {
        linkStore.add(link);
      } catch (cause) {
        throw new MetaChainError(`duplicate trace link in stage ${String(stageRecord.stage)}: ${(cause as Error).message}`);
      }
    }
  }
  const trace = linkStore.all();
  const requiredEndpoints = [
    ...separation.record.output_refs,
    ...proposal.record.output_refs,
    ...guardRecord.output_refs,
    ...effectivenessRecord.output_refs,
    ...decisionRecord.output_refs,
    ...rollbackRecord.output_refs,
    ...liabilityRecord.output_refs,
    ...proposal.record.proposals.map((proposalEntry) => proposalEntry.package_id),
  ];
  const chain = assertMetaTraceChain(trace, initialProcess.envelope.id, requiredEndpoints);

  // --- The summary. ---
  const finalProcess = head;
  const summary: MetaEvolutionLoopSummary = {
    scenario: 'sos-self-evolution-golden',
    object_loop: {
      system_name: separation.objectLoop.summary.system_name,
      variant: input.object.variant,
      decision: separation.objectLoop.stages.promotion.decision,
      chain_complete: separation.objectLoop.chain.complete,
      trace_links: separation.objectLoop.trace.length,
    },
    separation: {
      object_anchor: separation.record.object_probe.implementation_model_id,
      meta_anchor: separation.record.meta_anchor,
      mission_id: separation.record.mission_id,
      conflation_rejections: separation.record.conflation_rejections,
    },
    proposals: {
      count: proposal.record.proposals.length,
      families: [...proposal.record.retrieval.families],
      pareto_fronts: proposal.record.pareto.fronts,
      repertoire_cells: proposal.record.repertoire.cells,
    },
    guard: {
      passed: guardRecord.passed_count,
      rejected: guardRecord.rejected_count,
      rejected_invariants: guardRejections.map((rejection) => rejection.invariant),
    },
    effectiveness: {
      measured: measurements.length,
      effective: measurements.filter((measurement) => measurement.record.effective).length,
      negative: measurements.filter((measurement) => !measurement.record.effective).length,
      simulated: true,
      seed: input.effectiveness.seed,
    },
    decisions: {
      promote: decisionRecord.promote_count,
      rollback: decisionRecord.rollback_count,
      ask: decisionRecord.ask_count,
      other: decisionEntries.length - decisionRecord.promote_count - decisionRecord.rollback_count - decisionRecord.ask_count,
    },
    process_revision: {
      initial: initialProcess.envelope.id,
      final: finalProcess.envelope.id,
      final_version: finalProcess.envelope.version,
      restore_exact: rollbackRecord.rollbacks.every((rollback) => rollback.restore_exact),
      history: processStore.history(finalProcess.envelope.id).map((revision) => `${revision.envelope.id}@v${revision.envelope.version}`),
    },
    retained_failures: {
      count: retentions.length,
      memory_entry_kinds: [...liabilityRecord.memory_entry_kinds],
      transfer_outcomes: retentions.map((retention) => retention.record.transfer_outcome),
      penalty_demonstrated: retentions.every((retention) => retention.record.weight_after < retention.record.weight_before),
    },
    trace: { links: trace.length, artifacts_reachable: chain.reachable.length, complete: chain.complete },
  };

  return {
    input_digest: inputDigest,
    stages,
    artifacts: {
      initial_process: initialProcess,
      final_process: finalProcess,
      process_revisions: processRevisions,
      mission: separation.mission,
      object_loop_summary: separation.objectLoop.summary,
      object_evidence: separation.objectEvidence,
      changes: proposal.changes,
      guard_rejections: guardRejections,
      guard_rejection_evidence: guardRejectionEvidence,
      measurements: measurements.map((measurement) => ({
        change: measurement.change,
        candidate: measurement.candidate,
        hypothesis_id: measurement.hypothesisId,
        trial: measurement.trial,
        experiment: measurement.experiment,
        result: measurement.result,
      })),
      decisions: decisionEntries.map((entry) => ({
        change: entry.change,
        engine_record: entry.engine.record,
        revise_grant: entry.reviseGrant,
        promotion_record: entry.promotion?.record ?? null,
        promote_grant: entry.promoteGrant,
        assurance_case: entry.assuranceCase,
        recovery: entry.recovery,
        ask_id: entry.askId,
        activated_revision: entry.activated,
      })),
      rollbacks: rollbackExecutions.map((rollback) => ({
        change: rollback.change,
        promotion_record: rollback.promotion.record,
        promote_grant: rollback.promoteGrant,
        restore: rollback.restore,
        retired_trial: rollback.retiredTrial,
      })),
      retentions: retentions.map((retention) => ({
        change_id: retention.change_id,
        memory: retention.memory,
        outcome_evidence: retention.outcomeEvidence,
        transfer_record_id: retention.transferRecordId,
        decay_signal_id: retention.decaySignalId,
      })),
      ask_queue: askQueue.list().map((queueEntry) => ({
        id: queueEntry.id,
        origin_decision_ref: queueEntry.origin_decision_ref,
        priority: queueEntry.priority,
        status: queueEntry.status,
      })),
    },
    trace,
    chain,
    summary,
  };
}

/** Canonical (byte-stable) serialization of a loop result. */
export function canonicalMetaText(result: MetaEvolutionLoopResult): string {
  return canonicalSerialize(result);
}

/**
 * A deterministic, human-readable one-screen summary of the loop (the
 * harness prints exactly this). Byte-identical for identical results.
 */
export function formatMetaSummary(result: MetaEvolutionLoopResult): string {
  const summary = result.summary;
  const lines = [
    `SOS 2.0 Self-Evolution + Meta-Adaptation — ${summary.scenario}`,
    `object loop: ${summary.object_loop.system_name} (${summary.object_loop.variant}) -> ${summary.object_loop.decision} (chain ${summary.object_loop.chain_complete ? 'COMPLETE' : 'BROKEN'}, ${summary.object_loop.trace_links} links)`,
    `separation: object anchor ${summary.separation.object_anchor.slice(0, 40)}… | meta anchor ${summary.separation.meta_anchor.slice(0, 40)}… | conflation rejections: ${summary.separation.conflation_rejections}`,
    `proposals: ${summary.proposals.count} (${summary.proposals.families.join(', ')}) | pareto fronts: ${summary.proposals.pareto_fronts} | repertoire cells: ${summary.proposals.repertoire_cells}`,
    `guard: ${summary.guard.passed} passed, ${summary.guard.rejected} rejected${summary.guard.rejected_invariants.length > 0 ? ` (${summary.guard.rejected_invariants.join(', ')})` : ''}`,
    `effectiveness: ${summary.effectiveness.measured} measured (SIMULATED, seed ${summary.effectiveness.seed}) — ${summary.effectiveness.effective} effective, ${summary.effectiveness.negative} negative`,
    `decisions: promote=${summary.decisions.promote}, rollback=${summary.decisions.rollback}, ask=${summary.decisions.ask}, other=${summary.decisions.other}`,
    `process revision: ${summary.process_revision.initial.slice(0, 40)}… -> ${summary.process_revision.final.slice(0, 40)}… (v${summary.process_revision.final_version}; restore exact: ${summary.process_revision.restore_exact ? 'yes' : 'no'}; chain ${summary.process_revision.history.length} revisions)`,
    `retained failures: ${summary.retained_failures.count} (memory entries: ${summary.retained_failures.memory_entry_kinds.join(', ')}; transfer: ${summary.retained_failures.transfer_outcomes.join(', ') || 'none'}; R19 penalty demonstrated: ${summary.retained_failures.penalty_demonstrated ? 'yes' : 'no'})`,
    `trace chain: ${summary.trace.complete ? 'COMPLETE' : 'BROKEN'} (${summary.trace.links} links, ${summary.trace.artifacts_reachable} artifacts reachable from the initial MetaProcess)`,
  ];
  return lines.join('\n');
}
