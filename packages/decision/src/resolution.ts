/**
 * RESOLUTION decisions — how an ASK, once resolved by a competent authority
 * (human or otherwise), becomes a DecisionRecord THROUGH the decision
 * package's own record machinery (Work Order W10: "an ASK resolved by a
 * human/authority decision produces a DecisionRecord via the @sos-2/decision
 * engine with provenance of who resolved it").
 *
 * The resolution record is NOT a fresh engine evaluation: the authority can
 * choose an alternative the engine's gates would not have chosen (that is
 * exactly what asking is FOR — a human may accept a high-risk action). The
 * engine's invariants bind ENGINE decisions; a resolution records the
 * AUTHORITY's decision over the SAME exact input:
 *
 *   - input_digest   : the ORIGINAL ASK record's digest — the resolution is
 *                      bound to the exact escalated input (R30
 *                      reproducibility; tampering with the binding makes
 *                      the record invalid);
 *   - rule_trace     : exactly one entry, rule RESOLUTION (a resolution
 *                      trace is distinguishable from an engine trace by
 *                      construction and by validation);
 *   - request_summary: the ORIGINAL request summary (the same decision
 *                      request, answered by authority);
 *   - resolution     : { resolved_by, alternative_id, ask_ref,
 *                      origin_decision_ref, note } — REQUIRED (iff the
 *                      resolution path);
 *   - provenance     : the caller's provenance PLUS 'resolved-by:<who>'
 *                      and 'ask:<ask id>' — the provenance of who resolved
 *                      it is part of the artifact;
 *   - action         : the CHOSEN alternative's action (any of the frozen
 *                      six EXCEPT ASK — resolving an ASK with ASK is a new
 *                      AskRequest, not a resolution).
 */

import { assertValidAskRequest, isDecisionAction } from '@sos-2/authority';
import type { AskRequestArtifact, DecisionAction } from '@sos-2/authority';
import { DecisionError } from './errors.js';
import {
  assertValidDecisionRecord,
  createDecisionRecord,
  DECISION_ENGINE_VERSION,
} from './record.js';
import type { DecisionMeta, DecisionRecord } from './record.js';

/** The input for minting a resolution decision. */
export interface ResolutionDecisionInput {
  /** The resolved AskRequest artifact (from @sos-2/authority's contract). */
  ask: AskRequestArtifact;
  /** The ORIGINATING ASK decision record (action must be ASK). */
  origin_decision: DecisionRecord;
  /** WHO resolved it (non-empty; the human/authority identity). */
  resolved_by: string;
  /** The chosen alternative id — must be one of the ask's alternatives. */
  alternative_id: string;
  /** The resolver's note (non-empty). */
  note: string;
  /** Spine discipline: provenance + created_at (+ optional envelope fields). */
  meta: DecisionMeta;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Mint the resolution DecisionRecord. Deterministic; throws DecisionError
 * on any invalid binding (a resolution that does not reference a real ask
 * alternative, an origin that is not an ASK record, an ASK-action
 * alternative, or empty identity/note).
 */
export function mintResolutionDecision(input: ResolutionDecisionInput): DecisionRecord {
  if (typeof input !== 'object' || input === null) {
    throw new DecisionError('resolution input must be an object');
  }
  assertValidAskRequest(input.ask);
  assertValidDecisionRecord(input.origin_decision);
  if (input.origin_decision.content.action !== 'ASK') {
    throw new DecisionError(
      `the origin decision must be an ASK record, received action ${JSON.stringify(input.origin_decision.content.action)} (only ASK decisions are resolved)`,
    );
  }
  if (input.origin_decision.content.escalation === null) {
    throw new DecisionError('the origin ASK record carries no escalation block — it was not minted by this engine');
  }
  const originEscalationMessage: string = input.origin_decision.content.escalation.message;
  if (!isNonEmptyString(input.resolved_by)) {
    throw new DecisionError('resolved_by must be a non-empty string — the provenance of who resolved the ask is mandatory');
  }
  if (!isNonEmptyString(input.note)) {
    throw new DecisionError('note must be a non-empty string (every resolution is auditable)');
  }
  const alternative = input.ask.content.alternatives.find((entry) => entry.id === input.alternative_id);
  if (alternative === undefined) {
    throw new DecisionError(
      `alternative_id ${JSON.stringify(input.alternative_id)} is not one of the ask's alternatives [${input.ask.content.alternatives.map((entry) => entry.id).join(', ')}]`,
    );
  }
  if (!isDecisionAction(alternative.action)) {
    throw new DecisionError(
      `the chosen alternative's action must be one of the frozen six, received: ${JSON.stringify(alternative.action)}`,
    );
  }
  if (alternative.action === 'ASK') {
    throw new DecisionError(
      'resolving an ASK with ASK is a contradiction — re-asking is modeled by enqueueing a NEW AskRequest, not by a resolution',
    );
  }

  const origin = input.origin_decision;
  const action: DecisionAction = alternative.action;
  const reason = `ask ${input.ask.envelope.id} resolved by ${input.resolved_by}: alternative "${alternative.id}" (${alternative.action}) — ${input.note} (origin ASK decision ${origin.envelope.id}: ${originEscalationMessage})`;

  const content = {
    action,
    engine_version: DECISION_ENGINE_VERSION,
    input_digest: origin.content.input_digest, // the resolution binds to the EXACT escalated input
    rule_trace: [
      {
        rule: 'RESOLUTION',
        order: 1,
        outcome: action,
        code: 'RESOLVED_BY_AUTHORITY',
        reason,
      },
    ],
    request_summary: structuredClone(origin.content.request_summary), // the SAME decision request, answered by authority
    authority: {
      ...structuredClone(origin.content.authority),
      verdict_code: 'RESOLVED_BY_AUTHORITY',
    },
    escalation: null,
    resolution: {
      resolved_by: input.resolved_by,
      alternative_id: input.alternative_id,
      ask_ref: input.ask.envelope.id,
      origin_decision_ref: origin.envelope.id,
      note: input.note,
    },
    evidence_refs: [...origin.content.evidence_refs],
    confidence: origin.content.confidence === null ? null : structuredClone(origin.content.confidence),
    reasons: [
      `decision ${action}: the authority resolved the escalated ask ${input.ask.envelope.id}`,
      reason,
    ],
  };

  // Provenance of who resolved it is part of the artifact.
  const meta: DecisionMeta = {
    ...input.meta,
    provenance: [
      ...input.meta.provenance,
      `resolved-by:${input.resolved_by}`,
      `ask:${input.ask.envelope.id}`,
    ],
  };

  // The id is derived over the creation address, which includes the
  // extended provenance — so the record id itself binds the resolver
  // identity (R30: every resolved decision is reproducible from exact
  // revisions and provenance).
  return createDecisionRecord(meta, content);
}
