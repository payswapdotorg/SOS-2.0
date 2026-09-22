/**
 * THE DURABLE TASK GRAPH (Work Order P6) — the mission-linked work graph
 * the Spirit Orchestrator is the control loop over.
 *
 * PERSISTENCE (append-only through the P2 live-store task records,
 * VERBATIM): every node IS one P2 TaskRecord — the section 6 field list
 * maps natively (status, mission_ref, plan/work graph, owned_revision,
 * authority_context, body_lease_ref, checkpoints, artifacts, observations,
 * unresolved_uncertainty, retries, recovery_state, resource_usage,
 * final_verification) and the node snapshot serializes into the record's
 * plan field. The store persists the graph's records exactly as written;
 * every write is CAS-guarded (read-modify-write with expected_revision),
 * so there are NO PARTIAL WRITES: a crashed writer leaves the previously
 * stored revision intact and the retry re-reads.
 *
 * CONTROL PROTOCOL (who writes what — one record, CAS-guarded):
 *   - the GRAPH owns the node lifecycle writes: add (PENDING), assign
 *     (PENDING -> RUNNING with lease + lane + worker + handoff), fail
 *     (typed failure -> FAILED + recovery), retry (FAILED -> PENDING,
 *     retries + 1), ask parking/resolution (pending asks overlay,
 *     AWAITING_INPUT record status), workspace revision pinning and the
 *     post-completion verification ref;
 *   - the SECTION 9 lifecycle (pauseTask/resumeTask/cancelTask/
 *     completeTask) flows through the merged P5 execution fabric, which
 *     writes the durable status itself (with body-side contract calls);
 *     the graph ADOPTS those states through adoptFabricTransition, which
 *     re-reads the record and validates the state change is a legal
 *     TYPED transition from the node's prior state (never a blind
 *     adoption — a fabric-written status the typed machine forbids is a
 *     loud structure error).
 *
 * DISJOINT CONCURRENT SCOPES: assignment is only legal onto an owned-path
 * scope DISJOINT from every active node's scope and a FREE lane (1..3 —
 * lanes stay occupied while a task holds its assignment, including
 * pauses); a collision is a typed AssignmentDeniedError (SCOPE_COLLISION
 * / LANE_EXHAUSTED) — never a silent overlap (pinned).
 *
 * Determinism: no Date.now / Math.random / fetch / process.env in this
 * package's src — the clock and the stores are injected; observation ids
 * the graph ingests are deterministic sequences over the record's durable
 * observation count.
 */

import { InvalidTaskNodeError, TaskGraphStructureError, TaskRecoveryError } from './errors.js';
import { AssignmentDeniedError } from './errors.js';
import type {
  TaskNode,
  TaskNodeAssignment,
  TaskNodeCheckpointRef,
  TaskNodeInput,
  TaskNodeState,
  TaskFailureKind,
  TaskHandoff,
  TaskLane,
} from './node.js';
import { assertLegalTransition, nodeFromRecord, recordStatusOf, snapshotOf, taskNodeFromInput } from './node.js';
import { scanGraphInvariants } from './invariants.js';
import type { GraphInvariantReport } from './invariants.js';
import { firstCollision, scopesCollide } from './scope.js';
import type { Clock, ObservationEventInput, ObservationEventRepository, PutResult, TaskRecord, TaskStateRepository } from '@sos-2/live-store';
import { formatRfc3339 } from '@sos-2/live-store';

/** Graph dependencies: the durable task repository, the injected clock, the observation boundary. */
export interface TaskGraphDeps {
  /** The durable P2 task repository — the node records' durable home (append-only, CAS). */
  readonly tasks: TaskStateRepository;
  /** The typed observation boundary (durable, replay-protected — P2 port). */
  readonly observationEvents: ObservationEventRepository;
  /** The injected clock (no hidden time). */
  readonly clock: Clock;
}

/** Input for an assignment (typed assignment record — task, lane, worker, lease). */
export interface AssignNodeInput {
  readonly lane: TaskLane;
  readonly worker_ref: string;
  readonly lease_ref: string;
  /** Optional handoff note (the handoff carries authority + workspace revision by construction). */
  readonly note: string | null;
}

/** Input for recording a typed failure. */
export interface RecordFailureInput {
  readonly failure_kind: TaskFailureKind;
  readonly reason: string;
  /** RETRYABLE (default) or TERMINAL. */
  readonly recovery: 'RETRYABLE' | 'TERMINAL';
}

/** The typed outcome of a fabric-transition adoption. */
export type AdoptionOutcome =
  | { readonly status: 'ADOPTED'; readonly node: TaskNode }
  | { readonly status: 'UNCHANGED'; readonly node: TaskNode };

/** One graph transition to record alongside a write. */
interface GraphTransition {
  readonly kind: string;
  readonly details: Record<string, unknown>;
}

/**
 * THE DURABLE TASK GRAPH.
 */
export class TaskGraph {
  private readonly tasks: TaskStateRepository;
  private readonly observationEvents: ObservationEventRepository;
  private readonly clock: Clock;

  constructor(deps: TaskGraphDeps) {
    if (typeof deps !== 'object' || deps === null || typeof deps.tasks !== 'object' || deps.tasks === null) {
      throw new TaskGraphStructureError(['TaskGraph requires the durable P2 task repository (the port — node records live there)']);
    }
    if (typeof deps.observationEvents !== 'object' || deps.observationEvents === null) {
      throw new TaskGraphStructureError(['TaskGraph requires the typed observation boundary (P2 port)']);
    }
    if (typeof deps.clock !== 'object' || deps.clock === null || typeof deps.clock.nowEpochMs !== 'function') {
      throw new TaskGraphStructureError(['TaskGraph requires an injected clock (no hidden time)']);
    }
    this.tasks = deps.tasks;
    this.observationEvents = deps.observationEvents;
    this.clock = deps.clock;
  }

  // -------------------------------------------------------------------------
  // Node lifecycle (graph-owned writes)
  // -------------------------------------------------------------------------

  /** Add a node (state PENDING). Validates mission+authority refs, scope shape, dependencies and acyclicity. */
  async addNode(input: TaskNodeInput): Promise<TaskNode> {
    const node = taskNodeFromInput(input);
    const existing = await this.tasks.get(node.task_id);
    if (existing !== undefined) {
      throw new InvalidTaskNodeError(
        `task ${JSON.stringify(node.task_id)} already exists in the durable store — task ids are single-use (no local identity minting; the caller supplies durable identities)`,
      );
    }
    // Structural validation BEFORE the first write (acyclicity over the
    // graph-so-far + no orphaned dependencies + scope shape).
    const nodes = await this.nodes();
    const report = scanGraphInvariants([...nodes, node]);
    const relevant = report.violations.filter((violation) => violation.task_id === node.task_id);
    if (relevant.length > 0) {
      throw new TaskGraphStructureError(relevant.map((violation) => `${violation.rule}: ${violation.detail}`));
    }
    const record = await this.insertNode(node, {
      kind: 'NODE_ADDED',
      details: { title: node.title, owned_paths: [...node.owned_paths], dependencies: [...node.dependencies] },
    });
    return nodeFromRecord(record);
  }

  /** The node view of a task, or undefined. */
  async node(taskId: string): Promise<TaskNode | undefined> {
    const record = await this.tasks.get(taskId);
    return record === undefined ? undefined : nodeFromRecord(record);
  }

  /** Every node, deterministic order by task id. */
  async nodes(): Promise<TaskNode[]> {
    const listed = await this.tasks.list({ limit: null });
    return listed.items
      .map((record) => nodeFromRecord(record))
      .sort((a, b) => (a.task_id < b.task_id ? -1 : a.task_id > b.task_id ? 1 : 0));
  }

  /**
   * Assign a PENDING node onto a lane: the scope must be DISJOINT from
   * every active node's scope and the lane must be free — a collision is
   * a typed assignment denial, never a silent overlap.
   */
  async assign(taskId: string, input: AssignNodeInput): Promise<TaskNode> {
    const node = await this.requireNode(taskId);
    if (node.state !== 'PENDING') {
      throw new AssignmentDeniedError(
        'TASK_NOT_PENDING',
        `task ${JSON.stringify(taskId)} is ${node.state} — only PENDING tasks assign`,
        { task_id: taskId, state: node.state },
      );
    }
    // Dependencies gate assignment (all dependencies COMPLETED).
    for (const dependency of node.dependencies) {
      const dependencyNode = await this.node(dependency);
      if (dependencyNode === undefined || dependencyNode.state !== 'COMPLETED') {
        throw new AssignmentDeniedError(
          'DEPENDENCY_UNSATISFIED',
          `task ${JSON.stringify(taskId)} depends on ${JSON.stringify(dependency)} which is ${dependencyNode === undefined ? 'missing' : dependencyNode.state} — dependencies gate assignment`,
          { task_id: taskId, dependency },
        );
      }
    }
    const nodes = await this.nodes();
    const active = nodes.filter((candidate) => candidate.state === 'RUNNING' || (candidate.state === 'PAUSED' && candidate.assignment !== null));
    // Scope disjointness — the pinned rule.
    for (const other of active) {
      if (scopesCollide(node.owned_paths, other.owned_paths)) {
        const collision = firstCollision(node.owned_paths, other.owned_paths)!;
        throw new AssignmentDeniedError(
          'SCOPE_COLLISION',
          `task ${JSON.stringify(taskId)} scope [${node.owned_paths.join(', ')}] collides with active task ${JSON.stringify(other.task_id)} scope [${other.owned_paths.join(', ')}] (first collision: ${JSON.stringify(collision.a)} vs ${JSON.stringify(collision.b)}) — assignment is only legal onto DISJOINT owned-path scopes, never a silent overlap`,
          { task_id: taskId, collides_with: other.task_id, scope_a: collision.a, scope_b: collision.b },
        );
      }
    }
    // Lane freedom (up to three concurrent worker lanes; a lane stays
    // occupied while its task holds the assignment).
    const occupiedLanes = new Set<number>();
    for (const other of active) {
      if (other.assignment !== null) {
        occupiedLanes.add(other.assignment.lane);
      }
    }
    if (occupiedLanes.has(input.lane)) {
      throw new AssignmentDeniedError('LANE_EXHAUSTED', `lane ${input.lane} is occupied — up to three concurrent worker lanes exist`, {
        task_id: taskId,
        lane: input.lane,
      });
    }
    const now = formatRfc3339(this.clock.nowEpochMs());
    const handoff: TaskHandoff = {
      authority_ref: node.authority_ref,
      workspace_revision: { ...node.workspace_revision },
      issued_at: now,
      from_state: node.state,
      note: input.note,
    };
    const assignment: TaskNodeAssignment = {
      lane: input.lane,
      worker_ref: input.worker_ref,
      lease_ref: input.lease_ref,
      assigned_at: now,
      handoff,
    };
    assertLegalTransition(node.state, 'RUNNING');
    const assigned: TaskNode = { ...node, state: 'RUNNING', assignment };
    const record = await this.writeNode(assigned, node, {
      kind: 'ASSIGNED',
      details: {
        lane: assignment.lane,
        worker_ref: assignment.worker_ref,
        lease_ref: assignment.lease_ref,
        authority_ref: handoff.authority_ref,
        handoff_workspace_revision: { ...handoff.workspace_revision },
      },
    });
    return nodeFromRecord(record);
  }

  /**
   * Record a TYPED task failure (worker crash, provider outage, body
   * loss, operation failure, rejected verification): RUNNING/PAUSED ->
   * FAILED with an explicit recovery decision (RETRYABLE or TERMINAL —
   * never silently "done"). The assignment is cleared (the lease's fate
   * is the broker's concern; the node keeps the failure + recovery).
   */
  async recordFailure(taskId: string, input: RecordFailureInput): Promise<TaskNode> {
    const node = await this.requireNode(taskId);
    assertLegalTransition(node.state, 'FAILED');
    const now = formatRfc3339(this.clock.nowEpochMs());
    const failed: TaskNode = {
      ...node,
      state: 'FAILED',
      assignment: null,
      recovery: {
        status: input.recovery,
        failure_kind: input.failure_kind,
        reason: input.reason,
        failed_at: now,
      },
    };
    const record = await this.writeNode(failed, node, {
      kind: 'FAILED',
      details: { failure_kind: input.failure_kind, recovery: input.recovery, reason: input.reason },
    });
    return nodeFromRecord(record);
  }

  /**
   * Retry a FAILED task: only RETRYABLE recovery re-queues (typed — the
   * transition is refused for TERMINAL failures); retries increments and
   * the recovery state clears. The task resumes from its checkpoint
   * chain, not from zero (the worker reads the chain at re-assignment).
   */
  async retry(taskId: string): Promise<TaskNode> {
    const node = await this.requireNode(taskId);
    if (node.state !== 'FAILED') {
      throw new TaskRecoveryError(`task ${JSON.stringify(taskId)} is ${node.state} — only FAILED tasks retry`);
    }
    if (node.recovery.status !== 'RETRYABLE') {
      throw new TaskRecoveryError(
        `task ${JSON.stringify(taskId)} recovery is ${node.recovery.status} — only RETRYABLE failures re-queue (recovery never lies)`,
      );
    }
    assertLegalTransition('FAILED', 'PENDING');
    const lastCheckpoint = node.checkpoint_chain.length > 0 ? node.checkpoint_chain[node.checkpoint_chain.length - 1] : undefined;
    const retried: TaskNode = {
      ...node,
      state: 'PENDING',
      retries: node.retries + 1,
      recovery: { status: 'NONE', failure_kind: null, reason: null, failed_at: null },
      assignment: null,
    };
    const record = await this.writeNode(retried, node, {
      kind: 'RETRY_QUEUED',
      details: {
        retries: retried.retries,
        resume_from_checkpoint: lastCheckpoint === undefined ? null : lastCheckpoint.checkpoint_id,
      },
    });
    return nodeFromRecord(record);
  }

  /**
   * Park a node behind a pending ASK (ASK IS A SUCCESS STATE): the ask
   * entry id is recorded first-class and the node parks PAUSED — while
   * asks are pending the durable record status is AWAITING_INPUT and the
   * section 9 execution surface refuses the task.
   */
  async recordAsk(taskId: string, askEntryId: string, reason: string): Promise<TaskNode> {
    const node = await this.requireNode(taskId);
    if (typeof askEntryId !== 'string' || askEntryId.length === 0) {
      throw new InvalidTaskNodeError('recordAsk requires a non-empty ask entry id');
    }
    if (typeof reason !== 'string' || reason.length === 0) {
      throw new InvalidTaskNodeError('recordAsk requires a non-empty reason');
    }
    if (node.pending_asks.includes(askEntryId)) {
      return node; // idempotent: the same ask entry is already parked
    }
    if (node.state !== 'PAUSED') {
      assertLegalTransition(node.state, 'PAUSED');
    }
    const parked: TaskNode = {
      ...node,
      state: 'PAUSED',
      pending_asks: [...node.pending_asks, askEntryId],
      unresolved_uncertainty: [...node.unresolved_uncertainty, `pending ask ${askEntryId}: ${reason}`],
    };
    const record = await this.writeNode(parked, node, {
      kind: 'ASK_PARKED',
      details: { ask_entry_id: askEntryId, reason },
    });
    return nodeFromRecord(record);
  }

  /**
   * Resolve a parked ask: the entry id leaves the pending list; when no
   * asks remain pending the overlay clears (the record returns to PAUSED
   * for the section 9 resume path).
   */
  async resolveAsk(taskId: string, askEntryId: string): Promise<TaskNode> {
    const node = await this.requireNode(taskId);
    if (!node.pending_asks.includes(askEntryId)) {
      throw new TaskRecoveryError(
        `ask entry ${JSON.stringify(askEntryId)} is not pending on task ${JSON.stringify(taskId)} — resolution binds to a parked ask`,
      );
    }
    const remaining = node.pending_asks.filter((entry) => entry !== askEntryId);
    const resolved: TaskNode = { ...node, pending_asks: remaining };
    const record = await this.writeNode(resolved, node, {
      kind: 'ASK_RESOLVED',
      details: { ask_entry_id: askEntryId, remaining: remaining.length },
    });
    return nodeFromRecord(record);
  }

  /**
   * Record the final verification reference on a COMPLETED node (the
   * completion itself flows through the fabric's completeTask — the
   * verification record gates it; this write pins the ref into the node).
   */
  async recordVerificationRef(taskId: string, verificationRef: string): Promise<TaskNode> {
    const node = await this.requireNode(taskId);
    if (typeof verificationRef !== 'string' || verificationRef.length === 0) {
      throw new InvalidTaskNodeError('recordVerificationRef requires a non-empty verification record id');
    }
    if (node.state !== 'COMPLETED') {
      throw new TaskRecoveryError(
        `task ${JSON.stringify(taskId)} is ${node.state} — the verification reference is pinned on COMPLETED tasks (completion is verification-gated)`,
      );
    }
    const pinned: TaskNode = { ...node, verification_ref: verificationRef };
    const record = await this.writeNode(pinned, node, {
      kind: 'VERIFICATION_PINNED',
      details: { verification_ref: verificationRef },
    });
    return nodeFromRecord(record);
  }

  /**
   * Pin the exact workspace revision of a node (the worker's honest
   * report of the revision it produced/observed — preserved, never
   * defaulted).
   */
  async recordWorkspaceRevision(
    taskId: string,
    revision: { source_revision: string | null; deployment_revision: string | null },
  ): Promise<TaskNode> {
    const node = await this.requireNode(taskId);
    if (
      !isPlainRevision(revision)
    ) {
      throw new InvalidTaskNodeError('workspace revision must be { source_revision: string | null, deployment_revision: string | null }');
    }
    const pinned: TaskNode = { ...node, workspace_revision: { ...revision } };
    const record = await this.writeNode(pinned, node, {
      kind: 'WORKSPACE_REVISION_PINNED',
      details: { ...revision },
    });
    return nodeFromRecord(record);
  }

  /**
   * Adopt a durable status written by the merged P5 fabric lifecycle
   * (pauseTask / resumeTask / cancelTask / completeTask): re-read the
   * record and validate the state change is a legal TYPED transition from
   * the node's prior state. A status the typed machine forbids is a loud
   * structure error — never a blind adoption.
   */
  async adoptFabricTransition(taskId: string, prior: TaskNode): Promise<AdoptionOutcome> {
    const record = await this.tasks.get(taskId);
    if (record === undefined) {
      throw new TaskGraphStructureError([`task ${JSON.stringify(taskId)} left the durable store — the graph never loses a task`]);
    }
    const current = nodeFromRecord(record);
    if (current.state === prior.state) {
      return { status: 'UNCHANGED', node: current };
    }
    assertLegalTransition(prior.state, current.state);
    if (current.state === 'CANCELLED' || current.state === 'FAILED' || current.state === 'COMPLETED') {
      // Terminal fabric writes clear the assignment in the node view
      // (assignments belong to RUNNING and PAUSED tasks).
      const cleared: TaskNode = { ...current, assignment: null };
      const written = await this.writeNode(cleared, current, {
        kind: 'FABRIC_TERMINAL_ADOPTED',
        details: { state: current.state },
      });
      return { status: 'ADOPTED', node: nodeFromRecord(written) };
    }
    return { status: 'ADOPTED', node: current };
  }

  /**
   * Append the graph's view of a checkpoint to the node's checkpoint
   * chain (the durable checkpoint itself is recorded through the fabric's
   * recordCheckpoint; this pins the resumable step index into the node).
   */
  async recordCheckpointRef(taskId: string, checkpoint: TaskNodeCheckpointRef): Promise<TaskNode> {
    const node = await this.requireNode(taskId);
    if (node.checkpoint_chain.some((entry) => entry.checkpoint_id === checkpoint.checkpoint_id)) {
      return node; // idempotent append
    }
    const record = await this.tasks.get(taskId);
    if (record === undefined || !record.checkpoints.some((entry) => entry.checkpoint_id === checkpoint.checkpoint_id)) {
      throw new TaskGraphStructureError([
        `checkpoint ${JSON.stringify(checkpoint.checkpoint_id)} is not in the durable record of task ${JSON.stringify(taskId)} — the chain references durable checkpoints only (no partial writes)`,
      ]);
    }
    const extended: TaskNode = { ...node, checkpoint_chain: [...node.checkpoint_chain, { ...checkpoint }] };
    const written = await this.writeNode(extended, node, {
      kind: 'CHECKPOINT_CHAINED',
      details: { checkpoint_id: checkpoint.checkpoint_id, step_index: checkpoint.step_index },
    });
    return nodeFromRecord(written);
  }

  // -------------------------------------------------------------------------
  // Invariants (crash safety is structural)
  // -------------------------------------------------------------------------

  /** The full invariant scan over the graph (G1..G8 — see invariants.ts). */
  async scan(): Promise<GraphInvariantReport> {
    return scanGraphInvariants(await this.nodes());
  }

  // -------------------------------------------------------------------------
  // Internals: CAS-guarded read-modify-write (no partial writes)
  // -------------------------------------------------------------------------

  private async requireNode(taskId: string): Promise<TaskNode> {
    const record = await this.tasks.get(taskId);
    if (record === undefined) {
      throw new TaskGraphStructureError([`task ${JSON.stringify(taskId)} is not in the durable task store — the graph never invents nodes`]);
    }
    return nodeFromRecord(record);
  }

  /** The first durable write of a node (creation). */
  private async insertNode(node: TaskNode, transition: GraphTransition): Promise<TaskRecord> {
    const now = formatRfc3339(this.clock.nowEpochMs());
    const eventId = `graph-obs:${node.task_id}:000001`;
    const event = this.observationEvent(node, transition, eventId, now);
    await this.observationEvents.ingest(event);
    const record: TaskRecord = {
      task_id: node.task_id,
      mission_ref: node.mission_ref,
      status: recordStatusOf(node),
      plan: snapshotOf(node) as unknown as TaskRecord['plan'],
      owned_revision: { ...node.workspace_revision },
      authority_context: {
        grant_refs: [node.authority_ref],
        notes: 'task-graph authority context (mission + authority references on every task)',
      },
      body_lease_ref: null,
      checkpoints: [],
      artifacts: [],
      observations: [event.id],
      unresolved_uncertainty: [...node.unresolved_uncertainty],
      retries: node.retries,
      recovery_state: { ...node.recovery } as unknown as TaskRecord['recovery_state'],
      resource_usage: null,
      final_verification: null,
      revision: 1,
      created_at: now,
      updated_at: now,
    };
    const put: PutResult<TaskRecord> = await this.tasks.put(record);
    if (put.kind === 'STORED' || put.kind === 'IDENTICAL') {
      return put.record;
    }
    throw new TaskGraphStructureError([
      `task ${JSON.stringify(node.task_id)} creation lost the durable write race (${put.reason}) — task ids are single-use`,
    ]);
  }

  /**
   * One CAS write of the node view + one transition observation. The
   * observation id continues the record's durable observation sequence
   * (namespaced graph-obs: — never colliding with the fabric's
   * fabric-obs: ids); the observation is ingested BEFORE the CAS write,
   * and a lost race leaves both retryable (the event ingest is
   * replay-protected and the record stands as stored — no partial
   * writes, no lost tasks).
   */
  private async writeNode(node: TaskNode, prior: TaskNode, transition: GraphTransition): Promise<TaskRecord> {
    const current = await this.tasks.get(node.task_id);
    if (current === undefined) {
      throw new TaskGraphStructureError([`task ${JSON.stringify(node.task_id)} is not in the durable task store`]);
    }
    const now = formatRfc3339(this.clock.nowEpochMs());
    const eventId = `graph-obs:${node.task_id}:${String(current.observations.length + 1).padStart(6, '0')}`;
    const event = this.observationEvent(prior, transition, eventId, now);
    await this.observationEvents.ingest(event);
    const updated: TaskRecord = {
      ...structuredClone(current),
      mission_ref: node.mission_ref,
      status: recordStatusOf(node),
      plan: snapshotOf(node) as unknown as TaskRecord['plan'],
      owned_revision: { ...node.workspace_revision },
      authority_context: {
        grant_refs: [node.authority_ref],
        notes: 'task-graph authority context (mission + authority references on every task)',
      },
      body_lease_ref: node.assignment === null ? current.body_lease_ref : node.assignment.lease_ref,
      observations: [...current.observations, event.id],
      unresolved_uncertainty: [...node.unresolved_uncertainty],
      retries: node.retries,
      recovery_state: { ...node.recovery } as unknown as TaskRecord['recovery_state'],
      final_verification: current.final_verification,
      revision: current.revision + 1,
      updated_at: now,
    };
    const put: PutResult<TaskRecord> = await this.tasks.put(updated, { expected_revision: current.revision });
    if (put.kind === 'STORED' || put.kind === 'IDENTICAL') {
      return put.record;
    }
    throw new Error(
      `task ${JSON.stringify(node.task_id)} graph write lost the CAS race (${put.reason}) — the durable record stands as stored; re-read and retry (never a partial write)`,
    );
  }

  private observationEvent(node: TaskNode, transition: GraphTransition, eventId: string, now: string): ObservationEventInput {
    return {
      id: eventId,
      source: 'task-graph',
      kind: `task.${transition.kind.toLowerCase()}`,
      occurred_at: now,
      payload: {
        task_id: node.task_id,
        mission_ref: node.mission_ref,
        authority_ref: node.authority_ref,
        from_state: node.state,
        ...transition.details,
      },
      provenance: ['task-graph', `task:${node.task_id}`, `mission:${node.mission_ref}`],
    };
  }
}

function isPlainRevision(revision: { source_revision: string | null; deployment_revision: string | null }): boolean {
  return (
    typeof revision === 'object' &&
    revision !== null &&
    (revision.source_revision === null || typeof revision.source_revision === 'string') &&
    (revision.deployment_revision === null || typeof revision.deployment_revision === 'string')
  );
}
