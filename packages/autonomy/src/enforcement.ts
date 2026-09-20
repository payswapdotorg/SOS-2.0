/**
 * SCOPED AUTHORITY ENFORCEMENT — the autonomy gate.
 *
 * "An action requiring level L is permitted only with a currently-valid
 * grant covering it" (Work Order W10; spec/requirements.md R15): nothing is
 * authorized implicitly. Enforcement integrates @sos-2/authority's grant
 * evaluation VERBATIM (assertValidGrant + evaluateGrant + scopeCovers + the
 * frozen permission vocabulary) — this module never re-implements grant
 * semantics.
 *
 * TWO exports, matching the two dimensions of the policy:
 *
 *   evaluateAuthorityCoverage(request) — the pure AUTHORITY dimension:
 *     grants, raises, level satisfaction. Verdicts:
 *
 *       PERMITTED  the required (effective) level is satisfied: the
 *                  authorizing grant is currently VALID, covers the target
 *                  and carries the action permission, and the level's own
 *                  conditions hold (SUPERVISED additionally requires the
 *                  explicit per-request authority decision reference;
 *                  AUTONOMOUS_LOW_RISK additionally requires the low-risk
 *                  profile: risk LOW and reversibility REVERSIBLE).
 *
 *       DENIED     a structured refusal with a code:
 *                    EXPIRED / REVOKED      — a dead grant was presented
 *                                            (dead authority authorizes
 *                                            nothing; it dominates every
 *                                            other failure)
 *                    NO_GRANT               — no grant was presented at all
 *                    PERMISSION_MISSING     — grants alive, none carrying
 *                                            the action permission
 *                    SCOPE_MISMATCH         — grants alive and permissive,
 *                                            none covering the target
 *                    INDETERMINATE_EVALUATION — a grant cannot be evaluated
 *                                            at the given point (e.g. a
 *                                            revision-bound grant against a
 *                                            clock) — never silently VALID
 *
 *       ESCALATED  the authority is present but the situation requires an
 *                  explicit authority decision:
 *                    SUPERVISED_REQUIRES_EXPLICIT_DECISION
 *                    LOW_RISK_PROFILE_VIOLATION
 *
 *   evaluateAutonomy(request) — authority coverage PLUS the risk x
 *     irreversibility matrix (escalation.ts): a PERMITTED coverage can
 *     still be ESCALATED with code RISK_IRREVERSIBILITY_ESCALATION. The
 *     matrix applies at EVERY level; no confidence value is ever
 *     consulted (locked invariant).
 *
 * Determinism: verdicts depend only on the request. When several grants
 * qualify, the authorizing grant is the first in sorted-id order; denial
 * categorization is order-independent (dead grants dominate; among alive
 * grants PERMISSION_MISSING dominates SCOPE_MISMATCH dominates
 * INDETERMINATE_EVALUATION). Applied raises are the applicable,
 * grant-backed ones (raise.ts), sorted by id; raises only ever increase
 * the effective level, and an unprovable raise is ignored — which always
 * falls back toward the MORE restrictive default (fail-closed).
 */

import {
  assertValidGrant,
  evaluateGrant,
  isGrantPermission,
  scopeCovers,
} from '@sos-2/authority';
import type { AuthorityGrantArtifact, AuthorizationTarget, GrantEvaluationInput } from '@sos-2/authority';
import { isArtifactId } from '@sos-2/semantic-spine';
import { AutonomyError } from './errors.js';
import {
  AUTONOMY_LEVEL_RANKS,
  isBlastRadius,
  isReversibilityClass,
} from './levels.js';
import type { AutonomyLevel, BlastRadius, ReversibilityClass, RiskSeverity } from './levels.js';
import { escalationOutcome } from './escalation.js';
import type { EscalationCode } from './escalation.js';
import { requiredLevel } from './policy.js';
import type { AutonomyActionKind } from './policy.js';
import { raiseApplies } from './raise.js';
import { assertValidAutonomyRaise } from './raise.js';
import type { AutonomyRaiseArtifact } from './raise.js';

/** Structured denial codes (authority dimension). */
export const AUTONOMY_DENIAL_CODES = [
  'EXPIRED',
  'REVOKED',
  'NO_GRANT',
  'PERMISSION_MISSING',
  'SCOPE_MISMATCH',
  'INDETERMINATE_EVALUATION',
] as const;

export type AutonomyDenialCode = (typeof AUTONOMY_DENIAL_CODES)[number];

/** Structured escalation codes (authority dimension + the matrix code). */
export const AUTONOMY_ESCALATION_CODES = [
  'SUPERVISED_REQUIRES_EXPLICIT_DECISION',
  'LOW_RISK_PROFILE_VIOLATION',
  'RISK_IRREVERSIBILITY_ESCALATION',
] as const;

export type AutonomyEscalationCode = (typeof AUTONOMY_ESCALATION_CODES)[number];

/** The authority-dimension verdict (evaluateAuthorityCoverage). */
export type AutonomyCoverageVerdict =
  | {
      verdict: 'PERMITTED';
      /** The policy-table default level. */
      required_level: AutonomyLevel;
      /** The default raised by applicable grant-backed raises. */
      effective_level: AutonomyLevel;
      /** What authorized the action at this level. */
      authorizing: 'GRANT' | 'GRANT_AND_EXPLICIT_DECISION';
      /** The authorizing grant's spine id. */
      grant_ref: string;
      /** All presented grant ids (sorted). */
      consulted_grant_refs: string[];
      /** Applicable, grant-backed raise ids (sorted). */
      applied_raise_refs: string[];
      reason: string;
    }
  | {
      verdict: 'DENIED';
      code: AutonomyDenialCode;
      required_level: AutonomyLevel;
      effective_level: AutonomyLevel;
      grant_ref: string | null;
      consulted_grant_refs: string[];
      applied_raise_refs: string[];
      reason: string;
    }
  | {
      verdict: 'ESCALATED';
      code: Exclude<AutonomyEscalationCode, EscalationCode>;
      required_level: AutonomyLevel;
      effective_level: AutonomyLevel;
      grant_ref: string | null;
      consulted_grant_refs: string[];
      applied_raise_refs: string[];
      reason: string;
    };

/** The combined verdict (evaluateAutonomy): coverage + escalation matrix. */
export type AutonomyVerdict =
  | AutonomyCoverageVerdict
  | {
      verdict: 'ESCALATED';
      code: 'RISK_IRREVERSIBILITY_ESCALATION';
      required_level: AutonomyLevel;
      effective_level: AutonomyLevel;
      grant_ref: string | null;
      consulted_grant_refs: string[];
      applied_raise_refs: string[];
      reason: string;
    };

export interface AutonomyEnforcementRequest {
  /** The action kind (frozen authority permission). */
  action_kind: AutonomyActionKind;
  /** The authorization target (what the action operates on). */
  target: AuthorizationTarget;
  blast_radius: BlastRadius;
  risk: RiskSeverity;
  reversibility: ReversibilityClass;
  /** Presented grants (direct authorization AND raise backing). */
  grants: readonly AuthorityGrantArtifact[];
  /** Presented autonomy raises (optional). */
  raises?: readonly AutonomyRaiseArtifact[];
  /** The evaluation point ({ kind: "TIME", now } or { kind: "REVISION", ... }). */
  evaluation_point: GrantEvaluationInput;
  /**
   * Spine id of the EXPLICIT authority decision for THIS specific request
   * (required for SUPERVISED), or null.
   */
  explicit_authority_decision_ref: string | null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertValidTarget(target: AuthorizationTarget): void {
  if (!isPlainObject(target)) {
    throw new AutonomyError('enforcement target must be { kind: "ARTIFACT", artifact_id } or { kind: "KIND", artifact_kind }');
  }
  if (target.kind === 'ARTIFACT') {
    if (Object.keys(target).length !== 2 || typeof target.artifact_id !== 'string' || !isArtifactId(target.artifact_id)) {
      throw new AutonomyError('ARTIFACT target requires exactly { kind: "ARTIFACT", artifact_id } with a well-formed spine artifact id');
    }
    return;
  }
  if (target.kind === 'KIND') {
    if (Object.keys(target).length !== 2 || typeof target.artifact_kind !== 'string' || target.artifact_kind.length === 0) {
      throw new AutonomyError('KIND target requires exactly { kind: "KIND", artifact_kind } with a non-empty artifact kind');
    }
    return;
  }
  const kind: unknown = (target as Record<string, unknown>)['kind'];
  throw new AutonomyError(`enforcement target kind must be ARTIFACT or KIND, received: ${JSON.stringify(kind)}`);
}

function assertValidEnforcementRequest(request: AutonomyEnforcementRequest): void {
  if (!isPlainObject(request)) {
    throw new AutonomyError('enforcement request must be an object');
  }
  if (!isGrantPermission(request.action_kind)) {
    throw new AutonomyError(`action_kind must be a frozen authority permission, received: ${JSON.stringify(request.action_kind)}`);
  }
  assertValidTarget(request.target);
  if (!isBlastRadius(request.blast_radius)) {
    throw new AutonomyError(`blast_radius must be one of [COMPONENT, SERVICE, SYSTEM, ORGANIZATION], received: ${JSON.stringify(request.blast_radius)}`);
  }
  if (typeof request.risk !== 'string' || !['LOW', 'MODERATE', 'HIGH', 'SEVERE'].includes(request.risk)) {
    throw new AutonomyError(`risk must be one of [LOW, MODERATE, HIGH, SEVERE], received: ${JSON.stringify(request.risk)}`);
  }
  if (!isReversibilityClass(request.reversibility)) {
    throw new AutonomyError(`reversibility must be one of [REVERSIBLE, PARTIALLY_REVERSIBLE, IRREVERSIBLE], received: ${JSON.stringify(request.reversibility)}`);
  }
  if (!Array.isArray(request.grants)) {
    throw new AutonomyError('grants must be an array of AuthorityGrantArtifacts');
  }
  for (const grant of request.grants) {
    assertValidGrant(grant);
  }
  if (request.raises !== undefined && request.raises !== null) {
    if (!Array.isArray(request.raises)) {
      throw new AutonomyError('raises must be an array of AutonomyRaiseArtifacts');
    }
    for (const raise of request.raises) {
      try {
        assertValidAutonomyRaise(raise);
      } catch (cause) {
        throw new AutonomyError(`raises entries must be well-formed autonomy raise artifacts: ${(cause as Error).message}`);
      }
    }
  }
  if (!isPlainObject(request.evaluation_point)) {
    throw new AutonomyError('evaluation_point must be { kind: "TIME", now } or { kind: "REVISION", artifact_id, version }');
  }
  if (request.explicit_authority_decision_ref !== null && !isArtifactId(request.explicit_authority_decision_ref)) {
    throw new AutonomyError(
      `explicit_authority_decision_ref must be null or a well-formed spine artifact id, received: ${JSON.stringify(request.explicit_authority_decision_ref)}`,
    );
  }
}

type GrantScreening =
  | { kind: 'QUALIFIED' }
  | { kind: 'EXPIRED' }
  | { kind: 'REVOKED' }
  | { kind: 'SCOPE_MISMATCH' }
  | { kind: 'PERMISSION_MISSING' }
  | { kind: 'INDETERMINATE_EVALUATION'; message: string };

function screenGrant(
  grant: AuthorityGrantArtifact,
  request: AutonomyEnforcementRequest,
): GrantScreening {
  let status: string;
  try {
    status = evaluateGrant(grant, request.evaluation_point);
  } catch (cause) {
    return { kind: 'INDETERMINATE_EVALUATION', message: (cause as Error).message };
  }
  if (status === 'REVOKED') {
    return { kind: 'REVOKED' };
  }
  if (status === 'EXPIRED') {
    return { kind: 'EXPIRED' };
  }
  if (!scopeCovers(grant.content.scope, request.target)) {
    return { kind: 'SCOPE_MISMATCH' };
  }
  if (!grant.content.permissions.includes(request.action_kind)) {
    return { kind: 'PERMISSION_MISSING' };
  }
  return { kind: 'QUALIFIED' };
}

function sortedIds(grants: readonly AuthorityGrantArtifact[]): string[] {
  return grants.map((grant) => grant.envelope.id).sort();
}

/**
 * Evaluate the AUTHORITY dimension: grants, raises, level satisfaction.
 * Deterministic and total for well-formed input (malformed input throws
 * AutonomyError — loud).
 */
export function evaluateAuthorityCoverage(request: AutonomyEnforcementRequest): AutonomyCoverageVerdict {
  assertValidEnforcementRequest(request);

  const required = requiredLevel(request.action_kind, request.blast_radius);
  const consulted = sortedIds(request.grants);

  // Screen every presented grant (deterministic per grant).
  const screened = request.grants.map((grant) => ({ grant, screening: screenGrant(grant, request) }));

  // Effective level: the default raised by applicable, grant-backed raises.
  const presentedRaises = request.raises ?? [];
  const applicable = presentedRaises
    .filter((raise) => raiseApplies(raise, { action_kind: request.action_kind, blast_radius: request.blast_radius, grants: request.grants }, request.evaluation_point))
    .sort((a, b) => (a.envelope.id < b.envelope.id ? -1 : a.envelope.id > b.envelope.id ? 1 : 0));
  const appliedRaiseRefs = applicable.map((raise) => raise.envelope.id);
  let effective: AutonomyLevel = required;
  for (const raise of applicable) {
    if (AUTONOMY_LEVEL_RANKS[raise.content.to_level] > AUTONOMY_LEVEL_RANKS[effective]) {
      effective = raise.content.to_level;
    }
  }

  const base = {
    required_level: required,
    effective_level: effective,
    consulted_grant_refs: consulted,
    applied_raise_refs: appliedRaiseRefs,
  };

  const qualified = screened
    .filter((entry) => entry.screening.kind === 'QUALIFIED')
    .sort((a, b) => (a.grant.envelope.id < b.grant.envelope.id ? -1 : a.grant.envelope.id > b.grant.envelope.id ? 1 : 0));

  if (qualified.length === 0) {
    // No grant qualifies. Dead authority dominates (fail loud); then the
    // documented category priority among alive-but-insufficient grants.
    const kinds = new Set(screened.map((entry) => entry.screening.kind));
    if (kinds.has('REVOKED')) {
      return {
        ...base,
        verdict: 'DENIED',
        code: 'REVOKED',
        grant_ref: null,
        reason: 'authorization refused: a presented grant is REVOKED — dead authority authorizes nothing (an expired or revoked grant NEVER permits, regardless of level)',
      };
    }
    if (kinds.has('EXPIRED')) {
      return {
        ...base,
        verdict: 'DENIED',
        code: 'EXPIRED',
        grant_ref: null,
        reason: 'authorization refused: a presented grant is EXPIRED at the evaluation point — dead authority authorizes nothing (an expired or revoked grant NEVER permits, regardless of level)',
      };
    }
    if (request.grants.length === 0) {
      return {
        ...base,
        verdict: 'DENIED',
        code: 'NO_GRANT',
        grant_ref: null,
        reason: 'authorization refused: no grant was presented — an action requiring a level is permitted only with a currently-valid grant covering it (nothing is authorized implicitly)',
      };
    }
    if (kinds.has('PERMISSION_MISSING')) {
      return {
        ...base,
        verdict: 'DENIED',
        code: 'PERMISSION_MISSING',
        grant_ref: null,
        reason: `authorization refused: presented grants are alive and in scope but none carries permission ${request.action_kind} for target ${request.target.kind === 'ARTIFACT' ? request.target.artifact_id : request.target.artifact_kind}`,
      };
    }
    if (kinds.has('SCOPE_MISMATCH')) {
      return {
        ...base,
        verdict: 'DENIED',
        code: 'SCOPE_MISMATCH',
        grant_ref: null,
        reason: 'authorization refused: presented grants are alive and permissive but none covers the request target (scope violation)',
      };
    }
    const indeterminate = screened.find((entry) => entry.screening.kind === 'INDETERMINATE_EVALUATION');
    return {
      ...base,
      verdict: 'DENIED',
      code: 'INDETERMINATE_EVALUATION',
      grant_ref: null,
      reason: `authorization could not be established: a presented grant cannot be evaluated at the given point (${indeterminate !== undefined && indeterminate.screening.kind === 'INDETERMINATE_EVALUATION' ? indeterminate.screening.message : 'indeterminate evaluation'}) — indeterminacy is never silently treated as VALID`,
    };
  }

  // A qualified grant exists: the first in sorted-id order authorizes.
  const authorizing = qualified[0]!.grant;
  const grantRef = authorizing.envelope.id;

  if (effective === 'SUPERVISED') {
    if (request.explicit_authority_decision_ref !== null) {
      return {
        ...base,
        verdict: 'PERMITTED',
        authorizing: 'GRANT_AND_EXPLICIT_DECISION',
        grant_ref: grantRef,
        reason: `permitted at level SUPERVISED: grant ${grantRef} is currently valid, covers the target and carries permission ${request.action_kind}, and explicit authority decision ${request.explicit_authority_decision_ref} covers this specific request`,
      };
    }
    return {
      ...base,
      verdict: 'ESCALATED',
      code: 'SUPERVISED_REQUIRES_EXPLICIT_DECISION',
      grant_ref: grantRef,
      reason: 'escalated: the action requires level SUPERVISED and no explicit authority decision for this specific request was presented — grants bound a SUPERVISED action but never permit it on their own',
    };
  }

  if (effective === 'AUTONOMOUS_LOW_RISK') {
    if (request.risk === 'LOW' && request.reversibility === 'REVERSIBLE') {
      return {
        ...base,
        verdict: 'PERMITTED',
        authorizing: 'GRANT',
        grant_ref: grantRef,
        reason: `permitted at level AUTONOMOUS_LOW_RISK: grant ${grantRef} is currently valid, covers the target, carries permission ${request.action_kind}, and the risk profile (risk LOW, reversibility REVERSIBLE) stays in the autonomous-safe region`,
      };
    }
    return {
      ...base,
      verdict: 'ESCALATED',
      code: 'LOW_RISK_PROFILE_VIOLATION',
      grant_ref: grantRef,
      reason: `escalated: the action proceeds at level AUTONOMOUS_LOW_RISK but its risk profile (risk ${request.risk}, reversibility ${request.reversibility}) left the autonomous-safe region (risk LOW and reversibility REVERSIBLE) — autonomy is conditional on the risk profile staying low`,
    };
  }

  return {
    ...base,
    verdict: 'PERMITTED',
    authorizing: 'GRANT',
    grant_ref: grantRef,
    reason: `permitted at level BOUNDED: grant ${grantRef} is currently valid, covers the target and carries permission ${request.action_kind} — autonomy is bounded by the grant's explicit scope, permission set and expiry`,
  };
}

/**
 * The combined autonomy evaluation: authority coverage, then the risk x
 * irreversibility matrix. A PERMITTED coverage can still be ESCALATED by
 * the matrix — the matrix applies at EVERY level, and no confidence value
 * is ever consulted (locked invariant: confidence is not authorization).
 */
export function evaluateAutonomy(request: AutonomyEnforcementRequest): AutonomyVerdict {
  const coverage = evaluateAuthorityCoverage(request);
  if (coverage.verdict !== 'PERMITTED') {
    return coverage;
  }
  const matrix = escalationOutcome(request.risk, request.reversibility);
  if (matrix.escalates && matrix.code !== null) {
    return {
      verdict: 'ESCALATED',
      code: 'RISK_IRREVERSIBILITY_ESCALATION',
      required_level: coverage.required_level,
      effective_level: coverage.effective_level,
      grant_ref: coverage.grant_ref,
      consulted_grant_refs: coverage.consulted_grant_refs,
      applied_raise_refs: coverage.applied_raise_refs,
      reason: matrix.reason,
    };
  }
  return coverage;
}
