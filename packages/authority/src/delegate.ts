/**
 * Delegation — authority flows downhill only.
 *
 * delegateGrant(parent, spec) mints a child grant that is STRICTLY NARROWER
 * than its parent. Every escalation attempt fails loudly (AuthorityError):
 *
 *   1. the parent must carry the DELEGATE permission and be VALID at the
 *      evaluation point (the delegation act itself is authorized through
 *      the same loud `authorize` gate, with the CHILD SCOPE as the
 *      authorization target — so scope narrowing is enforced by the same
 *      deterministic scope-covering rule);
 *   2. child permissions must be a subset of parent permissions;
 *   3. child expiry must not outlive the parent: same expiry kind, and
 *      within the parent's bound (TIME: child.at <= parent.at compared as
 *      instants; REVISION: same artifact, child.max_version <= parent.max_version).
 *
 * The child's authority_ref is the parent grant id, and the delegation is
 * recorded in the child's provenance.
 */

import { AuthorityError } from './errors.js';
import { authorize } from './authorize.js';
import { createGrant } from './grant.js';
import type { AuthorityGrantArtifact, GrantEvaluationInput, GrantExpiry } from './grant.js';

export interface DelegateGrantSpec {
  grantee: string;
  scope: Parameters<typeof createGrant>[0]['scope'];
  permissions: string[];
  expiry: GrantExpiry;
  provenance: string[];
  created_at: string;
  /** The point at which the parent's validity (and DELEGATE right) is proven. */
  at: GrantEvaluationInput;
}

function epochMillis(timestamp: string): number {
  const millis = Date.parse(timestamp);
  if (Number.isNaN(millis)) {
    throw new AuthorityError(`unparseable RFC3339 timestamp: ${JSON.stringify(timestamp)}`);
  }
  return millis;
}

/** Child expiry must be within the parent's expiry (same kind, within bound). */
export function expiryIsWithin(child: GrantExpiry, parent: GrantExpiry): boolean {
  if (child.kind !== parent.kind) {
    return false;
  }
  if (child.kind === 'TIME' && parent.kind === 'TIME') {
    return epochMillis(child.at) <= epochMillis(parent.at);
  }
  if (child.kind === 'REVISION' && parent.kind === 'REVISION') {
    return child.artifact_id === parent.artifact_id && child.max_version <= parent.max_version;
  }
  return false;
}

/**
 * Mint a strictly-narrower child grant from a parent. Escalation attempts
 * (broader scope, extra permissions, longer life than the parent, or a
 * parent without DELEGATE / not VALID) throw AuthorityError.
 */
export function delegateGrant(parent: AuthorityGrantArtifact, spec: DelegateGrantSpec): AuthorityGrantArtifact {
  // 1. The delegation act itself goes through the loud gate: the parent
  //    must be VALID, carry DELEGATE, and cover the child's scope.
  authorize(parent, {
    action: 'DELEGATE',
    target:
      spec.scope.kind === 'ARTIFACT'
        ? { kind: 'ARTIFACT', artifact_id: spec.scope.artifact_id }
        : { kind: 'KIND', artifact_kind: spec.scope.artifact_kind },
    at: spec.at,
  });

  // 2. Permissions: the child may not gain permissions the parent lacks.
  const extra = spec.permissions.filter((permission) => !parent.content.permissions.includes(permission));
  if (extra.length > 0) {
    throw new AuthorityError(
      `delegation escalation rejected: child grant requests permissions the parent ${parent.envelope.id} does not carry: ${extra.join(', ')}`,
    );
  }

  // 3. Expiry: the child may not outlive the parent.
  if (!expiryIsWithin(spec.expiry, parent.content.expiry)) {
    throw new AuthorityError(
      `delegation escalation rejected: child grant expiry is not within the parent ${parent.envelope.id} expiry (same expiry kind, within the parent's bound — a child grant never outlives its parent)`,
    );
  }

  return createGrant({
    grantee: spec.grantee,
    scope: spec.scope,
    permissions: [...spec.permissions],
    expiry: spec.expiry,
    provenance: [...spec.provenance, `delegated-from:${parent.envelope.id}`],
    created_at: spec.created_at,
    authority_ref: parent.envelope.id,
    version: 1,
    status: 'ACTIVE',
  });
}
