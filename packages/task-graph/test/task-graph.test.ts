/**
 * @sos-2/task-graph contract tests (Work Order P6).
 *
 * Pins:
 *  - the typed six-state machine (illegal transitions throw naming the rule);
 *  - mission + authority references are REQUIRED on every node input;
 *  - owned-path scope disjointness + typed assignment denial on collision;
 *  - VERBATIM persistence: the node snapshot lands in the P2 record's plan
 *    field and every section 6 field maps natively (round-trip);
 *  - crash safety: typed failures leave the graph structurally valid and
 *    recovery marks the task RETRYABLE (retry re-queues, never silently done);
 *  - verification gating: recordVerificationRef binds to COMPLETED nodes;
 *  - the ASK overlay (parking maps the durable status to AWAITING_INPUT).
 */

import { describe, expect, it } from 'vitest';
import { ManualClock, createInMemoryLiveStore } from '@sos-2/live-store';
import {
  AssignmentDeniedError,
  IllegalTaskTransitionError,
  TaskGraph,
  TaskGraphError,
  TaskRecoveryError,
  assertLegalTransition,
  nodeFromRecord,
  recordStatusOf,
  scopesCollide,
  scopesDisjoint,
  scopesOverlap,
  snapshotOf,
  taskNodeFromInput,
} from '../src/index.js';
import type { TaskNode } from '../src/index.js';

const MISSION_REF = 'sos://Mission/0123456789abcdef0123456789abcdef';
const AUTHORITY_REF = 'sos://AuthorityGrant/0123456789abcdef0123456789abcdef';

function clock(): ManualClock {
  return new ManualClock(Date.parse('2026-02-01T10:00:00Z'));
}

function graph(clockInstance: ManualClock = clock()) {
  const store = createInMemoryLiveStore({ clock: clockInstance });
  const taskGraph = new TaskGraph({ tasks: store.tasks, observationEvents: store.observationEvents, clock: clockInstance });
  return { store, graph: taskGraph, clock: clockInstance };
}

function nodeInput(overrides: Partial<Parameters<typeof taskNodeFromInput>[0]> = {}) {
  return {
    task_id: 'task-alpha',
    mission_ref: MISSION_REF,
    authority_ref: AUTHORITY_REF,
    title: 'Advance the checkout mission',
    owned_paths: ['packages/checkout'],
    steps: { steps: [{ kind: 'operation', operation: { kind: 'workspace.write', path: 'src/a.ts', content: 'x' } }] },
    ...overrides,
  };
}

describe('owned-path scopes', () => {
  it('detects overlap by tree discipline (parent owns children)', () => {
    expect(scopesOverlap('src/a', 'src/a/b')).toBe(true);
    expect(scopesOverlap('src/a/*', 'src/a/b')).toBe(true);
    expect(scopesOverlap('src/ab', 'src/a')).toBe(false);
    expect(scopesCollide(['src/a'], ['src/b'])).toBe(false);
    expect(scopesCollide(['src/a', 'docs'], ['src/a/inner'])).toBe(true);
    expect(scopesDisjoint(['src/a'], ['src/b', 'docs/x'])).toBe(true);
  });

  it('rejects malformed scope entries loudly', () => {
    expect(() => taskNodeFromInput(nodeInput({ owned_paths: [] }))).toThrow(TaskGraphError);
    expect(() => taskNodeFromInput(nodeInput({ owned_paths: ['  '] }))).toThrow(TaskGraphError);
    expect(() => taskNodeFromInput(nodeInput({ owned_paths: ['src//a'] }))).toThrow(TaskGraphError);
    expect(() => taskNodeFromInput(nodeInput({ owned_paths: ['src/a', 'src/a'] }))).toThrow(TaskGraphError);
  });
});

describe('mission + authority references are required on every task', () => {
  it('rejects a node without a well-formed mission ref', () => {
    expect(() => taskNodeFromInput(nodeInput({ mission_ref: 'checkout-mission' }))).toThrow(/mission_ref/);
  });

  it('rejects a node without a well-formed authority ref', () => {
    expect(() => taskNodeFromInput(nodeInput({ authority_ref: 'worker-self-claimed' }))).toThrow(/authority_ref/);
  });

  it('rejects spine-shaped task ids (no local identity minting)', () => {
    expect(() => taskNodeFromInput(nodeInput({ task_id: 'sos://Mission/deadbeef' }))).toThrow(/semantic identity|sos:\/\//);
  });
});

describe('the typed state machine', () => {
  it('allows exactly the typed transitions', () => {
    expect(() => assertLegalTransition('PENDING', 'RUNNING')).not.toThrow();
    expect(() => assertLegalTransition('RUNNING', 'PAUSED')).not.toThrow();
    expect(() => assertLegalTransition('PAUSED', 'RUNNING')).not.toThrow();
    expect(() => assertLegalTransition('RUNNING', 'FAILED')).not.toThrow();
    expect(() => assertLegalTransition('FAILED', 'PENDING')).not.toThrow();
    expect(() => assertLegalTransition('RUNNING', 'COMPLETED')).not.toThrow();
    expect(() => assertLegalTransition('PENDING', 'COMPLETED')).toThrow(IllegalTaskTransitionError);
    expect(() => assertLegalTransition('FAILED', 'COMPLETED')).toThrow(/verification-gated/);
    expect(() => assertLegalTransition('COMPLETED', 'PENDING')).toThrow(IllegalTaskTransitionError);
    expect(() => assertLegalTransition('CANCELLED', 'RUNNING')).toThrow(/terminal states/);
    expect(() => assertLegalTransition('PENDING', 'FAILED')).toThrow(/typed state machine/);
  });
});

describe('durable persistence (append-only, VERBATIM, section 6 field-for-field)', () => {
  it('persists a node as a complete P2 TaskRecord and round-trips the view', async () => {
    const { store, graph: taskGraph } = graph();
    const added = await taskGraph.addNode(nodeInput());
    expect(added.state).toBe('PENDING');
    const record = await store.tasks.get('task-alpha');
    expect(record).toBeDefined();
    expect(record!.mission_ref).toBe(MISSION_REF);
    expect(record!.authority_context.grant_refs).toEqual([AUTHORITY_REF]);
    expect(record!.status).toBe('QUEUED');
    expect(record!.retries).toBe(0);
    expect(record!.observations.length).toBe(1);
    expect(record!.observations[0]!.startsWith('graph-obs:task-alpha:')).toBe(true);
    // The full section 6 field set is present on the durable record.
    for (const section6Field of [
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
    ]) {
      expect(Object.keys(record!)).toContain(section6Field);
    }
    // Round-trip: the node view rebuilds from the record VERBATIM.
    const roundTrip = nodeFromRecord(record!);
    expect(roundTrip.task_id).toBe(added.task_id);
    expect(roundTrip.mission_ref).toBe(added.mission_ref);
    expect(roundTrip.authority_ref).toBe(added.authority_ref);
    expect(roundTrip.owned_paths).toEqual(added.owned_paths);
    expect(roundTrip.steps).toEqual(added.steps);
    expect(roundTrip.cost_envelope).toEqual(added.cost_envelope);
  });

  it('refuses duplicate task ids (single-use durable identities)', async () => {
    const { graph: taskGraph } = graph();
    await taskGraph.addNode(nodeInput());
    await expect(taskGraph.addNode(nodeInput())).rejects.toThrow(/single-use/);
  });

  it('rejects dependency cycles and orphaned dependencies BEFORE the first write', async () => {
    const { graph: taskGraph } = graph();
    await taskGraph.addNode(nodeInput());
    await expect(
      taskGraph.addNode(nodeInput({ task_id: 'task-beta', owned_paths: ['packages/beta'], dependencies: ['task-missing'] })),
    ).rejects.toThrow(/orphaned-dependency/);
    await expect(
      taskGraph.addNode(nodeInput({ task_id: 'task-alpha', owned_paths: ['packages/b'], dependencies: ['task-alpha'] })),
    ).rejects.toThrow(/single-use|orphaned/);
  });
});

describe('assignment: disjoint scopes + free lanes, typed denial otherwise', () => {
  it('assigns a PENDING node with a typed assignment + handoff record', async () => {
    const { graph: taskGraph } = graph();
    await taskGraph.addNode(nodeInput());
    const assigned = await taskGraph.assign('task-alpha', { lane: 1, worker_ref: 'worker-01', lease_ref: 'lease:task-alpha:0001', note: 'first dispatch' });
    expect(assigned.state).toBe('RUNNING');
    expect(assigned.assignment).not.toBeNull();
    expect(assigned.assignment!.lane).toBe(1);
    expect(assigned.assignment!.worker_ref).toBe('worker-01');
    expect(assigned.assignment!.lease_ref).toBe('lease:task-alpha:0001');
    // The handoff carries authority context + workspace revision.
    expect(assigned.assignment!.handoff.authority_ref).toBe(AUTHORITY_REF);
    expect(assigned.assignment!.handoff.workspace_revision).toEqual({ source_revision: null, deployment_revision: null });
    const recordStatus = recordStatusOf(assigned);
    expect(recordStatus).toBe('RUNNING');
  });

  it('denies a colliding assignment with a TYPED SCOPE_COLLISION (never silent overlap)', async () => {
    const { graph: taskGraph } = graph();
    await taskGraph.addNode(nodeInput());
    await taskGraph.assign('task-alpha', { lane: 1, worker_ref: 'worker-01', lease_ref: 'lease:task-alpha:0001', note: null });
    await taskGraph.addNode(nodeInput({ task_id: 'task-beta', owned_paths: ['packages/checkout/src'] }));
    let denial: AssignmentDeniedError | null = null;
    try {
      await taskGraph.assign('task-beta', { lane: 2, worker_ref: 'worker-02', lease_ref: 'lease:task-beta:0001', note: null });
    } catch (cause) {
      denial = cause as AssignmentDeniedError;
    }
    expect(denial).not.toBeNull();
    expect(denial!.denial.code).toBe('SCOPE_COLLISION');
    expect(denial!.denial.reason).toContain('DISJOINT');
    // The colliding task stays PENDING — never a silent overlap.
    const beta = await taskGraph.node('task-beta');
    expect(beta!.state).toBe('PENDING');
    const report = await taskGraph.scan();
    expect(report.valid).toBe(true);
  });

  it('denies lane reuse with a typed LANE_EXHAUSTED denial', async () => {
    const { graph: taskGraph } = graph();
    await taskGraph.addNode(nodeInput());
    await taskGraph.assign('task-alpha', { lane: 2, worker_ref: 'worker-01', lease_ref: 'lease:task-alpha:0001', note: null });
    await taskGraph.addNode(nodeInput({ task_id: 'task-beta', owned_paths: ['packages/beta'] }));
    await expect(
      taskGraph.assign('task-beta', { lane: 2, worker_ref: 'worker-02', lease_ref: 'lease:task-beta:0001', note: null }),
    ).rejects.toThrow(/lane 2 is occupied/);
  });

  it('gates assignment on COMPLETED dependencies (typed DEPENDENCY_UNSATISFIED)', async () => {
    const { graph: taskGraph } = graph();
    await taskGraph.addNode(nodeInput());
    await taskGraph.addNode(nodeInput({ task_id: 'task-beta', owned_paths: ['packages/beta'], dependencies: ['task-alpha'] }));
    await expect(
      taskGraph.assign('task-beta', { lane: 1, worker_ref: 'worker-02', lease_ref: 'lease:task-beta:0001', note: null }),
    ).rejects.toThrow(/DEPENDENCY_UNSATISFIED|dependencies gate assignment/);
  });
});

describe('crash safety: typed failures, recovery, retry', () => {
  it('records a typed failure with RETRYABLE recovery and re-queues on retry', async () => {
    const { graph: taskGraph } = graph();
    await taskGraph.addNode(nodeInput());
    await taskGraph.assign('task-alpha', { lane: 1, worker_ref: 'worker-01', lease_ref: 'lease:task-alpha:0001', note: null });
    const failed = await taskGraph.recordFailure('task-alpha', {
      failure_kind: 'BODY_LOST',
      reason: 'body suspended mid-run; lease revoked',
      recovery: 'RETRYABLE',
    });
    expect(failed.state).toBe('FAILED');
    expect(failed.recovery.status).toBe('RETRYABLE');
    expect(failed.recovery.failure_kind).toBe('BODY_LOST');
    expect(failed.assignment).toBeNull();
    // The graph stays structurally valid after the failure.
    expect((await taskGraph.scan()).valid).toBe(true);
    const retried = await taskGraph.retry('task-alpha');
    expect(retried.state).toBe('PENDING');
    expect(retried.retries).toBe(1);
    expect(retried.recovery.status).toBe('NONE');
  });

  it('refuses retry of a TERMINAL failure (recovery never lies)', async () => {
    const { graph: taskGraph } = graph();
    await taskGraph.addNode(nodeInput());
    // A legal path: assign then fail terminally.
    await taskGraph.assign('task-alpha', { lane: 1, worker_ref: 'worker-01', lease_ref: 'lease:task-alpha:0001', note: null });
    await taskGraph.recordFailure('task-alpha', { failure_kind: 'OPERATION_FAILURE', reason: 'destructive failure', recovery: 'TERMINAL' });
    await expect(taskGraph.retry('task-alpha')).rejects.toThrow(TaskRecoveryError);
  });

  it('illegal failure transitions are typed violations naming the rule', async () => {
    const { graph: taskGraph } = graph();
    await taskGraph.addNode(nodeInput());
    await expect(
      taskGraph.recordFailure('task-alpha', { failure_kind: 'WORKER_CRASH', reason: 'x', recovery: 'RETRYABLE' }),
    ).rejects.toThrow(IllegalTaskTransitionError);
  });
});

describe('the ASK overlay (ASK is a success state)', () => {
  it('parks a node behind a pending ask (record status AWAITING_INPUT) and resolves it back to PAUSED', async () => {
    const { store, graph: taskGraph } = graph();
    await taskGraph.addNode(nodeInput());
    await taskGraph.assign('task-alpha', { lane: 1, worker_ref: 'worker-01', lease_ref: 'lease:task-alpha:0001', note: null });
    const parked = await taskGraph.recordAsk('task-alpha', 'ask-entry-1', 'authority gap: no grant covers deploy-class action');
    expect(parked.state).toBe('PAUSED');
    expect(parked.pending_asks).toEqual(['ask-entry-1']);
    const record = await store.tasks.get('task-alpha');
    expect(record!.status).toBe('AWAITING_INPUT');
    expect(parked.unresolved_uncertainty.some((statement) => statement.includes('ask-entry-1'))).toBe(true);
    const resolved = await taskGraph.resolveAsk('task-alpha', 'ask-entry-1');
    expect(resolved.pending_asks).toEqual([]);
    const after = await store.tasks.get('task-alpha');
    expect(after!.status).toBe('PAUSED');
    // Idempotent parking of the same entry.
    await taskGraph.recordAsk('task-alpha', 'ask-entry-1', 'again');
    const again = await taskGraph.recordAsk('task-alpha', 'ask-entry-1', 'again');
    expect(again.pending_asks).toEqual(['ask-entry-1']);
  });
});

describe('verification gating', () => {
  it('pins the verification reference only on COMPLETED nodes', async () => {
    const { graph: taskGraph } = graph();
    await taskGraph.addNode(nodeInput());
    await expect(taskGraph.recordVerificationRef('task-alpha', 'ver:abc123')).rejects.toThrow(/verification-gated/);
  });
});

describe('snapshot serialization', () => {
  it('serializes and validates the node snapshot', () => {
    const node: TaskNode = taskNodeFromInput(nodeInput({ task_id: 'task-snap' }));
    const snapshot = snapshotOf(node);
    expect(snapshot.task_id).toBe('task-snap');
    expect(snapshot.mission_ref).toBe(MISSION_REF);
    expect(snapshot.recovery.status).toBe('NONE');
    expect(snapshot.steps).toEqual(node.steps);
  });
});
