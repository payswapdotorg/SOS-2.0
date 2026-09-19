/**
 * Authorization — the loud gate.
 *
 * authorize(grant, request) is the ONLY sanctioned way to ask "may this
 * grant permit this action on this target at this point?". It fails loudly
 * (AuthorityError) on EVERY refusal path — an expired or revoked grant, a
 * scope violation, a missing permission — and returns the grant on success.
 * canAuthorize is the non-throwing predicate.
 *
 * Scope covering rule (deterministic):
 *   - ARTIFACT scope authorizes requests for exactly that artifact;
 *   - KIND scope authorizes requests for artifacts OF that kind and for the
 *     kind itself;
 *   - an ARTIFACT-scoped grant NEVER authorizes a kind-wide request
 *     (narrower never authorizes broader — anti-escalation).
 *
 * Check order: status (a dead grant authorizes nothing) -> scope ->
 * permission. All three are loud.
 */

import { isArtifactId, parseArtifactId } from '@sos-2/semantic-spine';
import { AuthorityError } from './errors.js';
import { evaluateGrant } from './grant.js';
import type { AuthorityGrantArtifact, GrantEvaluationInput, GrantScope } from './grant.js';

export type AuthorizationTarget =
  | { kind: 'ARTIFACT'; artifact_id: string }
  | { kind: 'KIND'; artifact_kind: string };

export interface AuthorizationRequest {
  /** The permission being exercised (from the grant permission vocabulary). */
  action: string;
  target: AuthorizationTarget;
  /** The evaluation point: { kind: 'TIME', now } or { kind: 'REVISION', artifact_id, version }. */
  at: GrantEvaluationInput;
}

function describeTarget(target: AuthorizationTarget): string {
  return target.kind === 'ARTIFACT' ? `artifact ${target.artifact_id}` : `kind ${target.artifact_kind}`;
}

/** Does `scope` cover `target`? (Pure; false is a scope violation.) */
export function scopeCovers(scope: GrantScope, target: AuthorizationTarget): boolean {
  if (scope.kind === 'ARTIFACT') {
    if (target.kind === 'ARTIFACT') {
      return scope.artifact_id === target.artifact_id;
    }
    return false; // artifact-scoped grants never authorize kind-wide requests
  }
  if (target.kind === 'ARTIFACT') {
    if (!isArtifactId(target.artifact_id)) {
      return false;
    }
    return parseArtifactId(target.artifact_id).kind === scope.artifact_kind;
  }
  return target.artifact_kind === scope.artifact_kind;
}

/**
 * The loud authorization gate. Returns the (valid, in-scope, permissive)
 * grant on success; throws AuthorityError on every refusal path.
 * Expired and revoked grants NEVER authorize.
 */
export function authorize(grant: AuthorityGrantArtifact, request: AuthorizationRequest): AuthorityGrantArtifact {
  const status = evaluateGrant(grant, request.at);
  if (status !== 'VALID') {
    throw new AuthorityError(
      `authorization refused: grant ${grant.envelope.id} is ${status} (expired and revoked grants never authorize)`,
    );
  }
  if (!scopeCovers(grant.content.scope, request.target)) {
    throw new AuthorityError(
      `authorization refused: scope violation — grant ${grant.envelope.id} (${grant.content.scope.kind === 'ARTIFACT' ? `artifact ${grant.content.scope.artifact_id}` : `kind ${grant.content.scope.artifact_kind}`}) does not cover ${describeTarget(request.target)}`,
    );
  }
  if (!grant.content.permissions.includes(request.action)) {
    throw new AuthorityError(
      `authorization refused: grant ${grant.envelope.id} does not carry permission ${JSON.stringify(request.action)} (granted: ${grant.content.permissions.join(', ')})`,
    );
  }
  return grant;
}

/** Non-throwing predicate form of authorize. */
export function canAuthorize(grant: AuthorityGrantArtifact, request: AuthorizationRequest): boolean {
  try {
    authorize(grant, request);
    return true;
  } catch {
    return false;
  }
}
