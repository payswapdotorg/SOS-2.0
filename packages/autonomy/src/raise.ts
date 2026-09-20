/**
 * GOVERNED autonomy raises (Work Order W10 acceptance: "autonomy RAISES are
 * governed").
 *
 * Raising an action's autonomy level — relaxing the policy table, e.g.
 * letting a SUPERVISED act proceed on grants alone — is itself an
 * authority-relevant act. It is NEVER silent:
 *
 *   - a raise is minted ONLY through authorizeAutonomyRaise, which REQUIRES
 *     an explicit, currently-valid AuthorityGrant FOR THE RAISE ITSELF:
 *       * the grant must be VALID at the raise's evaluation point
 *         (@sos-2/authority's evaluateGrant — expired/revoked grants throw),
 *       * the grant's scope must COVER the raise's scope (the same
 *         deterministic scope-covering rule authorize() uses — narrower
 *         never authorizes broader),
 *       * the grant must CARRY the action kind's permission (to relax
 *         autonomy for PROMOTE acts you need PROMOTE authority),
 *       * the raise's expiry must be WITHIN the authorizing grant's expiry
 *         (a raise never outlives its grant — @sos-2/authority's
 *         expiryIsWithin, the delegation rule);
 *   - the raise must STRICTLY increase the level (rank(to) > rank(from)):
 *     a silent "raise" that equals or lowers the level is rejected loudly
 *     (reductions are policy changes, not raises);
 *   - `from_level` must be the frozen policy-table default for the
 *     (action kind, blast radius) pair — raises are anchored to the
 *     documented baseline, never compounded;
 *   - at ENFORCEMENT time a raise applies ONLY when its authorizing grant
 *     is presented, currently VALID, carries the action permission and
 *     covers the raise's scope (enforcement.ts — a raise whose backing
 *     authority cannot be proven is IGNORED, which always falls back toward
 *     the MORE restrictive default: fail-closed, never fail-open).
 *
 * Identity discipline: AutonomyRaise is an explicitly-REGISTERED spine
 * extension kind (the sanctioned add-only registerArtifactKind API — the
 * W3 ProvenanceRecord / W5 CorrelationRecord / W8 RecoveryDeclaration
 * precedent). Ids are deterministic content-addressed over the creation
 * address. The frozen 19 core kinds are untouched.
 */

import {
  assertValidGrant,
  evaluateGrant,
  expiryIsWithin,
  scopeCovers,
} from '@sos-2/authority';
import type {
  AuthorityGrantArtifact,
  GrantEvaluationInput,
  GrantExpiry,
  GrantScope,
} from '@sos-2/authority';
import {
  assertValidEnvelope,
  createEnvelope,
  deriveDeterministicArtifactId,
  registerArtifactKind,
} from '@sos-2/semantic-spine';
import type { ArtifactEnvelope, ArtifactStatus } from '@sos-2/semantic-spine';
import { AutonomyError } from './errors.js';
import { AUTONOMY_LEVEL_RANKS, isAutonomyLevel, isBlastRadius } from './levels.js';
import type { AutonomyLevel, BlastRadius } from './levels.js';
import { requiredLevel } from './policy.js';
import type { AutonomyActionKind } from './policy.js';

/** The artifact kind segment used for autonomy raise ids. */
export const AUTONOMY_RAISE_KIND = 'AutonomyRaise';

/**
 * Register the AutonomyRaise extension kind in the spine's kind registry.
 * Idempotent: re-registration of the same kind is a no-op. The registry is
 * add-only — this can never remove or mutate any frozen core kind.
 */
export function registerAutonomyRaiseKind(): void {
  try {
    registerArtifactKind(AUTONOMY_RAISE_KIND);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    if (!message.includes('already registered')) {
      throw cause;
    }
  }
}

// Register eagerly at module load (documented, idempotent, add-only): the
// spine's kind registry is the single kind authority and this package's
// raise ids use the AutonomyRaise kind segment.
registerAutonomyRaiseKind();

/** The exact content of an autonomy raise artifact. */
export interface AutonomyRaiseContent {
  /** The action kind whose autonomy is raised (frozen authority permission). */
  action_kind: AutonomyActionKind;
  /** Where the raise applies (a grant-style scope: one artifact or one kind). */
  scope: GrantScope;
  /** The exact blast radius the raise covers (must match the request's). */
  blast_radius: BlastRadius;
  /** The policy-table default for (action kind, blast radius) — the anchored baseline. */
  from_level: AutonomyLevel;
  /** The raised level — STRICTLY higher rank than from_level. */
  to_level: AutonomyLevel;
  /** WHY the raise is justified (non-empty). */
  rationale: string;
  /** The authorizing grant (spine id) — the raise dies with this grant. */
  authorizing_grant_ref: string;
  /** The raise's expiry — within the authorizing grant's expiry, never beyond. */
  expiry: GrantExpiry;
}

export interface AutonomyRaiseArtifact {
  envelope: ArtifactEnvelope;
  content: AutonomyRaiseContent;
}

export interface AuthorizeAutonomyRaiseInput {
  action_kind: AutonomyActionKind;
  scope: GrantScope;
  blast_radius: BlastRadius;
  /** The requested level — must rank STRICTLY above the table default. */
  to_level: AutonomyLevel;
  /** Non-empty rationale. */
  rationale: string;
  /** The grant FOR THE RAISE ITSELF: VALID at `at`, covering the scope, carrying the action permission. */
  grant: AuthorityGrantArtifact;
  /** The point proving the grant's validity (and DELEGATE-free: the action permission is what is required). */
  at: GrantEvaluationInput;
  /**
   * The raise's expiry. When omitted, the raise inherits the grant's own
   * expiry (identical shape — trivially within). When supplied explicitly,
   * it must be within the grant's expiry.
   */
  expiry?: GrantExpiry;
  provenance: string[];
  created_at: string;
  status?: ArtifactStatus;
  version?: number;
  supersedes?: string | null;
}

export interface AutonomyRaiseCreationAddress {
  kind: 'AutonomyRaise';
  version: number;
  status: ArtifactStatus;
  authority_ref: string | null;
  provenance: string[];
  created_at: string;
  supersedes: string | null;
  content: AutonomyRaiseContent;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** Validate autonomy raise content (throws AutonomyError). */
export function assertValidAutonomyRaiseContent(value: unknown): asserts value is AutonomyRaiseContent {
  if (!isPlainObject(value)) {
    throw new AutonomyError(`autonomy raise content must be an object, received: ${JSON.stringify(value)}`);
  }
  const keys = ['action_kind', 'scope', 'blast_radius', 'from_level', 'to_level', 'rationale', 'authorizing_grant_ref', 'expiry'];
  if (
    Object.keys(value).length !== keys.length ||
    !keys.every((key) => Object.prototype.hasOwnProperty.call(value, key))
  ) {
    throw new AutonomyError(`autonomy raise content must have the exact field set { ${keys.join(', ')} }`);
  }
  // action_kind is validated against the frozen permission vocabulary by
  // requiredLevel below (which throws loudly on foreign values).
  if (!isBlastRadius(value['blast_radius'])) {
    throw new AutonomyError(
      `autonomy raise blast_radius must be one of [COMPONENT, SERVICE, SYSTEM, ORGANIZATION], received: ${JSON.stringify(value['blast_radius'])}`,
    );
  }
  if (!isAutonomyLevel(value['from_level'])) {
    throw new AutonomyError(`autonomy raise from_level must be a frozen autonomy level, received: ${JSON.stringify(value['from_level'])}`);
  }
  if (!isAutonomyLevel(value['to_level'])) {
    throw new AutonomyError(`autonomy raise to_level must be a frozen autonomy level, received: ${JSON.stringify(value['to_level'])}`);
  }
  if (AUTONOMY_LEVEL_RANKS[value['to_level']] <= AUTONOMY_LEVEL_RANKS[value['from_level']]) {
    throw new AutonomyError(
      `autonomy raise to_level ${value['to_level']} must rank STRICTLY above from_level ${value['from_level']} (a raise never equalizes or lowers; reductions are policy changes, not raises)`,
    );
  }
  if (value['from_level'] !== requiredLevel(value['action_kind'] as AutonomyActionKind, value['blast_radius'] as BlastRadius)) {
    throw new AutonomyError(
      `autonomy raise from_level ${value['from_level']} must be the policy-table default for (${JSON.stringify(value['action_kind'])}, ${value['blast_radius']}) — raises are anchored to the documented baseline, never compounded`,
    );
  }
  if (!isNonEmptyString(value['rationale'])) {
    throw new AutonomyError('autonomy raise rationale must be a non-empty string');
  }
  if (!isNonEmptyString(value['authorizing_grant_ref'])) {
    throw new AutonomyError('autonomy raise authorizing_grant_ref must be a non-empty spine artifact id');
  }
  if (!isPlainObject(value['expiry'])) {
    throw new AutonomyError('autonomy raise expiry must be a grant expiry { kind: "TIME", at } or { kind: "REVISION", artifact_id, max_version }');
  }
}

const ARTIFACT_KEYS = ['envelope', 'content'] as const;

/** Full semantic validation of an autonomy raise artifact (throws AutonomyError). */
export function assertValidAutonomyRaise(value: unknown): asserts value is AutonomyRaiseArtifact {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new AutonomyError('autonomy raise artifact must be an object with exact fields { envelope, content }');
  }
  const record = value as Record<string, unknown>;
  const actualKeys = Object.keys(record);
  const expected = new Set<string>(ARTIFACT_KEYS);
  if (actualKeys.length !== ARTIFACT_KEYS.length || !actualKeys.every((key) => expected.has(key))) {
    throw new AutonomyError('autonomy raise artifact must be an object with exact fields { envelope, content }');
  }
  try {
    assertValidEnvelope(record['envelope']);
  } catch (cause) {
    throw new AutonomyError(`autonomy raise envelope is not spine-valid: ${(cause as Error).message}`);
  }
  const envelope = record['envelope'] as ArtifactEnvelope;
  if (envelope.kind !== AUTONOMY_RAISE_KIND) {
    throw new AutonomyError(
      `autonomy raise envelope kind must be "${AUTONOMY_RAISE_KIND}", received: ${JSON.stringify(envelope.kind)}`,
    );
  }
  assertValidAutonomyRaiseContent(record['content']);
}

/** Predicate form of assertValidAutonomyRaise. */
export function validateAutonomyRaise(value: unknown): value is AutonomyRaiseArtifact {
  try {
    assertValidAutonomyRaise(value);
    return true;
  } catch {
    return false;
  }
}

export function autonomyRaiseCreationAddress(
  input: AuthorizeAutonomyRaiseInput,
  content: AutonomyRaiseContent,
): AutonomyRaiseCreationAddress {
  return {
    kind: AUTONOMY_RAISE_KIND,
    version: input.version ?? 1,
    status: input.status ?? 'DRAFT',
    authority_ref: input.grant.envelope.id,
    provenance: [...input.provenance],
    created_at: input.created_at,
    supersedes: input.supersedes ?? null,
    content,
  };
}

/** Derive the deterministic raise artifact id for a mint input + content. */
export function autonomyRaiseId(input: AuthorizeAutonomyRaiseInput, content: AutonomyRaiseContent): string {
  return deriveDeterministicArtifactId(AUTONOMY_RAISE_KIND, autonomyRaiseCreationAddress(input, content));
}

/**
 * Mint a GOVERNED autonomy raise. Every escalation attempt fails loudly
 * (AutonomyError):
 *
 *   1. the grant must be structurally valid and VALID at `at` (an expired,
 *      revoked or indeterminately-evaluable grant never authorizes a raise —
 *      a SILENT raise is impossible by construction);
 *   2. the grant's scope must cover the raise's scope;
 *   3. the grant must carry the action kind's permission;
 *   4. the raise's expiry must be within the grant's expiry;
 *   5. to_level must rank strictly above the anchored baseline from_level.
 */
export function authorizeAutonomyRaise(input: AuthorizeAutonomyRaiseInput): AutonomyRaiseArtifact {
  if (typeof input !== 'object' || input === null) {
    throw new AutonomyError('autonomy raise input must be an object');
  }
  if (!Array.isArray(input.provenance) || input.provenance.length === 0 || !input.provenance.every(isNonEmptyString)) {
    throw new AutonomyError('autonomy raise provenance must be a non-empty array of non-empty strings');
  }
  if (!isNonEmptyString(input.created_at)) {
    throw new AutonomyError('autonomy raise created_at must be a non-empty RFC3339 timestamp');
  }
  if (!isNonEmptyString(input.rationale)) {
    throw new AutonomyError('autonomy raise rationale must be a non-empty string (no silent raises)');
  }

  assertValidGrant(input.grant);

  // 1. The grant must be VALID at the raise's evaluation point.
  let grantStatus: string;
  try {
    grantStatus = evaluateGrant(input.grant, input.at);
  } catch (cause) {
    throw new AutonomyError(
      `autonomy raise rejected: the authorizing grant ${input.grant.envelope.id} cannot be evaluated at the given point (${(cause as Error).message}) — a silent raise is impossible by construction`,
    );
  }
  if (grantStatus !== 'VALID') {
    throw new AutonomyError(
      `autonomy raise rejected: the authorizing grant ${input.grant.envelope.id} is ${grantStatus} at the raise's evaluation point (expired and revoked grants never authorize — least of all autonomy raises)`,
    );
  }

  // 2. The grant's scope must cover the raise's scope.
  const raiseTarget =
    input.scope.kind === 'ARTIFACT'
      ? ({ kind: 'ARTIFACT', artifact_id: input.scope.artifact_id } as const)
      : ({ kind: 'KIND', artifact_kind: input.scope.artifact_kind } as const);
  if (!scopeCovers(input.grant.content.scope, raiseTarget)) {
    throw new AutonomyError(
      `autonomy raise rejected: scope violation — grant ${input.grant.envelope.id} does not cover the raise's scope (narrower never authorizes broader)`,
    );
  }

  // 3. The grant must carry the action kind's permission.
  if (!input.grant.content.permissions.includes(input.action_kind)) {
    throw new AutonomyError(
      `autonomy raise rejected: grant ${input.grant.envelope.id} does not carry permission ${JSON.stringify(input.action_kind)} (raising autonomy for an act requires authority over that act)`,
    );
  }

  // 5. The requested level must strictly raise the anchored baseline.
  const fromLevel = requiredLevel(input.action_kind, input.blast_radius);
  if (!isAutonomyLevel(input.to_level)) {
    throw new AutonomyError(
      `autonomy raise to_level must be one of [SUPERVISED, BOUNDED, AUTONOMOUS_LOW_RISK], received: ${JSON.stringify(input.to_level)}`,
    );
  }
  if (AUTONOMY_LEVEL_RANKS[input.to_level] <= AUTONOMY_LEVEL_RANKS[fromLevel]) {
    throw new AutonomyError(
      `autonomy raise rejected: to_level ${input.to_level} does not rank strictly above the policy default ${fromLevel} for (${input.action_kind}, ${input.blast_radius}) — silent equal/lower "raises" are not raises`,
    );
  }

  // 4. The raise never outlives its grant.
  const expiry = input.expiry ?? input.grant.content.expiry;
  if (!expiryIsWithin(expiry, input.grant.content.expiry)) {
    throw new AutonomyError(
      `autonomy raise rejected: the raise's expiry is not within the authorizing grant ${input.grant.envelope.id} expiry (a raise never outlives its grant)`,
    );
  }

  const content: AutonomyRaiseContent = {
    action_kind: input.action_kind,
    scope: structuredClone(input.scope),
    blast_radius: input.blast_radius,
    from_level: fromLevel,
    to_level: input.to_level,
    rationale: input.rationale,
    authorizing_grant_ref: input.grant.envelope.id,
    expiry: structuredClone(expiry),
  };
  assertValidAutonomyRaiseContent(content);

  const address = autonomyRaiseCreationAddress(input, content);
  const id = deriveDeterministicArtifactId(AUTONOMY_RAISE_KIND, address);
  const envelope = createEnvelope({
    kind: AUTONOMY_RAISE_KIND,
    version: address.version,
    status: address.status,
    authority_ref: address.authority_ref,
    provenance: address.provenance,
    created_at: address.created_at,
    supersedes: address.supersedes,
    id,
  });
  return { envelope, content };
}

/**
 * Is a raise APPLICABLE to a request at an evaluation point? The raise's
 * authorizing grant must be presented, currently VALID, carry the action
 * permission and cover the raise's scope; the raise's own blast radius and
 * action kind must match the request. Pure + deterministic; NEVER throws
 * for well-formed input (an inapplicable or unprovable raise simply does
 * not apply — fail-closed toward the more restrictive default).
 */
export function raiseApplies(
  raise: AutonomyRaiseArtifact,
  request: {
    action_kind: AutonomyActionKind;
    blast_radius: BlastRadius;
    grants: readonly AuthorityGrantArtifact[];
  },
  at: GrantEvaluationInput,
): boolean {
  try {
    assertValidAutonomyRaise(raise);
  } catch {
    return false; // malformed raises never apply
  }
  if (raise.content.action_kind !== request.action_kind || raise.content.blast_radius !== request.blast_radius) {
    return false;
  }
  const backing = request.grants.find((grant) => grant.envelope.id === raise.content.authorizing_grant_ref);
  if (backing === undefined) {
    return false; // the raise's authority was not presented — unproven, does not apply
  }
  let status: string;
  try {
    status = evaluateGrant(backing, at);
  } catch {
    return false; // indeterminate backing — does not apply
  }
  if (status !== 'VALID') {
    return false; // dead backing — does not apply
  }
  if (!backing.content.permissions.includes(request.action_kind)) {
    return false;
  }
  const raiseTarget =
    raise.content.scope.kind === 'ARTIFACT'
      ? ({ kind: 'ARTIFACT', artifact_id: raise.content.scope.artifact_id } as const)
      : ({ kind: 'KIND', artifact_kind: raise.content.scope.artifact_kind } as const);
  if (!scopeCovers(backing.content.scope, raiseTarget)) {
    return false;
  }
  return true;
}
