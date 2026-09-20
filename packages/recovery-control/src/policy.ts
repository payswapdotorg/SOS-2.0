/**
 * The trusted recovery policy and its authority-gated mutation path
 * (Work Order W8 TRUSTED BOUNDARY: "candidate code cannot disable assurance
 * policy — the assurance/recovery control types accept changes only through
 * authority-gated paths (integrate @sos-2/authority grants)").
 *
 * spec/architecture-lock.md forbids "the trusted assurance mechanism
 * disabled by untrusted candidate code". The policy therefore accepts
 * changes ONLY through a path that requires BOTH:
 *
 *   1. TRUSTED ORIGIN — the change is explicitly tagged
 *      origin: 'TRUSTED_OPERATORS'. A change tagged origin: 'CANDIDATE' is
 *      REJECTED UNCONDITIONALLY — no grant, however broad, lifts this
 *      (stolen or over-delegated grants are exactly the scenario the lock
 *      exists for). Candidates may PROPOSE through the governed ASK /
 *      Architect path, which is outside this package.
 *
 *   2. VALID AUTHORITY — a live AuthorityGrant (the merged W1 authority:
 *      authorize(grant, request) — loud refusal on expired/revoked grants,
 *      scope violations and missing permissions) carrying the REVISE
 *      permission and covering THIS policy artifact (an ARTIFACT-scoped
 *      grant for exactly this policy, or a KIND-scoped RecoveryPolicy
 *      grant).
 *
 * Additionally, WEAKENING the policy (setting require_bounded_recovery to
 * false — disabling the bounded-recovery control) requires an explicit
 * GOVERNED EXCEPTION RECORD defining the alternative containment mechanism,
 * mirroring the per-change exception rule: turning the global rule off is
 * itself an exceptional act (spec/architecture.md section 13).
 *
 * A RecoveryPolicyArtifact is a Semantic Spine envelope (extension kind
 * "RecoveryPolicy", registered through the sanctioned add-only API) plus
 * the exact content { require_bounded_recovery }. The DEFAULT policy (the
 * section 13 rule) requires bounded recovery.
 */

import {
  assertValidEnvelope,
  createEnvelope,
  deriveDeterministicArtifactId,
  registerArtifactKind,
} from '@sos-2/semantic-spine';
import type { ArtifactEnvelope, ArtifactStatus } from '@sos-2/semantic-spine';
import { authorize } from '@sos-2/authority';
import type { AuthorityGrantArtifact, GrantEvaluationInput } from '@sos-2/authority';
import { RecoveryPolicyError, TrustedBoundaryError } from './errors.js';
import { assertValidGovernedException } from './declaration.js';
import type { GovernedException } from './declaration.js';

/** The artifact kind segment used for recovery policy ids. */
export const RECOVERY_POLICY_KIND = 'RecoveryPolicy';

/**
 * Register the RecoveryPolicy extension kind in the spine's kind registry
 * (idempotent, add-only — the W3/W5 precedent).
 */
export function registerRecoveryPolicyKind(): void {
  try {
    registerArtifactKind(RECOVERY_POLICY_KIND);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    if (!message.includes('already registered')) {
      throw cause;
    }
  }
}

// Register eagerly at module load (documented, idempotent, add-only).
registerRecoveryPolicyKind();

// ---------------------------------------------------------------------------
// Policy artifact
// ---------------------------------------------------------------------------

/** The exact recovery policy content. */
export interface RecoveryPolicyContent {
  /** Live changes require bounded recovery declarations (the section 13 default: true). */
  require_bounded_recovery: boolean;
}

export interface RecoveryPolicyArtifact {
  /** Semantic Spine envelope; kind is always "RecoveryPolicy". */
  envelope: ArtifactEnvelope;
  /** The policy content (exact one-section field set). */
  content: RecoveryPolicyContent;
}

export interface CreateRecoveryPolicyInput {
  /** The policy content. Defaults to { require_bounded_recovery: true }. */
  content?: RecoveryPolicyContent;
  /** REQUIRED non-empty provenance entries (spine discipline). */
  provenance: string[];
  /** RFC3339 creation timestamp, caller-supplied (no hidden clocks). */
  created_at: string;
  /** Authorizing artifact id, or null. */
  authority_ref?: string | null;
  /** Version (integer >= 1). Defaults to 1. */
  version?: number;
  /** DRAFT (default) or ACTIVE. */
  status?: ArtifactStatus;
  /** RecoveryPolicy artifact id superseded by this one, or null. */
  supersedes?: string | null;
}

/** The default policy content: bounded recovery required (spec/architecture.md section 13). */
export function defaultRecoveryPolicyContent(): RecoveryPolicyContent {
  return { require_bounded_recovery: true };
}

/** The exact value a recovery policy artifact id is derived from. */
export interface RecoveryPolicyCreationAddress {
  kind: 'RecoveryPolicy';
  version: number;
  status: ArtifactStatus;
  authority_ref: string | null;
  provenance: string[];
  created_at: string;
  supersedes: string | null;
  content: RecoveryPolicyContent;
}

export function recoveryPolicyCreationAddress(
  input: CreateRecoveryPolicyInput,
): RecoveryPolicyCreationAddress {
  return {
    kind: RECOVERY_POLICY_KIND,
    version: input.version ?? 1,
    status: input.status ?? 'DRAFT',
    authority_ref: input.authority_ref ?? null,
    provenance: [...input.provenance],
    created_at: input.created_at,
    supersedes: input.supersedes ?? null,
    content: structuredClone(input.content ?? defaultRecoveryPolicyContent()),
  };
}

function assertValidRecoveryPolicyContentValue(value: unknown): asserts value is RecoveryPolicyContent {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).length !== 1 ||
    !('require_bounded_recovery' in value) ||
    typeof (value as Record<string, unknown>)['require_bounded_recovery'] !== 'boolean'
  ) {
    throw new RecoveryPolicyError(
      'recovery policy content must be exactly { require_bounded_recovery: boolean }',
    );
  }
}

/** Create a recovery policy artifact (defaults to the section 13 rule). */
export function createRecoveryPolicy(input: CreateRecoveryPolicyInput): RecoveryPolicyArtifact {
  if (typeof input !== 'object' || input === null) {
    throw new RecoveryPolicyError('recovery policy creation input must be an object');
  }
  if (input.content !== undefined) {
    assertValidRecoveryPolicyContentValue(input.content);
  }
  const address = recoveryPolicyCreationAddress(input);
  const id = deriveDeterministicArtifactId(RECOVERY_POLICY_KIND, address);
  const envelope = createEnvelope({
    kind: RECOVERY_POLICY_KIND,
    version: address.version,
    status: address.status,
    authority_ref: address.authority_ref,
    provenance: address.provenance,
    created_at: address.created_at,
    supersedes: address.supersedes,
    id,
  });
  return { envelope, content: structuredClone(address.content) };
}

/** Full semantic validation of a recovery policy artifact (throws RecoveryPolicyError). */
export function assertValidRecoveryPolicy(value: unknown): asserts value is RecoveryPolicyArtifact {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new RecoveryPolicyError('recovery policy artifact must be an object with exact fields { envelope, content }');
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length !== 2 ||
    !('envelope' in record) ||
    !('content' in record)
  ) {
    throw new RecoveryPolicyError('recovery policy artifact must be an object with exact fields { envelope, content }');
  }
  try {
    assertValidEnvelope(record['envelope']);
  } catch (cause) {
    throw new RecoveryPolicyError(`recovery policy envelope is not spine-valid: ${(cause as Error).message}`);
  }
  const envelope = record['envelope'] as ArtifactEnvelope;
  if (envelope.kind !== RECOVERY_POLICY_KIND) {
    throw new RecoveryPolicyError(
      `recovery policy artifact envelope kind must be "${RECOVERY_POLICY_KIND}", received: ${JSON.stringify(envelope.kind)}`,
    );
  }
  assertValidRecoveryPolicyContentValue(record['content']);
}

/** Predicate form of assertValidRecoveryPolicy. */
export function validateRecoveryPolicy(value: unknown): value is RecoveryPolicyArtifact {
  try {
    assertValidRecoveryPolicy(value);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// The trusted, authority-gated mutation path
// ---------------------------------------------------------------------------

/** Where a policy change originates from. */
export const CHANGE_ORIGINS = ['TRUSTED_OPERATORS', 'CANDIDATE'] as const;

export type ChangeOrigin = (typeof CHANGE_ORIGINS)[number];

export function isChangeOrigin(value: unknown): value is ChangeOrigin {
  return typeof value === 'string' && (CHANGE_ORIGINS as readonly string[]).includes(value);
}

export interface RecoveryPolicyChange {
  /** The origin of the change. 'CANDIDATE' is rejected UNCONDITIONALLY (architecture lock). */
  origin: ChangeOrigin;
  /** The exact setting being applied. */
  set: { require_bounded_recovery: boolean };
  /** The authorizing grant (validated through the merged W1 authority). */
  grant: AuthorityGrantArtifact;
  /** The grant evaluation point: { kind: 'TIME', now } or { kind: 'REVISION', artifact_id, version }. */
  at: GrantEvaluationInput;
  /**
   * REQUIRED when weakening (set.require_bounded_recovery === false): the
   * governed exception record defining the alternative containment.
   */
  governed_exception: GovernedException | null;
  /** Provenance of the change (non-empty entries). */
  provenance: string[];
  /** RFC3339 revision creation timestamp. */
  created_at: string;
}

/**
 * Apply a policy change through the TRUSTED, authority-gated path and
 * return the next policy revision (version + 1, supersedes the head).
 *
 * Rejection rules (all loud, in order):
 *   1. origin 'CANDIDATE'  -> TrustedBoundaryError, ALWAYS (no grant lifts
 *      this — the trusted assurance mechanism must not be disabled by
 *      untrusted candidate code);
 *   2. terminal head       -> the policy chain cannot continue from a
 *      SUPERSEDED or RETIRED head;
 *   3. authority           -> authorize(grant, { action: 'REVISE', target:
 *      THIS policy artifact }) must pass (valid, in-scope, permitted —
 *      expired/revoked grants never authorize);
 *   4. weakening           -> setting require_bounded_recovery to false
 *      requires an explicit governed exception record; trusted + granted is
 *      not enough on its own.
 */
export function updateRecoveryPolicy(
  head: RecoveryPolicyArtifact,
  change: RecoveryPolicyChange,
): RecoveryPolicyArtifact {
  assertValidRecoveryPolicy(head);

  if (typeof change !== 'object' || change === null) {
    throw new RecoveryPolicyError('recovery policy change must be an object');
  }
  if (!isChangeOrigin(change.origin)) {
    throw new RecoveryPolicyError(
      `policy change origin must be TRUSTED_OPERATORS or CANDIDATE, received: ${JSON.stringify(change.origin)}`,
    );
  }
  // 1. THE TRUSTED BOUNDARY — checked FIRST, unconditionally.
  if (change.origin === 'CANDIDATE') {
    throw new TrustedBoundaryError(
      'TRUSTED BOUNDARY: candidate-originated attempts to change the recovery/assurance policy are ALWAYS rejected ' +
        '(spec/architecture-lock.md: the trusted assurance mechanism must not be disabled by untrusted candidate code). ' +
        'Candidates propose through the governed ASK / Architect path — never through this one.',
    );
  }

  if (
    typeof change.set !== 'object' ||
    change.set === null ||
    Object.keys(change.set).length !== 1 ||
    typeof change.set.require_bounded_recovery !== 'boolean'
  ) {
    throw new RecoveryPolicyError('policy change set must be exactly { require_bounded_recovery: boolean }');
  }
  if (head.envelope.status === 'SUPERSEDED' || head.envelope.status === 'RETIRED') {
    throw new RecoveryPolicyError(
      `recovery policy ${head.envelope.id} is ${head.envelope.status} — superseded and retired policy heads cannot be revised (create a new chain instead)`,
    );
  }

  // 2. Authority gate — the merged W1 authority decides, loudly.
  authorize(change.grant, {
    action: 'REVISE',
    target: { kind: 'ARTIFACT', artifact_id: head.envelope.id },
    at: change.at,
  });

  // 3. Weakening requires an explicit governed exception record.
  const weakening = change.set.require_bounded_recovery === false && head.content.require_bounded_recovery === true;
  if (weakening) {
    if (change.governed_exception === null) {
      throw new RecoveryPolicyError(
        'DISABLING the bounded-recovery requirement requires an explicit governed exception record defining the ' +
          'alternative containment mechanism (spec/architecture.md section 13) — a trusted origin plus a valid grant is not enough',
      );
    }
    assertValidGovernedException(change.governed_exception);
  }

  if (!Array.isArray(change.provenance) || change.provenance.length === 0 || !change.provenance.every((entry) => typeof entry === 'string' && entry.length > 0)) {
    throw new RecoveryPolicyError('policy change provenance must be a non-empty array of non-empty strings');
  }

  const version = head.envelope.version + 1;
  const address = {
    kind: RECOVERY_POLICY_KIND,
    version,
    status: head.envelope.status,
    authority_ref: head.envelope.authority_ref,
    provenance: [...change.provenance],
    created_at: change.created_at,
    supersedes: head.envelope.id,
    content: { require_bounded_recovery: change.set.require_bounded_recovery },
  };
  const id = deriveDeterministicArtifactId(RECOVERY_POLICY_KIND, address);
  const envelope = createEnvelope({
    kind: RECOVERY_POLICY_KIND,
    version,
    status: head.envelope.status,
    authority_ref: head.envelope.authority_ref,
    provenance: [...change.provenance],
    created_at: change.created_at,
    supersedes: head.envelope.id,
    id,
  });
  return { envelope, content: { require_bounded_recovery: change.set.require_bounded_recovery } };
}
