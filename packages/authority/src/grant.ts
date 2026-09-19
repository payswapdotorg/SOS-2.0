/**
 * AuthorityGrant artifacts — scoped grants with permissions, expiry
 * (time or revision-bound) and revocation.
 *
 * Realizes Work Order W1 ("scoped authority grants with expiry and
 * revocation") under spec/architecture.md §3 Authority and
 * spec/requirements.md R15 (authority-aware autonomy): autonomy is bounded
 * by explicit, evaluable grants — nothing is authorized implicitly.
 *
 * Identity discipline (same as the other W1 packages): envelopes come from
 * the spine; ids are content-addressed over the exact creation address
 * (every envelope field except `id`, plus the grant content). Grants are
 * born VALID; EXPIRED is reached by deterministic evaluation; REVOKED is
 * reached by an explicit revocation recorded as a new grant revision
 * (see store.ts). EXPIRED and REVOKED are terminal — an expired or revoked
 * grant NEVER authorizes (asserted in tests).
 */

import {
  assertValidEnvelope,
  createEnvelope,
  deriveDeterministicArtifactId,
  isArtifactId,
  isRegisteredArtifactKind,
  RFC3339_PATTERN,
} from '@sos-2/semantic-spine';
import type { ArtifactEnvelope, ArtifactStatus } from '@sos-2/semantic-spine';
import { AuthorityError } from './errors.js';
import { isGrantPermission } from './permissions.js';

export const AUTHORITY_GRANT_KIND = 'AuthorityGrant';

/** A grant scoped to ONE artifact (narrow) or to a whole artifact kind (broad). */
export type GrantScope =
  | { kind: 'ARTIFACT'; artifact_id: string }
  | { kind: 'KIND'; artifact_kind: string };

/** A grant expiry: at a moment in time, or when a revision bound is passed. */
export type GrantExpiry =
  | { kind: 'TIME'; at: string }
  | { kind: 'REVISION'; artifact_id: string; max_version: number };

export interface GrantContent {
  /** Who/what receives the authority (non-empty). */
  grantee: string;
  scope: GrantScope;
  /** Non-empty, unique, all from the permission vocabulary. */
  permissions: string[];
  expiry: GrantExpiry;
  /** RFC3339 revocation instant, or null while the grant stands. */
  revoked_at: string | null;
  /** Provenance of the revocation; empty iff revoked_at is null. */
  revocation_provenance: string[];
}

export interface AuthorityGrantArtifact {
  envelope: ArtifactEnvelope;
  content: GrantContent;
}

export interface CreateGrantInput {
  grantee: string;
  scope: GrantScope;
  permissions: string[];
  expiry: GrantExpiry;
  provenance: string[];
  created_at: string;
  /** The granting authority (Constitution, Mission, a parent grant...), or null. */
  authority_ref?: string | null;
  version?: number;
  status?: ArtifactStatus;
  supersedes?: string | null;
}

export interface GrantCreationAddress {
  kind: 'AuthorityGrant';
  version: number;
  status: ArtifactStatus;
  authority_ref: string | null;
  provenance: string[];
  created_at: string;
  supersedes: string | null;
  content: GrantContent;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Validate a GrantScope (throws AuthorityError). */
export function validateGrantScope(value: unknown): asserts value is GrantScope {
  if (!isPlainObject(value)) {
    throw new AuthorityError(`grant scope must be an object, received: ${JSON.stringify(value)}`);
  }
  if (value['kind'] === 'ARTIFACT') {
    if (Object.keys(value).length !== 2 || typeof value['artifact_id'] !== 'string' || !isArtifactId(value['artifact_id'])) {
      throw new AuthorityError('ARTIFACT scope requires exactly { kind: "ARTIFACT", artifact_id } with a well-formed artifact id');
    }
    return;
  }
  if (value['kind'] === 'KIND') {
    if (
      Object.keys(value).length !== 2 ||
      typeof value['artifact_kind'] !== 'string' ||
      !isRegisteredArtifactKind(value['artifact_kind'])
    ) {
      throw new AuthorityError(
        `KIND scope requires exactly { kind: "KIND", artifact_kind } with a REGISTERED artifact kind, received: ${JSON.stringify(value['artifact_kind'])}`,
      );
    }
    return;
  }
  throw new AuthorityError(`grant scope kind must be ARTIFACT or KIND, received: ${JSON.stringify(value['kind'])}`);
}

/** Validate a GrantExpiry (throws AuthorityError). */
export function validateGrantExpiry(value: unknown): asserts value is GrantExpiry {
  if (!isPlainObject(value)) {
    throw new AuthorityError(`grant expiry must be an object, received: ${JSON.stringify(value)}`);
  }
  if (value['kind'] === 'TIME') {
    if (Object.keys(value).length !== 2 || typeof value['at'] !== 'string' || !RFC3339_PATTERN.test(value['at'])) {
      throw new AuthorityError('TIME expiry requires exactly { kind: "TIME", at } with an RFC3339 timestamp');
    }
    return;
  }
  if (value['kind'] === 'REVISION') {
    const maxVersion = value['max_version'];
    if (
      Object.keys(value).length !== 3 ||
      typeof value['artifact_id'] !== 'string' ||
      !isArtifactId(value['artifact_id']) ||
      typeof maxVersion !== 'number' ||
      !Number.isInteger(maxVersion) ||
      maxVersion < 1
    ) {
      throw new AuthorityError(
        'REVISION expiry requires exactly { kind: "REVISION", artifact_id, max_version } with a well-formed artifact id and an integer max_version >= 1',
      );
    }
    return;
  }
  throw new AuthorityError(`grant expiry kind must be TIME or REVISION, received: ${JSON.stringify(value['kind'])}`);
}

const CONTENT_KEYS = ['grantee', 'scope', 'permissions', 'expiry', 'revoked_at', 'revocation_provenance'] as const;

/** Validate grant content (throws AuthorityError). */
export function validateGrantContent(value: unknown): asserts value is GrantContent {
  if (!isPlainObject(value)) {
    throw new AuthorityError(`grant content must be an object, received: ${JSON.stringify(value)}`);
  }
  const actual = Object.keys(value);
  const expected = new Set<string>(CONTENT_KEYS);
  if (actual.length !== CONTENT_KEYS.length || !actual.every((key) => expected.has(key))) {
    throw new AuthorityError(`grant content must have the exact field set { ${CONTENT_KEYS.join(', ')} }`);
  }
  if (typeof value['grantee'] !== 'string' || (value['grantee'] as string).length === 0) {
    throw new AuthorityError(`grant grantee must be a non-empty string, received: ${JSON.stringify(value['grantee'])}`);
  }
  validateGrantScope(value['scope']);
  validateGrantExpiry(value['expiry']);
  const permissions = value['permissions'];
  if (
    !Array.isArray(permissions) ||
    permissions.length === 0 ||
    !permissions.every((entry) => isGrantPermission(entry)) ||
    new Set(permissions as string[]).size !== (permissions as string[]).length
  ) {
    throw new AuthorityError(
      `grant permissions must be a non-empty, duplicate-free array from [${'READ, REVISE, RETIRE, PROMOTE, DELEGATE'}], received: ${JSON.stringify(permissions)}`,
    );
  }
  const revokedAt = value['revoked_at'];
  if (revokedAt !== null && (typeof revokedAt !== 'string' || !RFC3339_PATTERN.test(revokedAt))) {
    throw new AuthorityError(`grant revoked_at must be an RFC3339 timestamp or null, received: ${JSON.stringify(revokedAt)}`);
  }
  const revocationProvenance = value['revocation_provenance'];
  if (!Array.isArray(revocationProvenance) || !revocationProvenance.every((entry) => typeof entry === 'string' && entry.length > 0)) {
    throw new AuthorityError('grant revocation_provenance must be an array of non-empty strings');
  }
  if (revokedAt === null && revocationProvenance.length > 0) {
    throw new AuthorityError('grant revocation_provenance must be empty when revoked_at is null');
  }
  if (revokedAt !== null && revocationProvenance.length === 0) {
    throw new AuthorityError('grant revocation_provenance must be non-empty when revoked_at is set');
  }
}

export function grantCreationAddress(input: CreateGrantInput, content: GrantContent): GrantCreationAddress {
  return {
    kind: AUTHORITY_GRANT_KIND,
    version: input.version ?? 1,
    status: input.status ?? 'DRAFT',
    authority_ref: input.authority_ref ?? null,
    provenance: [...input.provenance],
    created_at: input.created_at,
    supersedes: input.supersedes ?? null,
    content,
  };
}

/** Derive the deterministic grant artifact id for a creation input + content. */
export function grantArtifactId(input: CreateGrantInput, content: GrantContent): string {
  return deriveDeterministicArtifactId(AUTHORITY_GRANT_KIND, grantCreationAddress(input, content));
}

/**
 * Create a grant artifact. Grants are born un-revoked (revoked_at null,
 * empty revocation provenance); the initial envelope status is DRAFT by
 * default — callers activating a grant immediately pass status: 'ACTIVE'.
 */
export function createGrant(input: CreateGrantInput): AuthorityGrantArtifact {
  if (typeof input !== 'object' || input === null) {
    throw new AuthorityError('grant creation input must be an object');
  }
  const content: GrantContent = {
    grantee: input.grantee,
    scope: structuredClone(input.scope),
    permissions: [...input.permissions],
    expiry: structuredClone(input.expiry),
    revoked_at: null,
    revocation_provenance: [],
  };
  validateGrantContent(content);

  const address = grantCreationAddress(input, content);
  const id = deriveDeterministicArtifactId(AUTHORITY_GRANT_KIND, address);
  const envelope = createEnvelope({
    kind: AUTHORITY_GRANT_KIND,
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

const ARTIFACT_KEYS = ['envelope', 'content'] as const;

/**
 * Full semantic validation of a grant artifact (throws AuthorityError):
 * exact artifact shape, spine-valid envelope of kind AuthorityGrant, valid
 * grant content. (Identity is minted at creation and preserved across
 * transitions — re-derivation is intentionally not part of validation,
 * mirroring the spine.)
 */
export function assertValidGrant(value: unknown): asserts value is AuthorityGrantArtifact {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new AuthorityError('grant artifact must be an object with exact fields { envelope, content }');
  }
  const record = value as Record<string, unknown>;
  const actualKeys = Object.keys(record);
  const expected = new Set<string>(ARTIFACT_KEYS);
  if (actualKeys.length !== ARTIFACT_KEYS.length || !actualKeys.every((key) => expected.has(key))) {
    throw new AuthorityError('grant artifact must be an object with exact fields { envelope, content }');
  }
  try {
    assertValidEnvelope(record['envelope']);
  } catch (cause) {
    throw new AuthorityError(`grant envelope is not spine-valid: ${(cause as Error).message}`);
  }
  const envelope = record['envelope'] as ArtifactEnvelope;
  if (envelope.kind !== AUTHORITY_GRANT_KIND) {
    throw new AuthorityError(
      `grant artifact envelope kind must be "${AUTHORITY_GRANT_KIND}", received: ${JSON.stringify(envelope.kind)}`,
    );
  }
  validateGrantContent(record['content']);
}

/** Predicate form of assertValidGrant. */
export function validateGrant(value: unknown): value is AuthorityGrantArtifact {
  try {
    assertValidGrant(value);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Grant lifecycle: VALID -> EXPIRED/REVOKED with deterministic evaluation.
// ---------------------------------------------------------------------------

/** The grant status vocabulary (derived status of a grant artifact). */
export const GRANT_STATUSES = ['VALID', 'EXPIRED', 'REVOKED'] as const;

export type GrantStatus = (typeof GRANT_STATUSES)[number];

/**
 * The grant status transition table. EXPIRED and REVOKED are terminal —
 * expired/revoked grants never return to VALID and never authorize.
 */
export const ALLOWED_GRANT_TRANSITIONS: Readonly<Record<GrantStatus, readonly GrantStatus[]>> = {
  VALID: ['EXPIRED', 'REVOKED'],
  EXPIRED: [],
  REVOKED: [],
};

export function canTransitionGrantStatus(from: GrantStatus, to: GrantStatus): boolean {
  return ALLOWED_GRANT_TRANSITIONS[from]?.includes(to) === true;
}

/**
 * Validate a grant status transition and return the target status.
 * Invalid transitions (REVOKED -> VALID, EXPIRED -> anything, re-revocation,
 * "renewal" of an expired grant, ...) throw — invalid authority transitions
 * fail loudly.
 */
export function transitionGrantStatus(from: GrantStatus, to: GrantStatus): GrantStatus {
  if (!GRANT_STATUSES.includes(from)) {
    throw new AuthorityError(`unknown grant status: ${JSON.stringify(from)}`);
  }
  if (!GRANT_STATUSES.includes(to)) {
    throw new AuthorityError(`unknown grant status: ${JSON.stringify(to)}`);
  }
  if (!canTransitionGrantStatus(from, to)) {
    throw new AuthorityError(`invalid grant status transition: ${from} -> ${to} (EXPIRED and REVOKED are terminal; expired or revoked grants never authorize again)`);
  }
  return to;
}

/** The evaluation input: a moment in time OR a revision checkpoint — matching evaluate(grant, now|revision). */
export type GrantEvaluationInput =
  | { kind: 'TIME'; now: string }
  | { kind: 'REVISION'; artifact_id: string; version: number };

function validateEvaluationInput(input: GrantEvaluationInput): void {
  if (!isPlainObject(input)) {
    throw new AuthorityError('grant evaluation input must be { kind: "TIME", now } or { kind: "REVISION", artifact_id, version }');
  }
  if (input['kind'] === 'TIME') {
    if (Object.keys(input).length !== 2 || typeof input['now'] !== 'string' || !RFC3339_PATTERN.test(input['now'])) {
      throw new AuthorityError('TIME evaluation input requires exactly { kind: "TIME", now } with an RFC3339 timestamp');
    }
    return;
  }
  if (input['kind'] === 'REVISION') {
    const version = input['version'];
    if (
      Object.keys(input).length !== 3 ||
      typeof input['artifact_id'] !== 'string' ||
      !isArtifactId(input['artifact_id']) ||
      typeof version !== 'number' ||
      !Number.isInteger(version) ||
      version < 1
    ) {
      throw new AuthorityError(
        'REVISION evaluation input requires exactly { kind: "REVISION", artifact_id, version } with a well-formed artifact id and an integer version >= 1',
      );
    }
    return;
  }
  throw new AuthorityError(`grant evaluation input kind must be TIME or REVISION, received: ${JSON.stringify(input['kind'])}`);
}

function epochMillis(timestamp: string): number {
  const millis = Date.parse(timestamp);
  if (Number.isNaN(millis)) {
    throw new AuthorityError(`unparseable RFC3339 timestamp: ${JSON.stringify(timestamp)}`);
  }
  return millis;
}

/**
 * Deterministic grant evaluation — evaluate(grant, now | revision).
 *
 * Rules (checked in order; total and deterministic):
 *   1. revoked_at !== null        -> REVOKED (revocation beats expiry).
 *   2. TIME expiry + TIME input  : EXPIRED iff now >= at (a grant is valid
 *      strictly BEFORE its expiry instant); timestamps compare as instants
 *      (offsets honored), never as strings.
 *   3. REVISION expiry + REVISION input for the SAME artifact: EXPIRED iff
 *      version > max_version; otherwise VALID.
 *   4. Mismatched input (a time-bound grant evaluated against a revision
 *      checkpoint, a revision-bound grant evaluated against the clock, or a
 *      revision checkpoint for a DIFFERENT artifact) is INDETERMINATE and
 *      fails loudly (AuthorityError) — indeterminacy is never silently
 *      treated as VALID.
 */
export function evaluateGrant(grant: AuthorityGrantArtifact, input: GrantEvaluationInput): GrantStatus {
  assertValidGrant(grant);
  validateEvaluationInput(input);

  if (grant.content.revoked_at !== null) {
    return 'REVOKED';
  }

  const expiry = grant.content.expiry;
  if (expiry.kind === 'TIME') {
    if (input.kind !== 'TIME') {
      throw new AuthorityError(
        `indeterminate evaluation: time-bound grant ${grant.envelope.id} cannot be evaluated against a revision checkpoint (supply { kind: "TIME", now })`,
      );
    }
    return epochMillis(input.now) >= epochMillis(expiry.at) ? 'EXPIRED' : 'VALID';
  }

  if (input.kind !== 'REVISION') {
    throw new AuthorityError(
      `indeterminate evaluation: revision-bound grant ${grant.envelope.id} cannot be evaluated against a clock (supply { kind: "REVISION", artifact_id, version } for ${expiry.artifact_id})`,
    );
  }
  if (input.artifact_id !== expiry.artifact_id) {
    throw new AuthorityError(
      `indeterminate evaluation: revision-bound grant ${grant.envelope.id} is bound to ${expiry.artifact_id}, but the checkpoint describes ${input.artifact_id}`,
    );
  }
  return input.version > expiry.max_version ? 'EXPIRED' : 'VALID';
}

/** Predicate: is the grant VALID at the evaluation input? (Never throws for well-formed input.) */
export function isGrantValid(grant: AuthorityGrantArtifact, input: GrantEvaluationInput): boolean {
  return evaluateGrant(grant, input) === 'VALID';
}
