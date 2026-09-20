/**
 * Brownfield stage 7 — PROMOTION / ROLLBACK (W15).
 *
 * The evidence-gated promotion decision (@sos-2/promotion
 * evaluatePromotion) over the candidate:
 *   - CURRENT authority: an AuthorityGrant minted through @sos-2/authority
 *     (scope KIND CandidateState, PROMOTE permission, TIME-bound expiry —
 *     confidence is never authorization);
 *   - CURRENT assurance: the stage-5 fixture projection (an INVALID case
 *     maps to REFUTED and the gate REJECTS — assurance-invalid candidates
 *     are never promoted);
 *   - CURRENT evidence: NONE is presented (the loop's experiment outcome is
 *     SIMULATED — simulation is evaluation infrastructure and NEVER
 *     intervention evidence; presenting it is REJECTED, pinned by negative
 *     tests), so the honest gate outcome on a healthy candidate is
 *     EXPERIMENT (run the real controlled experiment);
 *   - LIVE guardrails: the experiment evaluation's rollback triggers are
 *     wired in — a triggered ROLLBACK trigger drives the decision ROLLBACK
 *     (safety first, before every other gate);
 *   - BOUNDED RECOVERY: the recovery-control-shaped declaration
 *     (mechanism + max recovery seconds + triggers wired to the experiment)
 *     is always built and validated, and a ROLLBACK decision without a
 *     recovery declaration is a REJECTED pipeline failure
 *     (assertRollbackRecovery, pinned by negative tests).
 *
 * Links: decision record --DERIVED_FROM--> experiment result.
 */

import { evaluatePromotion } from '@sos-2/promotion';
import type { PromotionEvaluation, BoundedRecoveryDeclaration } from '@sos-2/promotion';
import { createGrant } from '@sos-2/authority';
import type { AuthorityGrantArtifact } from '@sos-2/authority';
import type { CandidateStateFixture, ExperimentArtifact, ExperimentResultRecord, ExperimentEvaluation } from '@sos-2/experiments';
import type { SystemStateArtifact } from '@sos-2/system-state';
import { BrownfieldError } from './errors.js';
import type { BrownfieldLoopInput } from './input.js';
import type { PromotionStageRecord } from './stages.js';
import { brownfieldTraceLink } from './trace.js';

/** Everything stage 7 produces. */
export interface PromotionStageOutput {
  record: PromotionStageRecord;
  grant: AuthorityGrantArtifact;
  evaluation: PromotionEvaluation;
  recovery: BoundedRecoveryDeclaration;
}

/**
 * THE ROLLBACK RECOVERY GUARD: a ROLLBACK decision must carry a bounded
 * recovery declaration (recovery-control shape). Exported for negative
 * tests and console surfacing.
 */
export function assertRollbackRecovery(decision: string, recovery: BoundedRecoveryDeclaration | null): void {
  if (decision === 'ROLLBACK' && recovery === null) {
    throw new BrownfieldError(
      'ROLLBACK_WITHOUT_RECOVERY',
      'a ROLLBACK decision without a bounded recovery declaration is rejected — every rollback declares its recovery mechanism, bound and wired triggers (spec/architecture.md section 13)',
    );
  }
}

/** Build the bounded recovery declaration wired to the experiment guardrails. */
export function buildBoundedRecovery(
  input: BrownfieldLoopInput,
  experiment: ExperimentArtifact,
  evaluation: ExperimentEvaluation,
  grantId: string,
): BoundedRecoveryDeclaration {
  return {
    mechanism: `blue-green redeploy of the recovered hypothesis revision (revert the bounded subgraph replacement of "${input.goal.target_component}")`,
    max_recovery_seconds: 300,
    containment_exception: null,
    rollback_triggers: evaluation.rollback.map((trigger) => ({ experiment_id: experiment.envelope.id, trigger })),
    authority_ref: grantId,
  };
}

/** Run the promotion/rollback stage (deterministic, pure). */
export function runPromotionStage(
  input: BrownfieldLoopInput,
  candidateState: CandidateStateFixture,
  experiment: ExperimentArtifact,
  result: ExperimentResultRecord,
  evaluation: ExperimentEvaluation,
  assuranceFixture: {
    id: string;
    claims: Array<{ id: string; statement: string }>;
    verdict: 'SATISFIED' | 'REFUTED' | 'INCOMPLETE';
    validity: { status: 'CURRENT' | 'EXPIRED' | 'SUPERSEDED' | 'VIOLATED'; expires_at: string | null; reason: string };
  },
  systemState: SystemStateArtifact,
): PromotionStageOutput {
  // 1. CURRENT authority (minted through the merged W1 authority).
  let grant: AuthorityGrantArtifact;
  try {
    grant = createGrant({
      grantee: input.authority.grantee,
      scope: { kind: 'KIND', artifact_kind: 'CandidateState' },
      permissions: [...input.authority.permissions],
      expiry: { kind: 'TIME', at: input.authority.expires_at },
      provenance: [...input.provenance, 'brownfield:promotion-authority'],
      created_at: input.now,
      authority_ref: input.authority_ref,
      status: 'ACTIVE',
    });
  } catch (cause) {
    throw new BrownfieldError('PROMOTION_EVALUATION_FAILED', `authority grant creation failed: ${(cause as Error).message}`);
  }

  // 2. The bounded recovery declaration (recovery-control shape), wired.
  const recovery = buildBoundedRecovery(input, experiment, evaluation, grant.envelope.id);

  // 3. The gate: live guardrails wired in; NO evidence presented (the only
  //    outcome evidence this loop produces is simulated — never presented
  //    as intervention evidence; the gate rejects simulated records loudly).
  let promotion: PromotionEvaluation;
  try {
    promotion = evaluatePromotion(candidateState, {
      authority: { grant, now: input.now },
      assurance: assuranceFixture,
      evidence: [],
      liveTriggers: evaluation.rollback,
      systemState: { revision: `${systemState.envelope.id}@v${systemState.envelope.version}` },
      recovery,
      provenance: [...input.provenance, 'brownfield:promotion-decision'],
      created_at: input.now,
    });
  } catch (cause) {
    throw new BrownfieldError('PROMOTION_EVALUATION_FAILED', `promotion evaluation failed: ${(cause as Error).message}`);
  }

  // THE ROLLBACK RECOVERY INVARIANT (W15): rollback declares recovery.
  assertRollbackRecovery(promotion.decision, recovery);

  const links = [
    brownfieldTraceLink({
      source: promotion.record.envelope.id,
      target: result.id,
      type: 'DERIVED_FROM',
      provenance: [...input.provenance, 'brownfield:stage:promotion', `brownfield:decision:${promotion.decision}`],
    }),
    // The authority grant CONSTRAINS the promotion decision (the decision is
    // only legitimate under the presented authority).
    brownfieldTraceLink({
      source: grant.envelope.id,
      target: promotion.record.envelope.id,
      type: 'CONSTRAINS',
      provenance: [...input.provenance, 'brownfield:stage:promotion', `brownfield:grantee:${input.authority.grantee}`],
    }),
  ];

  const record: PromotionStageRecord = {
    stage: 'PROMOTION',
    input_refs: [candidateState.envelope.id, experiment.envelope.id, result.id, assuranceFixture.id],
    output_refs: [promotion.record.envelope.id, grant.envelope.id],
    links,
    decision: promotion.decision,
    reasons: [...promotion.reasons],
    decision_artifact_id: promotion.record.envelope.id,
    authority_grant_id: grant.envelope.id,
    guardrails_tripped: evaluation.rollback.some((trigger) => trigger.kind === 'ROLLBACK' && trigger.triggered),
    recovery,
  };

  return { record, grant, evaluation: promotion, recovery };
}
