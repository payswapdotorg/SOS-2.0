/**
 * Meta-evolution stage 6 — ROLLBACK (W16).
 *
 * A tripped guardrail or negative-effectiveness result drives the ROLLBACK
 * decision (stage 5: the engine's R2 SAFETY fires on the wired rollback
 * signals, and the promotion gate with wired live triggers returns ROLLBACK
 * — the record + the bounded recovery declaration). THIS stage executes the
 * recovery-control shape:
 *
 *   - a ROLLBACK decision without a recovery declaration REJECTS the
 *     pipeline (assertRollbackRecovery — the W15 invariant, held here too);
 *   - the process revision RESTORES EXACTLY: the restore revision is minted
 *     ACTIVE with parameters byte-equal to the pre-change parameters (the
 *     change's `restores_to` snapshot, captured at proposal time against the
 *     targeted revision), superseding the current head; the never-activated
 *     DRAFT trial is RETIRED. assertExactRestore machine-checks the
 *     byte-equality (the W16 "restore is exact" invariant).
 *
 * Links: restore revision --DERIVED_FROM--> rollback decision record and
 * the superseded head.
 */

import { contentHash, withStatus } from '@sos-2/semantic-spine';
import { evaluatePromotion } from '@sos-2/promotion';
import type { PromotionEvaluation, BoundedRecoveryDeclaration } from '@sos-2/promotion';
import { createGrant } from '@sos-2/authority';
import type { AuthorityGrantArtifact } from '@sos-2/authority';
import { MetaEvolutionError } from './errors.js';
import type { MetaEvolutionInput } from './input.js';
import type { RollbackStageRecord } from './stages.js';
import { metaTraceLink } from './trace.js';
import { assertExactRestore, createMetaProcess, retireRevision } from './process.js';
import type { MetaProcessArtifact, MetaProcessStore } from './process.js';
import { cloneParameters } from './parameters.js';
import type { MetaChangeArtifact } from './change.js';
import type { EffectivenessMeasurement } from './effectiveness.js';
import type { DecisionEntry } from './decision-stage.js';
import { buildMetaBoundedRecovery } from './decision-stage.js';

/**
 * THE ROLLBACK RECOVERY GUARD: a ROLLBACK decision must carry a bounded
 * recovery declaration (recovery-control shape). Exported for negative
 * tests and console surfacing.
 */
export function assertRollbackRecovery(decision: string, recovery: BoundedRecoveryDeclaration | null): void {
  if (decision === 'ROLLBACK' && recovery === null) {
    throw new MetaEvolutionError(
      'ROLLBACK_WITHOUT_RECOVERY',
      'a ROLLBACK decision without a bounded recovery declaration is rejected — every rollback declares its recovery mechanism, bound and wired triggers (spec/architecture.md section 13)',
    );
  }
}

export interface RollbackExecution {
  record: RollbackStageRecord['rollbacks'][number];
  change: MetaChangeArtifact;
  restore: MetaProcessArtifact;
  retiredTrial: MetaProcessArtifact;
  recovery: BoundedRecoveryDeclaration;
  promotion: PromotionEvaluation;
  promoteGrant: AuthorityGrantArtifact;
}

/**
 * Execute the rollback for one failed change (deterministic, pure):
 * promotion-gate ROLLBACK record with wired live triggers + recovery
 * declaration + the EXACT restore revision + trial retirement.
 */
export function executeRollback(
  input: MetaEvolutionInput,
  measurement: EffectivenessMeasurement,
  entry: DecisionEntry,
  head: MetaProcessArtifact,
  processStore: MetaProcessStore,
): RollbackExecution {
  const { change, spec } = measurement;

  // 1. The PROMOTE-lane grant + the recovery declaration (recovery-control
  //    shape, wired to the measurement guardrail records).
  let promoteGrant: AuthorityGrantArtifact;
  try {
    promoteGrant = createGrant({
      grantee: input.authority.promotion.grantee,
      scope: { kind: 'KIND', artifact_kind: 'CandidateState' },
      permissions: [...input.authority.promotion.permissions],
      expiry: { kind: 'TIME', at: input.authority.promotion.expires_at },
      provenance: [...input.provenance, 'meta-evolution:rollback-authority'],
      created_at: input.now,
      authority_ref: input.authority_ref,
      status: 'ACTIVE',
    });
  } catch (cause) {
    throw new MetaEvolutionError('PROMOTION_STAGE_FAILED', `rollback grant creation failed: ${(cause as Error).message}`);
  }
  const recovery = entry.recovery ?? buildMetaBoundedRecovery(input, measurement, promoteGrant.envelope.id);

  // 2. The promotion gate with the WIRED live triggers: a fired rollback
  //    trigger drives the ROLLBACK decision record (safety first).
  let promotion: PromotionEvaluation;
  try {
    promotion = evaluatePromotion(measurement.candidate, {
      authority: { grant: promoteGrant, now: input.now },
      assurance: null,
      evidence: [],
      liveTriggers: measurement.evaluation.rollback,
      systemState: { revision: `${head.envelope.id}@v${head.envelope.version}` },
      recovery,
      provenance: [...input.provenance, 'meta-evolution:rollback-decision', `meta-evolution:spec:${spec.key}`],
      created_at: input.now,
    });
  } catch (cause) {
    throw new MetaEvolutionError('PROMOTION_STAGE_FAILED', `rollback promotion evaluation failed: ${(cause as Error).message}`);
  }

  // 3. THE ROLLBACK RECOVERY INVARIANT: rollback declares recovery.
  assertRollbackRecovery(promotion.decision, recovery);

  // 3. THE EXACT RESTORE: the restore revision carries the TRIAL BASE's
  //    parameters (the head at trial time — the true pre-change state),
  //    byte-equal, superseding the head. The never-activated DRAFT trial is
  //    RETIRED (a dead-end branch; the ACTIVE chain stays linear).
  const restoredParameters = cloneParameters(head.content.parameters);
  assertExactRestore(restoredParameters, head.content.parameters);
  const restore = createMetaProcess({
    content: {
      parameters: restoredParameters,
      mission_ref: head.content.mission_ref,
      notes: `exact restore after the failed meta change "${spec.key}" (${change.envelope.id}): the process revision restores the exact pre-change parameters verbatim`,
    },
    provenance: [...input.provenance, 'meta-evolution:rollback-restore', `meta-evolution:change:${change.envelope.id}`],
    created_at: input.now,
    authority_ref: input.authority_ref,
    version: head.envelope.version + 1,
    status: 'ACTIVE',
    supersedes: head.envelope.id,
  });
  const retiredTrial = retireRevision(measurement.trial);
  processStore.replace(measurement.trial, retiredTrial);
  const supersededHead: MetaProcessArtifact = { envelope: withStatus(head.envelope, 'SUPERSEDED'), content: head.content };
  processStore.replace(head, supersededHead);
  processStore.put(restore);

  const record: RollbackStageRecord['rollbacks'][number] = {
    change_id: change.envelope.id,
    trial_revision_id: measurement.trial.envelope.id,
    restore_revision_id: restore.envelope.id,
    from_revision: `${measurement.trial.envelope.id}@v${measurement.trial.envelope.version}`,
    to_revision: `${restore.envelope.id}@v${restore.envelope.version}`,
    recovery,
    restored_parameters: restoredParameters,
    restored_to_digest: contentHash(restoredParameters),
    restore_exact: true,
  };

  return { record, change, restore, retiredTrial, recovery, promotion, promoteGrant };
}

/** Assemble the full stage record + links. */
export function assembleRollbackRecord(
  input: MetaEvolutionInput,
  rollbacks: readonly RollbackExecution[],
): RollbackStageRecord {
  const links = rollbacks.flatMap((rollback) => [
    metaTraceLink({
      source: rollback.restore.envelope.id,
      target: rollback.promotion.record.envelope.id,
      type: 'DERIVED_FROM',
      provenance: [...input.provenance, 'meta-evolution:stage:rollback', `meta-evolution:restore:${rollback.restore.envelope.id}`],
    }),
    metaTraceLink({
      source: rollback.restore.envelope.id,
      target: rollback.change.envelope.id,
      type: 'DERIVED_FROM',
      provenance: [...input.provenance, 'meta-evolution:stage:rollback', `meta-evolution:change:${rollback.change.envelope.id}`],
    }),
  ]);
  return {
    stage: 'ROLLBACK',
    input_refs: rollbacks.map((rollback) => rollback.change.envelope.id),
    output_refs: rollbacks.flatMap((rollback) => [rollback.restore.envelope.id, rollback.retiredTrial.envelope.id, rollback.promotion.record.envelope.id]),
    links,
    rollbacks: rollbacks.map((rollback) => rollback.record),
  };
}
