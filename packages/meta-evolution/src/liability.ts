/**
 * Meta-evolution stage 7 — LIABILITY MEMORY (W16, R19).
 *
 * FAILED self-changes are RETAINED — never deleted — as failure memory:
 *   - an @sos-2/memory ArchitectureMemory artifact with FAILURE, ROLLBACK,
 *     LIABILITY and LEARNED_RULE entries (the store is append-only and the
 *     memory evolution rule machine-enforces that FAILURE entries are
 *     immutable and never dropped);
 *   - an @sos-2/transfer TRANSFER_FAILURE record for the failed change's
 *     source package (negative transfer evidence, first-class — the
 *     TransferStore has no removal API);
 *   - an @sos-2/ecology decay signal into the READ-ONLY MaturityReviewQueue
 *     (evidence-shaped input only — never auto-demotion).
 *
 * R19 (failed proposals reduce future proposal probability): the failure
 * memory PENALIZES the source package's proposal weight (weight = fitness /
 * (1 + failures)). This stage records the before/after weight + probability
 * of the failed package over the SAME stores, demonstrating the penalty
 * in-band; the next proposal cycle reads it deterministically.
 *
 * Links: memory artifact --DERIVED_FROM--> rollback decision; outcome
 * evidence --OBSERVES--> the failed change.
 */

import { createArchitectureMemory } from '@sos-2/memory';
import type { ArchitectureMemoryArtifact } from '@sos-2/memory';
import { openResolution } from '@sos-2/memory';
import { createEvidence } from '@sos-2/evidence';
import type { EvidenceRecordW3 } from '@sos-2/evidence';
import { contentHash } from '@sos-2/semantic-spine';
import { MetaEvolutionError } from './errors.js';
import type { MetaEvolutionInput } from './input.js';
import type { LiabilityStageRecord } from './stages.js';
import { metaTraceLink } from './trace.js';
import { failurePenalty } from './propose.js';
import { assertRollbackRecovery } from './revision.js';
import type { RollbackExecution } from './revision.js';
import type { DecisionEntry } from './decision-stage.js';
import type { EffectivenessMeasurement } from './effectiveness.js';
import type { ProposalStageRecord } from './stages.js';

export interface LiabilityRetention {
  record: LiabilityStageRecord['failures'][number];
  change_id: string;
  package_id: string;
  memory: ArchitectureMemoryArtifact;
  outcomeEvidence: EvidenceRecordW3;
  transferRecordId: string;
  decaySignalId: string;
}

/**
 * THE RETENTION ASSERTION: the failure memory entries for a failed change
 * are present in the store (never deleted). Exported for negative tests.
 */
export function assertFailureRetained(
  memoryStore: { entriesOf: (id: string) => ReadonlyArray<{ entry_kind: string; id: string }> },
  memoryArtifactId: string,
): void {
  const entries = memoryStore.entriesOf(memoryArtifactId);
  const kinds = new Set(entries.map((entry) => entry.entry_kind));
  for (const required of ['FAILURE', 'ROLLBACK', 'LIABILITY', 'LEARNED_RULE']) {
    if (!kinds.has(required)) {
      throw new MetaEvolutionError(
        'LIABILITY_RETENTION_VIOLATION',
        `the failure memory for ${memoryArtifactId} is missing its ${required} entry — failed self-changes are retained, never deleted (R19)`,
      );
    }
  }
}

/** Run the liability stage for one rolled-back change (deterministic, pure). */
export function retainFailure(
  input: MetaEvolutionInput,
  measurement: EffectivenessMeasurement,
  entry: DecisionEntry,
  rollback: RollbackExecution,
  proposalRecord: ProposalStageRecord,
): LiabilityRetention {
  const { change, spec } = measurement;
  const packageId = spec.package_id;

  // 1. The outcome evidence: the change FAILED (rolled back) — an
  //    OBSERVATIONAL record of the loop outcome (never presented as
  //    intervention evidence anywhere).
  const outcomeEvidence = createEvidence({
    kind: 'meta-evolution-outcome',
    subject_ref: change.envelope.id,
    availability: 'FAILURE',
    evidence_class: 'OBSERVATIONAL',
    method: 'meta-evolution:rollback-outcome',
    provenance: [...input.provenance, 'meta-evolution:liability', `meta-evolution:spec:${spec.key}`],
    window: { start: input.now, end: input.now },
    producer: input.producer,
  });

  // 2. The failure memory artifact (FAILURE + ROLLBACK + LIABILITY + LEARNED_RULE).
  const memory = createArchitectureMemory({
    content: {
      entries: [
        {
          entry_kind: 'FAILURE',
          id: `failure-${spec.key}`,
          recorded_at: input.now,
          statement: `The meta change "${spec.key}" from package ${packageId} failed adaptation effectiveness: ${rollback.record.recovery.mechanism}`,
          evidence_refs: [outcomeEvidence.id],
          context: { domain: 'sos-meta', change: change.envelope.id, lane: 'META', decision: 'ROLLBACK' },
        },
        {
          entry_kind: 'ROLLBACK',
          id: `rollback-${spec.key}`,
          recorded_at: input.now,
          statement: `The meta change "${spec.key}" was rolled back within the declared recovery bound; the process revision restored the exact pre-change parameters.`,
          from_revision: rollback.record.from_revision,
          to_revision: rollback.record.to_revision,
          reason: 'The wired effectiveness guardrail fired — safety outranks process optimization (spec/architecture.md section 18).',
          evidence_refs: [outcomeEvidence.id],
          context: { domain: 'sos-meta', mechanism: rollback.record.recovery.mechanism },
        },
        {
          entry_kind: 'LIABILITY',
          id: `liability-${spec.key}`,
          recorded_at: input.now,
          statement: `The meta-strategy package ${packageId} produced a failed self-change; its proposals carry reduced probability until re-validated.`,
          severity: 'HIGH',
          owner_kind: 'GOVERNANCE',
          resolution: openResolution(),
          context: { domain: 'sos-meta', package: packageId },
        },
        {
          entry_kind: 'LEARNED_RULE',
          id: `rule-${spec.key}`,
          recorded_at: input.now,
          statement: input.learning.failure_rule,
          applicability: { domain: 'sos-meta', lesson: 'failed-proposals-reduce-probability' },
          evidence_refs: [outcomeEvidence.id],
          uncertainty: { kind: 'QUALITATIVE', uncertainty_class: 'MODERATE' },
        },
      ],
      update: { producer: input.producer, evidence_refs: [outcomeEvidence.id] },
    },
    provenance: [...input.provenance, 'meta-evolution:liability-memory', `meta-evolution:spec:${spec.key}`],
    created_at: input.now,
    authority_ref: input.authority_ref,
    status: 'ACTIVE',
  });
  input.stores.memory.put(memory);
  assertFailureRetained(input.stores.memory, memory.envelope.id);

  // 3. Negative transfer evidence (retained forever — no removal API exists).
  const sourceContext = input.registry.current(packageId)?.artifact.content.context;
  if (sourceContext === undefined) {
    throw new MetaEvolutionError('LIABILITY_RETENTION_VIOLATION', `the failed package ${packageId} is no longer registered (it must never be deleted)`);
  }
  const transfer = input.stores.transfer.recordTransfer({
    source_ref: packageId,
    source_context: { ...sourceContext },
    target_context: { ...input.learning.transfer_target_context },
    outcome: 'TRANSFER_FAILURE',
    evidence: [outcomeEvidence],
    claim_strength: 'CORRELATIONAL',
    provenance: [...input.provenance, 'meta-evolution:liability-transfer', `meta-evolution:spec:${spec.key}`],
    recorded_at: input.now,
    note: `the meta change "${spec.key}" failed effectiveness and was rolled back — retained as negative transfer evidence (R19)`,
  });

  // 4. The decay signal into the READ-ONLY maturity review queue.
  const decay = input.stores.reviewQueue.recordSignal({
    package_id: packageId,
    kind: input.learning.decay_signal.kind,
    observed_at: input.now,
    evidence_refs: [outcomeEvidence.id],
    provenance: [...input.provenance, 'meta-evolution:liability-decay', `meta-evolution:spec:${spec.key}`],
    note: input.learning.decay_signal.note,
  });

  // 5. The R19 penalty, demonstrated in-band over the SAME stores: the
  //    failed package's proposal weight + probability drop deterministically.
  const proposal = proposalRecord.proposals.find((candidate) => candidate.change_id === change.envelope.id);
  const fitness = spec.fitness;
  const failureCountBefore = 0; // this run's failure is the first
  const failureCountAfter = input.stores.transfer.failedTransfersFor(packageId).length;
  const weightBefore = fitness * failurePenalty(failureCountBefore);
  const weightAfter = fitness * failurePenalty(failureCountAfter);
  const probabilityBefore = proposal?.proposal_probability ?? 0;
  const totalAfter = proposalRecord.proposals.reduce((sum, other) => {
    const otherFitness = input.changes.find((changeSpec) => changeSpec.package_id === other.package_id)?.fitness ?? 0;
    const otherFailures = input.stores.transfer.failedTransfersFor(other.package_id).length;
    return sum + otherFitness * failurePenalty(otherFailures);
  }, 0);
  const probabilityAfter = totalAfter > 0 ? weightAfter / totalAfter : 0;

  // The recovery declaration must still be wired (the rollback invariant
  // holds through the liability stage).
  assertRollbackRecovery('ROLLBACK', rollback.record.recovery);

  const record: LiabilityStageRecord['failures'][number] = {
    change_id: change.envelope.id,
    package_id: packageId,
    memory_artifact_id: memory.envelope.id,
    memory_entry_ids: memory.content.entries.map((memoryEntry) => memoryEntry.id),
    transfer_outcome: 'TRANSFER_FAILURE',
    transfer_record_id: transfer.id,
    decay_signal_id: decay.id,
    failure_count: failureCountAfter,
    weight_before: weightBefore,
    weight_after: weightAfter,
    probability_before: probabilityBefore,
    probability_after: probabilityAfter,
  };

  return {
    record,
    change_id: change.envelope.id,
    package_id: packageId,
    memory,
    outcomeEvidence,
    transferRecordId: transfer.id,
    decaySignalId: decay.id,
  };
}

/** Assemble the full stage record + links. */
export function assembleLiabilityRecord(
  input: MetaEvolutionInput,
  retentions: readonly LiabilityRetention[],
): LiabilityStageRecord {
  const links = retentions.flatMap((retention) => [
    metaTraceLink({
      source: retention.memory.envelope.id,
      target: retention.change_id,
      type: 'DERIVED_FROM',
      provenance: [...input.provenance, 'meta-evolution:stage:liability', `meta-evolution:memory:${retention.memory.envelope.id}`],
    }),
    metaTraceLink({
      source: retention.outcomeEvidence.id,
      target: retention.change_id,
      type: 'OBSERVES',
      provenance: [...input.provenance, 'meta-evolution:stage:liability', `meta-evolution:evidence:${retention.outcomeEvidence.id}`],
    }),
  ]);
  const memoryEntryKinds = [
    ...new Set(retentions.flatMap((retention) => retention.memory.content.entries.map((entry) => entry.entry_kind))),
  ];
  return {
    stage: 'LIABILITY',
    input_refs: retentions.map((retention) => retention.change_id),
    output_refs: retentions.flatMap((retention) => [retention.memory.envelope.id, retention.outcomeEvidence.id, retention.package_id]),
    links,
    failures: retentions.map((retention) => retention.record),
    memory_entry_kinds: memoryEntryKinds,
  };
}

/** Deterministic digest helper (used by the record above). */
export function liabilityDigest(value: unknown): string {
  return contentHash(value);
}
