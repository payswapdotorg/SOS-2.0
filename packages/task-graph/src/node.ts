/**
 * TaskNode records + the typed state machine (Work Order P6).
 *
 * A TaskNode is one vertex of the durable mission work graph. The node's
 * durable home is the P2 TaskRecord (the section 6 shape, persisted
 * VERBATIM through the P2 TaskStateRepository):
 *
 *   - the node snapshot (scope, dependencies, assignment, recovery,
 *     checkpoint chain, cost envelope, work program...) serializes into
 *     the record's `plan` field as canonical JSON — the store persists it
 *     VERBATIM and never redefines the graph's shapes;
 *   - every section 6 field ALSO maps natively onto the record (status,
 *     mission_ref, owned_revision, authority_context, body_lease_ref,
 *     checkpoints, artifacts, observations, unresolved_uncertainty,
 *     retries, recovery_state, resource_usage, final_verification) so the
 *     full section 6 list is representable field-for-field (pinned).
 *
 * IDENTITY DISCIPLINE: task ids are caller-supplied RUNTIME identifiers —
 * this package NEVER mints identities (spine-shaped ids are rejected
 * loudly through @sos-2/runtime-contracts' guard); mission and authority
 * references are spine artifact ids validated by the spine's own guards
 * (isArtifactId — consumed, never re-implemented).
 *
 * STATE MACHINE (typed transitions only):
 *
 *   PENDING  -> RUNNING (assignment) | CANCELLED
 *   RUNNING  -> PAUSED | CANCELLED | COMPLETED (verification-gated) | FAILED
 *   PAUSED   -> RUNNING (resume) | CANCELLED | COMPLETED (verification-gated) | FAILED
 *   FAILED   -> PENDING (retry — only when recovery is RETRYABLE)
 *   COMPLETED | CANCELLED are terminal.
 *
 * The ASK OVERLAY: a node with pending asks parks (typed transition
 * RUNNING/PAUSED -> PAUSED with the ask entry recorded); while asks are
 * pending the durable record status is the P2 AWAITING_INPUT status and
 * the section 9 execution surface refuses the task. Resolving the ask
 * clears the overlay and returns the record to PAUSED for the section 9
 * resume path. ASK IS A SUCCESS STATE — parking never throws.
 *
 * COMPLETION IS VERIFICATION-GATED: the RUNNING/PAUSED -> COMPLETED
 * transition requires a final verification record (section 10 — a worker
 * reporting completion never certifies mission success). FAILED always
 * carries a recovery decision (RETRYABLE or TERMINAL — never silently
 * "done"): recovery marks the task retryable, the retry transition
 * re-queues it with retries + 1.
 */

import { isArtifactId } from '@sos-2/semantic-spine';
import type { JsonValue } from '@sos-2/semantic-spine';
import { canonicalSerialize } from '@sos-2/semantic-spine';
import { assertValidRuntimeIdentifier } from '@sos-2/runtime-contracts';
import type { TaskRecord, TaskStatus } from '@sos-2/live-store';
import { RFC3339_PATTERN } from '@sos-2/live-store';
import { InvalidTaskNodeError, IllegalTaskTransitionError } from './errors.js';
import { assertValidOwnedPaths } from './scope.js';

/** The typed node states (the work-order state machine). */
export const TASK_NODE_STATES = ['PENDING', 'RUNNING', 'PAUSED', 'CANCELLED', 'COMPLETED', 'FAILED'] as const;
export type TaskNodeState = (typeof TASK_NODE_STATES)[number];

const NODE_STATE_SET: ReadonlySet<string> = new Set(TASK_NODE_STATES);

/** The typed failure kinds — worker crashes / provider outages / body loss are TYPED. */
export const TASK_FAILURE_KINDS = [
  'WORKER_CRASH',
  'BODY_LOST',
  'PROVIDER_OUTAGE',
  'OPERATION_FAILURE',
  'CAPABILITY_UNSUPPORTED',
  'AUTHORITY_GAP',
  'VERIFICATION_REJECTED',
] as const;
export type TaskFailureKind = (typeof TASK_FAILURE_KINDS)[number];

const FAILURE_KIND_SET: ReadonlySet<string> = new Set(TASK_FAILURE_KINDS);

/** Recovery discipline: a failed task is RETRYABLE or TERMINAL — never silently "done". */
export const TASK_RECOVERY_STATUSES = ['NONE', 'RETRYABLE', 'TERMINAL'] as const;
export type TaskRecoveryStatus = (typeof TASK_RECOVERY_STATUSES)[number];

const RECOVERY_STATUS_SET: ReadonlySet<string> = new Set(TASK_RECOVERY_STATUSES);

/** The lane an assigned task occupies (up to three concurrent worker lanes). */
export const TASK_LANES = [1, 2, 3] as const;
export type TaskLane = (typeof TASK_LANES)[number];

const LANE_SET: ReadonlySet<number> = new Set(TASK_LANES);

/** Is this a lane number (1 | 2 | 3)? */
export function isTaskLane(value: unknown): value is TaskLane {
  return typeof value === 'number' && LANE_SET.has(value);
}

/** The cost envelope of a task (the section 3 body-envelope mirror at the task level). */
export interface TaskCostEnvelope {
  /** Cost ceiling in USD per task, or null when unmetered. */
  readonly max_cost_usd: number | null;
  /** Duration ceiling in milliseconds, or null when unbounded. */
  readonly max_duration_ms: number | null;
}

/** One entry of the node's checkpoint chain (resumable snapshot reference). */
export interface TaskNodeCheckpointRef {
  readonly checkpoint_id: string;
  /** The 0-based work-program step index this checkpoint resumes from. */
  readonly step_index: number;
  readonly recorded_at: string;
}

/** The handoff context carried on (re)assignment (the section 9 execution-contract shape). */
export interface TaskHandoff {
  /** The authority reference the receiving worker acts under (carried authority context). */
  readonly authority_ref: string;
  /** The exact workspace revision at handoff time. */
  readonly workspace_revision: { readonly source_revision: string | null; readonly deployment_revision: string | null };
  readonly issued_at: string;
  readonly from_state: TaskNodeState;
  readonly note: string | null;
}

/** The typed assignment record (task, lane, worker ref, lease ref). */
export interface TaskNodeAssignment {
  readonly lane: TaskLane;
  /** The worker's RUNTIME identity (never a semantic identity). */
  readonly worker_ref: string;
  /** The body lease the assignment holds. */
  readonly lease_ref: string;
  readonly assigned_at: string;
  readonly handoff: TaskHandoff | null;
}

/** Recovery bookkeeping (typed — never a silent "done"). */
export interface TaskNodeRecovery {
  readonly status: TaskRecoveryStatus;
  readonly failure_kind: TaskFailureKind | null;
  readonly reason: string | null;
  readonly failed_at: string | null;
}

/** The typed TaskNode — one vertex of the durable mission work graph. */
export interface TaskNode {
  /** Task identity — a caller-supplied RUNTIME identifier (never minted here, never spine-shaped). */
  readonly task_id: string;
  /** Mission artifact id (sos://Mission/...) — REQUIRED on every task. */
  readonly mission_ref: string;
  /** Authority grant artifact id (sos://AuthorityGrant/...) — REQUIRED on every task. */
  readonly authority_ref: string;
  /** Human-readable title (non-empty). */
  readonly title: string;
  /** The exclusive owned-path scope (non-empty, duplicate-free). */
  readonly owned_paths: readonly string[];
  /** Dependencies (task ids; must exist; the graph validates acyclicity). */
  readonly dependencies: readonly string[];
  /** The typed state. */
  readonly state: TaskNodeState;
  /** The assignment, when any (lane + worker + lease). */
  readonly assignment: TaskNodeAssignment | null;
  /** The owned workspace/repository revision (exact — preserved, never defaulted). */
  readonly workspace_revision: { readonly source_revision: string | null; readonly deployment_revision: string | null };
  /** The checkpoint chain (a crashed worker resumes from the last checkpoint, not from zero). */
  readonly checkpoint_chain: readonly TaskNodeCheckpointRef[];
  /** Pending ask queue entry ids (ASK is first-class — an asking task parks, it never errors). */
  readonly pending_asks: readonly string[];
  /** Retry count. */
  readonly retries: number;
  /** Recovery state (a FAILED task carries RETRYABLE or TERMINAL — never NONE). */
  readonly recovery: TaskNodeRecovery;
  /** Unresolved uncertainty statements (retained, never dropped). */
  readonly unresolved_uncertainty: readonly string[];
  /** The cost envelope. */
  readonly cost_envelope: TaskCostEnvelope;
  /** The final verification record ref (gates COMPLETED — section 10). */
  readonly verification_ref: string | null;
  /** The work program (opaque canonical JSON — the orchestrator's plan fragment). */
  readonly steps: JsonValue;
}

/** Input for adding a node (state starts PENDING; identity is caller-supplied). */
export interface TaskNodeInput {
  readonly task_id: string;
  readonly mission_ref: string;
  readonly authority_ref: string;
  readonly title: string;
  readonly owned_paths: readonly string[];
  readonly dependencies?: readonly string[];
  readonly workspace_revision?: { readonly source_revision: string | null; readonly deployment_revision: string | null };
  readonly unresolved_uncertainty?: readonly string[];
  readonly cost_envelope?: TaskCostEnvelope;
  readonly steps: JsonValue;
}

const NODE_INPUT_KEYS = [
  'task_id',
  'mission_ref',
  'authority_ref',
  'title',
  'owned_paths',
  'dependencies',
  'workspace_revision',
  'unresolved_uncertainty',
  'cost_envelope',
  'steps',
] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isRfc3339(value: unknown): value is string {
  return typeof value === 'string' && RFC3339_PATTERN.test(value);
}

function isJson(value: unknown): boolean {
  try {
    canonicalSerialize(value);
    return true;
  } catch {
    return false;
  }
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

/** Validate a cost envelope (throws InvalidTaskNodeError). */
function assertValidCostEnvelope(value: unknown): asserts value is TaskCostEnvelope {
  if (
    !isPlainObject(value) ||
    !hasExactKeys(value, ['max_cost_usd', 'max_duration_ms']) ||
    (value['max_cost_usd'] !== null &&
      (typeof value['max_cost_usd'] !== 'number' || !Number.isFinite(value['max_cost_usd']) || value['max_cost_usd'] < 0)) ||
    (value['max_duration_ms'] !== null &&
      (typeof value['max_duration_ms'] !== 'number' || !Number.isFinite(value['max_duration_ms']) || value['max_duration_ms'] < 0))
  ) {
    throw new InvalidTaskNodeError(
      `cost envelope must be { max_cost_usd: number | null, max_duration_ms: number | null } (finite non-negative), received: ${JSON.stringify(value)}`,
    );
  }
}

/** Validate a node input (throws InvalidTaskNodeError with a precise message). */
export function assertValidTaskNodeInput(value: unknown): asserts value is TaskNodeInput {
  if (!isPlainObject(value)) {
    throw new InvalidTaskNodeError('task node input must be an object');
  }
  const keys = Object.keys(value);
  const known = new Set<string>(NODE_INPUT_KEYS);
  const unknown = keys.find((key) => !known.has(key));
  if (unknown !== undefined) {
    throw new InvalidTaskNodeError(
      `task node input carries the unknown field ${JSON.stringify(unknown)} — the exact field set is { ${NODE_INPUT_KEYS.join(', ')} }; mission and authority references are REQUIRED, identity is caller-supplied`,
    );
  }
  if (!keys.includes('task_id') || !keys.includes('mission_ref') || !keys.includes('authority_ref')) {
    throw new InvalidTaskNodeError(
      'task node input REQUIRES task_id, mission_ref and authority_ref — every task carries its mission and authority references (pinned)',
    );
  }
  try {
    assertValidRuntimeIdentifier(value['task_id'], 'task node task_id');
  } catch (cause) {
    throw new InvalidTaskNodeError((cause as Error).message);
  }
  if (typeof value['mission_ref'] !== 'string' || !isArtifactId(value['mission_ref']) || !value['mission_ref'].startsWith('sos://Mission/')) {
    throw new InvalidTaskNodeError(
      `mission_ref must be a well-formed sos://Mission/... spine artifact id — every task carries its mission reference, received: ${JSON.stringify(value['mission_ref'])}`,
    );
  }
  if (
    typeof value['authority_ref'] !== 'string' ||
    !isArtifactId(value['authority_ref']) ||
    !value['authority_ref'].startsWith('sos://AuthorityGrant/')
  ) {
    throw new InvalidTaskNodeError(
      `authority_ref must be a well-formed sos://AuthorityGrant/... spine artifact id — every task runs under explicit authority (fail closed), received: ${JSON.stringify(value['authority_ref'])}`,
    );
  }
  if (!isNonEmptyString(value['title'])) {
    throw new InvalidTaskNodeError(`task node title must be a non-empty string, received: ${JSON.stringify(value['title'])}`);
  }
  assertValidOwnedPaths(value['owned_paths'], 'task node owned_paths');
  if (value['dependencies'] !== undefined && !isStringArray(value['dependencies'])) {
    throw new InvalidTaskNodeError('task node dependencies must be an array of task ids');
  }
  for (const dependency of value['dependencies'] ?? []) {
    try {
      assertValidRuntimeIdentifier(dependency, 'task node dependency');
    } catch (cause) {
      throw new InvalidTaskNodeError((cause as Error).message);
    }
  }
  if (value['workspace_revision'] !== undefined) {
    const revision = value['workspace_revision'];
    if (
      !isPlainObject(revision) ||
      !hasExactKeys(revision, ['source_revision', 'deployment_revision']) ||
      (revision['source_revision'] !== null && !isNonEmptyString(revision['source_revision'])) ||
      (revision['deployment_revision'] !== null && !isNonEmptyString(revision['deployment_revision']))
    ) {
      throw new InvalidTaskNodeError('task node workspace_revision must be { source_revision: string | null, deployment_revision: string | null }');
    }
  }
  if (value['unresolved_uncertainty'] !== undefined && !isStringArray(value['unresolved_uncertainty'])) {
    throw new InvalidTaskNodeError('task node unresolved_uncertainty must be an array of strings');
  }
  if (value['cost_envelope'] !== undefined) {
    assertValidCostEnvelope(value['cost_envelope']);
  }
  if (!isJson(value['steps'])) {
    throw new InvalidTaskNodeError('task node steps must be a canonical-JSON value (the work program)');
  }
}

/** The fresh node built from an input (state PENDING, nothing assigned). */
export function taskNodeFromInput(input: TaskNodeInput): TaskNode {
  assertValidTaskNodeInput(input);
  return {
    task_id: input.task_id,
    mission_ref: input.mission_ref,
    authority_ref: input.authority_ref,
    title: input.title,
    owned_paths: [...input.owned_paths],
    dependencies: [...(input.dependencies ?? [])],
    state: 'PENDING',
    assignment: null,
    workspace_revision: structuredClone(input.workspace_revision ?? { source_revision: null, deployment_revision: null }),
    checkpoint_chain: [],
    pending_asks: [],
    retries: 0,
    recovery: { status: 'NONE', failure_kind: null, reason: null, failed_at: null },
    unresolved_uncertainty: [...(input.unresolved_uncertainty ?? [])],
    cost_envelope: structuredClone(input.cost_envelope ?? { max_cost_usd: null, max_duration_ms: null }),
    verification_ref: null,
    steps: structuredClone(input.steps),
  };
}

// ---------------------------------------------------------------------------
// The typed state machine
// ---------------------------------------------------------------------------

/** The legal transitions (typed only — everything else throws naming the rule). */
export const TASK_NODE_TRANSITIONS: Readonly<Record<TaskNodeState, readonly TaskNodeState[]>> = {
  PENDING: ['RUNNING', 'CANCELLED', 'PAUSED'],
  RUNNING: ['PAUSED', 'CANCELLED', 'COMPLETED', 'FAILED'],
  PAUSED: ['RUNNING', 'CANCELLED', 'COMPLETED', 'FAILED'],
  CANCELLED: [],
  COMPLETED: [],
  FAILED: ['PENDING'],
};

/** Assert a transition is legal (throws IllegalTaskTransitionError naming the rule). */
export function assertLegalTransition(from: TaskNodeState, to: TaskNodeState): void {
  const legal = TASK_NODE_TRANSITIONS[from].includes(to);
  if (!legal) {
    const rule =
      to === 'COMPLETED'
        ? 'completion is verification-gated: only RUNNING or PAUSED tasks carrying a final verification record complete (section 10)'
        : to === 'PENDING'
          ? 'only a FAILED task with RETRYABLE recovery re-queues (recovery marks the task retryable, never silently done)'
          : from === 'COMPLETED' || from === 'CANCELLED'
            ? 'COMPLETED and CANCELLED are terminal states'
            : `the typed state machine does not define ${from} -> ${to}`;
    throw new IllegalTaskTransitionError(from, to, rule);
  }
}

/** The legal transition list of a state (for audits/tests). */
export function legalTransitionsOf(from: TaskNodeState): readonly TaskNodeState[] {
  return TASK_NODE_TRANSITIONS[from];
}

// ---------------------------------------------------------------------------
// P2 TaskRecord mapping (section 6 — VERBATIM persistence)
// ---------------------------------------------------------------------------

/** Node state -> P2 record status (a parked ask maps to AWAITING_INPUT). */
export function recordStatusOf(node: TaskNode): TaskStatus {
  if (node.state === 'PAUSED' && node.pending_asks.length > 0) {
    return 'AWAITING_INPUT';
  }
  switch (node.state) {
    case 'PENDING':
      return 'QUEUED';
    case 'RUNNING':
      return 'RUNNING';
    case 'PAUSED':
      return 'PAUSED';
    case 'CANCELLED':
      return 'CANCELLED';
    case 'COMPLETED':
      return 'COMPLETED';
    case 'FAILED':
      return 'FAILED';
  }
}

/** P2 record status -> node state (AWAITING_INPUT is the ask overlay on PAUSED). */
export function nodeStateOfRecord(record: TaskRecord): TaskNodeState {
  switch (record.status) {
    case 'QUEUED':
      return 'PENDING';
    case 'RUNNING':
      return 'RUNNING';
    case 'PAUSED':
    case 'AWAITING_INPUT':
      return 'PAUSED';
    case 'CANCELLED':
      return 'CANCELLED';
    case 'COMPLETED':
      return 'COMPLETED';
    case 'FAILED':
      return 'FAILED';
  }
}

/** The node snapshot serialized into the record's plan field (canonical JSON). */
export interface TaskNodeSnapshot {
  readonly task_id: string;
  readonly mission_ref: string;
  readonly authority_ref: string;
  readonly title: string;
  readonly owned_paths: readonly string[];
  readonly dependencies: readonly string[];
  readonly assignment: TaskNodeAssignment | null;
  readonly checkpoint_chain: readonly TaskNodeCheckpointRef[];
  readonly pending_asks: readonly string[];
  readonly recovery: TaskNodeRecovery;
  readonly cost_envelope: TaskCostEnvelope;
  readonly verification_ref: string | null;
  readonly steps: JsonValue;
}

const SNAPSHOT_KEYS = [
  'task_id',
  'mission_ref',
  'authority_ref',
  'title',
  'owned_paths',
  'dependencies',
  'assignment',
  'checkpoint_chain',
  'pending_asks',
  'recovery',
  'cost_envelope',
  'verification_ref',
  'steps',
] as const;

/** Serialize the node snapshot (canonical-JSON safe, cloned defensively). */
export function snapshotOf(node: TaskNode): TaskNodeSnapshot {
  return {
    task_id: node.task_id,
    mission_ref: node.mission_ref,
    authority_ref: node.authority_ref,
    title: node.title,
    owned_paths: [...node.owned_paths],
    dependencies: [...node.dependencies],
    assignment: node.assignment === null ? null : structuredClone(node.assignment),
    checkpoint_chain: node.checkpoint_chain.map((entry) => ({ ...entry })),
    pending_asks: [...node.pending_asks],
    recovery: { ...node.recovery },
    cost_envelope: { ...node.cost_envelope },
    verification_ref: node.verification_ref,
    steps: structuredClone(node.steps),
  };
}

/** Validate a deserialized snapshot (throws InvalidTaskNodeError). */
export function assertValidTaskNodeSnapshot(value: unknown): asserts value is TaskNodeSnapshot {
  if (!isPlainObject(value)) {
    throw new InvalidTaskNodeError('task node snapshot must be an object');
  }
  if (!hasExactKeys(value, SNAPSHOT_KEYS)) {
    throw new InvalidTaskNodeError(`task node snapshot must have the exact field set { ${SNAPSHOT_KEYS.join(', ')} }`);
  }
  if (!isNonEmptyString(value['task_id'])) {
    throw new InvalidTaskNodeError('snapshot task_id must be a non-empty string');
  }
  if (typeof value['mission_ref'] !== 'string' || !isArtifactId(value['mission_ref'])) {
    throw new InvalidTaskNodeError(`snapshot mission_ref must be a well-formed spine artifact id, received: ${JSON.stringify(value['mission_ref'])}`);
  }
  if (typeof value['authority_ref'] !== 'string' || !isArtifactId(value['authority_ref'])) {
    throw new InvalidTaskNodeError(`snapshot authority_ref must be a well-formed spine artifact id, received: ${JSON.stringify(value['authority_ref'])}`);
  }
  if (!isNonEmptyString(value['title'])) {
    throw new InvalidTaskNodeError('snapshot title must be a non-empty string');
  }
  assertValidOwnedPaths(value['owned_paths'], 'snapshot owned_paths');
  if (!isStringArray(value['dependencies'])) {
    throw new InvalidTaskNodeError('snapshot dependencies must be an array of task ids');
  }
  if (!isStringArray(value['pending_asks'])) {
    throw new InvalidTaskNodeError('snapshot pending_asks must be an array of ask entry ids');
  }
  if (value['verification_ref'] !== null && !isNonEmptyString(value['verification_ref'])) {
    throw new InvalidTaskNodeError('snapshot verification_ref must be null or a non-empty string');
  }
  if (!isJson(value['steps'])) {
    throw new InvalidTaskNodeError('snapshot steps must be canonical JSON');
  }
  const recovery = value['recovery'];
  if (
    !isPlainObject(recovery) ||
    !hasExactKeys(recovery, ['status', 'failure_kind', 'reason', 'failed_at']) ||
    !RECOVERY_STATUS_SET.has(String(recovery['status'])) ||
    (recovery['failure_kind'] !== null && !FAILURE_KIND_SET.has(String(recovery['failure_kind']))) ||
    (recovery['reason'] !== null && !isNonEmptyString(recovery['reason'])) ||
    (recovery['failed_at'] !== null && !isRfc3339(recovery['failed_at']))
  ) {
    throw new InvalidTaskNodeError('snapshot recovery must be { status: NONE|RETRYABLE|TERMINAL, failure_kind, reason, failed_at }');
  }
  const assignment = value['assignment'];
  if (assignment !== null) {
    if (
      !isPlainObject(assignment) ||
      !hasExactKeys(assignment, ['lane', 'worker_ref', 'lease_ref', 'assigned_at', 'handoff']) ||
      !isTaskLane(assignment['lane']) ||
      !isNonEmptyString(assignment['worker_ref']) ||
      !isNonEmptyString(assignment['lease_ref']) ||
      !isRfc3339(assignment['assigned_at'])
    ) {
      throw new InvalidTaskNodeError('snapshot assignment must be { lane: 1|2|3, worker_ref, lease_ref, assigned_at, handoff }');
    }
  }
  const chain = value['checkpoint_chain'];
  if (!Array.isArray(chain)) {
    throw new InvalidTaskNodeError('snapshot checkpoint_chain must be an array');
  }
  for (const entry of chain) {
    if (
      !isPlainObject(entry) ||
      !hasExactKeys(entry, ['checkpoint_id', 'step_index', 'recorded_at']) ||
      !isNonEmptyString(entry['checkpoint_id']) ||
      typeof entry['step_index'] !== 'number' ||
      !Number.isInteger(entry['step_index']) ||
      entry['step_index'] < 0 ||
      !isRfc3339(entry['recorded_at'])
    ) {
      throw new InvalidTaskNodeError('snapshot checkpoint_chain entries must be { checkpoint_id, step_index, recorded_at }');
    }
  }
  assertValidCostEnvelope(value['cost_envelope']);
}

/**
 * Rebuild the node VIEW from a durable record: the native section 6 fields
 * supply status/mission/authority/revision/lease/checkpoints/retries/
 * uncertainty/verification, and the plan snapshot supplies the graph
 * fragment (scope, dependencies, assignment, recovery, cost envelope,
 * work program). The snapshot's checkpoint chain is integrity-trimmed to
 * checkpoints that exist in the record (no partial-write ghost refs).
 */
export function nodeFromRecord(record: TaskRecord): TaskNode {
  const snapshot = record.plan as unknown;
  assertValidTaskNodeSnapshot(snapshot);
  const checkpointChain = snapshot.checkpoint_chain.filter((ref) =>
    record.checkpoints.some((checkpoint) => checkpoint.checkpoint_id === ref.checkpoint_id),
  );
  return {
    task_id: record.task_id,
    mission_ref: record.mission_ref !== null ? record.mission_ref : snapshot.mission_ref,
    authority_ref: record.authority_context.grant_refs[0] ?? snapshot.authority_ref,
    title: snapshot.title,
    owned_paths: snapshot.owned_paths,
    dependencies: snapshot.dependencies,
    state: nodeStateOfRecord(record),
    assignment: snapshot.assignment,
    workspace_revision: {
      source_revision: record.owned_revision.source_revision,
      deployment_revision: record.owned_revision.deployment_revision,
    },
    checkpoint_chain: checkpointChain,
    pending_asks: snapshot.pending_asks,
    retries: record.retries,
    recovery: snapshot.recovery,
    unresolved_uncertainty: record.unresolved_uncertainty,
    cost_envelope: snapshot.cost_envelope,
    verification_ref: snapshot.verification_ref,
    steps: snapshot.steps,
  };
}

/** Is a value one of the typed node states? */
export function isTaskNodeState(value: unknown): value is TaskNodeState {
  return typeof value === 'string' && NODE_STATE_SET.has(value);
}

/** Is a value one of the typed failure kinds? */
export function isTaskFailureKind(value: unknown): value is TaskFailureKind {
  return typeof value === 'string' && FAILURE_KIND_SET.has(value);
}
