/**
 * Recovery declarations — the rollback contract of Work Order W8
 * (spec/architecture.md section 13: "Live changes require bounded recovery
 * unless a governed exception defines another containment mechanism";
 * docs/assurance-model.md: "Every live change declares: rollback mechanism,
 * trigger, authority and evidence").
 *
 * A RecoveryDeclarationArtifact is a Semantic Spine envelope (extension kind
 * "RecoveryDeclaration", registered through the spine's sanctioned add-only
 * registerArtifactKind API — the W3 ProvenanceRecord / W5 CorrelationRecord
 * precedent) plus the exact content:
 *
 *   change_ref     the spine artifact id of the LIVE CHANGE being declared
 *                  for (a promoted CandidateState, a Decision, a deployment
 *                  ... — any consequential artifact; recovery-control never
 *                  redefines the change's own kind semantics)
 *   mechanism      the bounded recovery mechanism (see below)
 *   trigger        when recovery fires (see below)
 *   authority_ref  the AuthorityGrant artifact id authorizing the change and
 *                  its rollback path (@sos-2/authority W1)
 *   evidence_ref   the Evidence artifact id demonstrating the declared
 *                  containment WORKS (e.g. a successful rollback rehearsal)
 *   exception      null, or an explicit GOVERNED exception record that
 *                  defines another containment mechanism (the only way an
 *                  unbounded/unspecified mechanism is ever accepted)
 *
 * MECHANISM VOCABULARY (typed; "bounded" = a concrete target):
 *   ROLLBACK_DEPLOYMENT { to_deployment_id }  redeploy a prior deployment
 *   DISABLE_FEATURE     { feature_id }        turn the change off by flag
 *   RESTORE_STATE       { snapshot_id }       restore a data snapshot
 *   CUSTOM_PROCEDURE    { procedure_ref }     execute a referenced concrete
 *                                             procedure
 *   UNSPECIFIED         {}                    NO mechanism declared — always
 *                                             rejected by the policy check
 *                                             unless a governed exception
 *                                             exists
 *
 * TRIGGER VOCABULARY (typed; a trigger must be concrete):
 *   BUDGET    { metric, threshold, window_ms }  auto-fire when the metric
 *                                               crosses the threshold within
 *                                               the window
 *   DEADLINE  { within_ms }                     auto-fire unless success is
 *                                               declared within the bound
 *   MANUAL    { authority_ref }                 an authority pulls the plug
 *                                               (the authority is a spine
 *                                               artifact id — "someone" is
 *                                               not a trigger)
 *
 * Identity discipline (mirrors W1/W2/W3/W4/W5): the artifact id is
 * content-addressed over the exact creation address (every envelope field
 * except `id`, plus the declaration content).
 */

import {
  assertValidEnvelope,
  createEnvelope,
  deriveDeterministicArtifactId,
  isArtifactId,
  parseArtifactId,
  registerArtifactKind,
} from '@sos-2/semantic-spine';
import type { ArtifactEnvelope, ArtifactStatus } from '@sos-2/semantic-spine';
import { RecoveryDeclarationError } from './errors.js';

/** The artifact kind segment used for recovery declaration ids. */
export const RECOVERY_DECLARATION_KIND = 'RecoveryDeclaration';

/**
 * Register the RecoveryDeclaration extension kind in the spine's kind
 * registry. Idempotent: re-registration of the same kind is a no-op. The
 * registry is add-only, so this can never remove or mutate any frozen core
 * kind.
 */
export function registerRecoveryDeclarationKind(): void {
  try {
    registerArtifactKind(RECOVERY_DECLARATION_KIND);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    if (!message.includes('already registered')) {
      throw cause;
    }
  }
}

// Register eagerly at module load (documented, idempotent, add-only): the
// spine's kind registry is the single kind authority and this package's ids
// use the RecoveryDeclaration kind segment.
registerRecoveryDeclarationKind();

// ---------------------------------------------------------------------------
// Mechanisms and triggers
// ---------------------------------------------------------------------------

export const RECOVERY_MECHANISM_KINDS = [
  'ROLLBACK_DEPLOYMENT',
  'DISABLE_FEATURE',
  'RESTORE_STATE',
  'CUSTOM_PROCEDURE',
  'UNSPECIFIED',
] as const;

export type RecoveryMechanismKind = (typeof RECOVERY_MECHANISM_KINDS)[number];

export type RecoveryMechanism =
  | { kind: 'ROLLBACK_DEPLOYMENT'; to_deployment_id: string }
  | { kind: 'DISABLE_FEATURE'; feature_id: string }
  | { kind: 'RESTORE_STATE'; snapshot_id: string }
  | { kind: 'CUSTOM_PROCEDURE'; procedure_ref: string }
  | { kind: 'UNSPECIFIED' };

export const RECOVERY_TRIGGER_KINDS = ['BUDGET', 'DEADLINE', 'MANUAL'] as const;

export type RecoveryTriggerKind = (typeof RECOVERY_TRIGGER_KINDS)[number];

export type RecoveryTrigger =
  | { kind: 'BUDGET'; metric: string; threshold: string; window_ms: number }
  | { kind: 'DEADLINE'; within_ms: number }
  | { kind: 'MANUAL'; authority_ref: string };

/**
 * An explicit GOVERNED exception record: the only way an unbounded or
 * unspecified recovery mechanism is ever accepted
 * (spec/architecture.md section 13 — the exception must itself define
 * another containment mechanism and carry authority + provenance).
 */
export interface GovernedException {
  /** The governing authority artifact id (Decision, AuthorityGrant, AskRequest resolution, ...). */
  authority_ref: string;
  /** The alternative containment mechanism this exception defines (non-empty). */
  containment: string;
  /** Provenance of the exception (non-empty entries — no anonymous exceptions). */
  provenance: string[];
}

// ---------------------------------------------------------------------------
// Content and artifact
// ---------------------------------------------------------------------------

export interface RecoveryDeclarationContent {
  /** The spine artifact id of the live change this declaration is attached to. */
  change_ref: string;
  /** The declared recovery mechanism. */
  mechanism: RecoveryMechanism;
  /** The declared recovery trigger. */
  trigger: RecoveryTrigger;
  /** The AuthorityGrant artifact id authorizing the change and its rollback. */
  authority_ref: string;
  /** The Evidence artifact id demonstrating the declared containment works. */
  evidence_ref: string;
  /** null, or the governed exception accepting another containment mechanism. */
  exception: GovernedException | null;
}

export interface RecoveryDeclarationArtifact {
  /** Semantic Spine envelope; kind is always "RecoveryDeclaration". */
  envelope: ArtifactEnvelope;
  /** The declaration content (exact six-section field set). */
  content: RecoveryDeclarationContent;
}

export interface CreateRecoveryDeclarationInput {
  content: RecoveryDeclarationContent;
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
  /** RecoveryDeclaration artifact id superseded by this one, or null. */
  supersedes?: string | null;
}

/** The exact value a recovery declaration artifact id is derived from. */
export interface RecoveryDeclarationCreationAddress {
  kind: 'RecoveryDeclaration';
  version: number;
  status: ArtifactStatus;
  authority_ref: string | null;
  provenance: string[];
  created_at: string;
  supersedes: string | null;
  content: RecoveryDeclarationContent;
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isNonEmptyStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every((entry) => isNonEmptyString(entry));
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => actual.includes(key));
}

function isPositiveIntegerMs(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

/** Validate a recovery mechanism (throws RecoveryDeclarationError). */
export function assertValidRecoveryMechanism(value: unknown): asserts value is RecoveryMechanism {
  if (!isPlainObject(value)) {
    throw new RecoveryDeclarationError('recovery mechanism must be an object');
  }
  switch (value['kind']) {
    case 'ROLLBACK_DEPLOYMENT':
      if (!hasExactKeys(value, ['kind', 'to_deployment_id']) || !isNonEmptyString(value['to_deployment_id'])) {
        throw new RecoveryDeclarationError(
          'ROLLBACK_DEPLOYMENT mechanism requires exactly { kind, to_deployment_id } with a non-empty prior deployment id (a concrete rollback target)',
        );
      }
      return;
    case 'DISABLE_FEATURE':
      if (!hasExactKeys(value, ['kind', 'feature_id']) || !isNonEmptyString(value['feature_id'])) {
        throw new RecoveryDeclarationError(
          'DISABLE_FEATURE mechanism requires exactly { kind, feature_id } with a non-empty feature id',
        );
      }
      return;
    case 'RESTORE_STATE':
      if (!hasExactKeys(value, ['kind', 'snapshot_id']) || !isNonEmptyString(value['snapshot_id'])) {
        throw new RecoveryDeclarationError(
          'RESTORE_STATE mechanism requires exactly { kind, snapshot_id } with a non-empty snapshot id',
        );
      }
      return;
    case 'CUSTOM_PROCEDURE':
      if (!hasExactKeys(value, ['kind', 'procedure_ref']) || !isNonEmptyString(value['procedure_ref'])) {
        throw new RecoveryDeclarationError(
          'CUSTOM_PROCEDURE mechanism requires exactly { kind, procedure_ref } with a non-empty referenced procedure (a named concrete procedure is bounded; "we will figure it out" is not)',
        );
      }
      return;
    case 'UNSPECIFIED':
      if (!hasExactKeys(value, ['kind'])) {
        throw new RecoveryDeclarationError('UNSPECIFIED mechanism requires exactly { kind }');
      }
      return;
    default:
      throw new RecoveryDeclarationError(
        `recovery mechanism kind must be one of ${RECOVERY_MECHANISM_KINDS.join(' / ')}, received: ${JSON.stringify(value['kind'])}`,
      );
  }
}

/** Validate a recovery trigger (throws RecoveryDeclarationError). */
export function assertValidRecoveryTrigger(value: unknown): asserts value is RecoveryTrigger {
  if (!isPlainObject(value)) {
    throw new RecoveryDeclarationError('recovery trigger must be an object');
  }
  switch (value['kind']) {
    case 'BUDGET':
      if (
        !hasExactKeys(value, ['kind', 'metric', 'threshold', 'window_ms']) ||
        !isNonEmptyString(value['metric']) ||
        !isNonEmptyString(value['threshold']) ||
        !isPositiveIntegerMs(value['window_ms'])
      ) {
        throw new RecoveryDeclarationError(
          'BUDGET trigger requires exactly { kind, metric, threshold, window_ms } with non-empty metric/threshold and a positive integer window_ms',
        );
      }
      return;
    case 'DEADLINE':
      if (!hasExactKeys(value, ['kind', 'within_ms']) || !isPositiveIntegerMs(value['within_ms'])) {
        throw new RecoveryDeclarationError(
          'DEADLINE trigger requires exactly { kind, within_ms } with a positive integer within_ms',
        );
      }
      return;
    case 'MANUAL':
      if (!hasExactKeys(value, ['kind', 'authority_ref']) || !isArtifactId(value['authority_ref'])) {
        throw new RecoveryDeclarationError(
          'MANUAL trigger requires exactly { kind, authority_ref } with a well-formed spine artifact id ("someone will notice" is not a trigger)',
        );
      }
      return;
    default:
      throw new RecoveryDeclarationError(
        `recovery trigger kind must be one of ${RECOVERY_TRIGGER_KINDS.join(' / ')}, received: ${JSON.stringify(value['kind'])}`,
      );
  }
}

/** Validate a governed exception record (throws RecoveryDeclarationError). */
export function assertValidGovernedException(value: unknown): asserts value is GovernedException {
  if (!isPlainObject(value) || !hasExactKeys(value, ['authority_ref', 'containment', 'provenance'])) {
    throw new RecoveryDeclarationError(
      'governed exception must be an object with exact fields { authority_ref, containment, provenance }',
    );
  }
  if (!isArtifactId(value['authority_ref'])) {
    throw new RecoveryDeclarationError(
      `governed exception authority_ref must be a well-formed spine artifact id, received: ${JSON.stringify(value['authority_ref'])}`,
    );
  }
  if (!isNonEmptyString(value['containment'])) {
    throw new RecoveryDeclarationError(
      `governed exception containment must be a non-empty description of the alternative containment mechanism, received: ${JSON.stringify(value['containment'])}`,
    );
  }
  if (!isNonEmptyStringArray(value['provenance'])) {
    throw new RecoveryDeclarationError('governed exception provenance must be a non-empty array of non-empty strings (no anonymous exceptions)');
  }
}

const CONTENT_KEYS = [
  'change_ref',
  'mechanism',
  'trigger',
  'authority_ref',
  'evidence_ref',
  'exception',
] as const;

/**
 * Full semantic validation of the declaration content (throws
 * RecoveryDeclarationError): exact field set, well-formed spine references,
 * the evidence reference must be of kind segment "Evidence".
 */
export function assertValidRecoveryDeclarationContent(
  value: unknown,
): asserts value is RecoveryDeclarationContent {
  if (!isPlainObject(value)) {
    throw new RecoveryDeclarationError('recovery declaration content must be an object');
  }
  const actual = Object.keys(value);
  const expected = new Set<string>(CONTENT_KEYS);
  if (actual.length !== CONTENT_KEYS.length || !actual.every((key) => expected.has(key))) {
    throw new RecoveryDeclarationError(
      `recovery declaration content must have the exact field set { ${CONTENT_KEYS.join(', ')} } (mechanism, trigger, authority and evidence are ALL mandatory — docs/assurance-model.md)`,
    );
  }
  if (!isArtifactId(value['change_ref'])) {
    throw new RecoveryDeclarationError(
      `change_ref must be a well-formed spine artifact id (the live change being declared for), received: ${JSON.stringify(value['change_ref'])}`,
    );
  }
  assertValidRecoveryMechanism(value['mechanism']);
  assertValidRecoveryTrigger(value['trigger']);
  if (!isArtifactId(value['authority_ref'])) {
    throw new RecoveryDeclarationError(
      `authority_ref must be a well-formed spine artifact id (the AuthorityGrant authorizing the change), received: ${JSON.stringify(value['authority_ref'])}`,
    );
  }
  if (!isArtifactId(value['evidence_ref']) || parseArtifactId(value['evidence_ref']).kind !== 'Evidence') {
    throw new RecoveryDeclarationError(
      `evidence_ref must be a well-formed spine artifact id of kind Evidence (sos://Evidence/<32 hex>), received: ${JSON.stringify(value['evidence_ref'])}`,
    );
  }
  if (value['exception'] !== null) {
    assertValidGovernedException(value['exception']);
  }
}

// ---------------------------------------------------------------------------
// Creation and full-artifact validation
// ---------------------------------------------------------------------------

export function recoveryDeclarationCreationAddress(
  input: CreateRecoveryDeclarationInput,
): RecoveryDeclarationCreationAddress {
  return {
    kind: RECOVERY_DECLARATION_KIND,
    version: input.version ?? 1,
    status: input.status ?? 'DRAFT',
    authority_ref: input.authority_ref ?? null,
    provenance: [...input.provenance],
    created_at: input.created_at,
    supersedes: input.supersedes ?? null,
    content: structuredClone(input.content),
  };
}

/** Derive the deterministic recovery declaration artifact id for a creation input. */
export function recoveryDeclarationArtifactId(input: CreateRecoveryDeclarationInput): string {
  return deriveDeterministicArtifactId(RECOVERY_DECLARATION_KIND, recoveryDeclarationCreationAddress(input));
}

/** Create a recovery declaration artifact with a deterministic content-addressed id. */
export function createRecoveryDeclaration(input: CreateRecoveryDeclarationInput): RecoveryDeclarationArtifact {
  if (typeof input !== 'object' || input === null) {
    throw new RecoveryDeclarationError('recovery declaration creation input must be an object');
  }
  assertValidRecoveryDeclarationContent(input.content);
  const address = recoveryDeclarationCreationAddress(input);
  const id = deriveDeterministicArtifactId(RECOVERY_DECLARATION_KIND, address);
  const envelope = createEnvelope({
    kind: RECOVERY_DECLARATION_KIND,
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

const ARTIFACT_KEYS = ['envelope', 'content'] as const;

/**
 * Full semantic validation of a recovery declaration artifact (throws
 * RecoveryDeclarationError).
 */
export function assertValidRecoveryDeclaration(value: unknown): asserts value is RecoveryDeclarationArtifact {
  if (!isPlainObject(value) || !hasExactKeys(value, ARTIFACT_KEYS)) {
    throw new RecoveryDeclarationError('recovery declaration artifact must be an object with exact fields { envelope, content }');
  }
  try {
    assertValidEnvelope(value['envelope']);
  } catch (cause) {
    throw new RecoveryDeclarationError(`recovery declaration envelope is not spine-valid: ${(cause as Error).message}`);
  }
  const envelope = value['envelope'] as ArtifactEnvelope;
  if (envelope.kind !== RECOVERY_DECLARATION_KIND) {
    throw new RecoveryDeclarationError(
      `recovery declaration artifact envelope kind must be "${RECOVERY_DECLARATION_KIND}", received: ${JSON.stringify(envelope.kind)}`,
    );
  }
  assertValidRecoveryDeclarationContent(value['content']);
}

/** Predicate form of assertValidRecoveryDeclaration. */
export function validateRecoveryDeclaration(value: unknown): value is RecoveryDeclarationArtifact {
  try {
    assertValidRecoveryDeclaration(value);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Boundedness
// ---------------------------------------------------------------------------

/**
 * Is the mechanism BOUNDED (a concrete recovery target)? UNSPECIFIED is the
 * unbounded/unspecified case: it is never accepted by the policy check
 * unless an explicit governed exception record exists.
 */
export function isBoundedRecoveryMechanism(mechanism: RecoveryMechanism): boolean {
  return mechanism.kind !== 'UNSPECIFIED';
}

/**
 * Policy validation of a declaration against a recovery policy (throws
 * RecoveryPolicyError from policy.ts via the gate; this pure helper returns
 * the structured verdict):
 *
 *   { required, satisfied, reason }
 *
 *   required   the policy demands bounded recovery for this declaration
 *   satisfied  the declaration meets the policy demand
 *   reason     deterministic explanation (cited verbatim on rejection)
 */
export function checkRecoveryDeclarationAgainstPolicy(
  mechanism: RecoveryMechanism,
  exception: GovernedException | null,
  requireBoundedRecovery: boolean,
): { required: boolean; satisfied: boolean; reason: string } {
  if (!requireBoundedRecovery) {
    return {
      required: false,
      satisfied: true,
      reason: 'the recovery policy does not currently require bounded recovery (weakened through the governed path)',
    };
  }
  if (isBoundedRecoveryMechanism(mechanism)) {
    return {
      required: true,
      satisfied: true,
      reason: `mechanism ${mechanism.kind} is bounded (concrete recovery target)`,
    };
  }
  if (exception !== null) {
    return {
      required: true,
      satisfied: true,
      reason:
        'mechanism is unspecified, but an explicit governed exception record defines another containment mechanism ' +
        '(authorized by the exception authority)',
    };
  }
  return {
    required: true,
    satisfied: false,
    reason:
      'UNBOUNDED RECOVERY REJECTED: the mechanism is unspecified and no governed exception record exists — ' +
      'live changes require bounded recovery (spec/architecture.md section 13); declare a concrete mechanism or attach a governed exception',
  };
}
