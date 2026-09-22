/**
 * ASK escalation (Work Order P6) — through @sos-2/ask's AskQueue, the
 * merged golden workflow:
 *
 *   decision engine (@sos-2/decision evaluate) -> ASK decision record
 *   -> composeAskContent (@sos-2/ask) -> createAskRequest (@sos-2/authority)
 *   -> AskQueue.enqueue (first-class entry)
 *
 * ASK IS A SUCCESS STATE (R16): escalating never throws for a valid
 * escalation; the ask lands in the queue as a first-class record and the
 * task parks (the task-graph records the pending ask — the durable
 * record status becomes AWAITING_INPUT). NEVER an exception class,
 * NEVER a silent bypass (pinned).
 *
 * Honest branch: when the decision engine does NOT decide ASK (the
 * presented grants actually cover the action), the escalation outcome is
 * NOT_ESCALATED with the engine's action — the orchestrator then treats
 * the gap as a typed retryable failure instead of inventing an ask.
 */

import { evaluate } from '@sos-2/decision';
import type { DecisionRecord, DecisionRequest } from '@sos-2/decision';
import { createAskRequest } from '@sos-2/authority';
import type { AuthorityGrantArtifact } from '@sos-2/authority';
import type { AskQueue, AskQueueEntry } from '@sos-2/ask';
import { composeAskContent } from '@sos-2/ask';
import { EscalationDecisionError } from './errors.js';
import type { TaskFailureKind } from '@sos-2/task-graph';

/** Why the orchestrator is escalating. */
export type AskEscalationReasonCode = 'AUTHORITY_GAP' | 'UNCERTAINTY' | 'CAPABILITY_UNSUPPORTED';

/** The escalation input. */
export interface AskEscalationInput {
  readonly task_id: string;
  readonly mission_ref: string;
  readonly authority_ref: string;
  readonly reason: {
    readonly code: AskEscalationReasonCode;
    /** The EXACT decision requested (non-empty). */
    readonly statement: string;
    /** WHY current authority/understanding is insufficient (non-empty). */
    readonly basis: string;
  };
  /** The grants currently held (may be empty — an authority gap). */
  readonly grants: readonly AuthorityGrantArtifact[];
  /** RFC3339 evaluation instant (caller-supplied through the injected clock). */
  readonly now: string;
  /** Provenance entries for the minted records. */
  readonly provenance: readonly string[];
}

/** The typed escalation outcome. */
export type AskEscalationOutcome =
  | {
      readonly status: 'ESCALATED';
      readonly entry: AskQueueEntry;
      readonly ask_ref: string;
      readonly decision_ref: string;
      readonly action_taken: 'ASK';
    }
  | {
      /** The engine decided the presented authority already covers the action — no ask. */
      readonly status: 'NOT_ESCALATED';
      readonly action_taken: Exclude<ReturnType<typeof evaluate>['action'], 'ASK'>;
      readonly reason: string;
    };

/** The failure kind an escalation reason maps to when NOT_ESCALATED. */
export function failureKindOf(reasonCode: AskEscalationReasonCode): TaskFailureKind {
  switch (reasonCode) {
    case 'AUTHORITY_GAP':
      return 'AUTHORITY_GAP';
    case 'CAPABILITY_UNSUPPORTED':
      return 'CAPABILITY_UNSUPPORTED';
    case 'UNCERTAINTY':
      return 'OPERATION_FAILURE';
  }
}

/**
 * Escalate an ask through the merged AskQueue (the golden workflow).
 * Never throws for a valid input — ASK is a success state.
 */
export function escalateAsk(input: AskEscalationInput, deps: { queue: AskQueue }): AskEscalationOutcome {
  if (typeof input.task_id !== 'string' || input.task_id.length === 0) {
    throw new EscalationDecisionError('escalation requires the task id');
  }
  if (typeof input.reason.statement !== 'string' || input.reason.statement.length === 0) {
    throw new EscalationDecisionError('escalation requires the EXACT decision requested (non-empty statement)');
  }
  if (typeof input.reason.basis !== 'string' || input.reason.basis.length === 0) {
    throw new EscalationDecisionError('escalation requires a non-empty basis (why current authority is insufficient)');
  }
  if (input.provenance.length === 0) {
    throw new EscalationDecisionError('escalation provenance must be non-empty (every record is auditable)');
  }

  const uncertaintyClass = input.reason.code === 'UNCERTAINTY' ? 'IRREDUCIBLE' : 'MODERATE';
  const request: DecisionRequest = {
    action_kind: 'REVISE',
    action_description: `${input.reason.statement} (task ${input.task_id} of mission ${input.mission_ref})`,
    target: { kind: 'KIND', artifact_kind: 'Mission' },
    blast_radius: 'SERVICE',
    impact: 'MODERATE',
    risk: input.reason.code === 'UNCERTAINTY' ? 'MODERATE' : 'LOW',
    reversibility: 'REVERSIBLE',
    causal_claim: false,
    uncertainty: {
      uncertainty_class: uncertaintyClass,
      basis: input.reason.basis,
    },
    rollback_signals: [],
    evidence: [],
    grants: [...input.grants],
    evaluation_point: { kind: 'TIME', now: input.now },
    explicit_authority_decision_ref: null,
    confidence: null,
  };
  const evaluation = evaluate(request, {
    provenance: [...input.provenance],
    created_at: input.now,
    authority_ref: input.authority_ref,
  });
  if (evaluation.action !== 'ASK') {
    return {
      status: 'NOT_ESCALATED',
      action_taken: evaluation.action,
      reason: `the decision engine decided ${evaluation.action} — the presented authority covers the action (rule trace: ${evaluation.rule_trace.map((entry) => entry.rule).join(' -> ')})`,
    };
  }
  const originDecision: DecisionRecord = evaluation.record;
  const ask = createAskRequest({
    content: composeAskContent({ decision: originDecision }),
    provenance: [...input.provenance, `task:${input.task_id}`],
    created_at: input.now,
    authority_ref: input.authority_ref,
  });
  const entry = deps.queue.enqueue({
    ask,
    origin_decision: originDecision,
    enqueued_at: input.now,
  });
  return {
    status: 'ESCALATED',
    entry,
    ask_ref: ask.envelope.id,
    decision_ref: originDecision.envelope.id,
    action_taken: 'ASK',
  };
}
