/**
 * Durable task records — the §6 task-durability shape (Work Order P2).
 *
 * spec/productization-execution-architecture.md §6: "Every long-running task
 * persists: task identity and mission link; current plan/work graph; owned
 * workspace/repository revision; authority context; body lease, when any;
 * checkpoints; produced artifacts; observations/evidence; unresolved
 * uncertainty; retries/recovery state; cost/resource consumption; final
 * verification record. A body crash, provider outage, browser closure or
 * user computer shutdown must not erase the task."
 *
 * Each field of that list maps 1:1 onto TaskRecord below. Execution-fabric
 * vocabulary (P2's own boundary per the work order) — NOT a Semantic Spine
 * artifact: task ids are execution-fabric ids, and mission/authority links
 * reference spine artifacts where they exist.
 */

import { canonicalSerialize } from '@sos-2/semantic-spine';
import { InvalidRecordError } from '../errors.js';
import type { JsonValue } from '@sos-2/semantic-spine';

export const TASK_NAMESPACE = 'task';

export const TASK_STATUSES = [
  'QUEUED',
  'RUNNING',
  'PAUSED',
  'AWAITING_INPUT',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

const TASK_STATUS_SET: ReadonlySet<string> = new Set(TASK_STATUSES);

/** RFC3339 (the same pattern the spine enforces). */
const RFC3339_PATTERN = /^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/;

const CONTENT_HASH_PATTERN = /^[0-9a-f]{64}$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function isNonEmptyStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every((entry) => typeof entry === 'string' && entry.length > 0);
}

function isJsonOrNull(value: unknown): boolean {
  if (value === null) {
    return true;
  }
  try {
    canonicalSerialize(value);
    return true;
  } catch {
    return false;
  }
}

function isRfc3339(value: unknown): value is string {
  return typeof value === 'string' && RFC3339_PATTERN.test(value);
}

/** A persisted checkpoint: a resumable snapshot of the work graph. */
export interface TaskCheckpoint {
  /** Checkpoint id (unique within the task). */
  checkpoint_id: string;
  /** When the checkpoint was recorded, RFC3339 (injected clock). */
  recorded_at: string;
  /** Human label, or null. */
  label: string | null;
  /** The plan/work-graph state at this checkpoint (opaque canonical JSON). */
  work_graph_state: JsonValue;
  /** Free-form notes, or null. */
  notes: string | null;
}

/** An artifact produced by the task, stored by content hash in R2. */
export interface TaskArtifactRecord {
  /** Artifact id (execution-fabric or spine id, as produced). */
  artifact_id: string;
  /** sha-256 content hash (64 lowercase hex) — the object-store key. */
  content_hash: string;
  /** The object-store reference (e.g. "r2://<hash>"). */
  object_ref: string;
  /** Artifact size in bytes. */
  size_bytes: number;
  /** Description, or null. */
  description: string | null;
}

/** The exact revisions the task's workspace/repository/deployment pins. */
export interface TaskOwnedRevision {
  /** Exact source (git) revision, or null. Preserved, never defaulted. */
  source_revision: string | null;
  /** Exact deployment revision, or null. Preserved, never defaulted. */
  deployment_revision: string | null;
}

/** The authority context the task runs under. */
export interface TaskAuthorityContext {
  /** AuthorityGrant artifact ids authorizing the task's actions. */
  grant_refs: string[];
  /** Free-form authority notes, or null. */
  notes: string | null;
}

/** The final verification record (§6; a task's completion evidence). */
export interface TaskVerificationRecord {
  /** Whether verification succeeded. */
  verified: boolean;
  /** When verification ran, RFC3339. */
  recorded_at: string;
  /** Evidence artifact ids supporting the verdict. */
  evidence_refs: string[];
  /** Summary, or null. */
  summary: string | null;
}

/** The durable task record — the §6 shape, verbatim field-for-field. */
export interface TaskRecord {
  /** Task identity (execution-fabric id; caller-supplied). */
  task_id: string;
  /** Mission artifact id (sos://Mission/...), or null while unlinked. */
  mission_ref: string | null;
  /** Task lifecycle status. */
  status: TaskStatus;
  /** The current plan / work graph (opaque canonical JSON). */
  plan: JsonValue;
  /** The owned workspace/repository/deployment revisions. */
  owned_revision: TaskOwnedRevision;
  /** The authority context (grants the task acts under). */
  authority_context: TaskAuthorityContext;
  /** The body lease holding this task's execution body, or null. */
  body_lease_ref: string | null;
  /** Persisted checkpoints (append-only through the task's life). */
  checkpoints: TaskCheckpoint[];
  /** Artifacts the task produced (content-addressed in the object store). */
  artifacts: TaskArtifactRecord[];
  /** Observation event ids recorded against this task. */
  observations: string[];
  /** Unresolved uncertainty statements (retained, never dropped). */
  unresolved_uncertainty: string[];
  /** Retry count. */
  retries: number;
  /** Recovery bookkeeping (opaque canonical JSON), or null. */
  recovery_state: JsonValue | null;
  /** Cost/resource consumption (opaque canonical JSON), or null. */
  resource_usage: JsonValue | null;
  /** The final verification record, or null until verified. */
  final_verification: TaskVerificationRecord | null;
  /** Optimistic-concurrency revision (integer >= 1). */
  revision: number;
  /** Task creation instant, RFC3339. */
  created_at: string;
  /** Last update instant, RFC3339. */
  updated_at: string;
}

const TASK_KEYS = [
  'task_id',
  'mission_ref',
  'status',
  'plan',
  'owned_revision',
  'authority_context',
  'body_lease_ref',
  'checkpoints',
  'artifacts',
  'observations',
  'unresolved_uncertainty',
  'retries',
  'recovery_state',
  'resource_usage',
  'final_verification',
  'revision',
  'created_at',
  'updated_at',
] as const;

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function assertValidCheckpoint(value: unknown): asserts value is TaskCheckpoint {
  if (!isPlainObject(value) || !hasExactKeys(value, ['checkpoint_id', 'recorded_at', 'label', 'work_graph_state', 'notes'])) {
    throw new InvalidRecordError(TASK_NAMESPACE, 'task checkpoint must have the exact field set { checkpoint_id, recorded_at, label, work_graph_state, notes }');
  }
  if (!isNonEmptyString(value['checkpoint_id'])) {
    throw new InvalidRecordError(TASK_NAMESPACE, `checkpoint_id must be a non-empty string, received: ${JSON.stringify(value['checkpoint_id'])}`);
  }
  if (!isRfc3339(value['recorded_at'])) {
    throw new InvalidRecordError(TASK_NAMESPACE, `checkpoint recorded_at must be RFC3339, received: ${JSON.stringify(value['recorded_at'])}`);
  }
  if (value['label'] !== null && !isNonEmptyString(value['label'])) {
    throw new InvalidRecordError(TASK_NAMESPACE, `checkpoint label must be null or a non-empty string, received: ${JSON.stringify(value['label'])}`);
  }
  if (!isJsonOrNull(value['work_graph_state'])) {
    throw new InvalidRecordError(TASK_NAMESPACE, 'checkpoint work_graph_state must be canonical JSON');
  }
  if (value['notes'] !== null && !isNonEmptyString(value['notes'])) {
    throw new InvalidRecordError(TASK_NAMESPACE, `checkpoint notes must be null or a non-empty string, received: ${JSON.stringify(value['notes'])}`);
  }
}

function assertValidArtifact(value: unknown): asserts value is TaskArtifactRecord {
  if (!isPlainObject(value) || !hasExactKeys(value, ['artifact_id', 'content_hash', 'object_ref', 'size_bytes', 'description'])) {
    throw new InvalidRecordError(TASK_NAMESPACE, 'task artifact must have the exact field set { artifact_id, content_hash, object_ref, size_bytes, description }');
  }
  if (!isNonEmptyString(value['artifact_id'])) {
    throw new InvalidRecordError(TASK_NAMESPACE, `artifact_id must be a non-empty string, received: ${JSON.stringify(value['artifact_id'])}`);
  }
  if (typeof value['content_hash'] !== 'string' || !CONTENT_HASH_PATTERN.test(value['content_hash'])) {
    throw new InvalidRecordError(TASK_NAMESPACE, `artifact content_hash must be 64 lowercase hex chars, received: ${JSON.stringify(value['content_hash'])}`);
  }
  if (!isNonEmptyString(value['object_ref'])) {
    throw new InvalidRecordError(TASK_NAMESPACE, `artifact object_ref must be a non-empty string, received: ${JSON.stringify(value['object_ref'])}`);
  }
  if (typeof value['size_bytes'] !== 'number' || !Number.isInteger(value['size_bytes']) || value['size_bytes'] < 0) {
    throw new InvalidRecordError(TASK_NAMESPACE, `artifact size_bytes must be a non-negative integer, received: ${JSON.stringify(value['size_bytes'])}`);
  }
  if (value['description'] !== null && !isNonEmptyString(value['description'])) {
    throw new InvalidRecordError(TASK_NAMESPACE, `artifact description must be null or a non-empty string, received: ${JSON.stringify(value['description'])}`);
  }
}

function assertValidOwnedRevision(value: unknown): asserts value is TaskOwnedRevision {
  if (!isPlainObject(value) || !hasExactKeys(value, ['source_revision', 'deployment_revision'])) {
    throw new InvalidRecordError(TASK_NAMESPACE, 'owned_revision must have the exact field set { source_revision, deployment_revision }');
  }
  for (const key of ['source_revision', 'deployment_revision']) {
    const entry = value[key];
    if (entry !== null && !isNonEmptyString(entry)) {
      throw new InvalidRecordError(TASK_NAMESPACE, `owned_revision ${key} must be null or a non-empty string, received: ${JSON.stringify(entry)}`);
    }
  }
}

function assertValidAuthorityContext(value: unknown): asserts value is TaskAuthorityContext {
  if (!isPlainObject(value) || !hasExactKeys(value, ['grant_refs', 'notes'])) {
    throw new InvalidRecordError(TASK_NAMESPACE, 'authority_context must have the exact field set { grant_refs, notes }');
  }
  if (!isStringArray(value['grant_refs'])) {
    throw new InvalidRecordError(TASK_NAMESPACE, 'authority_context grant_refs must be an array of strings');
  }
  if (value['notes'] !== null && !isNonEmptyString(value['notes'])) {
    throw new InvalidRecordError(TASK_NAMESPACE, `authority_context notes must be null or a non-empty string, received: ${JSON.stringify(value['notes'])}`);
  }
}

function assertValidVerification(value: unknown): asserts value is TaskVerificationRecord {
  if (!isPlainObject(value) || !hasExactKeys(value, ['verified', 'recorded_at', 'evidence_refs', 'summary'])) {
    throw new InvalidRecordError(TASK_NAMESPACE, 'final_verification must have the exact field set { verified, recorded_at, evidence_refs, summary }');
  }
  if (typeof value['verified'] !== 'boolean') {
    throw new InvalidRecordError(TASK_NAMESPACE, `final_verification verified must be a boolean, received: ${JSON.stringify(value['verified'])}`);
  }
  if (!isRfc3339(value['recorded_at'])) {
    throw new InvalidRecordError(TASK_NAMESPACE, `final_verification recorded_at must be RFC3339, received: ${JSON.stringify(value['recorded_at'])}`);
  }
  if (!isStringArray(value['evidence_refs'])) {
    throw new InvalidRecordError(TASK_NAMESPACE, 'final_verification evidence_refs must be an array of strings');
  }
  if (value['summary'] !== null && !isNonEmptyString(value['summary'])) {
    throw new InvalidRecordError(TASK_NAMESPACE, `final_verification summary must be null or a non-empty string, received: ${JSON.stringify(value['summary'])}`);
  }
}

/** Full validation of the durable task record (throws InvalidRecordError). */
export function assertValidTaskRecord(value: unknown): asserts value is TaskRecord {
  if (!isPlainObject(value)) {
    throw new InvalidRecordError(TASK_NAMESPACE, 'task record must be an object');
  }
  if (!hasExactKeys(value, TASK_KEYS)) {
    throw new InvalidRecordError(
      TASK_NAMESPACE,
      `task record must have the exact §6 field set { ${TASK_KEYS.join(', ')} } (spec/productization-execution-architecture.md §6)`,
    );
  }
  if (!isNonEmptyString(value['task_id'])) {
    throw new InvalidRecordError(TASK_NAMESPACE, `task_id must be a non-empty string, received: ${JSON.stringify(value['task_id'])}`);
  }
  if (value['mission_ref'] !== null && !isNonEmptyString(value['mission_ref'])) {
    throw new InvalidRecordError(TASK_NAMESPACE, `mission_ref must be null or a non-empty string, received: ${JSON.stringify(value['mission_ref'])}`);
  }
  if (typeof value['status'] !== 'string' || !TASK_STATUS_SET.has(value['status'])) {
    throw new InvalidRecordError(
      TASK_NAMESPACE,
      `task status must be one of ${TASK_STATUSES.join(', ')}, received: ${JSON.stringify(value['status'])}`,
    );
  }
  if (!isJsonOrNull(value['plan'])) {
    throw new InvalidRecordError(TASK_NAMESPACE, 'task plan must be canonical JSON');
  }
  assertValidOwnedRevision(value['owned_revision']);
  assertValidAuthorityContext(value['authority_context']);
  if (value['body_lease_ref'] !== null && !isNonEmptyString(value['body_lease_ref'])) {
    throw new InvalidRecordError(TASK_NAMESPACE, `body_lease_ref must be null or a non-empty string, received: ${JSON.stringify(value['body_lease_ref'])}`);
  }
  if (!Array.isArray(value['checkpoints'])) {
    throw new InvalidRecordError(TASK_NAMESPACE, 'task checkpoints must be an array');
  }
  const checkpointIds = new Set<string>();
  for (const checkpoint of value['checkpoints']) {
    assertValidCheckpoint(checkpoint);
    const id = (checkpoint as TaskCheckpoint).checkpoint_id;
    if (checkpointIds.has(id)) {
      throw new InvalidRecordError(TASK_NAMESPACE, `duplicate checkpoint id within task: ${JSON.stringify(id)}`);
    }
    checkpointIds.add(id);
  }
  if (!Array.isArray(value['artifacts'])) {
    throw new InvalidRecordError(TASK_NAMESPACE, 'task artifacts must be an array');
  }
  for (const artifact of value['artifacts']) {
    assertValidArtifact(artifact);
  }
  if (!isStringArray(value['observations'])) {
    throw new InvalidRecordError(TASK_NAMESPACE, 'task observations must be an array of strings');
  }
  if (!isStringArray(value['unresolved_uncertainty'])) {
    throw new InvalidRecordError(TASK_NAMESPACE, 'task unresolved_uncertainty must be an array of strings');
  }
  if (typeof value['retries'] !== 'number' || !Number.isInteger(value['retries']) || value['retries'] < 0) {
    throw new InvalidRecordError(TASK_NAMESPACE, `task retries must be a non-negative integer, received: ${JSON.stringify(value['retries'])}`);
  }
  if (!isJsonOrNull(value['recovery_state'])) {
    throw new InvalidRecordError(TASK_NAMESPACE, 'task recovery_state must be null or canonical JSON');
  }
  if (!isJsonOrNull(value['resource_usage'])) {
    throw new InvalidRecordError(TASK_NAMESPACE, 'task resource_usage must be null or canonical JSON');
  }
  if (value['final_verification'] !== null) {
    assertValidVerification(value['final_verification']);
  }
  if (typeof value['revision'] !== 'number' || !Number.isInteger(value['revision']) || value['revision'] < 1) {
    throw new InvalidRecordError(TASK_NAMESPACE, `task revision must be an integer >= 1, received: ${JSON.stringify(value['revision'])}`);
  }
  if (!isRfc3339(value['created_at'])) {
    throw new InvalidRecordError(TASK_NAMESPACE, `task created_at must be RFC3339, received: ${JSON.stringify(value['created_at'])}`);
  }
  if (!isRfc3339(value['updated_at'])) {
    throw new InvalidRecordError(TASK_NAMESPACE, `task updated_at must be RFC3339, received: ${JSON.stringify(value['updated_at'])}`);
  }
}
