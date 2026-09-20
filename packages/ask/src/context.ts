/**
 * ESCALATION CONTEXT ASSEMBLY — everything a decider needs to see
 * (Work Order W10: "escalation context assembly (what the decider needs to
 * see: the decision request + alternatives + evidence summary + uncertainty
 * + risk)").
 *
 * The context joins the AskRequest artifact (what is being asked) with the
 * ORIGINATING ASK decision record (why it escalated, what was consulted)
 * and the evidence records (with their CURRENT freshness at the
 * presentation instant — re-evaluated through @sos-2/evidence's
 * evaluateFreshness, never cached).
 *
 * Truthful distinct states: an evidence ref whose record is NOT supplied is
 * reported as `provided: false` with `freshness: null` — missing is never
 * silently fresh, and never silently stale either.
 */

import { assertValidAskRequest } from '@sos-2/authority';
import type { AskAlternative, AskRequestArtifact, AskRiskSeverity, UncertaintyStatement } from '@sos-2/authority';
import { evaluateFreshness } from '@sos-2/evidence';
import type { EvidenceRecordW3, FreshnessStatus } from '@sos-2/evidence';
import { RFC3339_PATTERN } from '@sos-2/semantic-spine';
import { assertValidDecisionRecord } from '@sos-2/decision';
import type { DecisionRecord, DecisionRuleTraceEntry } from '@sos-2/decision';
import { AskError } from './errors.js';

/** The queue/presentation priority: the ask's risk severity (consumed vocabulary). */
export function askPriorityOf(ask: AskRequestArtifact): AskRiskSeverity {
  return ask.content.risk.severity;
}

/** One evidence summary row — what the decider sees about the evidence. */
export interface AskEvidenceSummaryRow {
  /** The evidence record's spine id (from the decision's evidence_refs). */
  ref: string;
  /** Was the record supplied to the context assembly? (missing is never silently fresh or stale) */
  provided: boolean;
  availability: string | null;
  evidence_class: string | null;
  freshness: FreshnessStatus | null;
  freshness_reason: string | null;
}

/** The full escalation context — what the decider needs to see. */
export interface AskEscalationContext {
  /** The AskRequest artifact id. */
  ask_id: string;
  /** The originating ASK decision record id. */
  decision_record_ref: string;
  /** The origin decision's exact input digest (the R30 binding). */
  origin_input_digest: string;
  /** Presentation priority (the ask's risk severity). */
  priority: AskRiskSeverity;
  /** The decision request (the risk/impact profile snapshot of what was decided). */
  decision_request: {
    action_kind: string;
    action_description: string;
    target_kind: string;
    target: string;
    blast_radius: string;
    impact: string;
    risk: string;
    reversibility: string;
    causal_claim: boolean;
  };
  /** The typed alternatives the decider chooses among. */
  alternatives: AskAlternative[];
  /** The evidence summary (freshness re-evaluated at the presentation instant). */
  evidence_summary: AskEvidenceSummaryRow[];
  /** The qualitative evidence-quality class from the ask contract. */
  evidence_quality: string;
  /** The uncertainty statement. */
  uncertainty: UncertaintyStatement;
  /** The typed risk. */
  risk: { description: string; severity: string };
  /** WHY current authority/autonomy is insufficient. */
  authority_insufficiency: string;
  /** The originating decision's rule trace (which rules fired, in order). */
  rule_trace: DecisionRuleTraceEntry[];
  /** The consulted authority trace (levels, grants, raises). */
  authority: DecisionRecord['content']['authority'];
}

export interface AssembleContextInput {
  ask: AskRequestArtifact;
  /** The ORIGINATING ASK decision record (action must be ASK). */
  decision: DecisionRecord;
  /** Evidence records for the decision's evidence_refs (optional; missing ones are reported truthfully). */
  evidence?: readonly EvidenceRecordW3[];
  /** RFC3339 presentation instant (no hidden clocks). */
  now: string;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Assemble the escalation context for a decider. Deterministic; throws
 * AskError only on invalid operations (a non-ASK origin, a malformed ask,
 * a malformed `now`) — assembling a context for a valid ask never fails.
 */
export function assembleEscalationContext(input: AssembleContextInput): AskEscalationContext {
  assertValidAskRequest(input.ask);
  assertValidDecisionRecord(input.decision);
  if (input.decision.content.action !== 'ASK' || input.decision.content.escalation === null) {
    throw new AskError(
      `an escalation context can only be assembled from an ASK decision record, received action ${JSON.stringify(input.decision.content.action)}`,
    );
  }
  if (!isNonEmptyString(input.now) || !RFC3339_PATTERN.test(input.now)) {
    throw new AskError(`context assembly requires an RFC3339 presentation instant, received: ${JSON.stringify(input.now)}`);
  }

  const decision = input.decision;
  const summary = decision.content.request_summary;
  const evidence = input.evidence ?? [];

  const evidenceSummary: AskEvidenceSummaryRow[] = decision.content.evidence_refs.map((ref) => {
    const record = evidence.find((candidate) => candidate.id === ref);
    if (record === undefined) {
      return { ref, provided: false, availability: null, evidence_class: null, freshness: null, freshness_reason: null };
    }
    const freshness = evaluateFreshness(record, { now: input.now });
    return {
      ref,
      provided: true,
      availability: record.availability,
      evidence_class: record.evidence_class,
      freshness: freshness.status,
      freshness_reason: freshness.reason,
    };
  });

  const target =
    summary.target.kind === 'ARTIFACT' ? summary.target.artifact_id : summary.target.artifact_kind;

  return {
    ask_id: input.ask.envelope.id,
    decision_record_ref: decision.envelope.id,
    origin_input_digest: decision.content.input_digest,
    priority: askPriorityOf(input.ask),
    decision_request: {
      action_kind: summary.action_kind,
      action_description: summary.action_description,
      target_kind: summary.target.kind,
      target,
      blast_radius: summary.blast_radius,
      impact: summary.impact,
      risk: summary.risk,
      reversibility: summary.reversibility,
      causal_claim: summary.causal_claim,
    },
    alternatives: input.ask.content.alternatives.map((alternative) => ({ ...alternative })),
    evidence_summary: evidenceSummary,
    evidence_quality: input.ask.content.evidence_quality.quality,
    uncertainty: input.ask.content.uncertainty,
    risk: { ...input.ask.content.risk },
    authority_insufficiency: input.ask.content.authority_insufficiency,
    rule_trace: decision.content.rule_trace.map((entry) => ({ ...entry })),
    authority: { ...decision.content.authority },
  };
}
