/**
 * Credential scoping (Work Order P14).
 *
 * Typed scopes over the P9 action families. PINNED:
 *   - a credential scoped to family set X cannot mint actions of family
 *     Y — SCOPE_EXCEEDED is a typed violation, fail-closed;
 *   - an EXPIRED credential is CREDENTIAL_EXPIRED — stale authority
 *     fails closed (composed with the P9 gateway in the acceptance
 *     suite: the AuthorityPort adapter returns not-granted and the
 *     gateway never invokes an executor);
 *   - scope ESCALATION through the broker is a typed violation
 *     (assertNoBrokerScopeEscalation) — the broker cannot silently
 *     escalate authority (§13).
 *
 * The action-family vocabulary is an INDEPENDENT typed vocabulary that
 * mirrors the merged P9 ACTION_FAMILIES exactly (commit, push,
 * pull-request, deployment, configuration, remediation, promotion,
 * rollback, body-lifecycle). Document-alignment only — no import from
 * @sos-2/action-gateway (the lockfile identity rule); the equality of
 * the two vocabularies is PINNED by the acceptance suite, which imports
 * the merged P9 module directly and compares the family sets.
 *
 * Credentials here are RECORDS ABOUT scope, never credential values —
 * values live in enforcement closures (the secrets isolation module).
 *
 * Determinism: pure functions; expiry is evaluated against an INJECTED
 * timestamp (no ambient clock).
 */

import { CredentialScopeError } from '../errors.js';
import type { Timestamp } from '../types.js';

/**
 * The action-family vocabulary (mirrors the merged P9 ACTION_FAMILIES
 * exactly — pinned by the acceptance suite).
 */
export const ACTION_FAMILY_VOCABULARY = [
  'commit',
  'push',
  'pull-request',
  'deployment',
  'configuration',
  'remediation',
  'promotion',
  'rollback',
  'body-lifecycle',
] as const;

export type ActionFamilyName = (typeof ACTION_FAMILY_VOCABULARY)[number];

const FAMILY_SET: ReadonlySet<string> = new Set(ACTION_FAMILY_VOCABULARY);

/** Structural check: is this one of the nine action families? */
export function isActionFamilyName(value: unknown): value is ActionFamilyName {
  return typeof value === 'string' && FAMILY_SET.has(value);
}

/** Who may hold a credential scope. */
export type CredentialHolder = 'body' | 'human' | 'system';

/**
 * A typed credential scope RECORD — families held (never values; the
 * credential itself lives in a secret store behind a SecretReference).
 */
export interface CredentialScopeRecord {
  readonly credentialId: string;
  readonly heldBy: CredentialHolder;
  /** The holder's stable identity (body id / user id / system component). */
  readonly holderId: string;
  /** The families this credential may mint actions for. */
  readonly families: readonly ActionFamilyName[];
  /** Expiry (injected-clock comparable); null = no expiry declared. */
  readonly expiresAt: Timestamp | null;
  /** The project the credential is scoped to (isolation tie-in). */
  readonly projectId: string;
}

/**
 * The typed scope decision. Everything except SCOPE_GRANTED fails
 * closed: there is no override, no partial grant, no silent widening.
 */
export type CredentialScopeDecision =
  | {
      readonly kind: 'SCOPE_GRANTED';
      readonly credentialId: string;
      readonly family: ActionFamilyName;
    }
  | {
      readonly kind: 'SCOPE_EXCEEDED';
      readonly credentialId: string;
      readonly family: ActionFamilyName;
      readonly heldFamilies: readonly ActionFamilyName[];
      readonly detail: string;
    }
  | {
      readonly kind: 'CREDENTIAL_EXPIRED';
      readonly credentialId: string;
      readonly family: ActionFamilyName;
      readonly expiredAt: Timestamp;
      readonly detail: string;
    }
  | {
      readonly kind: 'CREDENTIAL_UNKNOWN';
      readonly credentialId: string;
      readonly family: ActionFamilyName;
      readonly detail: string;
    };

/**
 * Evaluate whether a credential may mint an action of the requested
 * family at the injected instant.
 *
 *   - unknown/malformed credential  -> CREDENTIAL_UNKNOWN (fail-closed;
 *     an unknown credential is NEVER treated as holding everything);
 *   - expired                       -> CREDENTIAL_EXPIRED (stale fails
 *     closed — no grace period, no extension);
 *   - family not held                -> SCOPE_EXCEEDED (scoped to X
 *     cannot mint Y);
 *   - otherwise                      -> SCOPE_GRANTED.
 */
export function evaluateCredentialScope(
  credential: CredentialScopeRecord | null,
  requestedFamily: ActionFamilyName,
  now: Timestamp,
): CredentialScopeDecision {
  if (!isActionFamilyName(requestedFamily)) {
    throw new CredentialScopeError(`requested family ${JSON.stringify(requestedFamily)} is not part of the action-family vocabulary`);
  }
  if (credential === null || !isWellFormedScope(credential)) {
    return {
      kind: 'CREDENTIAL_UNKNOWN',
      credentialId: credential?.credentialId ?? '(missing)',
      family: requestedFamily,
      detail: 'credential record absent or malformed — an unknown credential holds nothing (fail-closed)',
    };
  }
  if (credential.expiresAt !== null && now >= credential.expiresAt) {
    return {
      kind: 'CREDENTIAL_EXPIRED',
      credentialId: credential.credentialId,
      family: requestedFamily,
      expiredAt: credential.expiresAt,
      detail: `credential expired at ${credential.expiresAt} (now ${now}) — stale authority fails closed`,
    };
  }
  if (!credential.families.includes(requestedFamily)) {
    return {
      kind: 'SCOPE_EXCEEDED',
      credentialId: credential.credentialId,
      family: requestedFamily,
      heldFamilies: credential.families,
      detail: `credential scoped to [${credential.families.join(', ')}] cannot mint actions of family "${requestedFamily}"`,
    };
  }
  return { kind: 'SCOPE_GRANTED', credentialId: credential.credentialId, family: requestedFamily };
}

/** The typed scope-escalation violation (broker discipline, §13). */
export interface ScopeEscalationViolation {
  readonly beforeCredentialId: string;
  readonly afterCredentialId: string;
  readonly addedFamilies: readonly ActionFamilyName[];
  readonly widenedExpiry: boolean;
  readonly detail: string;
}

/**
 * PINNED: scope escalation through the broker is a typed violation. A
 * replacement credential record may only SHRINK scope (drop families)
 * or shorten lifetime — never add families, never extend expiry, never
 * change identity. Returns the typed violation, or null when the
 * transition is non-escalating (or describes different credentials,
 * which callers treat as a separate mint, not an escalation).
 */
export function assertNoBrokerScopeEscalation(
  before: CredentialScopeRecord,
  after: CredentialScopeRecord,
): ScopeEscalationViolation | null {
  if (!isWellFormedScope(before) || !isWellFormedScope(after)) {
    throw new CredentialScopeError('scope-escalation check requires well-formed before/after credential records');
  }
  if (before.credentialId !== after.credentialId) return null;
  const added = after.families.filter((family) => !before.families.includes(family));
  const widenedExpiry =
    before.expiresAt !== null && after.expiresAt !== null && after.expiresAt > before.expiresAt;
  const holderChanged = before.heldBy !== after.heldBy || before.holderId !== after.holderId;
  const projectChanged = before.projectId !== after.projectId;
  if (added.length === 0 && !widenedExpiry && !holderChanged && !projectChanged) return null;
  const problems: string[] = [];
  if (added.length > 0) problems.push(`added families: ${added.join(', ')}`);
  if (widenedExpiry) problems.push(`expiry widened: ${before.expiresAt} -> ${after.expiresAt}`);
  if (holderChanged) problems.push(`holder changed: ${before.heldBy}/${before.holderId} -> ${after.heldBy}/${after.holderId}`);
  if (projectChanged) problems.push(`project changed: ${before.projectId} -> ${after.projectId}`);
  return {
    beforeCredentialId: before.credentialId,
    afterCredentialId: after.credentialId,
    addedFamilies: added,
    widenedExpiry,
    detail: `the broker cannot silently escalate authority — credential ${before.credentialId} transition ${problems.join('; ')}`,
  };
}

/** The throwing seam for the escalation violation. */
export function assertCredentialScope(credential: CredentialScopeRecord | null, family: ActionFamilyName, now: Timestamp): void {
  const decision = evaluateCredentialScope(credential, family, now);
  if (decision.kind !== 'SCOPE_GRANTED') {
    throw new CredentialScopeError(decision.detail);
  }
}

function isWellFormedScope(record: CredentialScopeRecord): boolean {
  if (typeof record.credentialId !== 'string' || record.credentialId.length === 0) return false;
  if (record.heldBy !== 'body' && record.heldBy !== 'human' && record.heldBy !== 'system') return false;
  if (typeof record.holderId !== 'string' || record.holderId.length === 0) return false;
  if (typeof record.projectId !== 'string' || record.projectId.length === 0) return false;
  if (!Array.isArray(record.families) || record.families.length === 0) return false;
  if (!record.families.every((family) => isActionFamilyName(family))) return false;
  if (new Set(record.families).size !== record.families.length) return false;
  if (record.expiresAt !== null && (typeof record.expiresAt !== 'number' || !Number.isFinite(record.expiresAt))) return false;
  return true;
}
