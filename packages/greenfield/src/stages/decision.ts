/**
 * STAGE 3 — Human decision flow (Work Order W14).
 *
 * The candidate + the reuse evidence + the uncertainty -> a DecisionRecord
 * through @sos-2/decision (the W10 engine: deterministic, total,
 * reproducible — the frozen six ACT / EXPERIMENT / GATHER_EVIDENCE / ASK /
 * REJECT / ROLLBACK per authority + risk, exactly as the W10 rule order
 * R0 SHAPE -> R1 AUTHORITY -> R2 SAFETY -> R3 EVIDENCE -> R4 UNCERTAINTY
 * -> R5 ACT decides). The greenfield orchestrator NEVER bypasses the
 * engine: it presents the typed request (the mission's risk profile, the
 * candidate target, the reuse evidence, the world's grants) and records
 * the outcome.
 *
 * When the outcome is ASK (the first-class ask-the-authority state, R16),
 * the stage produces the structured AskRequest through @sos-2/ask
 * (composeAskContent over the escalation) + @sos-2/authority's
 * createAskRequest contract, enqueues it in the AskQueue (deduplicated by
 * the origin's exact input digest) and — when a human decider is supplied
 * — resolves it through the queue (the resolution DecisionRecord carries
 * the provenance of who resolved it and binds to the origin's exact input
 * digest). ASK IS A SUCCESS STATE: enqueueing a valid ask never throws.
 *
 * The candidate is APPROVED iff the engine acted (ACT) directly, or the
 * ask was resolved by an ACT-action alternative. Every other outcome
 * leaves the candidate unapproved — and stage 4 refuses to realize an
 * unapproved candidate (bypassing authority is rejected, loudly).
 */

import { createAskRequest } from '@sos-2/authority';
import type { AskRequestArtifact, DecisionAction } from '@sos-2/authority';
import { composeAskContent } from '@sos-2/ask';
import { AskQueue } from '@sos-2/ask';
import type { AskQueueEntry } from '@sos-2/ask';
import { evaluate } from '@sos-2/decision';
import type { DecisionEvaluation, DecisionRecord, DecisionRequest } from '@sos-2/decision';
import { decisionInputDigest } from '@sos-2/decision';
import { createTraceLink } from '@sos-2/semantic-spine';
import type { TraceLink } from '@sos-2/semantic-spine';
import type {
  GreenfieldAskDecider,
  GreenfieldRiskProfile,
  GreenfieldRunContext,
  GreenfieldWorld,
} from '../context.js';
import { GreenfieldError } from '../errors.js';
import type { CandidateStageRecord } from './candidate.js';
import type { MissionStageRecord } from './mission.js';

/** The typed stage record of the human decision flow (plain JSON, spine-traceable). */
export interface DecisionStageRecord {
  stage: 'HUMAN_DECISION_FLOW';
  /** A serializable view of the exact decision request (the digest binds the full input). */
  request_view: {
    action_kind: DecisionRequest['action_kind'];
    action_description: string;
    target: DecisionRequest['target'];
    blast_radius: DecisionRequest['blast_radius'];
    impact: DecisionRequest['impact'];
    risk: DecisionRequest['risk'];
    reversibility: DecisionRequest['reversibility'];
    causal_claim: boolean;
    uncertainty: DecisionRequest['uncertainty'];
    evaluation_point: DecisionRequest['evaluation_point'];
    evidence_ids: string[];
    grant_ids: string[];
  };
  /** The exact input digest (R30 reproducibility anchor). */
  input_digest: string;
  /** The engine outcome — exactly one of the frozen six. */
  action: DecisionAction;
  /** The DecisionRecord (a Decision-kind spine artifact). */
  record: DecisionRecord;
  /** The structured AskRequest (non-null iff the outcome is ASK). */
  ask: AskRequestArtifact | null;
  /** The ask queue entry id (non-null iff the outcome is ASK). */
  queue_entry_id: string | null;
  /** The resolution DecisionRecord (non-null iff an ask was resolved through the queue). */
  resolution: DecisionRecord | null;
  /** Whether the candidate is approved for realization. */
  approved: boolean;
  /**
   * The stage's trace links: the decision record SUPPORTS the candidate;
   * on the ASK path the AskRequest is DERIVED_FROM the originating
   * decision and the resolution SUPPORTS the candidate.
   */
  links: TraceLink[];
}

export interface DecisionStageInput {
  mission_stage: MissionStageRecord;
  candidate_stage: CandidateStageRecord;
  world: GreenfieldWorld;
  run: GreenfieldRunContext;
  risk: GreenfieldRiskProfile;
  /** The human decider (used iff the engine escalates to ASK). */
  decider?: GreenfieldAskDecider | null;
}

/** Run the human decision flow stage. Deterministic and pure. */
export function runDecisionStage(input: DecisionStageInput): DecisionStageRecord {
  const { mission_stage, candidate_stage, world, run, risk } = input;
  const candidate = candidate_stage.candidate;
  const mission = mission_stage.mission;

  const request: DecisionRequest = {
    action_kind: 'PROMOTE',
    action_description:
      `Realize the greenfield candidate composition ${candidate.envelope.id} ` +
      `(capability ${JSON.stringify(candidate_stage.capability)}) for mission ${mission.envelope.id}`,
    target: { kind: 'ARTIFACT', artifact_id: candidate.envelope.id },
    blast_radius: risk.blast_radius,
    impact: risk.impact,
    risk: risk.risk,
    reversibility: risk.reversibility,
    causal_claim: risk.causal_claim,
    uncertainty: { uncertainty_class: risk.uncertainty_class, basis: risk.uncertainty_basis },
    rollback_signals: [],
    evidence: candidate_stage.evidence,
    grants: [...world.grants],
    evaluation_point: { kind: 'TIME', now: run.t_decision },
    explicit_authority_decision_ref: null,
    confidence: null,
  };

  let evaluation: DecisionEvaluation;
  try {
    evaluation = evaluate(request, {
      provenance: [...run.provenance, 'W14:greenfield:decision-flow'],
      created_at: run.t_decision,
      status: 'ACTIVE',
    });
  } catch (cause) {
    throw new GreenfieldError(`the decision engine rejected the request shape: ${(cause as Error).message}`, {
      cause,
    });
  }

  const inputDigest = decisionInputDigest(request);
  const stageProvenance = [...run.provenance, 'W14:greenfield:decision-flow'];
  const links: TraceLink[] = [
    createTraceLink({
      source: evaluation.record.envelope.id,
      target: candidate.envelope.id,
      type: 'SUPPORTS',
      provenance: [...stageProvenance],
    }),
  ];

  let ask: AskRequestArtifact | null = null;
  let queueEntryId: string | null = null;
  let resolution: DecisionRecord | null = null;
  let approved = evaluation.action === 'ACT';

  if (evaluation.action === 'ASK') {
    // The first-class ask-the-authority outcome (R16): compose the
    // structured AskRequest through @sos-2/ask over @sos-2/authority's
    // frozen contract, enqueue it (deduplicated by the origin's exact
    // input digest), and resolve it when a human decider is supplied.
    const askContent = composeAskContent({
      decision: evaluation.record,
      evidence: candidate_stage.evidence,
    });
    ask = createAskRequest({
      content: askContent,
      provenance: [...stageProvenance, 'ask:compose-escalation'],
      created_at: run.t_ask,
      status: 'ACTIVE',
      authority_ref: mission.envelope.id,
    });
    links.push(
      createTraceLink({
        source: ask.envelope.id,
        target: evaluation.record.envelope.id,
        type: 'DERIVED_FROM',
        provenance: [...stageProvenance],
      }),
    );

    const queue = new AskQueue();
    const entry: AskQueueEntry = queue.enqueue({
      ask,
      origin_decision: evaluation.record,
      enqueued_at: run.t_ask,
    });
    queueEntryId = entry.id;

    if (input.decider !== undefined && input.decider !== null) {
      const alternativeId =
        input.decider.chosen_alternative_id ??
        ask.content.alternatives.find((alternative) => alternative.action === 'ACT')?.id ??
        ask.content.alternatives[0]!.id;
      const chosen = ask.content.alternatives.find((alternative) => alternative.id === alternativeId);
      if (chosen === undefined) {
        throw new GreenfieldError(
          `the decider chose alternative ${JSON.stringify(alternativeId)}, which is not one of the ask's alternatives ` +
            `(${ask.content.alternatives.map((alternative) => alternative.id).join(', ')})`,
        );
      }
      resolution = queue.resolve(entry.id, {
        resolved_by: input.decider.resolved_by,
        chosen_alternative_id: alternativeId,
        note: input.decider.note,
        provenance: [...stageProvenance, `resolved-by:${input.decider.resolved_by}`],
        created_at: run.t_ask,
        authority_ref: mission.envelope.id,
      });
      links.push(
        createTraceLink({
          source: resolution.envelope.id,
          target: candidate.envelope.id,
          type: 'SUPPORTS',
          provenance: [...stageProvenance],
        }),
      );
      approved = resolution.content.action === 'ACT';
    }
  }

  return {
    stage: 'HUMAN_DECISION_FLOW',
    request_view: {
      action_kind: request.action_kind,
      action_description: request.action_description,
      target: request.target,
      blast_radius: request.blast_radius,
      impact: request.impact,
      risk: request.risk,
      reversibility: request.reversibility,
      causal_claim: request.causal_claim,
      uncertainty: request.uncertainty,
      evaluation_point: request.evaluation_point,
      evidence_ids: candidate_stage.evidence.map((record) => record.id),
      grant_ids: world.grants.map((grant) => grant.envelope.id),
    },
    input_digest: inputDigest,
    action: evaluation.action,
    record: evaluation.record,
    ask,
    queue_entry_id: queueEntryId,
    resolution,
    approved,
    links,
  };
}
