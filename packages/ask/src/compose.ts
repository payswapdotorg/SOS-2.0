/**
 * ASK CONTENT COMPOSITION — deriving the AskContent for an ASK decision
 * record (the deterministic defaults a caller can always override).
 *
 * The AskRequest CONTRACT is @sos-2/authority's (ask.ts) — consumed through
 * createAskRequest/validateAskContent, never redefined. This module derives
 * the CONTENT fields from the originating ASK decision record:
 *
 *   - decision               : the EXACT decision requested — composed from
 *                              the decision record's request summary
 *   - alternatives           : TYPED alternatives — the documented default
 *                              set for the escalation code (each carries one
 *                              of the 6 frozen Decision actions);
 *                              caller-overridable
 *   - evidence_quality       : derived from the decision's evidence refs
 *                              (NONE / WEAK / MODERATE / STRONG, the frozen
 *                              qualitative classes); caller-overridable
 *   - uncertainty            : the request's uncertainty statement (the
 *                              frozen ASK contract classes)
 *   - trade_offs             : deterministic defaults from the risk/impact
 *                              profile; caller-overridable
 *   - risk                   : the request's risk severity + a composed
 *                              description
 *   - authority_insufficiency: the decision record's escalation message —
 *                              WHY current authority (or autonomy) is
 *                              insufficient
 *
 * ASK IS A SUCCESS STATE: composing ask content from a valid ASK record
 * never throws; the result validates against the authority contract.
 */

import {
  EVIDENCE_QUALITY_CLASSES,
  isAskRiskSeverity,
} from '@sos-2/authority';
import type {
  AskAlternative,
  AskContent,
  AskRiskSeverity,
  DecisionAction,
  EvidenceQualityClass,
  EvidenceQualitySummary,
} from '@sos-2/authority';
import type { EvidenceRecordW3 } from '@sos-2/evidence';
import { AskError } from './errors.js';
import { assertValidDecisionRecord } from '@sos-2/decision';
import type { DecisionRecord } from '@sos-2/decision';

/** The documented default alternative sets, keyed by the decision engine's escalation codes. */
export const DEFAULT_ALTERNATIVES: Readonly<Record<string, readonly AskAlternative[]>> = {
  AUTHORITY_INSUFFICIENT: [
    { id: 'act-under-granted-authority', action: 'ACT', description: 'Proceed with the action under an explicit grant covering it.' },
    { id: 'experiment-first', action: 'EXPERIMENT', description: 'Run a controlled experiment before the action.' },
    { id: 'reject', action: 'REJECT', description: 'Refuse the action.' },
  ],
  SUPERVISED_REQUIRES_EXPLICIT_DECISION: [
    { id: 'approve-action', action: 'ACT', description: 'Approve this specific execution of the action.' },
    { id: 'experiment-first', action: 'EXPERIMENT', description: 'Run a controlled experiment instead.' },
    { id: 'reject', action: 'REJECT', description: 'Refuse the action.' },
  ],
  LOW_RISK_PROFILE_VIOLATION: [
    { id: 'proceed-anyway', action: 'ACT', description: 'Proceed despite the risk profile leaving the autonomous-safe region.' },
    { id: 'experiment-first', action: 'EXPERIMENT', description: 'Run a controlled experiment first.' },
    { id: 'reject', action: 'REJECT', description: 'Refuse the action.' },
  ],
  RISK_IRREVERSIBILITY_ESCALATION: [
    { id: 'proceed-under-authority', action: 'ACT', description: 'Accept the high-risk/low-reversibility action under explicit authority.' },
    { id: 'experiment-first', action: 'EXPERIMENT', description: 'Run a controlled experiment to reduce the risk first.' },
    { id: 'rollback', action: 'ROLLBACK', description: 'Roll the live change back.' },
    { id: 'reject', action: 'REJECT', description: 'Refuse the action.' },
  ],
  UNCERTAINTY_IRREDUCIBLE: [
    { id: 'act-on-judgment', action: 'ACT', description: 'Proceed on explicit judgment despite irreducible uncertainty.' },
    { id: 'gather-evidence', action: 'GATHER_EVIDENCE', description: 'Try to reduce the uncertainty anyway.' },
    { id: 'reject', action: 'REJECT', description: 'Refuse the action.' },
  ],
};

/** The fallback alternative set for an unrecognized escalation code. */
const FALLBACK_ALTERNATIVES: readonly AskAlternative[] = [
  { id: 'act-under-authority', action: 'ACT', description: 'Proceed with the action under explicit authority.' },
  { id: 'reject', action: 'REJECT', description: 'Refuse the action.' },
];

/** The documented default alternatives for an escalation code. */
export function defaultAlternativesFor(escalationCode: string): AskAlternative[] {
  const set = DEFAULT_ALTERNATIVES[escalationCode];
  if (set === undefined) {
    return FALLBACK_ALTERNATIVES.map((alternative) => ({ ...alternative }));
  }
  return set.map((alternative) => ({ ...alternative }));
}

/**
 * Derive the qualitative evidence quality for a decision's evidence refs.
 * Deterministic:
 *   - no evidence refs                                  -> NONE
 *   - matching records supplied:
 *       any SUCCESS + calibrated/STRONG confidence      -> STRONG
 *       else any SUCCESS                                -> MODERATE
 *       only non-SUCCESS                                -> WEAK
 *   - refs present but records not supplied             -> MODERATE
 *     (the evidence satisfied the engine's gate; the class is unknown —
 *     never inflated to STRONG, never deflated to NONE)
 */
export function deriveEvidenceQuality(
  evidenceRefs: readonly string[],
  evidence: readonly EvidenceRecordW3[],
): EvidenceQualityClass {
  if (evidenceRefs.length === 0) {
    return 'NONE';
  }
  const matching = evidence.filter((record) => evidenceRefs.includes(record.id));
  if (matching.length === 0) {
    return 'MODERATE';
  }
  const successes = matching.filter((record) => record.availability === 'SUCCESS');
  if (successes.length === 0) {
    return 'WEAK';
  }
  const strong = successes.some(
    (record) => record.confidence.kind === 'CALIBRATED' || (record.confidence.kind === 'QUALITATIVE' && record.confidence.uncertainty_class === 'STRONG'),
  );
  return strong ? 'STRONG' : 'MODERATE';
}

export interface ComposeAskOverrides {
  /** Typed alternatives replacing the default set for the escalation code. */
  alternatives?: AskAlternative[];
  /** A trade-offs list replacing the derived defaults. */
  trade_offs?: string[];
  /** An evidence-quality summary replacing the derived one. */
  evidence_quality?: EvidenceQualitySummary;
}

export interface ComposeAskInput {
  /** The ORIGINATING ASK decision record (action must be ASK). */
  decision: DecisionRecord;
  /** The evidence records matching the decision's evidence_refs (optional; for quality derivation). */
  evidence?: readonly EvidenceRecordW3[];
  /** Overrides for the derived defaults. */
  overrides?: ComposeAskOverrides;
}

/** Compose the AskContent for an ASK decision record (deterministic). */
export function composeAskContent(input: ComposeAskInput): AskContent {
  assertValidDecisionRecord(input.decision);
  const decision = input.decision;
  if (decision.content.action !== 'ASK' || decision.content.escalation === null) {
    throw new AskError(
      `ask content can only be composed from an ASK decision record with an escalation block, received action ${JSON.stringify(decision.content.action)}`,
    );
  }
  const summary = decision.content.request_summary;
  const evidenceRefs = decision.content.evidence_refs;
  const qualityClass = deriveEvidenceQuality(evidenceRefs, input.evidence ?? []);

  const alternatives =
    input.overrides?.alternatives ?? defaultAlternativesFor(decision.content.escalation.code);
  const evidenceQuality: EvidenceQualitySummary =
    input.overrides?.evidence_quality ?? {
      quality: qualityClass,
      summary:
        evidenceRefs.length === 0
          ? 'no admissible evidence backed the escalated decision request'
          : `${evidenceRefs.length} admissible evidence record(s) backed the escalated decision request (quality ${qualityClass})`,
    };
  const tradeOffs =
    input.overrides?.trade_offs ?? [
      `risk ${summary.risk} vs reversibility ${summary.reversibility}`,
      `impact ${summary.impact} vs evidence quality ${qualityClass}`,
      `required autonomy ${decision.content.authority.required_level} vs presented authority ${decision.content.authority.verdict_code}`,
    ];

  return {
    decision:
      `Decide the escalated action: ${summary.action_description} ` +
      `(action ${summary.action_kind}, blast radius ${summary.blast_radius}, risk ${summary.risk}, reversibility ${summary.reversibility}, input digest ${decision.content.input_digest}).`,
    alternatives,
    evidence_quality: evidenceQuality,
    uncertainty: summary.uncertainty,
    trade_offs: tradeOffs.length > 0 ? tradeOffs : ['the default trade-offs apply'],
    risk: {
      description:
        `The proposed action carries ${summary.risk} risk with ${summary.reversibility} reversibility at blast radius ${summary.blast_radius} and impact ${summary.impact}.`,
      severity: (isAskRiskSeverity(summary.risk) ? summary.risk : 'LOW') as AskRiskSeverity,
    },
    authority_insufficiency: decision.content.escalation.message,
  };
}

/** All escalation codes with documented default alternative sets (audit helper). */
export function documentedEscalationCodes(): string[] {
  return Object.keys(DEFAULT_ALTERNATIVES);
}

/** Re-export for callers: the frozen evidence-quality classes (authority owns the vocabulary). */
export { EVIDENCE_QUALITY_CLASSES };

export type { DecisionAction };
