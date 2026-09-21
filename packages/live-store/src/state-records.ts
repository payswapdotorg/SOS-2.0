/**
 * P2-owned durable state records: TaskRecord, BodyLeaseRecord and
 * DevelopmentStateRecord (Work Order P2).
 *
 * These are PRODUCTIZATION-LAYER state shapes, NOT frozen core domain
 * records: task/body-lease/development-state are execution-fabric and
 * governance data. They deliberately do NOT introduce a second semantic
 * registry (AGENTS.md section 4): task/lease/event identities are plain
 * caller-supplied non-empty strings (the orchestrator and body broker mint
 * them in later waves); the ONLY sos:// identities referenced here are
 * frozen spine artifact ids (mission_ref, grant refs, evidence refs),
 * validated as well-formed spine ids and never minted here.
 *
 * TaskRecord realizes the EXACT task-durability shape of
 * spec/productization-execution-architecture.md section 6: task identity
 * and mission link; current plan/work graph; owned workspace/repository
 * revision; authority context; body lease, when any; checkpoints; produced
 * artifacts; observations/evidence; unresolved uncertainty;
 * retries/recovery state; cost/resource consumption; final verification
 * record. A body crash, provider outage or user shutdown must not erase
 * the task — the record is durable and complete at every revision.
 *
 * Every mutable record carries a caller-owned integer `revision` (>= 1)
 * used for optimistic concurrency: a write with a HIGHER revision is a
 * forward write; an identical replay is an idempotent no-op; a
 * lower/equal-revision divergent write is a typed conflict.
 */

import { isArtifactId } from '@sos-2/semantic-spine';
import type { JsonValue } from '@sos-2/semantic-spine';
import { InvalidRecordError } from './errors.js';

const RFC3339_PATTERN = /^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/;

const SHA256_PATTERN = /^[0-9a-f]{64}$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isNullOrNonEmptyString(value: unknown): value is string | null {
  return value === null || isNonEmptyString(value);
}

function isNonEmptyStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every((entry) => typeof entry === 'string' && entry.length > 0);
}

function isRfc3339(value: unknown): value is string {
  return typeof value === 'string' && RFC3339_PATTERN.test(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isSpineIdArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => isArtifactId(entry));
}

// ---------------------------------------------------------------------------
// TaskRecord (spec/productization-execution-architecture.md section 6)
// ---------------------------------------------------------------------------

export const TASK_STATUSES = [
  'CREATED',
  'PLANNED',
  'RUNNING',
  'PAUSED',
  'AWAITING_ASK',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

const TASK_STATUS_SET: ReadonlySet<string> = new Set(TASK_STATUSES);

export function isTaskStatus(value: unknown): value is TaskStatus {
  return typeof value === 'string' && TASK_STATUS_SET.has(value);
}

/** Work-graph node state (the orchestrator owns work-graph semantics; the store persists the declared shape verbatim). */
export const TASK_PLAN_NODE_STATES = ['PENDING', 'IN_PROGRESS', 'DONE', 'FAILED', 'SKIPPED'] as const;

export type TaskPlanNodeState = (typeof TASK_PLAN_NODE_STATES)[number];

const TASK_PLAN_NODE_STATE_SET: ReadonlySet<string> = new Set(TASK_PLAN_NODE_STATES);

/** One node of the task's current plan/work graph (caller-supplied node ids). */
export interface TaskPlanNode {
  node_id: string;
  state: TaskPlanNodeState;
  summary: string;
}

/** One dependency edge of the task's current plan/work graph. */
export interface TaskPlanEdge {
  from: string;
  to: string;
}

/** The current plan/work graph (section 6: "current plan/work graph"). */
export interface TaskWorkGraph {
  nodes: TaskPlanNode[];
  edges: TaskPlanEdge[];
}

/** The authority context the task runs under (section 6: "authority context"). */
export interface TaskAuthorityContext {
  /** AuthorityGrant artifact ids presented for this task (well-formed spine ids; may be empty while ungranted). */
  grant_refs: string[];
  /** Free-text authority note, or null. */
  note: string | null;
}

/** One durable checkpoint (section 6: "checkpoints"). */
export interface TaskCheckpoint {
  checkpoint_id: string;
  /** RFC3339 checkpoint instant (caller-supplied). */
  created_at: string;
  /** The durable checkpoint state (plain JSON; the resume point after body loss). */
  state: JsonValue;
  /** Provenance of the checkpoint (non-empty). */
  provenance: string[];
  /** Human label, or null. */
  label: string | null;
}

/** A produced artifact reference (section 6: "produced artifacts") — content-addressed in the object store. */
export interface TaskArtifactRef {
  /** sha-256 content hash (64 lowercase hex) of the stored immutable artifact bytes. */
  content_hash: string;
  size_bytes: number;
  /** RFC3339 capture instant. */
  created_at: string;
  description: string | null;
}

/** Retries/recovery state (section 6: "retries/recovery state"). */
export interface TaskRetryRecoveryState {
  /** Number of attempts so far (>= 0). */
  attempt_count: number;
  /** The last failure description, or null. */
  last_failure: string | null;
  /** RFC3339 of the last failure, or null. */
  last_failure_at: string | null;
  /** The declared recovery kind (NONE while no recovery is pending). */
  recovery_kind: 'NONE' | 'RETRY' | 'RESUME_FROM_CHECKPOINT' | 'ROLLBACK';
}

/** One cost/resource consumption entry (section 6: "cost/resource consumption"). */
export interface TaskCostEntry {
  kind: 'TOKENS' | 'COMPUTE_SECONDS' | 'COST_UNITS' | 'OTHER';
  amount: number;
  unit: string;
  /** RFC3339 when the consumption was recorded. */
  recorded_at: string;
}

/** The final verification record (section 6: "final verification record"). */
export interface TaskFinalVerification {
  verdict: 'VERIFIED' | 'FAILED' | 'INCONCLUSIVE';
  /** RFC3339 verification instant. */
  verified_at: string;
  /** Evidence artifact ids the verdict rests on (well-formed spine ids). */
  evidence_refs: string[];
  /** The verification summary (non-empty). */
  summary: string;
}

/** The durable task record — the EXACT section 6 task-durability shape. */
export interface TaskRecord {
  task_id: string;
  /** Mission artifact id this task serves (section 6: "task identity and mission link"). */
  mission_ref: string;
  status: TaskStatus;
  plan: TaskWorkGraph;
  /** The exact workspace/repository revision this task owns (e.g. git sha), or null. */
  owned_revision: string | null;
  authority_context: TaskAuthorityContext;
  /** The body lease id owning this task's body, or null while bodiless. */
  body_lease_ref: string | null;
  checkpoints: TaskCheckpoint[];
  artifacts: TaskArtifactRef[];
  /** Evidence artifact ids recorded for this task (well-formed spine ids). */
  evidence_refs: string[];
  /** Unresolved uncertainty statements (section 6: "unresolved uncertainty"). */
  unresolved_uncertainty: string[];
  retries: TaskRetryRecoveryState;
  cost: TaskCostEntry[];
  /** The final verification record, or null while the task is unfinished. */
  final_verification: TaskFinalVerification | null;
  /** Provenance of this revision (non-empty). */
  provenance: string[];
  /** RFC3339 creation instant (caller-supplied). */
  created_at: string;
  /** RFC3339 last-update instant (caller-supplied). */
  updated_at: string;
  /** Caller-owned optimistic-concurrency revision (integer >= 1). */
  revision: number;
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
  'evidence_refs',
  'unresolved_uncertainty',
  'retries',
  'cost',
  'final_verification',
  'provenance',
  'created_at',
  'updated_at',
  'revision',
] as const;

function failTask(field: string, detail: string): never {
  throw new InvalidRecordError('task', `${field}: ${detail}`);
}

function assertValidTaskWorkGraph(value: unknown): asserts value is TaskWorkGraph {
  if (!isPlainObject(value) || Object.keys(value).length !== 2) {
    failTask('plan', 'must be an object with exact fields { nodes, edges }');
  }
  const graph = value as Record<string, unknown>;
  if (!Array.isArray(graph['nodes'])) {
    failTask('plan.nodes', 'must be an array');
  }
  const nodeIds = new Set<string>();
  for (const node of graph['nodes']) {
    if (!isPlainObject(node) || Object.keys(node).length !== 3) {
      failTask('plan.nodes[]', 'must be an object with exact fields { node_id, state, summary }');
    }
    const nodeRecord = node as Record<string, unknown>;
    if (!isNonEmptyString(nodeRecord['node_id'])) {
      failTask('plan.nodes[].node_id', 'must be a non-empty string');
    }
    if (nodeIds.has(nodeRecord['node_id'])) {
      failTask('plan.nodes[].node_id', `duplicate node id: ${nodeRecord['node_id']}`);
    }
    nodeIds.add(nodeRecord['node_id']);
    if (!TASK_PLAN_NODE_STATE_SET.has(String(nodeRecord['state']))) {
      failTask('plan.nodes[].state', `must be one of ${TASK_PLAN_NODE_STATES.join('|')}`);
    }
    if (!isNonEmptyString(nodeRecord['summary'])) {
      failTask('plan.nodes[].summary', 'must be a non-empty string');
    }
  }
  if (!Array.isArray(graph['edges'])) {
    failTask('plan.edges', 'must be an array');
  }
  const edgeKeys = new Set<string>();
  for (const edge of graph['edges']) {
    if (!isPlainObject(edge) || Object.keys(edge).length !== 2) {
      failTask('plan.edges[]', 'must be an object with exact fields { from, to }');
    }
    const edgeRecord = edge as Record<string, unknown>;
    if (!isNonEmptyString(edgeRecord['from']) || !isNonEmptyString(edgeRecord['to'])) {
      failTask('plan.edges[]', 'from and to must be non-empty strings');
    }
    if (!nodeIds.has(edgeRecord['from']) || !nodeIds.has(edgeRecord['to'])) {
      failTask('plan.edges[]', `edge references an undeclared node: ${String(edgeRecord['from'])} -> ${String(edgeRecord['to'])}`);
    }
    const key = `${edgeRecord['from']}\u0000${edgeRecord['to']}`;
    if (edgeKeys.has(key)) {
      failTask('plan.edges[]', `duplicate edge: ${key}`);
    }
    edgeKeys.add(key);
  }
}

function assertValidTaskCheckpoint(value: unknown): asserts value is TaskCheckpoint {
  if (!isPlainObject(value) || Object.keys(value).length !== 5) {
    failTask('checkpoints[]', 'must be an object with exact fields { checkpoint_id, created_at, state, provenance, label }');
  }
  const record = value as Record<string, unknown>;
  if (!isNonEmptyString(record['checkpoint_id'])) {
    failTask('checkpoints[].checkpoint_id', 'must be a non-empty string');
  }
  if (!isRfc3339(record['created_at'])) {
    failTask('checkpoints[].created_at', 'must be RFC3339');
  }
  if (record['state'] === undefined) {
    failTask('checkpoints[].state', 'must be present (JSON value; null allowed for marker checkpoints)');
  }
  if (!isNonEmptyStringArray(record['provenance'])) {
    failTask('checkpoints[].provenance', 'must be a non-empty array of non-empty strings');
  }
  if (!isNullOrNonEmptyString(record['label'])) {
    failTask('checkpoints[].label', 'must be null or a non-empty string');
  }
}

function assertValidTaskArtifactRef(value: unknown): asserts value is TaskArtifactRef {
  if (!isPlainObject(value) || Object.keys(value).length !== 4) {
    failTask('artifacts[]', 'must be an object with exact fields { content_hash, size_bytes, created_at, description }');
  }
  const record = value as Record<string, unknown>;
  if (typeof record['content_hash'] !== 'string' || !SHA256_PATTERN.test(record['content_hash'])) {
    failTask('artifacts[].content_hash', 'must be a sha-256 content hash (64 lowercase hex)');
  }
  if (!isNonNegativeInteger(record['size_bytes'])) {
    failTask('artifacts[].size_bytes', 'must be an integer >= 0');
  }
  if (!isRfc3339(record['created_at'])) {
    failTask('artifacts[].created_at', 'must be RFC3339');
  }
  if (!isNullOrNonEmptyString(record['description'])) {
    failTask('artifacts[].description', 'must be null or a non-empty string');
  }
}

function assertValidTaskFinalVerification(value: unknown): asserts value is TaskFinalVerification {
  if (!isPlainObject(value) || Object.keys(value).length !== 4) {
    failTask('final_verification', 'must be an object with exact fields { verdict, verified_at, evidence_refs, summary }');
  }
  const record = value as Record<string, unknown>;
  if (!['VERIFIED', 'FAILED', 'INCONCLUSIVE'].includes(String(record['verdict']))) {
    failTask('final_verification.verdict', 'must be VERIFIED | FAILED | INCONCLUSIVE');
  }
  if (!isRfc3339(record['verified_at'])) {
    failTask('final_verification.verified_at', 'must be RFC3339');
  }
  if (!isSpineIdArray(record['evidence_refs'])) {
    failTask('final_verification.evidence_refs', 'must be an array of well-formed spine artifact ids');
  }
  if (!isNonEmptyString(record['summary'])) {
    failTask('final_verification.summary', 'must be a non-empty string');
  }
}

/** Full validation of a TaskRecord (throws InvalidRecordError). */
export function assertValidTaskRecord(value: unknown): asserts value is TaskRecord {
  if (!isPlainObject(value)) {
    throw new InvalidRecordError('task', 'task record must be an object');
  }
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record);
  if (actual.length !== TASK_KEYS.length || !TASK_KEYS.every((key) => Object.prototype.hasOwnProperty.call(record, key))) {
    throw new InvalidRecordError('task', `task record must have the exact ${TASK_KEYS.length}-field section 6 field set`);
  }
  if (!isNonEmptyString(record['task_id'])) {
    failTask('task_id', 'must be a non-empty string (task identity; minted by the orchestrator)');
  }
  if (typeof record['mission_ref'] !== 'string' || !isArtifactId(record['mission_ref'])) {
    failTask('mission_ref', 'must be a well-formed spine Mission artifact id');
  }
  if (!isTaskStatus(record['status'])) {
    failTask('status', `must be one of ${TASK_STATUSES.join('|')}`);
  }
  assertValidTaskWorkGraph(record['plan']);
  if (!isNullOrNonEmptyString(record['owned_revision'])) {
    failTask('owned_revision', 'must be null or a non-empty string (the exact owned revision)');
  }
  const authority = record['authority_context'];
  if (!isPlainObject(authority) || Object.keys(authority).length !== 2) {
    failTask('authority_context', 'must be an object with exact fields { grant_refs, note }');
  }
  const authorityRecord = authority as Record<string, unknown>;
  if (!isSpineIdArray(authorityRecord['grant_refs'])) {
    failTask('authority_context.grant_refs', 'must be an array of well-formed spine artifact ids');
  }
  if (!isNullOrNonEmptyString(authorityRecord['note'])) {
    failTask('authority_context.note', 'must be null or a non-empty string');
  }
  if (!isNullOrNonEmptyString(record['body_lease_ref'])) {
    failTask('body_lease_ref', 'must be null (bodiless) or a non-empty body lease id');
  }
  if (!Array.isArray(record['checkpoints'])) {
    failTask('checkpoints', 'must be an array');
  }
  for (const checkpoint of record['checkpoints']) {
    assertValidTaskCheckpoint(checkpoint);
  }
  const checkpointIds = new Set((record['checkpoints'] as TaskCheckpoint[]).map((entry) => entry.checkpoint_id));
  if (checkpointIds.size !== (record['checkpoints'] as TaskCheckpoint[]).length) {
    failTask('checkpoints', 'checkpoint ids must be unique');
  }
  if (!Array.isArray(record['artifacts'])) {
    failTask('artifacts', 'must be an array');
  }
  for (const artifact of record['artifacts']) {
    assertValidTaskArtifactRef(artifact);
  }
  if (!isSpineIdArray(record['evidence_refs'])) {
    failTask('evidence_refs', 'must be an array of well-formed spine artifact ids');
  }
  if (!Array.isArray(record['unresolved_uncertainty']) || !(record['unresolved_uncertainty'] as unknown[]).every(isNonEmptyString)) {
    failTask('unresolved_uncertainty', 'must be an array of non-empty statements');
  }
  const retries = record['retries'];
  if (!isPlainObject(retries) || Object.keys(retries).length !== 4) {
    failTask('retries', 'must be an object with exact fields { attempt_count, last_failure, last_failure_at, recovery_kind }');
  }
  const retriesRecord = retries as Record<string, unknown>;
  if (!isNonNegativeInteger(retriesRecord['attempt_count'])) {
    failTask('retries.attempt_count', 'must be an integer >= 0');
  }
  if (!isNullOrNonEmptyString(retriesRecord['last_failure'])) {
    failTask('retries.last_failure', 'must be null or a non-empty string');
  }
  if (retriesRecord['last_failure_at'] !== null && !isRfc3339(retriesRecord['last_failure_at'])) {
    failTask('retries.last_failure_at', 'must be null or RFC3339');
  }
  if (!['NONE', 'RETRY', 'RESUME_FROM_CHECKPOINT', 'ROLLBACK'].includes(String(retriesRecord['recovery_kind']))) {
    failTask('retries.recovery_kind', 'must be NONE | RETRY | RESUME_FROM_CHECKPOINT | ROLLBACK');
  }
  if (!Array.isArray(record['cost'])) {
    failTask('cost', 'must be an array');
  }
  for (const entry of record['cost'] as unknown[]) {
    if (!isPlainObject(entry) || Object.keys(entry).length !== 4) {
      failTask('cost[]', 'must be an object with exact fields { kind, amount, unit, recorded_at }');
    }
    const entryRecord = entry as Record<string, unknown>;
    if (!['TOKENS', 'COMPUTE_SECONDS', 'COST_UNITS', 'OTHER'].includes(String(entryRecord['kind']))) {
      failTask('cost[].kind', 'must be TOKENS | COMPUTE_SECONDS | COST_UNITS | OTHER');
    }
    if (!isFiniteNumber(entryRecord['amount'])) {
      failTask('cost[].amount', 'must be a finite number');
    }
    if (!isNonEmptyString(entryRecord['unit'])) {
      failTask('cost[].unit', 'must be a non-empty string');
    }
    if (!isRfc3339(entryRecord['recorded_at'])) {
      failTask('cost[].recorded_at', 'must be RFC3339');
    }
  }
  if (record['final_verification'] !== null) {
    assertValidTaskFinalVerification(record['final_verification']);
  }
  if (!isNonEmptyStringArray(record['provenance'])) {
    failTask('provenance', 'must be a non-empty array of non-empty strings');
  }
  if (!isRfc3339(record['created_at']) || !isRfc3339(record['updated_at'])) {
    failTask('created_at/updated_at', 'must be RFC3339 (caller-supplied; never a hidden clock)');
  }
  if (!isPositiveInteger(record['revision'])) {
    failTask('revision', 'must be an integer >= 1 (caller-owned optimistic-concurrency revision)');
  }
}

// ---------------------------------------------------------------------------
// BodyLeaseRecord
// ---------------------------------------------------------------------------

export const BODY_LEASE_STATES = ['ACTIVE', 'RELEASED', 'EXPIRED', 'REVOKED'] as const;

export type BodyLeaseState = (typeof BODY_LEASE_STATES)[number];

const BODY_LEASE_STATE_SET: ReadonlySet<string> = new Set(BODY_LEASE_STATES);

/**
 * The durable body-lease record. A TASK owns a body lease; the task,
 * evidence and state SURVIVE body replacement
 * (spec/productization-execution-architecture.md section 1).
 *
 * body_ref is a PROVIDER-NEUTRAL body reference (vendor identity is never
 * SOS semantic identity); capabilities is the declared capability snapshot
 * the body advertised when the lease was acquired (section 3). Lease
 * LIVENESS coordination (heartbeats/TTL) is the coordination provider's
 * ephemeral business — this durable record is the semantic truth of the
 * lease's state, preserved verbatim with caller-declared transitions.
 */
export interface BodyLeaseRecord {
  lease_id: string;
  /** The task that owns this lease (non-empty task id). */
  task_ref: string;
  /** Provider-neutral body reference (never a semantic identity). */
  body_ref: string;
  /** Declared capability snapshot (section 3 body advertisement). */
  capabilities: string[];
  state: BodyLeaseState;
  /** RFC3339 acquisition instant. */
  acquired_at: string;
  /** RFC3339 expiry instant, or null (no expiry). */
  expires_at: string | null;
  /** RFC3339 of the last declared heartbeat, or null. */
  last_heartbeat_at: string | null;
  /** Why the lease ended (RELEASED/EXPIRED/REVOKED), or null while ACTIVE. */
  release_reason: string | null;
  provenance: string[];
  /** Caller-owned optimistic-concurrency revision (integer >= 1). */
  revision: number;
}

const BODY_LEASE_KEYS = [
  'lease_id',
  'task_ref',
  'body_ref',
  'capabilities',
  'state',
  'acquired_at',
  'expires_at',
  'last_heartbeat_at',
  'release_reason',
  'provenance',
  'revision',
] as const;

function failLease(field: string, detail: string): never {
  throw new InvalidRecordError('body-lease', `${field}: ${detail}`);
}

/** Full validation of a BodyLeaseRecord (throws InvalidRecordError). */
export function assertValidBodyLeaseRecord(value: unknown): asserts value is BodyLeaseRecord {
  if (!isPlainObject(value)) {
    throw new InvalidRecordError('body-lease', 'body lease record must be an object');
  }
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record);
  if (actual.length !== BODY_LEASE_KEYS.length || !BODY_LEASE_KEYS.every((key) => Object.prototype.hasOwnProperty.call(record, key))) {
    throw new InvalidRecordError('body-lease', `body lease record must have the exact ${BODY_LEASE_KEYS.length}-field set`);
  }
  if (!isNonEmptyString(record['lease_id'])) {
    failLease('lease_id', 'must be a non-empty string');
  }
  if (!isNonEmptyString(record['task_ref'])) {
    failLease('task_ref', 'must be a non-empty string (the owning task id)');
  }
  if (!isNonEmptyString(record['body_ref'])) {
    failLease('body_ref', 'must be a non-empty string (provider-neutral body reference)');
  }
  if (!Array.isArray(record['capabilities']) || !(record['capabilities'] as unknown[]).every(isNonEmptyString)) {
    failLease('capabilities', 'must be an array of non-empty capability names');
  }
  if (!BODY_LEASE_STATE_SET.has(String(record['state']))) {
    failLease('state', `must be one of ${BODY_LEASE_STATES.join('|')}`);
  }
  if (!isRfc3339(record['acquired_at'])) {
    failLease('acquired_at', 'must be RFC3339');
  }
  if (record['expires_at'] !== null && !isRfc3339(record['expires_at'])) {
    failLease('expires_at', 'must be null or RFC3339');
  }
  if (record['last_heartbeat_at'] !== null && !isRfc3339(record['last_heartbeat_at'])) {
    failLease('last_heartbeat_at', 'must be null or RFC3339');
  }
  if (!isNullOrNonEmptyString(record['release_reason'])) {
    failLease('release_reason', 'must be null (while ACTIVE) or a non-empty reason');
  }
  if (!isNonEmptyStringArray(record['provenance'])) {
    failLease('provenance', 'must be a non-empty array of non-empty strings');
  }
  if (!isPositiveInteger(record['revision'])) {
    failLease('revision', 'must be an integer >= 1');
  }
}

// ---------------------------------------------------------------------------
// DevelopmentStateRecord
// ---------------------------------------------------------------------------

/**
 * The durable development-state record: a verbatim snapshot of the
 * program's canonical machine state (spec/development-state/
 * implementation-state.json and the productization state) — work orders,
 * statuses, dependencies, merged heads, the current frontier.
 *
 * READ-ONLY AUTHORITY DISCIPLINE: the canonical machine state lives in the
 * repository's spec state files (the governance authority); this record
 * stores snapshots VERBATIM for live reads. It is a view-input contract,
 * NOT a semantic spine type and NOT a second semantic registry — the spine
 * remains the only identity authority. Light structural checks only
 * (schemaVersion/program/status present and non-empty; the full schema is
 * the machine-state authority's business).
 */
export interface DevelopmentStateRecord {
  /** Stable development-state key (e.g. "SOS-2.0"); snapshots of one key form a revision chain. */
  state_id: string;
  /** The verbatim machine-state snapshot (plain JSON object). */
  snapshot: JsonValue;
  provenance: string[];
  /** RFC3339 snapshot instant (caller-supplied). */
  updated_at: string;
  /** Caller-owned optimistic-concurrency revision (integer >= 1). */
  revision: number;
}

const DEV_STATE_KEYS = ['state_id', 'snapshot', 'provenance', 'updated_at', 'revision'] as const;

/** Full validation of a DevelopmentStateRecord (throws InvalidRecordError). */
export function assertValidDevelopmentStateRecord(value: unknown): asserts value is DevelopmentStateRecord {
  if (!isPlainObject(value)) {
    throw new InvalidRecordError('development-state', 'development state record must be an object');
  }
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record);
  if (actual.length !== DEV_STATE_KEYS.length || !DEV_STATE_KEYS.every((key) => Object.prototype.hasOwnProperty.call(record, key))) {
    throw new InvalidRecordError('development-state', `development state record must have the exact ${DEV_STATE_KEYS.length}-field set`);
  }
  if (!isNonEmptyString(record['state_id'])) {
    throw new InvalidRecordError('development-state', 'state_id must be a non-empty string');
  }
  if (!isPlainObject(record['snapshot'])) {
    throw new InvalidRecordError('development-state', 'snapshot must be a plain JSON object (the verbatim machine state)');
  }
  const snapshot = record['snapshot'] as Record<string, unknown>;
  for (const key of ['schemaVersion', 'program', 'status'] as const) {
    if (!isNonEmptyString(snapshot[key])) {
      throw new InvalidRecordError('development-state', `snapshot must carry a non-empty string ${JSON.stringify(key)} (machine-state view-input contract)`);
    }
  }
  if (!isNonEmptyStringArray(record['provenance'])) {
    throw new InvalidRecordError('development-state', 'provenance must be a non-empty array of non-empty strings');
  }
  if (!isRfc3339(record['updated_at'])) {
    throw new InvalidRecordError('development-state', 'updated_at must be RFC3339');
  }
  if (!isPositiveInteger(record['revision'])) {
    throw new InvalidRecordError('development-state', 'revision must be an integer >= 1');
  }
}
