/**
 * The DECISION ENGINE — `evaluate(request) → DecisionRecord`
 * (Work Order W10; spec/architecture.md §5: "Decision: ACT, EXPERIMENT,
 * GATHER_EVIDENCE, ASK, REJECT or ROLLBACK"; spec/requirements.md R15/R16).
 *
 * THE RULES — explicit, deterministic, total; evaluated in a FIXED order.
 * Tie priority (documented, frozen): AUTHORITY first, then SAFETY, then
 * EVIDENCE, then UNCERTAINTY. The first rule that forces an outcome ends
 * the evaluation; every rule that RAN leaves an entry in the rule trace.
 *
 *   R0 SHAPE        a structurally invalid request (foreign vocabulary,
 *                   malformed targets, non-W3 evidence, invalid grants...)
 *                   is REJECTED — never evaluated further.
 *
 *   R1 AUTHORITY    the autonomy policy (@sos-2/autonomy
 *                   evaluateAuthorityCoverage): the required level for
 *                   (action kind, blast radius) — raised by any applicable
 *                   grant-backed raise — must be satisfied by a
 *                   currently-valid covering grant (plus the explicit
 *                   authority decision for SUPERVISED).
 *                     * a DEAD grant (EXPIRED/REVOKED)      -> REJECT
 *                       (dead authority authorizes nothing; loud)
 *                     * insufficient authority (NO_GRANT,
 *                       SCOPE_MISMATCH, PERMISSION_MISSING,
 *                       INDETERMINATE_EVALUATION)           -> ASK
 *                       (authority insufficiency — the first-class
 *                       ask-the-authority escalation, R16)
 *                     * SUPERVISED without the explicit
 *                       decision; LOW-risk profile violation -> ASK
 *                     * CONFIDENCE IS NEVER CONSULTED (locked invariant).
 *
 *   R2 SAFETY       first wired ROLLBACK signals, then the risk x
 *                   irreversibility matrix (@sos-2/autonomy
 *                   escalationOutcome):
 *                     * non-empty rollback_signals           -> ROLLBACK
 *                     * matrix escalation (high-risk/low-
 *                       reversibility corner)                -> ASK
 *                       REGARDLESS of confidence (locked invariant:
 *                       confidence alone never authorizes risky changes —
 *                       the request's confidence mark is not even read
 *                       by any rule).
 *
 *   R3 EVIDENCE     current evidence (@sos-2/evidence evaluation consumed,
 *                   never re-implemented). Subject binding follows the
 *                   request target (ARTIFACT: subject_ref must be exactly
 *                   that artifact; KIND: the subject's parsed kind must
 *                   match).
 *                     * SIMULATED records presented as evidence -> REJECT
 *                       (simulation is evaluation infrastructure, never
 *                       evidence — the @sos-2/experiments mark discipline).
 *                     * LLM-produced records never satisfy (§18).
 *                     * causal claims without ANY real interventional
 *                       record                               -> EXPERIMENT
 *                       (run a real experiment)
 *                     * interventional records exist but none is
 *                       current (SUCCESS + FRESH + subject-bound) ->
 *                       GATHER_EVIDENCE
 *                     * non-causal actions at HIGH/CRITICAL impact
 *                       without current SUCCESS evidence     -> GATHER_EVIDENCE
 *
 *   R4 UNCERTAINTY  the frozen ASK uncertainty classes:
 *                     * IRREDUCIBLE                          -> ASK
 *                       (only judgment can decide)
 *                     * HIGH                                 -> GATHER_EVIDENCE
 *                       (reduce the uncertainty first)
 *
 *   R5 ACT          every gate passed                       -> ACT
 *
 * REPRODUCIBILITY: the record carries the exact input digest (canonical
 * sha-256 of the request) and the full ordered rule trace; evaluation is a
 * pure function of (request, engine version). Re-evaluating the same input
 * yields the BYTE-IDENTICAL record (pinned by tests). The engine version
 * constant is part of the record content — a rule change is a new engine
 * version and visibly different records.
 */

import { assertValidGrant } from '@sos-2/authority';
import type { DecisionAction } from '@sos-2/authority';
import { isAskRiskSeverity, isGrantPermission, isUncertaintyClass } from '@sos-2/authority';
import { assertValidAutonomyRaise, evaluateAuthorityCoverage, escalationOutcome, isBlastRadius, isReversibilityClass } from '@sos-2/autonomy';
import type { AutonomyCoverageVerdict } from '@sos-2/autonomy';
import { validateConfidence, evaluateFreshness, validateEvidenceRecord } from '@sos-2/evidence';
import type { EvidenceRecordW3 } from '@sos-2/evidence';
import { isSimulatedRecord } from '@sos-2/experiments';
import { contentHash, parseArtifactId } from '@sos-2/semantic-spine';
import { DecisionError } from './errors.js';
import { assertValidDecisionRequest, isImpactClass } from './request.js';
import type { DecisionRequest } from './request.js';
import {
  DECISION_ENGINE_VERSION,
  createDecisionRecord,
} from './record.js';
import type {
  DecisionAuthorityTrace,
  DecisionEscalation,
  DecisionMeta,
  DecisionRecord,
  DecisionRuleTraceEntry,
} from './record.js';

export {
  DECISION_ENGINE_VERSION,
} from './record.js';

/** The full engine evaluation result. */
export interface DecisionEvaluation {
  /** Exactly one of the frozen six. */
  action: DecisionAction;
  /** The Decision-kind spine artifact recording this outcome. */
  record: DecisionRecord;
  /** The ordered rule trace (which rules fired, in order). */
  rule_trace: DecisionRuleTraceEntry[];
  /** The audit trail (non-empty). */
  reasons: string[];
  /** The structured escalation block — non-null iff action is ASK. */
  escalation: DecisionEscalation | null;
  /** The canonical input digest (R30 reproducibility anchor). */
  input_digest: string;
}

/** The engine's own escalation codes (authority insufficiency, uncertainty). */
export const DECISION_ESCALATION_CODES = [
  'AUTHORITY_INSUFFICIENT',
  'SUPERVISED_REQUIRES_EXPLICIT_DECISION',
  'LOW_RISK_PROFILE_VIOLATION',
  'RISK_IRREVERSIBILITY_ESCALATION',
  'UNCERTAINTY_IRREDUCIBLE',
] as const;

type EngineEscalationCode = (typeof DECISION_ESCALATION_CODES)[number];

function isRfc3339(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/.test(value);
}

/**
 * The safe input view: identical to decisionInputView for valid requests,
 * but tolerant of any JSON-shaped input (R0 needs an honest digest even
 * for shape-invalid requests — the digest binds the EXACT input).
 */
function safeInputView(request: DecisionRequest): Record<string, unknown> {
  const asRecord = request as unknown as Record<string, unknown>;
  return {
    action_kind: asRecord['action_kind'],
    action_description: asRecord['action_description'],
    target: asRecord['target'],
    blast_radius: asRecord['blast_radius'],
    impact: asRecord['impact'],
    risk: asRecord['risk'],
    reversibility: asRecord['reversibility'],
    causal_claim: asRecord['causal_claim'],
    uncertainty: asRecord['uncertainty'],
    rollback_signals: Array.isArray(asRecord['rollback_signals']) ? [...asRecord['rollback_signals']] : asRecord['rollback_signals'],
    evidence: Array.isArray(asRecord['evidence']) ? [...asRecord['evidence']] : asRecord['evidence'],
    grants: Array.isArray(asRecord['grants'])
      ? asRecord['grants'].map((grant) => {
          const g = grant as Record<string, unknown>;
          return { envelope: g['envelope'], content: g['content'] };
        })
      : asRecord['grants'],
    raises: Array.isArray(asRecord['raises'])
      ? asRecord['raises'].map((raise) => {
          const r = raise as Record<string, unknown>;
          return { envelope: r['envelope'], content: r['content'] };
        })
      : asRecord['raises'] === undefined || asRecord['raises'] === null
        ? []
        : asRecord['raises'],
    evaluation_point: asRecord['evaluation_point'],
    explicit_authority_decision_ref: asRecord['explicit_authority_decision_ref'],
    confidence: asRecord['confidence'] === undefined ? null : asRecord['confidence'],
  };
}

function subjectBound(record: EvidenceRecordW3, target: DecisionRequest['target']): boolean {
  if (target.kind === 'ARTIFACT') {
    return record.subject_ref === target.artifact_id;
  }
  try {
    return parseArtifactId(record.subject_ref).kind === target.artifact_kind;
  } catch {
    return false;
  }
}

interface EvidenceGateResult {
  outcome: DecisionAction | null;
  code: 'SIMULATED_EVIDENCE' | 'EVIDENCE_NOT_CURRENT' | 'NO_INTERVENTION_EVIDENCE' | 'EVIDENCE_INSUFFICIENT_FOR_IMPACT' | null;
  reasons: string[];
  satisfying: string[];
}

function evaluateEvidenceGate(request: DecisionRequest): EvidenceGateResult {
  const reasons: string[] = [];
  const satisfying: string[] = [];
  let realInterventionalConsidered = 0;
  let realCurrentConsidered = false;

  for (const entry of request.evidence) {
    if (typeof entry !== 'object' || entry === null) {
      reasons.push('a non-object entry in the evidence input was ignored');
      continue;
    }
    // Rule: the simulation mark is checked FIRST — regardless of shape
    // (the W9 promotion evidence-gate discipline; the mark is
    // @sos-2/experiments' isSimulatedRecord structural check).
    if (isSimulatedRecord(entry)) {
      const id = typeof (entry as Record<string, unknown>)['id'] === 'string' ? (entry as Record<string, unknown>)['id'] : '(no id)';
      return {
        outcome: 'REJECT',
        code: 'SIMULATED_EVIDENCE',
        reasons: [
          `evidence record ${String(id)} is marked simulated — simulation is EVALUATION infrastructure and never satisfies evidence requirements (docs/implementation/TESTING-AND-EVIDENCE.md layer-6 semantics)`,
        ],
        satisfying: [],
      };
    }
    if (!validateEvidenceRecord(entry)) {
      const id = typeof (entry as Record<string, unknown>)['id'] === 'string' ? (entry as Record<string, unknown>)['id'] : '(no id)';
      reasons.push(
        `evidence record ${String(id)} is not a well-formed W3 evidence record and was not counted (real evidence must be minted as W3 records through @sos-2/evidence first)`,
      );
      continue;
    }
    const record: EvidenceRecordW3 = entry;
    if (!subjectBound(record, request.target)) {
      reasons.push(
        `evidence record ${record.id} is about ${record.subject_ref}, not the decision target (${request.target.kind === 'ARTIFACT' ? request.target.artifact_id : request.target.artifact_kind}) — evidence must be subject-bound`,
      );
      continue;
    }
    if (record.llm_output) {
      reasons.push(
        `evidence record ${record.id} is LLM-produced (llm_output) — LLM output is never authoritative evidence or authorization (spec/architecture.md §18)`,
      );
      continue;
    }
    if (record.evidence_class === 'INTERVENTIONAL') {
      realInterventionalConsidered += 1;
    }
    if (record.availability !== 'SUCCESS') {
      reasons.push(
        `evidence record ${record.id} has availability ${record.availability} — only SUCCESS records satisfy decision evidence`,
      );
      continue;
    }
    const freshness = evaluateFreshness(record, { now: request.evaluation_point.now });
    if (freshness.status !== 'FRESH') {
      reasons.push(`evidence record ${record.id} is not current: freshness ${freshness.status} (${freshness.reason})`);
      continue;
    }
    realCurrentConsidered = true;
    satisfying.push(record.id);
    reasons.push(
      `evidence record ${record.id} is admissible: ${record.evidence_class}, SUCCESS, subject-bound to the decision target, FRESH at ${request.evaluation_point.now}`,
    );
  }

  if (request.causal_claim) {
    // Intervention evidence outranks observational correlation for strong
    // causal claims (spec §18).
    const interventionalSatisfying = request.evidence.filter(
      (record) => satisfying.includes(record.id) && record.evidence_class === 'INTERVENTIONAL',
    );
    if (interventionalSatisfying.length > 0) {
      reasons.unshift(
        `${interventionalSatisfying.length} current intervention-grade SUCCESS record(s) satisfy the causal claim's evidence requirement`,
      );
      return { outcome: null, code: null, reasons, satisfying };
    }
    if (realInterventionalConsidered === 0) {
      return {
        outcome: 'EXPERIMENT',
        code: 'NO_INTERVENTION_EVIDENCE',
        reasons: [
          ...reasons,
          'the proposal rests on a causal claim and NO real intervention-grade evidence exists — run a real experiment (a passing test suite is not equivalent to a mission outcome; spec/architecture.md §14)',
        ],
        satisfying,
      };
    }
    return {
      outcome: 'GATHER_EVIDENCE',
      code: 'EVIDENCE_NOT_CURRENT',
      reasons: [
        ...reasons,
        `${realInterventionalConsidered} real interventional record(s) were considered but none is current (SUCCESS + FRESH + subject-bound) — gather current evidence`,
      ],
      satisfying,
    };
  }

  // Non-causal: only HIGH/CRITICAL impact carries an evidence requirement.
  if (request.impact === 'HIGH' || request.impact === 'CRITICAL') {
    if (satisfying.length > 0) {
      reasons.unshift(`${satisfying.length} current SUCCESS record(s) satisfy the impact-scaled evidence requirement`);
      return { outcome: null, code: null, reasons, satisfying };
    }
    return {
      outcome: 'GATHER_EVIDENCE',
      code: 'EVIDENCE_INSUFFICIENT_FOR_IMPACT',
      reasons: [
        ...reasons,
        `impact ${request.impact} with ${realCurrentConsidered ? 'no current' : 'no'} subject-bound SUCCESS evidence — gather current evidence before acting at this impact`,
      ],
      satisfying,
    };
  }
  return { outcome: null, code: null, reasons, satisfying };
}

function authorityTraceOf(verdict: AutonomyCoverageVerdict): DecisionAuthorityTrace {
  return {
    required_level: verdict.required_level,
    effective_level: verdict.effective_level,
    verdict_code: verdict.verdict === 'PERMITTED' ? 'PERMITTED' : verdict.code,
    grant_ref: verdict.grant_ref,
    consulted_grant_refs: [...verdict.consulted_grant_refs],
    applied_raise_refs: [...verdict.applied_raise_refs],
  };
}

/**
 * Sanitize the recordable summary for shape-invalid requests: every field
 * is recorded AS-IS when it respects its frozen vocabulary, otherwise the
 * documented R0 fallback is used (the W9 '(invalid-candidate)' placeholder
 * discipline — the input digest and the R0 reason carry the truth; the
 * fallback never fabricates a decision input, it only satisfies the record
 * contract for an input that was never evaluated).
 */
function sanitizedSummary(request: DecisionRequest): {
  summary: import('./record.js').DecisionRequestSummary;
  description: string;
  confidence: import('@sos-2/evidence').Confidence | null;
} {
  const rq = request as unknown as Record<string, unknown>;
  const target = isPlainishTarget(rq['target']) ? structuredClone(rq['target']) : { kind: 'KIND', artifact_kind: '(invalid-target)' };
  const uncertainty =
    isPlainishObject(rq['uncertainty']) &&
    isUncertaintyClass((rq['uncertainty'] as Record<string, unknown>)['uncertainty_class']) &&
    typeof (rq['uncertainty'] as Record<string, unknown>)['basis'] === 'string' &&
    ((rq['uncertainty'] as Record<string, unknown>)['basis'] as string).length > 0
      ? structuredClone(rq['uncertainty'])
      : { uncertainty_class: 'LOW' as const, basis: '(invalid request — the uncertainty statement could not be trusted)' };
  const description =
    typeof rq['action_description'] === 'string' && (rq['action_description'] as string).length > 0
      ? (rq['action_description'] as string)
      : '(invalid request — shape rejected at R0)';
  const confidence = rq['confidence'] === null || rq['confidence'] === undefined ? null : validateConfidence(rq['confidence']) ? structuredClone(rq['confidence']) : null;
  return {
    summary: {
      action_kind: isGrantPermission(rq['action_kind']) ? (rq['action_kind'] as DecisionRequest['action_kind']) : 'READ',
      action_description: description,
      target: target as DecisionRequest['target'],
      blast_radius: isBlastRadius(rq['blast_radius']) ? (rq['blast_radius'] as DecisionRequest['blast_radius']) : 'COMPONENT',
      impact: isImpactClass(rq['impact']) ? (rq['impact'] as DecisionRequest['impact']) : 'LOW',
      risk: isAskRiskSeverity(rq['risk']) ? (rq['risk'] as DecisionRequest['risk']) : 'LOW',
      reversibility: isReversibilityClass(rq['reversibility'])
        ? (rq['reversibility'] as DecisionRequest['reversibility'])
        : 'REVERSIBLE',
      causal_claim: typeof rq['causal_claim'] === 'boolean' ? (rq['causal_claim'] as boolean) : false,
      uncertainty: uncertainty as unknown as DecisionRequest['uncertainty'],
    },
    description,
    confidence,
  };
}

function isPlainishObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPlainishTarget(value: unknown): boolean {
  if (!isPlainishObject(value)) {
    return false;
  }
  if (value['kind'] === 'ARTIFACT') {
    return Object.keys(value).length === 2 && typeof value['artifact_id'] === 'string' && value['artifact_id'].length > 0;
  }
  if (value['kind'] === 'KIND') {
    return Object.keys(value).length === 2 && typeof value['artifact_kind'] === 'string' && value['artifact_kind'].length > 0;
  }
  return false;
}

/**
 * Evaluate a decision request. Deterministic, total and reproducible: every
 * JSON-shaped request yields exactly one decision from the frozen six, a
 * full ordered rule trace and a Decision-kind spine artifact whose id is
 * content-addressed over (meta, content). Non-JSON input (functions,
 * symbols, ...) throws DecisionError — canonicalization itself is
 * impossible and the failure is loud.
 */
export function evaluate(request: DecisionRequest, meta: DecisionMeta): DecisionEvaluation {
  if (typeof meta !== 'object' || meta === null) {
    throw new DecisionError('decision meta must be an object { provenance, created_at, ... }');
  }

  // The exact input digest — computed BEFORE validation so even a
  // shape-invalid request binds to its exact input (R0 records it).
  let inputDigest: string;
  try {
    inputDigest = contentHash(safeInputView(request));
  } catch {
    // decisionInputView succeeded but hashing failed, or vice versa: the
    // request contains non-JSON values — fail loud.
    throw new DecisionError(
      'the decision request is not canonicalizable (it contains non-JSON values such as functions, symbols or non-finite numbers) — no exact input digest exists',
    );
  }

  const trace: DecisionRuleTraceEntry[] = [];
  const reasons: string[] = [];

  const sanitized = sanitizedSummary(request);

  const finish = (
    action: DecisionAction,
    escalation: DecisionEscalation | null,
    authority: DecisionAuthorityTrace,
    evidenceRefs: string[],
  ): DecisionEvaluation => {
    const header =
      action === 'ACT'
        ? `decision ${action}: every gate passed (authority, safety, evidence, uncertainty) for "${sanitized.description}" — the engine never consulted the request's confidence mark`
        : `decision ${action} for "${sanitized.description}"`;
    const allReasons = [header, ...reasons];
    const content = {
      action,
      engine_version: DECISION_ENGINE_VERSION,
      input_digest: inputDigest,
      rule_trace: trace.map((entry, index) => ({ ...entry, order: index + 1 })),
      request_summary: sanitized.summary,
      authority,
      escalation,
      resolution: null,
      evidence_refs: [...evidenceRefs].sort(),
      confidence: sanitized.confidence,
      reasons: allReasons,
    };
    const record = createDecisionRecord(meta, content);
    return {
      action,
      record,
      rule_trace: record.content.rule_trace,
      reasons: allReasons,
      escalation,
      input_digest: inputDigest,
    };
  };

  const emptyAuthority: DecisionAuthorityTrace = {
    required_level: 'SUPERVISED',
    effective_level: 'SUPERVISED',
    verdict_code: 'NOT_CONSULTED',
    grant_ref: null,
    consulted_grant_refs: [],
    applied_raise_refs: [],
  };

  // ---- R0 SHAPE ---------------------------------------------------------
  try {
    assertValidDecisionRequest(request);
    // Grants and raises get their full semantic validation here too — a
    // malformed grant/raise is a shape-invalid request.
    for (const grant of request.grants) {
      assertValidGrant(grant);
    }
    for (const raise of request.raises ?? []) {
      assertValidAutonomyRaise(raise);
    }
    trace.push({
      rule: 'R0_SHAPE',
      order: trace.length + 1,
      outcome: null,
      code: null,
      reason: 'request shape is valid: every vocabulary respected, evidence records well-formed W3, grants and raises well-formed',
    });
  } catch (cause) {
    reasons.push(`request shape is invalid: ${(cause as Error).message}`);
    trace.push({
      rule: 'R0_SHAPE',
      order: trace.length + 1,
      outcome: 'REJECT',
      code: 'INVALID_REQUEST_SHAPE',
      reason: `structurally invalid request — rejected before any gate was evaluated: ${(cause as Error).message}`,
    });
    return finish('REJECT', null, emptyAuthority, []);
  }

  // ---- R1 AUTHORITY (authority first) -----------------------------------
  const coverage = evaluateAuthorityCoverage({
    action_kind: request.action_kind,
    target: request.target,
    blast_radius: request.blast_radius,
    risk: request.risk,
    reversibility: request.reversibility,
    grants: [...request.grants],
    raises: [...(request.raises ?? [])],
    evaluation_point: request.evaluation_point,
    explicit_authority_decision_ref: request.explicit_authority_decision_ref,
  });
  const authority = authorityTraceOf(coverage);
  const consultedList = `grants consulted: ${coverage.consulted_grant_refs.length > 0 ? coverage.consulted_grant_refs.join(', ') : 'none'}; raises applied: ${coverage.applied_raise_refs.length > 0 ? coverage.applied_raise_refs.join(', ') : 'none'}`;

  if (coverage.verdict === 'DENIED' && (coverage.code === 'EXPIRED' || coverage.code === 'REVOKED')) {
    reasons.push(coverage.reason, consultedList);
    trace.push({
      rule: 'R1_AUTHORITY',
      order: trace.length + 1,
      outcome: 'REJECT',
      code: coverage.code,
      reason: `dead authority (${coverage.code}): ${coverage.reason}`,
    });
    return finish('REJECT', null, authority, []);
  }
  if (coverage.verdict === 'DENIED') {
    // Insufficient (but not dead) authority: the first-class ASK — the
    // competent authority may grant, broaden or decide.
    const message = `authority is insufficient for this request: ${coverage.reason} — the exact decision is escalated to the competent authority (ASK is a first-class, successful outcome; spec/requirements.md R16)`;
    reasons.push(message, consultedList);
    trace.push({
      rule: 'R1_AUTHORITY',
      order: trace.length + 1,
      outcome: 'ASK',
      code: 'AUTHORITY_INSUFFICIENT',
      reason: message,
    });
    return finish('ASK', { code: 'AUTHORITY_INSUFFICIENT', message }, authority, []);
  }
  if (coverage.verdict === 'ESCALATED') {
    const message = `${coverage.reason} — the exact decision is escalated to the competent authority (ASK is a first-class, successful outcome; spec/requirements.md R16)`;
    reasons.push(message, consultedList);
    trace.push({
      rule: 'R1_AUTHORITY',
      order: trace.length + 1,
      outcome: 'ASK',
      code: coverage.code,
      reason: message,
    });
    return finish('ASK', { code: coverage.code, message }, authority, []);
  }
  trace.push({
    rule: 'R1_AUTHORITY',
    order: trace.length + 1,
    outcome: null,
    code: 'PERMITTED',
    reason: `authority sufficient: ${coverage.reason} (${consultedList})`,
  });
  reasons.push(coverage.reason);

  // ---- R2 SAFETY (then safety) ------------------------------------------
  if (request.rollback_signals.length > 0) {
    const reason = `${request.rollback_signals.length} wired rollback signal(s) fired: ${request.rollback_signals.join('; ')} — the live change rolls back (safety outranks proceeding; spec/architecture.md §18)`;
    reasons.push(reason);
    trace.push({
      rule: 'R2_SAFETY',
      order: trace.length + 1,
      outcome: 'ROLLBACK',
      code: 'ROLLBACK_SIGNALS',
      reason,
    });
    return finish('ROLLBACK', null, authority, []);
  }
  const matrix = escalationOutcome(request.risk, request.reversibility);
  if (matrix.escalates) {
    const message = `${matrix.reason} — confidence was NOT consulted and cannot de-escalate this (spec/architecture-lock.md: confidence alone never authorizes risky changes)`;
    reasons.push(message);
    trace.push({
      rule: 'R2_SAFETY',
      order: trace.length + 1,
      outcome: 'ASK',
      code: 'RISK_IRREVERSIBILITY_ESCALATION',
      reason: message,
    });
    return finish('ASK', { code: 'RISK_IRREVERSIBILITY_ESCALATION', message }, authority, []);
  }
  trace.push({
    rule: 'R2_SAFETY',
    order: trace.length + 1,
    outcome: null,
    code: null,
    reason: `no rollback signals wired and no matrix escalation: risk ${request.risk} with reversibility ${request.reversibility}`,
  });

  // ---- R3 EVIDENCE (then evidence) ---------------------------------------
  const evidenceGate = evaluateEvidenceGate(request);
  reasons.push(...evidenceGate.reasons);
  if (evidenceGate.outcome !== null && evidenceGate.code !== null) {
    trace.push({
      rule: 'R3_EVIDENCE',
      order: trace.length + 1,
      outcome: evidenceGate.outcome,
      code: evidenceGate.code,
      reason: evidenceGate.code === 'SIMULATED_EVIDENCE'
        ? evidenceGate.reasons[0]!
        : evidenceGate.reasons[evidenceGate.reasons.length - 1]!,
    });
    const escalation: DecisionEscalation | null =
      evidenceGate.outcome === 'ASK' ? { code: evidenceGate.code, message: evidenceGate.reasons[evidenceGate.reasons.length - 1]! } : null;
    return finish(evidenceGate.outcome, escalation, authority, evidenceGate.satisfying);
  }
  trace.push({
    rule: 'R3_EVIDENCE',
    order: trace.length + 1,
    outcome: null,
    code: null,
    reason: `evidence sufficient: ${evidenceGate.satisfying.length} admissible record(s)`,
  });

  // ---- R4 UNCERTAINTY ----------------------------------------------------
  const uncertaintyClass = request.uncertainty.uncertainty_class;
  if (uncertaintyClass === 'IRREDUCIBLE') {
    const message = `uncertainty is IRREDUCIBLE (${request.uncertainty.basis}) — only judgment can decide; the exact decision is escalated to the competent authority (ASK is a first-class, successful outcome)`;
    reasons.push(message);
    trace.push({
      rule: 'R4_UNCERTAINTY',
      order: trace.length + 1,
      outcome: 'ASK',
      code: 'UNCERTAINTY_IRREDUCIBLE',
      reason: message,
    });
    return finish('ASK', { code: 'UNCERTAINTY_IRREDUCIBLE', message }, authority, evidenceGate.satisfying);
  }
  if (uncertaintyClass === 'HIGH') {
    const reason = `uncertainty is HIGH (${request.uncertainty.basis}) — reduce it before acting: gather current evidence`;
    reasons.push(reason);
    trace.push({
      rule: 'R4_UNCERTAINTY',
      order: trace.length + 1,
      outcome: 'GATHER_EVIDENCE',
      code: 'UNCERTAINTY_HIGH',
      reason,
    });
    return finish('GATHER_EVIDENCE', null, authority, evidenceGate.satisfying);
  }
  trace.push({
    rule: 'R4_UNCERTAINTY',
    order: trace.length + 1,
    outcome: null,
    code: null,
    reason: `uncertainty ${uncertaintyClass} is decisionable (${request.uncertainty.basis})`,
  });

  // ---- R5 ACT -------------------------------------------------------------
  trace.push({
    rule: 'R5_ACT',
    order: trace.length + 1,
    outcome: 'ACT',
    code: null,
    reason: 'every gate passed — act (the request\'s confidence mark was carried and recorded, never consulted)',
  });
  return finish('ACT', null, authority, evidenceGate.satisfying);
}

/**
 * Verify reproducibility: re-evaluate the request and confirm the record is
 * reproduced byte-identically (which includes the exact input digest). A
 * tampered or foreign record returns false (never throws for well-shaped
 * arguments). Non-reproducible decisions are REJECTED by this check —
 * decisions bind to their exact input and engine version.
 */
export function verifyDecision(
  request: DecisionRequest,
  meta: DecisionMeta,
  record: DecisionRecord,
): boolean {
  try {
    const expected = evaluate(request, meta);
    return JSON.stringify(expected.record) === JSON.stringify(record);
  } catch {
    return false;
  }
}
