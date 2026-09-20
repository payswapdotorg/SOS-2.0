/**
 * The PROMOTION GATE — `evaluatePromotion(candidate, { authority,
 * assurance, evidence })` (Work Order W9; spec/architecture.md §13, §14;
 * docs/assurance-model.md: "Promotion requires current authority +
 * assurance + evidence + compatible current System State").
 *
 * THE GATES, evaluated in a fixed, deterministic, total order:
 *
 *   0. CANDIDATE SHAPE    a structurally invalid candidate fixture is
 *                         REJECTED (never evaluated further).
 *   1. LIVE GUARDRAILS    wired live trigger records (from
 *                         @sos-2/experiments): any triggered ROLLBACK
 *                         trigger -> decision ROLLBACK (safety first; an
 *                         unknown guardrail is fail-closed downstream and
 *                         arrives here as a triggered rollback trigger).
 *   2. AUTHORITY          CURRENT authority — a valid, unexpired,
 *                         unrevoked AuthorityGrant from @sos-2/authority
 *                         (the merged W1 authority, consumed through its
 *                         exported evaluation: assertValidGrant +
 *                         evaluateGrant + scopeCovers + the permission
 *                         vocabulary). CONFIDENCE IS NOT AUTHORIZATION
 *                         (locked invariant): the candidate's confidence
 *                         mark is never consulted — a high-confidence
 *                         candidate without a valid grant is REJECTED.
 *                         An INDETERMINATE authority evaluation (a
 *                         revision-bound grant without a usable checkpoint)
 *                         is ASK — the first-class, successful
 *                         ask-the-authority outcome (R16).
 *   3. SYSTEM STATE       when the current system state revision is
 *                         declared and the candidate is based on a
 *                         different revision: REJECT (incompatible current
 *                         System State).
 *   4. ASSURANCE          CURRENT assurance — the AssuranceCase-shaped
 *                         fixture is validated and truthfully evaluated
 *                         (never assumed valid): structurally invalid or
 *                         REFUTED -> REJECT; INCOMPLETE verdict or
 *                         non-CURRENT validity (EXPIRED, SUPERSEDED,
 *                         VIOLATED — including a case claiming CURRENT
 *                         whose expires_at has passed) -> GATHER_EVIDENCE.
 *   5. EVIDENCE           CURRENT evidence — intervention-grade for causal
 *                         claims, fresh, subject-bound, never simulated,
 *                         never LLM-produced (evidence-gate.ts). Missing
 *                         intervention evidence -> EXPERIMENT (run a real
 *                         experiment); existing-but-not-current ->
 *                         GATHER_EVIDENCE; simulated records presented as
 *                         intervention evidence -> REJECT (simulation is
 *                         evaluation infrastructure, never evidence).
 *   6. RECOVERY           an ACT decision REQUIRES a valid bounded recovery
 *                         declaration (rollback mechanism wired to
 *                         experiment guardrail trigger records; bounded
 *                         time, or a governed containment exception —
 *                         spec/architecture.md §13). Missing/invalid ->
 *                         REJECT.
 *
 * DECISION OUTCOMES: exactly the frozen six — ACT, EXPERIMENT,
 * GATHER_EVIDENCE, ASK, REJECT, ROLLBACK — imported from
 * @sos-2/authority's DECISION_ACTIONS. No new outcome is ever invented.
 * Every evaluation produces a Decision-kind spine artifact record (see
 * record.ts) with the full reason audit trail.
 */

import {
  assertValidGrant,
  evaluateGrant,
  scopeCovers,
} from '@sos-2/authority';
import type { AuthorityGrantArtifact } from '@sos-2/authority';
import { DECISION_ACTIONS } from '@sos-2/authority';
import type { DecisionAction } from '@sos-2/authority';
import { assertValidCandidateState } from '@sos-2/experiments';
import type { CandidateStateFixture, TriggerRecord } from '@sos-2/experiments';
import { RFC3339_PATTERN } from '@sos-2/semantic-spine';
import { PromotionError } from './errors.js';
import { evaluateAssuranceCase } from './assurance-fixture.js';
import type { AssuranceCaseFixture, AssuranceGateEvaluation } from './assurance-fixture.js';
import { evaluateEvidenceGate } from './evidence-gate.js';
import type { EvidenceGateEvaluation, PromotionEvidenceRecord } from './evidence-gate.js';
import { assertValidBoundedRecovery } from './recovery.js';
import type { BoundedRecoveryDeclaration } from './recovery.js';
import { createPromotionDecision } from './record.js';
import type { PromotionDecisionArtifact } from './record.js';

/** The promotion permission from @sos-2/authority's frozen vocabulary. */
export const PROMOTION_PERMISSION = 'PROMOTE';

// ---------------------------------------------------------------------------
// Input contract
// ---------------------------------------------------------------------------

/** The CURRENT authority input: the grant (or none) + the evaluation instant. */
export interface AuthorityGateInput {
  /** The AuthorityGrantArtifact from @sos-2/authority, or null when none is presented. */
  grant: AuthorityGrantArtifact | null;
  /** RFC3339 evaluation instant (caller-supplied; no hidden clocks). */
  now: string;
}

/** The declared current System State (for the compatibility gate). */
export interface SystemStateDeclaration {
  /** The current System State revision. */
  revision: string;
  /** Optional description. */
  description?: string;
}

/** The full promotion evaluation input. */
export interface PromotionInput {
  /** CURRENT authority. */
  authority: AuthorityGateInput;
  /** CURRENT assurance (AssuranceCase-shaped fixture — validated, never assumed valid). */
  assurance: AssuranceCaseFixture | null;
  /** CURRENT evidence (W3 evidence records; simulated experiment results are rejected loudly). */
  evidence: readonly PromotionEvidenceRecord[];
  /** Live experiment trigger records wired to guardrails (ROLLBACK triggers drive the ROLLBACK decision). */
  liveTriggers?: readonly TriggerRecord[];
  /** The declared current System State, or null/undefined when not evaluated. */
  systemState?: SystemStateDeclaration | null;
  /** The bounded recovery declaration — REQUIRED for an ACT decision. */
  recovery?: BoundedRecoveryDeclaration | null;
  /** Provenance for the decision artifact (non-empty). */
  provenance: string[];
  /** RFC3339 creation timestamp for the decision artifact (caller-supplied). */
  created_at: string;
}

// ---------------------------------------------------------------------------
// Gate evaluation records
// ---------------------------------------------------------------------------

export interface AuthorityGateEvaluation {
  /** Whether the authority gate passed. */
  passes: boolean;
  /** The decision forced by this gate, or null (continue evaluating). */
  decision: DecisionAction | null;
  /** The grant id consulted, or null. */
  grant_ref: string | null;
  reasons: string[];
}

export interface SystemStateGateEvaluation {
  compatible: boolean;
  reasons: string[];
}

export interface GuardrailGateEvaluation {
  /** The triggered ROLLBACK trigger records (the ROLLBACK decision drivers). */
  triggered: TriggerRecord[];
  reasons: string[];
}

export interface RecoveryGateEvaluation {
  declared: boolean;
  valid: boolean;
  reasons: string[];
}

/** The complete promotion evaluation. */
export interface PromotionEvaluation {
  /** Exactly one of the frozen six decision actions. */
  decision: DecisionAction;
  /** The full reason audit trail (non-empty). */
  reasons: string[];
  gates: {
    authority: AuthorityGateEvaluation;
    assurance: AssuranceGateEvaluation;
    evidence: EvidenceGateEvaluation;
    systemState: SystemStateGateEvaluation | null;
    guardrails: GuardrailGateEvaluation | null;
    recovery: RecoveryGateEvaluation | null;
  };
  /** The Decision-kind spine artifact recording this outcome. */
  record: PromotionDecisionArtifact;
}

// ---------------------------------------------------------------------------
// Validation of the input itself
// ---------------------------------------------------------------------------

function isRfc3339(value: unknown): value is string {
  return typeof value === 'string' && RFC3339_PATTERN.test(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertValidTriggerRecordShape(value: unknown): asserts value is TriggerRecord {
  if (!isPlainObject(value)) {
    throw new PromotionError('live trigger entries must be typed trigger records from @sos-2/experiments');
  }
  const keys = ['kind', 'rule_id', 'description', 'triggered', 'reason', 'conditions'];
  if (Object.keys(value).length !== keys.length || !keys.every((key) => Object.prototype.hasOwnProperty.call(value, key))) {
    throw new PromotionError(
      'live trigger entries must be @sos-2/experiments TriggerRecords with the exact field set ' +
        '{ kind, rule_id, description, triggered, reason, conditions }',
    );
  }
  if (value['kind'] !== 'STOPPING' && value['kind'] !== 'ROLLBACK') {
    throw new PromotionError(`live trigger kind must be STOPPING or ROLLBACK, received: ${JSON.stringify(value['kind'])}`);
  }
  if (typeof value['rule_id'] !== 'string' || (value['rule_id'] as string).length === 0) {
    throw new PromotionError(`live trigger rule_id must be a non-empty string, received: ${JSON.stringify(value['rule_id'])}`);
  }
  if (typeof value['triggered'] !== 'boolean') {
    throw new PromotionError(`live trigger triggered must be a boolean, received: ${JSON.stringify(value['triggered'])}`);
  }
  if (typeof value['reason'] !== 'string' || (value['reason'] as string).length === 0) {
    throw new PromotionError(`live trigger reason must be a non-empty string, received: ${JSON.stringify(value['reason'])}`);
  }
  if (!Array.isArray(value['conditions'])) {
    throw new PromotionError('live trigger conditions must be an array of { condition, satisfied }');
  }
}

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

/**
 * Evaluate a promotion request.
 *
 * `evaluatePromotion(candidate, { authority, assurance, evidence })` — the
 * evidence-gated promotion gate. Deterministic and total: every valid input
 * produces exactly one decision from the frozen six, a full reason audit
 * trail, and a Decision-kind spine artifact record. Promotion (ACT) happens
 * ONLY with current authority + current assurance + current (intervention-
 * grade for causal claims) evidence + compatible current System State + a
 * valid bounded recovery declaration. Confidence is NEVER authorization.
 */
export function evaluatePromotion(
  candidate: CandidateStateFixture,
  input: PromotionInput,
): PromotionEvaluation {
  if (typeof input !== 'object' || input === null) {
    throw new PromotionError('promotion input must be an object');
  }
  if (input.authority === undefined || input.authority === null) {
    throw new PromotionError('promotion input requires an authority block { grant, now }');
  }
  if (!isRfc3339(input.authority.now)) {
    throw new PromotionError(
      `authority.now must be an RFC3339 timestamp, received: ${JSON.stringify(input.authority.now)}`,
    );
  }
  if (!Array.isArray(input.evidence)) {
    throw new PromotionError('promotion evidence must be an array');
  }
  if (
    !Array.isArray(input.provenance) ||
    input.provenance.length === 0 ||
    !input.provenance.every((entry) => typeof entry === 'string' && entry.length > 0)
  ) {
    throw new PromotionError('provenance must be a non-empty array of non-empty strings');
  }
  if (!isRfc3339(input.created_at)) {
    throw new PromotionError(`created_at must be an RFC3339 timestamp, received: ${JSON.stringify(input.created_at)}`);
  }
  if (input.liveTriggers !== undefined && input.liveTriggers !== null) {
    if (!Array.isArray(input.liveTriggers)) {
      throw new PromotionError('liveTriggers must be an array of trigger records');
    }
    for (const trigger of input.liveTriggers) {
      assertValidTriggerRecordShape(trigger);
    }
  }
  if (input.systemState !== undefined && input.systemState !== null) {
    if (
      !isPlainObject(input.systemState) ||
      typeof input.systemState.revision !== 'string' ||
      input.systemState.revision.length === 0
    ) {
      throw new PromotionError('systemState must be { revision, description? } with a non-empty revision');
    }
  }
  const now = input.authority.now;

  // ---- Gate 0: candidate shape ------------------------------------------
  let candidateId: string;
  try {
    assertValidCandidateState(candidate);
    candidateId = candidate.envelope.id;
  } catch (cause) {
    return buildEvaluation(
      'REJECT',
      candidate,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      input,
      [
        `candidate fixture is structurally invalid: ${(cause as Error).message}`,
        'a structurally invalid candidate is rejected before any gate is evaluated',
      ],
    );
  }

  // ---- Gate 1: live guardrails (safety first) ---------------------------
  const liveTriggers: readonly TriggerRecord[] = input.liveTriggers ?? [];
  const triggeredRollback = liveTriggers.filter(
    (trigger) => trigger.kind === 'ROLLBACK' && trigger.triggered,
  );
  const guardrailGate: GuardrailGateEvaluation = {
    triggered: triggeredRollback,
    reasons: triggeredRollback.map(
      (trigger) =>
        `live rollback trigger "${trigger.rule_id}" fired: ${trigger.reason} (conditions: ${trigger.conditions
          .map((condition) => `${condition.condition}=${condition.satisfied ? 'yes' : 'no'}`)
          .join('; ')})`,
    ),
  };
  if (triggeredRollback.length > 0) {
    return buildEvaluation('ROLLBACK', candidate, candidateId, null, null, null, null, guardrailGate, null, input, [
      'a wired live rollback trigger fired — the live change rolls back (safety outranks promotion; spec/architecture.md §18)',
      ...guardrailGate.reasons,
    ]);
  }

  // ---- Gate 2: CURRENT authority -----------------------------------------
  const authorityGate = evaluateAuthorityGate(candidate, input.authority);
  if (authorityGate.decision !== null) {
    return buildEvaluation(
      authorityGate.decision,
      candidate,
      candidateId,
      authorityGate,
      null,
      null,
      null,
      guardrailGate,
      null,
      input,
      [...authorityGate.reasons],
    );
  }

  // ---- Gate 3: compatible current System State ---------------------------
  let systemStateGate: SystemStateGateEvaluation | null = null;
  if (input.systemState !== undefined && input.systemState !== null) {
    const declared = input.systemState;
    const base = candidate.content.base_subject_revision;
    if (base !== null && base !== declared.revision) {
      systemStateGate = {
        compatible: false,
        reasons: [
          `candidate ${candidateId} is based on System State revision ${JSON.stringify(base)}, but the current revision is ${JSON.stringify(declared.revision)} — promotion requires a compatible current System State (docs/assurance-model.md)`,
        ],
      };
      return buildEvaluation(
        'REJECT',
        candidate,
        candidateId,
        authorityGate,
        null,
        null,
        systemStateGate,
        guardrailGate,
        null,
        input,
        [...systemStateGate.reasons],
      );
    }
    systemStateGate = {
      compatible: true,
      reasons: [
        `candidate ${candidateId} is based on the current System State revision ${JSON.stringify(declared.revision)}`,
      ],
    };
  }

  // ---- Gate 4: CURRENT assurance ------------------------------------------
  const assuranceGate = evaluateAssuranceCase(input.assurance, now);
  if (!assuranceGate.passes) {
    // Structurally invalid -> REJECT; REFUTED -> REJECT;
    // INCOMPLETE verdict or non-CURRENT validity -> GATHER_EVIDENCE.
    const decision: DecisionAction =
      !assuranceGate.structurally_valid || assuranceGate.verdict === 'REFUTED' ? 'REJECT' : 'GATHER_EVIDENCE';
    return buildEvaluation(
      decision,
      candidate,
      candidateId,
      authorityGate,
      assuranceGate,
      null,
      systemStateGate,
      guardrailGate,
      null,
      input,
      [
        ...assuranceGate.reasons,
        decision === 'REJECT'
          ? 'the assurance case is invalid or refuted — promotion is rejected'
          : 'the assurance case is not currently satisfied — gather the evidence to complete/revalidate it before promotion',
      ],
    );
  }

  // ---- Gate 5: CURRENT evidence -------------------------------------------
  const evidenceGate = evaluateEvidenceGate(candidate, input.evidence, now);
  if (!evidenceGate.satisfied) {
    let decision: DecisionAction;
    let headline: string;
    if (evidenceGate.real_interventional_considered > 0) {
      decision = 'GATHER_EVIDENCE';
      headline =
        'intervention evidence about the candidate exists but none is current/successful — gather current evidence';
    } else if (evidenceGate.rejected_simulated.length > 0) {
      decision = 'REJECT';
      headline =
        'simulated records were presented as intervention evidence — simulation is evaluation infrastructure and NEVER satisfies intervention evidence requirements (docs/implementation/TESTING-AND-EVIDENCE.md layer 6)';
    } else {
      decision = 'EXPERIMENT';
      headline = candidate.content.causal_claim
        ? 'no intervention-grade evidence about the candidate was presented — run a controlled experiment (a causal claim requires intervention evidence; spec/architecture.md §18)'
        : 'no current evidence about the candidate was presented — gather evidence or run an experiment';
    }
    return buildEvaluation(
      decision,
      candidate,
      candidateId,
      authorityGate,
      assuranceGate,
      evidenceGate,
      systemStateGate,
      guardrailGate,
      null,
      input,
      [headline, ...evidenceGate.reasons],
    );
  }

  // ---- Gate 6: bounded recovery (ACT requires it) -------------------------
  const recoveryDeclared = input.recovery !== undefined && input.recovery !== null;
  let recoveryValid = false;
  const recoveryReasons: string[] = [];
  if (recoveryDeclared) {
    try {
      assertValidBoundedRecovery(input.recovery);
      recoveryValid = true;
      const recovery = input.recovery as BoundedRecoveryDeclaration;
      recoveryReasons.push(
        `bounded recovery declared: ${recovery.mechanism}` +
          (recovery.max_recovery_seconds !== null
            ? ` (max ${recovery.max_recovery_seconds}s)`
            : ' (governed containment exception)'),
      );
    } catch (cause) {
      recoveryReasons.push(`the recovery declaration is invalid: ${(cause as Error).message}`);
    }
  } else {
    recoveryReasons.push(
      'no bounded recovery declaration was presented — live changes require bounded recovery unless a governed containment exception applies (spec/architecture.md §13)',
    );
  }
  const recoveryGate: RecoveryGateEvaluation = {
    declared: recoveryDeclared,
    valid: recoveryValid,
    reasons: recoveryReasons,
  };
  if (!recoveryValid) {
    return buildEvaluation(
      'REJECT',
      candidate,
      candidateId,
      authorityGate,
      assuranceGate,
      evidenceGate,
      systemStateGate,
      guardrailGate,
      recoveryGate,
      input,
      [...recoveryGate.reasons],
    );
  }

  // ---- All gates green: ACT ------------------------------------------------
  return buildEvaluation(
    'ACT',
    candidate,
    candidateId,
    authorityGate,
    assuranceGate,
    evidenceGate,
    systemStateGate,
    guardrailGate,
    recoveryGate,
    input,
    [
      'all promotion gates passed — the candidate is promoted (ACT)',
      ...authorityGate.reasons,
      ...assuranceGate.reasons,
      ...evidenceGate.reasons,
      ...recoveryGate.reasons,
      ...(systemStateGate?.reasons ?? []),
    ],
  );
}

// ---------------------------------------------------------------------------
// The authority gate (consuming @sos-2/authority's exported evaluation)
// ---------------------------------------------------------------------------

function evaluateAuthorityGate(
  candidate: CandidateStateFixture,
  authority: AuthorityGateInput,
): AuthorityGateEvaluation {
  const now = authority.now;
  if (authority.grant === null || authority.grant === undefined) {
    return {
      passes: false,
      decision: 'REJECT',
      grant_ref: null,
      reasons: [
        'no authority grant was presented — CONFIDENCE IS NOT AUTHORIZATION (spec/architecture-lock.md): ' +
          'a high-confidence candidate without a valid authority grant is rejected, whatever its confidence mark',
      ],
    };
  }
  try {
    assertValidGrant(authority.grant);
  } catch (cause) {
    return {
      passes: false,
      decision: 'REJECT',
      grant_ref: null,
      reasons: [`the authority grant is structurally invalid: ${(cause as Error).message}`],
    };
  }
  const grant = authority.grant;
  const grantRef = grant.envelope.id;

  // Deterministic evaluation — indeterminate inputs ASK (first-class, R16).
  let status: 'VALID' | 'EXPIRED' | 'REVOKED';
  try {
    if (grant.content.expiry.kind === 'TIME') {
      status = evaluateGrant(grant, { kind: 'TIME', now });
    } else if (grant.content.expiry.artifact_id === candidate.envelope.id) {
      status = evaluateGrant(grant, {
        kind: 'REVISION',
        artifact_id: candidate.envelope.id,
        version: candidate.envelope.version,
      });
    } else {
      return {
        passes: false,
        decision: 'ASK',
        grant_ref: grantRef,
        reasons: [
          `authority evaluation is INDETERMINATE: grant ${grantRef} is revision-bound to ${grant.content.expiry.artifact_id}, ` +
            `which is not the candidate ${candidate.envelope.id} — ask the granting authority for a determination (ASK is a first-class decision, R16)`,
        ],
      };
    }
  } catch (cause) {
    return {
      passes: false,
      decision: 'ASK',
      grant_ref: grantRef,
      reasons: [
        `authority evaluation is INDETERMINATE: ${(cause as Error).message} — ask the granting authority for a determination (ASK is a first-class decision, R16)`,
      ],
    };
  }
  if (status !== 'VALID') {
    return {
      passes: false,
      decision: 'REJECT',
      grant_ref: grantRef,
      reasons: [
        `authority grant ${grantRef} is ${status} at ${now} — expired and revoked grants NEVER authorize promotion (the candidate's confidence mark is irrelevant: confidence is not authorization)`,
      ],
    };
  }
  if (!scopeCovers(grant.content.scope, { kind: 'ARTIFACT', artifact_id: candidate.envelope.id })) {
    return {
      passes: false,
      decision: 'REJECT',
      grant_ref: grantRef,
      reasons: [
        `authorization refused: scope violation — grant ${grantRef} does not cover candidate ${candidate.envelope.id}`,
      ],
    };
  }
  if (!(grant.content.permissions as readonly string[]).includes(PROMOTION_PERMISSION)) {
    return {
      passes: false,
      decision: 'REJECT',
      grant_ref: grantRef,
      reasons: [
        `authorization refused: grant ${grantRef} does not carry the ${PROMOTION_PERMISSION} permission (granted: ${grant.content.permissions.join(', ')})`,
      ],
    };
  }
  return {
    passes: true,
    decision: null,
    grant_ref: grantRef,
    reasons: [
      `authority grant ${grantRef} is VALID at ${now}, covers the candidate and carries ${PROMOTION_PERMISSION}`,
    ],
  };
}

// ---------------------------------------------------------------------------
// Decision artifact assembly
// ---------------------------------------------------------------------------

function buildEvaluation(
  decision: DecisionAction,
  candidate: CandidateStateFixture,
  candidateId: string | null,
  authorityGate: AuthorityGateEvaluation | null,
  assuranceGate: AssuranceGateEvaluation | null,
  evidenceGate: EvidenceGateEvaluation | null,
  systemStateGate: SystemStateGateEvaluation | null,
  guardrailGate: GuardrailGateEvaluation | null,
  recoveryGate: RecoveryGateEvaluation | null,
  input: PromotionInput,
  auditTrail: readonly string[],
): PromotionEvaluation {
  if (!(DECISION_ACTIONS as readonly string[]).includes(decision)) {
    throw new PromotionError(
      `internal invariant: decision ${JSON.stringify(decision)} is not one of the frozen six — refusing to mint`,
    );
  }
  const reasons = [...new Set(auditTrail.filter((reason) => reason.length > 0))];
  if (reasons.length === 0) {
    reasons.push('(no reasons recorded)');
  }
  const assuranceRef =
    assuranceGate !== null &&
    assuranceGate.structurally_valid &&
    input.assurance !== null &&
    input.assurance !== undefined
      ? input.assurance.id
      : null;
  const record = createPromotionDecision({
    content: {
      action: decision,
      candidate_ref: candidateId ?? '(invalid-candidate)',
      authority_grant_ref: authorityGate?.grant_ref ?? null,
      assurance_case_ref: assuranceRef,
      evidence_refs: evidenceGate?.satisfying ?? [],
      reasons,
      recovery:
        decision === 'ACT' && input.recovery !== undefined && input.recovery !== null
          ? structuredClone(input.recovery)
          : null,
      system_state_revision: input.systemState?.revision ?? null,
      live_trigger_rule_ids: (input.liveTriggers ?? []).map((trigger) => trigger.rule_id),
    },
    provenance: [...input.provenance],
    created_at: input.created_at,
    authority_ref: authorityGate?.grant_ref ?? null,
  });
  return {
    decision,
    reasons,
    gates: {
      authority:
        authorityGate ?? {
          passes: false,
          decision: null,
          grant_ref: null,
          reasons: ['(authority gate not reached)'],
        },
      assurance:
        assuranceGate ?? {
          structurally_valid: false,
          verdict: null,
          effective_validity: null,
          passes: false,
          reasons: ['(assurance gate not reached)'],
        },
      evidence:
        evidenceGate ?? {
          satisfied: false,
          requires: 'INTERVENTIONAL',
          satisfying: [],
          rejected_simulated: [],
          real_interventional_considered: 0,
          reasons: ['(evidence gate not reached)'],
        },
      systemState: systemStateGate,
      guardrails: guardrailGate,
      recovery: recoveryGate,
    },
    record,
  };
}
