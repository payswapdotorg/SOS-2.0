/**
 * The DECISION REQUEST — the typed input of the decision engine
 * (Work Order W10: "Decision inputs: typed request (proposed action,
 * evidence set, authority grants, uncertainty, impact, risk, reversibility,
 * blast radius)").
 *
 * Every vocabulary is CONSUMED from its owning authority — nothing here is
 * redefined:
 *   - action kind      : @sos-2/authority GRANT_PERMISSIONS (the frozen
 *                        authority-relevant act vocabulary)
 *   - authorization
 *     target           : @sos-2/authority AuthorizationTarget
 *   - risk severity    : @sos-2/authority ASK_RISK_SEVERITIES (LOW, MODERATE,
 *                        HIGH, SEVERE)
 *   - uncertainty      : @sos-2/authority's AskRequest UncertaintyStatement
 *                        (uncertainty_class LOW/MODERATE/HIGH/IRREDUCIBLE +
 *                        non-empty basis — the frozen ASK contract classes)
 *   - blast radius /
 *     reversibility    : @sos-2/autonomy's frozen vocabularies
 *   - impact           : this package's own small typed ladder
 *                        (LOW, MODERATE, HIGH, CRITICAL) — a decision-input
 *                        dimension, recorded and shown to the decider
 *   - evidence         : @sos-2/evidence EvidenceRecordW3 (the merged W3
 *                        records — freshness and classes are evaluated by
 *                        the engine through @sos-2/evidence's own exports)
 *   - grants / raises  : @sos-2/authority AuthorityGrantArtifact and
 *                        @sos-2/autonomy AutonomyRaiseArtifact
 *
 * CONFIDENCE (spec/meta-model.md; spec/architecture.md §18): the request
 * MAY carry an optional confidence mark (@sos-2/evidence's Confidence
 * contract — CALIBRATED only with a calibration artifact ref). It is
 * included in the input digest (it IS part of the exact input) and
 * RECORDED in the decision record — but NO rule ever consults it
 * (the W9 discipline: "carried, displayed and NEVER consulted for
 * authorization"). Confidence alone never authorizes anything; the
 * engine's tests pin that a high-confidence request still escalates in the
 * high-risk/low-reversibility corner.
 *
 * The evaluation point is TIME-based (RFC3339 `now`, caller-supplied — no
 * hidden clocks): grant validity, raise validity and evidence freshness
 * are all evaluated at the same instant. A revision-bound grant presented
 * at a time point is INDETERMINATE and escalates to ASK (the W9 mapping).
 */

import { isAskRiskSeverity, isGrantPermission, isUncertaintyClass } from '@sos-2/authority';
import type {
  AuthorityGrantArtifact,
  AuthorizationTarget,
  GrantPermission,
  UncertaintyStatement,
} from '@sos-2/authority';
import { isBlastRadius, isReversibilityClass } from '@sos-2/autonomy';
import type { AutonomyRaiseArtifact, BlastRadius, ReversibilityClass } from '@sos-2/autonomy';
import { assertValidConfidence } from '@sos-2/evidence';
import type { Confidence, EvidenceRecordW3 } from '@sos-2/evidence';
import { isArtifactId, RFC3339_PATTERN, contentHash } from '@sos-2/semantic-spine';
import { DecisionError } from './errors.js';

/** This package's impact ladder (a decision-input dimension, not a core identifier). */
export const IMPACT_CLASSES = ['LOW', 'MODERATE', 'HIGH', 'CRITICAL'] as const;

export type ImpactClass = (typeof IMPACT_CLASSES)[number];

const IMPACT_SET: ReadonlySet<string> = new Set(IMPACT_CLASSES);

/** Structural check: is this one of the frozen impact classes? */
export function isImpactClass(value: unknown): value is ImpactClass {
  return typeof value === 'string' && IMPACT_SET.has(value);
}

/** The typed decision request (see module doc for every field's authority). */
export interface DecisionRequest {
  /** The proposed action (frozen authority permission). */
  action_kind: GrantPermission;
  /** What the actor proposes to do (non-empty; the decision's subject). */
  action_description: string;
  /** What the action operates on. */
  target: AuthorizationTarget;
  blast_radius: BlastRadius;
  impact: ImpactClass;
  risk: 'LOW' | 'MODERATE' | 'HIGH' | 'SEVERE';
  reversibility: ReversibilityClass;
  /** Does the proposal rest on a causal claim (intervention-grade evidence required)? */
  causal_claim: boolean;
  /** The calibrated-uncertainty statement (frozen ASK contract classes). */
  uncertainty: UncertaintyStatement;
  /** Wired rollback signals (non-empty entries; a non-empty array forces ROLLBACK). */
  rollback_signals: string[];
  /** The evidence set consulted (W3 records; may be empty). */
  evidence: readonly EvidenceRecordW3[];
  /** The authority grants presented (may be empty). */
  grants: readonly AuthorityGrantArtifact[];
  /** The governed autonomy raises presented (may be empty/omitted). */
  raises?: readonly AutonomyRaiseArtifact[];
  /** RFC3339 instant: grants, raises and evidence freshness are evaluated here. */
  evaluation_point: { kind: 'TIME'; now: string };
  /**
   * Spine id of the EXPLICIT authority decision for this specific request
   * (what a SUPERVISED level needs), or null.
   */
  explicit_authority_decision_ref: string | null;
  /** Optional confidence mark: CARRIED, DIGESTED, RECORDED — never consulted. */
  confidence: Confidence | null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Validate the decision request SHAPE (throws DecisionError). A request
 * with an invalid shape is evaluated by the engine's R0 rule into a REJECT
 * decision (never thrown from evaluate()); this validator is the shared
 * structural authority for R0 and for callers constructing requests.
 */
export function assertValidDecisionRequest(request: DecisionRequest): void {
  if (!isPlainObject(request)) {
    throw new DecisionError(`decision request must be an object, received: ${JSON.stringify(request)}`);
  }
  if (!isGrantPermission(request.action_kind)) {
    throw new DecisionError(
      `action_kind must be one of the frozen authority permissions [READ, REVISE, RETIRE, PROMOTE, DELEGATE], received: ${JSON.stringify(request.action_kind)}`,
    );
  }
  if (!isNonEmptyString(request.action_description)) {
    throw new DecisionError(`action_description must be a non-empty string, received: ${JSON.stringify(request.action_description)}`);
  }
  if (!isPlainObject(request.target)) {
    throw new DecisionError('target must be { kind: "ARTIFACT", artifact_id } or { kind: "KIND", artifact_kind }');
  }
  if (request.target.kind === 'ARTIFACT') {
    if (
      Object.keys(request.target).length !== 2 ||
      typeof request.target.artifact_id !== 'string' ||
      !isArtifactId(request.target.artifact_id)
    ) {
      throw new DecisionError('ARTIFACT target requires exactly { kind: "ARTIFACT", artifact_id } with a well-formed spine artifact id');
    }
  } else if (request.target.kind === 'KIND') {
    if (
      Object.keys(request.target).length !== 2 ||
      typeof request.target.artifact_kind !== 'string' ||
      request.target.artifact_kind.length === 0
    ) {
      throw new DecisionError('KIND target requires exactly { kind: "KIND", artifact_kind } with a non-empty artifact kind');
    }
  } else {
    const targetKind: unknown = (request.target as Record<string, unknown>)['kind'];
    throw new DecisionError(`target kind must be ARTIFACT or KIND, received: ${JSON.stringify(targetKind)}`);
  }
  if (!isBlastRadius(request.blast_radius)) {
    throw new DecisionError(
      `blast_radius must be one of [COMPONENT, SERVICE, SYSTEM, ORGANIZATION], received: ${JSON.stringify(request.blast_radius)}`,
    );
  }
  if (!isImpactClass(request.impact)) {
    throw new DecisionError(`impact must be one of [LOW, MODERATE, HIGH, CRITICAL], received: ${JSON.stringify(request.impact)}`);
  }
  if (!isAskRiskSeverity(request.risk)) {
    throw new DecisionError(`risk must be one of [LOW, MODERATE, HIGH, SEVERE], received: ${JSON.stringify(request.risk)}`);
  }
  if (!isReversibilityClass(request.reversibility)) {
    throw new DecisionError(
      `reversibility must be one of [REVERSIBLE, PARTIALLY_REVERSIBLE, IRREVERSIBLE], received: ${JSON.stringify(request.reversibility)}`,
    );
  }
  if (typeof request.causal_claim !== 'boolean') {
    throw new DecisionError(`causal_claim must be a boolean, received: ${JSON.stringify(request.causal_claim)}`);
  }
  if (!isPlainObject(request.uncertainty)) {
    throw new DecisionError('uncertainty must be { uncertainty_class, basis }');
  }
  if (!isUncertaintyClass(request.uncertainty.uncertainty_class)) {
    throw new DecisionError(
      `uncertainty.uncertainty_class must be one of @sos-2/authority's frozen classes [LOW, MODERATE, HIGH, IRREDUCIBLE], received: ${JSON.stringify(request.uncertainty.uncertainty_class)}`,
    );
  }
  if (!isNonEmptyString(request.uncertainty.basis)) {
    throw new DecisionError('uncertainty.basis must be a non-empty string');
  }
  if (!Array.isArray(request.rollback_signals) || !request.rollback_signals.every(isNonEmptyString)) {
    throw new DecisionError('rollback_signals must be an array of non-empty strings (empty array = no signals)');
  }
  if (!Array.isArray(request.evidence)) {
    throw new DecisionError('evidence must be an array of W3 evidence records');
  }
  // NOTE: individual evidence ENTRIES are not shape-rejected here — they are
  // classified by the R3 evidence gate exactly like W9's promotion evidence
  // gate: the simulation mark is checked FIRST (a simulated record presented
  // as evidence is REJECTED loudly with a specific reason), then malformed
  // entries are ignored with a reason, never silently counted.
  if (!Array.isArray(request.grants)) {
    throw new DecisionError('grants must be an array of AuthorityGrantArtifacts');
  }
  if (request.raises !== undefined && request.raises !== null) {
    if (!Array.isArray(request.raises)) {
      throw new DecisionError('raises must be an array of AutonomyRaiseArtifacts');
    }
  }
  if (!isPlainObject(request.evaluation_point) || request.evaluation_point.kind !== 'TIME') {
    throw new DecisionError('evaluation_point must be exactly { kind: "TIME", now } (the engine evaluates at an instant)');
  }
  if (typeof request.evaluation_point.now !== 'string' || !RFC3339_PATTERN.test(request.evaluation_point.now)) {
    throw new DecisionError(
      `evaluation_point.now must be an RFC3339 timestamp, received: ${JSON.stringify(request.evaluation_point.now)}`,
    );
  }
  if (request.explicit_authority_decision_ref !== null && !isArtifactId(request.explicit_authority_decision_ref)) {
    throw new DecisionError(
      `explicit_authority_decision_ref must be null or a well-formed spine artifact id, received: ${JSON.stringify(request.explicit_authority_decision_ref)}`,
    );
  }
  if (request.confidence !== null && request.confidence !== undefined) {
    assertValidConfidence(request.confidence);
  }
}

/**
 * The canonical input view — the exact JSON the input digest is derived
 * from. Everything that is part of the request is part of the digest
 * (including the confidence mark: it is INPUT, even though no rule consults
 * it — the digest binds the exact input, and reproducibility is input-wide).
 */
export function decisionInputView(request: DecisionRequest): Record<string, unknown> {
  return {
    action_kind: request.action_kind,
    action_description: request.action_description,
    target: request.target,
    blast_radius: request.blast_radius,
    impact: request.impact,
    risk: request.risk,
    reversibility: request.reversibility,
    causal_claim: request.causal_claim,
    uncertainty: request.uncertainty,
    rollback_signals: [...request.rollback_signals],
    evidence: request.evidence.map((record) => record as unknown as Record<string, unknown>),
    grants: request.grants.map((grant) => ({ envelope: grant.envelope, content: grant.content })),
    raises: (request.raises ?? []).map((raise) => ({ envelope: raise.envelope, content: raise.content })),
    evaluation_point: request.evaluation_point,
    explicit_authority_decision_ref: request.explicit_authority_decision_ref,
    confidence: request.confidence ?? null,
  };
}

/**
 * The EXACT INPUT DIGEST (Work Order W10: "it carries the exact input
 * digest (canonical hash)"): sha-256 over the canonical serialization of
 * the input view — the same canonicalization the spine exports. Two
 * requests with the same digest are the same input; re-evaluation
 * reproduces the byte-identical record.
 */
export function decisionInputDigest(request: DecisionRequest): string {
  return contentHash(decisionInputView(request));
}
