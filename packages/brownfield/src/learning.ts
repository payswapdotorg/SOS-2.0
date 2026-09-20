/**
 * Brownfield stage 9 — PACKAGE LEARNING (W15).
 *
 * The loop outcome feeds the package ecology and architecture memory:
 *   - TRANSFER EVIDENCE (@sos-2/transfer): applying the retrieved package
 *     in the brownfield target context is a distinct evidence class —
 *     context-conditioned, claim strength CORRELATIONAL (the loop's
 *     outcome evidence is observational; simulated experiment outcomes are
 *     NEVER intervention evidence), never updating the source package's
 *     applicability estimate;
 *   - DECAY/OBSOLESCENCE SIGNALS (@sos-2/ecology MaturityReviewQueue):
 *     evidence-shaped input only, feeding the read-only review queue —
 *     never auto-demotion;
 *   - FAILURE MEMORY + ROLLBACK EVENTS + LEARNED RULES
 *     (@sos-2/memory ArchitectureMemory): on a ROLLBACK decision the
 *     failure context is retained verbatim, the bounded rollback is
 *     recorded and a learned rule is appended; on a nominal outcome the
 *     prediction/outcome pair is recorded with realized UNKNOWN (honest:
 *     only simulated evidence exists so far).
 *
 * Links:
 *   outcome evidence --DERIVED_FROM--> promotion decision record
 *   outcome evidence --OBSERVES-->    every decay-signal package (its
 *                                     evidence is exactly this record)
 *   memory artifact  --DERIVED_FROM--> outcome evidence
 */

import { createArchitectureMemory } from '@sos-2/memory';
import type { ArchitectureMemoryArtifact, MemoryEntry } from '@sos-2/memory';
import type { TransferEvidenceRecord } from '@sos-2/transfer';
import type { DecaySignal } from '@sos-2/ecology';
import { createEvidence } from '@sos-2/evidence';
import type { EvidenceRecordW3 } from '@sos-2/evidence';
import type { CandidateStateFixture, ExperimentResultRecord } from '@sos-2/experiments';
import type { ArchitectureGraphArtifact } from '@sos-2/architecture';
import type { RecoveryHypothesis } from '@sos-2/recovery';
import type { RuntimeConformanceResult } from '@sos-2/runtime-conformance';
import type { DecisionAction } from '@sos-2/authority';
import { BrownfieldError } from './errors.js';
import type { BrownfieldLoopInput } from './input.js';
import type { LearningStageRecord } from './stages.js';
import { brownfieldTraceLink } from './trace.js';

/** Everything stage 9 produces. */
export interface LearningStageOutput {
  record: LearningStageRecord;
  outcomeEvidence: EvidenceRecordW3;
  transfer: TransferEvidenceRecord;
  decaySignals: DecaySignal[];
  memory: ArchitectureMemoryArtifact;
}

/** Resolve a learning package reference ('selected' or a fixture key). */
function resolvePackageId(input: BrownfieldLoopInput, packageKey: string, selectedPackageId: string): string {
  if (packageKey === 'selected') {
    return selectedPackageId;
  }
  const resolved = input.learning.package_ids[packageKey];
  if (resolved === undefined) {
    throw new BrownfieldError(
      'LEARNING_FAILED',
      `learning decay signal references unknown package key "${packageKey}" (known keys: ${Object.keys(input.learning.package_ids).join(', ') || 'none'}, plus "selected")`,
    );
  }
  return resolved;
}

/** Run the package learning stage (deterministic, pure). */
export function runLearningStage(
  input: BrownfieldLoopInput,
  decision: DecisionAction,
  decisionArtifactId: string,
  candidateState: CandidateStateFixture,
  selectedPackageId: string,
  selectedHypothesis: RecoveryHypothesis,
  candidateArchitecture: ArchitectureGraphArtifact,
  experimentResult: ExperimentResultRecord,
  runtimeConformance: RuntimeConformanceResult,
): LearningStageOutput {
  const rolledBack = decision === 'ROLLBACK';

  // 1. The loop outcome evidence (observational; the decision is what was
  //    observed; the simulated result is cited in provenance, never used
  //    as intervention evidence).
  const outcomeEvidence = createEvidence({
    kind: 'brownfield-loop-outcome',
    subject_ref: candidateState.envelope.id,
    availability: rolledBack ? 'FAILURE' : 'SUCCESS',
    evidence_class: 'OBSERVATIONAL',
    method: 'brownfield:promotion-decision',
    provenance: [
      ...input.provenance,
      `brownfield:decision:${decision}`,
      `brownfield:decision-artifact:${decisionArtifactId}`,
      `brownfield:simulated-result:${experimentResult.id} (cited as provenance only — simulated outcomes are never intervention evidence)`,
    ],
    window: { start: input.now, end: input.now },
    subject_revision: candidateState.content.base_subject_revision,
    producer: input.producer,
  });

  // 2. Transfer evidence: the package applied in the NEW brownfield context
  //    (source context = the package's OWN declared context, looked up from
  //    THE registry — the authority; target = the brownfield system).
  const selectedEntry = input.registry.current(selectedPackageId);
  const sourceContext = selectedEntry !== undefined && selectedEntry.kind === 'PACKAGE' ? selectedEntry.artifact.content.context : undefined;
  if (sourceContext === undefined) {
    throw new BrownfieldError('LEARNING_FAILED', `the selected package ${selectedPackageId} is no longer current in the registry — transfer evidence requires the package's own declared context`);
  }
  let transfer: TransferEvidenceRecord;
  try {
    transfer = input.stores.transfer.recordTransfer({
      source_ref: selectedPackageId,
      source_context: sourceContext,
      target_context: input.learning.transfer_target_context,
      outcome: rolledBack ? 'TRANSFER_FAILURE' : 'TRANSFER_SUCCESS',
      evidence: [outcomeEvidence],
      claim_strength: 'CORRELATIONAL',
      provenance: [...input.provenance, 'brownfield:package-learning'],
      recorded_at: input.now,
      note: rolledBack
        ? 'the brownfield loop rolled the candidate back (guardrail breach under the fixed-seed simulated experiment); retained as negative transfer evidence'
        : 'the brownfield loop carried the candidate through assurance and a healthy simulated experiment; promotion remains gated on real intervention evidence',
    });
  } catch (cause) {
    throw new BrownfieldError('LEARNING_FAILED', `transfer recording failed: ${(cause as Error).message}`);
  }

  // 3. Decay/obsolescence signals (evidence-shaped input to the review queue).
  const decaySignals: DecaySignal[] = [];
  for (const signalSpec of input.learning.decay_signals) {
    const packageId = resolvePackageId(input, signalSpec.package_key, selectedPackageId);
    try {
      decaySignals.push(
        input.stores.reviewQueue.recordSignal({
          package_id: packageId,
          kind: signalSpec.kind,
          observed_at: input.now,
          evidence_refs: [outcomeEvidence.id],
          provenance: [...input.provenance, 'brownfield:package-learning'],
          note: signalSpec.note,
        }),
      );
    } catch (cause) {
      throw new BrownfieldError('LEARNING_FAILED', `decay signal recording failed: ${(cause as Error).message}`);
    }
  }

  // 4. Architecture memory: prediction + outcome (+ failure + rollback on
  //    ROLLBACK) + learned rule + runtime observation.
  const prediction: MemoryEntry = {
    entry_kind: 'PREDICTION',
    id: 'pred-candidate-effects',
    recorded_at: input.now,
    statement: candidateState.content.predicted_effects.join('; '),
    subject_ref: candidateState.envelope.id,
    hypothesis_ref: candidateState.content.hypothesis_ref,
    context: { environment: input.goal.query_context['environment'] ?? 'production', target: input.goal.target_component },
  };
  const outcome: MemoryEntry = {
    entry_kind: 'OUTCOME',
    id: 'outcome-promotion-decision',
    recorded_at: input.now,
    statement: rolledBack
      ? `The candidate was ROLLED BACK: a wired guardrail trigger fired (${decision}). The prediction remains UNKNOWN — only simulated experiment evidence exists.`
      : `The candidate reached decision ${decision} (promotion gated on real intervention evidence). The prediction remains UNKNOWN — only simulated experiment evidence exists.`,
    prediction_refs: ['pred-candidate-effects'],
    realized: 'UNKNOWN',
    evidence_refs: [outcomeEvidence.id],
    context: { decision, environment: input.goal.query_context['environment'] ?? 'production' },
  };
  const passConformance = runtimeConformance.records.filter((record) => record.verdict === 'PASS');
  const observation: MemoryEntry = {
    entry_kind: 'OBSERVATION',
    id: 'obs-runtime-conformance',
    recorded_at: input.now,
    statement: `Runtime conformance over the declared invariants at the exact system revision: ${runtimeConformance.records
      .map((record) => record.verdict)
      .join(', ')}.`,
    evidence_refs: passConformance.length > 0 ? passConformance.map((record) => record.evidence.id) : [outcomeEvidence.id],
    context: { environment: 'production', system: input.snapshot.system_name },
  };
  const entries: MemoryEntry[] = [prediction, outcome, observation];
  if (rolledBack) {
    entries.push(
      {
        entry_kind: 'FAILURE',
        id: 'failure-guardrail-rollback',
        recorded_at: input.now,
        statement: 'The bounded candidate replacement was rolled back after a wired guardrail trigger fired under the simulated experiment evaluation.',
        evidence_refs: [outcomeEvidence.id],
        context: { environment: input.goal.query_context['environment'] ?? 'production', decision: 'ROLLBACK', target: input.goal.target_component },
      },
      {
        entry_kind: 'ROLLBACK',
        id: 'rollback-bounded-recovery',
        recorded_at: input.now,
        statement: 'Rolled the bounded subgraph replacement back to the recovered hypothesis revision (blue-green redeploy within the declared recovery bound).',
        from_revision: `${candidateArchitecture.envelope.id}@v${candidateArchitecture.envelope.version}`,
        to_revision: `${selectedHypothesis.artifact.envelope.id}@v${selectedHypothesis.artifact.envelope.version}`,
        reason: 'A wired experiment guardrail trigger fired — safety outranks promotion (spec/architecture.md section 18).',
        evidence_refs: [outcomeEvidence.id],
        context: { environment: input.goal.query_context['environment'] ?? 'production', mechanism: 'blue-green redeploy' },
      },
    );
  }
  entries.push({
    entry_kind: 'LEARNED_RULE',
    id: rolledBack ? 'rule-guardrail-first-rollout' : 'rule-intervention-evidence-before-promotion',
    recorded_at: input.now,
    statement: rolledBack ? input.learning.rollback_rule : input.learning.nominal_rule,
    applicability: { change_kind: 'bounded-component-replacement', environment: input.goal.query_context['environment'] ?? 'production' },
    evidence_refs: [outcomeEvidence.id],
    uncertainty: { kind: 'QUALITATIVE', uncertainty_class: 'MODERATE' },
  });

  let memory: ArchitectureMemoryArtifact;
  try {
    memory = createArchitectureMemory({
      content: {
        entries,
        update: { producer: input.producer, evidence_refs: [outcomeEvidence.id] },
      },
      provenance: [...input.provenance, 'brownfield:package-learning'],
      created_at: input.now,
      authority_ref: input.authority_ref,
      status: 'ACTIVE',
    });
    input.stores.memory.put(memory);
  } catch (cause) {
    throw new BrownfieldError('LEARNING_FAILED', `architecture memory recording failed: ${(cause as Error).message}`);
  }

  // 5. Stage handoff links (the chain endpoints of the learning ecology).
  const ecologyPackageIds = [...new Set([...decaySignals.map((signal) => signal.package_id), selectedPackageId])].sort();
  const links = [
    brownfieldTraceLink({
      source: outcomeEvidence.id,
      target: decisionArtifactId,
      type: 'DERIVED_FROM',
      provenance: [...input.provenance, 'brownfield:stage:learning'],
    }),
    ...decaySignals.map((signal) =>
      brownfieldTraceLink({
        source: outcomeEvidence.id,
        target: signal.package_id,
        type: 'OBSERVES',
        provenance: [...input.provenance, `brownfield:decay-signal:${signal.kind}`],
      }),
    ),
    brownfieldTraceLink({
      source: memory.envelope.id,
      target: outcomeEvidence.id,
      type: 'DERIVED_FROM',
      provenance: [...input.provenance, 'brownfield:stage:learning'],
    }),
  ];

  const record: LearningStageRecord = {
    stage: 'LEARNING',
    input_refs: [decisionArtifactId, candidateState.envelope.id, selectedPackageId],
    output_refs: [outcomeEvidence.id, memory.envelope.id],
    links,
    outcome_evidence_id: outcomeEvidence.id,
    outcome_availability: outcomeEvidence.availability,
    decision,
    memory_artifact_id: memory.envelope.id,
    memory_entries: memory.content.entries.map((entry) => ({ id: entry.id, entry_kind: entry.entry_kind })),
    transfer_record_id: transfer.id,
    transfer_outcome: transfer.outcome,
    transfer_source_ref: transfer.source_ref,
    decay_signal_ids: decaySignals.map((signal) => signal.id),
    decay_kinds: decaySignals.map((signal) => signal.kind),
    ecology_package_ids: ecologyPackageIds,
  };

  return { record, outcomeEvidence, transfer, decaySignals, memory };
}
