/**
 * Deployment records — the W12 deployment contract.
 *
 * A DeploymentRecord is a Semantic Spine envelope (extension kind
 * "DeploymentRecord", registered through the spine's sanctioned add-only
 * registerArtifactKind API — the W3 ProvenanceRecord / W8
 * RecoveryDeclaration precedent) plus the exact content:
 *
 *   deployment_id     human deployment identifier (unique within a store)
 *   environment       where the deployment runs (e.g. "production")
 *   artifact_revision the EXACT revision of the deployed artifact (an
 *                     ExactRevision consumed from @sos-2/system-state —
 *                     the W2 contract; kind must be git-sha or
 *                     config-version: deployment-id revisions identify
 *                     deployments themselves and would be circular)
 *   target_runtime    a typed reference to the runtime that serves the
 *                     deployment (id + kind + version — structurally
 *                     compatible with @sos-2/runtimes' RuntimeDescriptor)
 *   configuration     typed configuration values (JSON object)
 *   rollback          the DECLARED rollback: mechanism + trigger +
 *                     authority MIRRORING the merged @sos-2/recovery-control
 *                     declarations — which are CONSUMED, not duplicated:
 *                     the mechanism/trigger validators and the boundedness
 *                     policy are @sos-2/recovery-control's own, so an
 *                     UNSPECIFIED mechanism without a governed exception is
 *                     REJECTED here exactly as W8 rejects it.
 *
 * LIFECYCLE: PLANNED -> DEPLOYED -> ROLLED_BACK, carried by the envelope
 * status (DRAFT -> ACTIVE -> RETIRED — a stricter subset of the spine's
 * legal transitions; PLANNED -> ROLLED_BACK is FORBIDDEN here even though
 * the spine would allow DRAFT -> RETIRED: you cannot roll back what was
 * never deployed). Identity is minted at creation and preserved across
 * transitions (the spine discipline).
 */

import {
  assertValidEnvelope,
  canonicalSerialize,
  createEnvelope,
  deriveDeterministicArtifactId,
  isArtifactId,
  registerArtifactKind,
} from '@sos-2/semantic-spine';
import type { ArtifactEnvelope, ArtifactStatus } from '@sos-2/semantic-spine';
import type { JsonValue } from '@sos-2/semantic-spine';
import { assertExactRevision, assertRevisionKind } from '@sos-2/system-state';
import type { ExactRevision } from '@sos-2/system-state';
import {
  assertValidGovernedException,
  assertValidRecoveryMechanism,
  assertValidRecoveryTrigger,
  checkRecoveryDeclarationAgainstPolicy,
} from '@sos-2/recovery-control';
import type { GovernedException, RecoveryMechanism, RecoveryTrigger } from '@sos-2/recovery-control';
import { DeploymentLifecycleError, DeploymentRecordError } from './errors.js';

/** The artifact kind segment used for deployment record ids. */
export const DEPLOYMENT_RECORD_KIND = 'DeploymentRecord';

/**
 * Register the DeploymentRecord extension kind in the spine's kind
 * registry. Idempotent: re-registration of the same kind is a no-op. The
 * registry is add-only, so this can never remove or mutate any frozen core
 * kind.
 */
export function registerDeploymentRecordKind(): void {
  try {
    registerArtifactKind(DEPLOYMENT_RECORD_KIND);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    if (!message.includes('already registered')) {
      throw cause;
    }
  }
}

// Register eagerly at module load (documented, idempotent, add-only).
registerDeploymentRecordKind();

// ---------------------------------------------------------------------------
// Lifecycle (PLANNED -> DEPLOYED -> ROLLED_BACK)
// ---------------------------------------------------------------------------

export const DEPLOYMENT_LIFECYCLE = ['PLANNED', 'DEPLOYED', 'ROLLED_BACK'] as const;

export type DeploymentLifecycleStatus = (typeof DEPLOYMENT_LIFECYCLE)[number];

/**
 * The deployment lifecycle maps onto the spine's envelope statuses: PLANNED
 * = DRAFT, DEPLOYED = ACTIVE, ROLLED_BACK = RETIRED. Every deployment
 * transition below is therefore also a spine-legal envelope transition —
 * the deployment table is STRICTLY NARROWER (PLANNED -> ROLLED_BACK is
 * forbidden here although DRAFT -> RETIRED is spine-legal).
 */
export const DEPLOYMENT_LIFECYCLE_TO_ENVELOPE: Readonly<
  Record<DeploymentLifecycleStatus, ArtifactStatus>
> = {
  PLANNED: 'DRAFT',
  DEPLOYED: 'ACTIVE',
  ROLLED_BACK: 'RETIRED',
};

export const ENVELOPE_TO_DEPLOYMENT_LIFECYCLE: Readonly<Record<ArtifactStatus, DeploymentLifecycleStatus>> = {
  DRAFT: 'PLANNED',
  ACTIVE: 'DEPLOYED',
  SUPERSEDED: 'DEPLOYED',
  RETIRED: 'ROLLED_BACK',
};

/** The validated transition table (strict subset of the spine's). */
export const ALLOWED_DEPLOYMENT_TRANSITIONS: Readonly<
  Record<DeploymentLifecycleStatus, readonly DeploymentLifecycleStatus[]>
> = {
  PLANNED: ['DEPLOYED'],
  DEPLOYED: ['ROLLED_BACK'],
  ROLLED_BACK: [],
};

export function canTransitionDeploymentLifecycle(
  from: DeploymentLifecycleStatus,
  to: DeploymentLifecycleStatus,
): boolean {
  return ALLOWED_DEPLOYMENT_TRANSITIONS[from]?.includes(to) === true;
}

/**
 * Validate a deployment lifecycle transition (throws
 * DeploymentLifecycleError). ROLLED_BACK is terminal; PLANNED cannot skip
 * to ROLLED_BACK; re-deployment of a ROLLED_BACK deployment is forbidden.
 */
export function transitionDeploymentLifecycle(
  from: DeploymentLifecycleStatus,
  to: DeploymentLifecycleStatus,
): DeploymentLifecycleStatus {
  if (!(DEPLOYMENT_LIFECYCLE as readonly string[]).includes(from)) {
    throw new DeploymentLifecycleError(`unknown deployment lifecycle status: ${JSON.stringify(from)}`);
  }
  if (!(DEPLOYMENT_LIFECYCLE as readonly string[]).includes(to)) {
    throw new DeploymentLifecycleError(`unknown deployment lifecycle status: ${JSON.stringify(to)}`);
  }
  if (!canTransitionDeploymentLifecycle(from, to)) {
    throw new DeploymentLifecycleError(
      `invalid deployment lifecycle transition: ${from} -> ${to} ` +
        `(the deployment lifecycle is PLANNED -> DEPLOYED -> ROLLED_BACK; ROLLED_BACK is terminal; ` +
        'you cannot roll back a deployment that was never deployed)',
    );
  }
  return to;
}

/** The deployment lifecycle status of a record (derived from the envelope). */
export function deploymentLifecycle(record: DeploymentRecord): DeploymentLifecycleStatus {
  return ENVELOPE_TO_DEPLOYMENT_LIFECYCLE[record.envelope.status];
}

// ---------------------------------------------------------------------------
// Content
// ---------------------------------------------------------------------------

/** A typed reference to the runtime serving the deployment. */
export interface TargetRuntimeRef {
  /** The runtime id (matches a @sos-2/runtimes RuntimeDescriptor id). */
  runtime_id: string;
  /** The runtime kind (informational, e.g. "container"). */
  runtime_kind: string;
  /** The runtime version (non-empty, e.g. "1.4.0"). */
  runtime_version: string;
}

/**
 * The declared rollback — MIRRORING the recovery-control declarations by
 * CONSUMING them: mechanism, trigger and exception are validated by
 * @sos-2/recovery-control's own validators, and the policy check
 * (bounded mechanism or governed exception) is its own.
 */
export interface DeploymentRollbackDeclaration {
  /** The bounded recovery mechanism (consumed type + validator). */
  mechanism: RecoveryMechanism;
  /** The concrete recovery trigger (consumed type + validator). */
  trigger: RecoveryTrigger;
  /** The AuthorityGrant spine id authorizing the rollback path. */
  authority_ref: string;
  /** null, or the governed exception accepting another containment mechanism. */
  exception: GovernedException | null;
}

export interface DeploymentContent {
  /** Human deployment identifier (non-empty; unique within a store). */
  deployment_id: string;
  /** Target environment (non-empty, e.g. "production"). */
  environment: string;
  /** The EXACT revision of the deployed artifact (git-sha or config-version). */
  artifact_revision: ExactRevision;
  /** The runtime serving the deployment. */
  target_runtime: TargetRuntimeRef;
  /** Typed configuration values (JSON object; may be empty). */
  configuration: Record<string, JsonValue>;
  /** The declared rollback (mechanism + trigger + authority [+ exception]). */
  rollback: DeploymentRollbackDeclaration;
}

export interface DeploymentRecord {
  /** Semantic Spine envelope; kind is always "DeploymentRecord". */
  envelope: ArtifactEnvelope;
  /** The deployment content (exact six-section field set). */
  content: DeploymentContent;
}

export interface CreateDeploymentInput {
  /** The deployment content (validated; lifecycle starts at PLANNED/DRAFT). */
  content: DeploymentContent;
  /** REQUIRED non-empty provenance entries (spine discipline). */
  provenance: string[];
  /** RFC3339 creation timestamp, caller-supplied (no hidden clocks). */
  created_at: string;
  /** Authorizing artifact id, or null. */
  authority_ref?: string | null;
  /** Version (integer >= 1). Defaults to 1. */
  version?: number;
  /** DRAFT (default) or ACTIVE (a deployment created already live). */
  status?: ArtifactStatus;
  /** DeploymentRecord artifact id superseded by this one, or null. */
  supersedes?: string | null;
}

/** The exact value a deployment record id is derived from. */
export interface DeploymentCreationAddress {
  kind: 'DeploymentRecord';
  version: number;
  status: ArtifactStatus;
  authority_ref: string | null;
  provenance: string[];
  created_at: string;
  supersedes: string | null;
  content: DeploymentContent;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isJsonRecord(value: unknown): value is Record<string, JsonValue> {
  if (!isPlainObject(value)) {
    return false;
  }
  try {
    // The spine serializer is the JSON authority; it throws on non-JSON.
    canonicalSerialize(value);
    return true;
  } catch {
    return false;
  }
}

/** Validate a target runtime reference (throws DeploymentRecordError). */
export function assertValidTargetRuntimeRef(value: unknown): asserts value is TargetRuntimeRef {
  if (!isPlainObject(value) || Object.keys(value).length !== 3) {
    throw new DeploymentRecordError('target runtime ref must be an object with exact fields { runtime_id, runtime_kind, runtime_version }');
  }
  if (!isNonEmptyString(value['runtime_id'])) {
    throw new DeploymentRecordError(`target_runtime.runtime_id must be a non-empty string, received: ${JSON.stringify(value['runtime_id'])}`);
  }
  if (!isNonEmptyString(value['runtime_kind'])) {
    throw new DeploymentRecordError(`target_runtime.runtime_kind must be a non-empty string, received: ${JSON.stringify(value['runtime_kind'])}`);
  }
  if (!isNonEmptyString(value['runtime_version'])) {
    throw new DeploymentRecordError(`target_runtime.runtime_version must be a non-empty string, received: ${JSON.stringify(value['runtime_version'])}`);
  }
}

/** Validate a deployment rollback declaration (throws DeploymentRecordError). */
export function assertValidDeploymentRollback(value: unknown): asserts value is DeploymentRollbackDeclaration {
  if (!isPlainObject(value) || Object.keys(value).length !== 4) {
    throw new DeploymentRecordError(
      'deployment rollback must be an object with exact fields { mechanism, trigger, authority_ref, exception } ' +
        '(mechanism + trigger + authority are ALL mandatory — the recovery-control declarations)',
    );
  }
  // The mechanism/trigger validators are CONSUMED from @sos-2/recovery-control.
  assertValidRecoveryMechanism(value['mechanism']);
  assertValidRecoveryTrigger(value['trigger']);
  if (!isArtifactId(value['authority_ref'])) {
    throw new DeploymentRecordError(
      `deployment rollback authority_ref must be a well-formed spine artifact id (the AuthorityGrant authorizing the rollback), received: ${JSON.stringify(value['authority_ref'])}`,
    );
  }
  if (value['exception'] !== null) {
    assertValidGovernedException(value['exception']);
  }
  // The boundedness POLICY is consumed from @sos-2/recovery-control too:
  // UNSPECIFIED without a governed exception is REJECTED, exactly as W8
  // rejects it (spec/architecture.md section 13).
  const verdict = checkRecoveryDeclarationAgainstPolicy(
    value['mechanism'] as RecoveryMechanism,
    (value['exception'] ?? null) as GovernedException | null,
    true,
  );
  if (!verdict.satisfied) {
    throw new DeploymentRecordError(
      `deployment rollback is invalid: ${verdict.reason}`,
    );
  }
}

const CONTENT_KEYS = [
  'deployment_id',
  'environment',
  'artifact_revision',
  'target_runtime',
  'configuration',
  'rollback',
] as const;

/** Full semantic validation of deployment content (throws DeploymentRecordError). */
export function assertValidDeploymentContent(value: unknown): asserts value is DeploymentContent {
  if (!isPlainObject(value)) {
    throw new DeploymentRecordError('deployment content must be an object');
  }
  const actual = Object.keys(value);
  const expected = new Set<string>(CONTENT_KEYS);
  if (actual.length !== CONTENT_KEYS.length || !actual.every((key) => expected.has(key))) {
    throw new DeploymentRecordError(`deployment content must have the exact field set { ${CONTENT_KEYS.join(', ')} }`);
  }
  if (!isNonEmptyString(value['deployment_id'])) {
    throw new DeploymentRecordError(`deployment_id must be a non-empty string, received: ${JSON.stringify(value['deployment_id'])}`);
  }
  if (!isNonEmptyString(value['environment'])) {
    throw new DeploymentRecordError(`environment must be a non-empty string, received: ${JSON.stringify(value['environment'])}`);
  }
  assertExactRevision(value['artifact_revision'], 'artifact');
  const kind = (value['artifact_revision'] as ExactRevision).kind;
  if (kind !== 'git-sha' && kind !== 'config-version') {
    // deployment-id revisions identify deployments themselves (circular).
    throw new DeploymentRecordError(
      `artifact_revision.kind must be "git-sha" or "config-version", received: ${JSON.stringify(kind)}`,
    );
  }
  assertRevisionKind(value['artifact_revision'] as ExactRevision, 'artifact', kind);
  assertValidTargetRuntimeRef(value['target_runtime']);
  if (!isJsonRecord(value['configuration'])) {
    throw new DeploymentRecordError('configuration must be a plain JSON object of typed configuration values');
  }
  assertValidDeploymentRollback(value['rollback']);
}

export function deploymentCreationAddress(input: CreateDeploymentInput): DeploymentCreationAddress {
  return {
    kind: DEPLOYMENT_RECORD_KIND,
    version: input.version ?? 1,
    status: input.status ?? 'DRAFT',
    authority_ref: input.authority_ref ?? null,
    provenance: [...input.provenance],
    created_at: input.created_at,
    supersedes: input.supersedes ?? null,
    content: structuredClone(input.content),
  };
}

/** Derive the deterministic deployment record id for a creation input. */
export function deploymentRecordId(input: CreateDeploymentInput): string {
  return deriveDeterministicArtifactId(DEPLOYMENT_RECORD_KIND, deploymentCreationAddress(input));
}

/** Create a deployment record with a deterministic content-addressed id. */
export function createDeployment(input: CreateDeploymentInput): DeploymentRecord {
  if (typeof input !== 'object' || input === null) {
    throw new DeploymentRecordError('deployment creation input must be an object');
  }
  assertValidDeploymentContent(input.content);
  const status = input.status ?? 'DRAFT';
  if (status !== 'DRAFT' && status !== 'ACTIVE') {
    throw new DeploymentRecordError(`deployments are created PLANNED (DRAFT) or DEPLOYED (ACTIVE), never ${status}`);
  }
  const address = deploymentCreationAddress(input);
  const id = deriveDeterministicArtifactId(DEPLOYMENT_RECORD_KIND, address);
  const envelope = createEnvelope({
    kind: DEPLOYMENT_RECORD_KIND,
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

/** Full semantic validation of a deployment record (throws DeploymentRecordError). */
export function assertValidDeployment(value: unknown): asserts value is DeploymentRecord {
  if (!isPlainObject(value) || Object.keys(value).length !== 2 || !ARTIFACT_KEYS.every((key) => key in value)) {
    throw new DeploymentRecordError('deployment record must be an object with exact fields { envelope, content }');
  }
  try {
    assertValidEnvelope(value['envelope']);
  } catch (cause) {
    throw new DeploymentRecordError(`deployment envelope is not spine-valid: ${(cause as Error).message}`);
  }
  const envelope = value['envelope'] as ArtifactEnvelope;
  if (envelope.kind !== DEPLOYMENT_RECORD_KIND) {
    throw new DeploymentRecordError(
      `deployment record envelope kind must be "${DEPLOYMENT_RECORD_KIND}", received: ${JSON.stringify(envelope.kind)}`,
    );
  }
  assertValidDeploymentContent(value['content']);
}

/** Predicate form of assertValidDeployment. */
export function validateDeployment(value: unknown): value is DeploymentRecord {
  try {
    assertValidDeployment(value);
    return true;
  } catch {
    return false;
  }
}
