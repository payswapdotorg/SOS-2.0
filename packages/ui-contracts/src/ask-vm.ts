/**
 * AskVM — the structured ASK view model (Work Order W11; spec/requirements.md
 * R16 first-class ASK; the W10 ASK contract).
 *
 * A pure projection joining the AskRequestArtifact (@sos-2/authority — the
 * frozen ASK content contract: exact decision, typed alternatives,
 * evidence quality, qualitative uncertainty, trade-offs, typed risk,
 * authority insufficiency) with the assembled escalation context
 * (@sos-2/ask — what the decider needs to see, including the originating
 * decision record's rule trace and the re-evaluated evidence freshness).
 *
 * ASK IS A SUCCESS STATE: the projection never treats an ask as an error;
 * it is the escalation the W10 engine deliberately produced, and the view
 * model surfaces every field a human needs to decide.
 */

import { isArtifactId } from '@sos-2/semantic-spine';
import type {
  AskAlternative,
  AskRequestArtifact,
  AskRisk,
  EvidenceQualitySummary,
  UncertaintyStatement,
} from '@sos-2/authority';
import { assertValidAskRequest } from '@sos-2/authority';
import type { AskEscalationContext, AskEvidenceSummaryRow } from '@sos-2/ask';
import type { DecisionRecord, DecisionRuleTraceEntry } from '@sos-2/decision';
import { assertValidDecisionRecord } from '@sos-2/decision';
import { UIContractError } from './errors.js';
import { assertValidRationaleChain } from './rationale.js';
import type { RationaleChain } from './rationale.js';

/** The structured ASK view model. */
export interface AskVM {
  ask_id: string;
  /** The originating ASK decision record id. */
  decision_record_ref: string;
  /** Presentation priority (the ask's risk severity). */
  priority: string;
  /** The EXACT decision requested (not a vague topic). */
  decision: string;
  /** Typed alternatives (each carries one of the 6 frozen Decision actions). */
  alternatives: AskAlternative[];
  /** Qualitative evidence quality (NONE/WEAK/MODERATE/STRONG + summary). */
  evidence_quality: EvidenceQualitySummary;
  /** Qualitative uncertainty (class + basis — never numeric without calibration). */
  uncertainty: UncertaintyStatement;
  /** The trade-offs in play. */
  trade_offs: string[];
  /** Typed risk { description, severity }. */
  risk: AskRisk;
  /** WHY current authority/autonomy is insufficient. */
  authority_insufficiency: string;
  /** Evidence summary rows with CURRENT freshness (missing is never silently fresh). */
  evidence_summary: AskEvidenceSummaryRow[];
  /** The originating decision's ordered rule trace. */
  rule_trace: DecisionRuleTraceEntry[];
  /** Upstream/downstream rationale + evidence (W11 acceptance). */
  rationale: RationaleChain;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

export interface ProjectAskInput {
  ask: AskRequestArtifact;
  /** The assembled escalation context (what the decider needs to see). */
  context: AskEscalationContext;
  /** The ORIGINATING ASK decision record. */
  decision: DecisionRecord;
  rationale: RationaleChain;
}

/** Project an ask request + escalation context onto the structured ask view model. */
export function projectAsk(input: ProjectAskInput): AskVM {
  assertValidAskRequest(input.ask);
  assertValidDecisionRecord(input.decision);
  if (input.decision.content.action !== 'ASK') {
    throw new UIContractError(
      `ask view model can only be projected from an ASK decision record, received action ${JSON.stringify(input.decision.content.action)}`,
    );
  }
  if (input.context.ask_id !== input.ask.envelope.id) {
    throw new UIContractError(
      `escalation context belongs to ask ${input.context.ask_id}, not ${input.ask.envelope.id}`,
    );
  }
  if (input.rationale.subject_id !== input.ask.envelope.id) {
    throw new UIContractError(
      `rationale chain subject ${JSON.stringify(input.rationale.subject_id)} does not match the ask id ${JSON.stringify(input.ask.envelope.id)}`,
    );
  }
  assertValidRationaleChain(input.rationale);

  const vm: AskVM = {
    ask_id: input.ask.envelope.id,
    decision_record_ref: input.decision.envelope.id,
    priority: input.context.priority,
    decision: input.ask.content.decision,
    alternatives: structuredClone(input.ask.content.alternatives),
    evidence_quality: structuredClone(input.ask.content.evidence_quality),
    uncertainty: structuredClone(input.ask.content.uncertainty),
    trade_offs: [...input.ask.content.trade_offs],
    risk: structuredClone(input.ask.content.risk),
    authority_insufficiency: input.ask.content.authority_insufficiency,
    evidence_summary: structuredClone(input.context.evidence_summary),
    rule_trace: structuredClone(input.decision.content.rule_trace),
    rationale: input.rationale,
  };
  assertValidAskVM(vm);
  return vm;
}

/** Validate an AskVM (throws UIContractError). */
export function assertValidAskVM(value: unknown): asserts value is AskVM {
  if (!isPlainObject(value)) {
    throw new UIContractError(`ask view model must be an object, received: ${JSON.stringify(value)}`);
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  const expected = new Set([
    'ask_id',
    'decision_record_ref',
    'priority',
    'decision',
    'alternatives',
    'evidence_quality',
    'uncertainty',
    'trade_offs',
    'risk',
    'authority_insufficiency',
    'evidence_summary',
    'rule_trace',
    'rationale',
  ]);
  if (keys.length !== expected.size || !keys.every((key) => expected.has(key))) {
    throw new UIContractError('ask view model must have the exact W11 field set (the full ASK contract + rule trace + rationale)');
  }
  if (!isNonEmptyString(record['ask_id']) || !isArtifactId(record['ask_id'])) {
    throw new UIContractError('ask view model ask_id must be a well-formed spine artifact id');
  }
  if (!isNonEmptyString(record['decision_record_ref']) || !isArtifactId(record['decision_record_ref'])) {
    throw new UIContractError('ask view model decision_record_ref must be a well-formed spine artifact id');
  }
  if (!isNonEmptyString(record['decision'])) {
    throw new UIContractError('ask view model decision must be a non-empty string (the EXACT decision requested)');
  }
  if (!Array.isArray(record['alternatives']) || record['alternatives'].length === 0) {
    throw new UIContractError('ask view model must carry at least one typed alternative');
  }
  for (const alternative of record['alternatives'] as AskAlternative[]) {
    if (!isPlainObject(alternative) || !isNonEmptyString(alternative.id) || !isNonEmptyString(alternative.description)) {
      throw new UIContractError('ask alternatives must be { id, action, description }');
    }
    const actions = ['ACT', 'EXPERIMENT', 'GATHER_EVIDENCE', 'ASK', 'REJECT', 'ROLLBACK'];
    if (!actions.includes(alternative.action)) {
      throw new UIContractError(
        `ask alternative action must be one of the frozen six, received: ${JSON.stringify(alternative.action)}`,
      );
    }
  }
  const quality = record['evidence_quality'];
  if (!isPlainObject(quality) || !['NONE', 'WEAK', 'MODERATE', 'STRONG'].includes((quality as Record<string, unknown>)['quality'] as string)) {
    throw new UIContractError('ask evidence_quality must carry a frozen quality class (NONE/WEAK/MODERATE/STRONG)');
  }
  const uncertainty = record['uncertainty'];
  if (
    !isPlainObject(uncertainty) ||
    !['LOW', 'MODERATE', 'HIGH', 'IRREDUCIBLE'].includes((uncertainty as Record<string, unknown>)['uncertainty_class'] as string) ||
    !isNonEmptyString((uncertainty as Record<string, unknown>)['basis'])
  ) {
    throw new UIContractError('ask uncertainty must be a qualitative class + basis (uncertainty is never dropped)');
  }
  if (!Array.isArray(record['trade_offs']) || record['trade_offs'].length === 0 || !record['trade_offs'].every(isNonEmptyString)) {
    throw new UIContractError('ask view model must carry non-empty trade-offs');
  }
  const risk = record['risk'];
  if (
    !isPlainObject(risk) ||
    Object.keys(risk).length !== 2 ||
    !isNonEmptyString((risk as Record<string, unknown>)['description']) ||
    !['LOW', 'MODERATE', 'HIGH', 'SEVERE'].includes((risk as Record<string, unknown>)['severity'] as string)
  ) {
    throw new UIContractError('ask risk must be { description, severity } with a frozen severity');
  }
  if (!isNonEmptyString(record['authority_insufficiency'])) {
    throw new UIContractError('ask view model must state WHY current authority is insufficient');
  }
  if (!Array.isArray(record['evidence_summary'])) {
    throw new UIContractError('ask evidence_summary must be an array');
  }
  if (!Array.isArray(record['rule_trace']) || record['rule_trace'].length === 0) {
    throw new UIContractError('ask view model must carry the originating decision rule trace (non-empty)');
  }
  try {
    assertValidRationaleChain(record['rationale']);
  } catch (cause) {
    throw new UIContractError(`ask view model rationale is invalid: ${(cause as Error).message}`);
  }
  const rationale = record['rationale'] as RationaleChain;
  if (rationale.subject_id !== record['ask_id']) {
    throw new UIContractError('ask view model rationale must bind this ask id');
  }
  if (rationale.evidence_refs.length === 0) {
    throw new UIContractError(
      'ask view model rationale must cite the consulted evidence (the decider must see what the escalation consulted)',
    );
  }
}

/** Predicate form of assertValidAskVM. */
export function validateAskVM(value: unknown): value is AskVM {
  try {
    assertValidAskVM(value);
    return true;
  } catch {
    return false;
  }
}
