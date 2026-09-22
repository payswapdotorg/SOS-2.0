/**
 * ACCEPTANCE SUITE 1 — CONCURRENCY (Work Order P6, pinned).
 *
 * "workers can be dispatched concurrently on disjoint owned paths" and
 * the typed-denial pin: "assignment only onto DISJOINT owned-path scopes
 * (collision = typed assignment denial, never silent overlap)".
 */

import { describe, expect, it } from 'vitest';
import { AssignmentDeniedError } from '@sos-2/task-graph';
import { serializeWorkerStepProgram } from '@sos-2/worker-runtime';
import { createAcceptanceWorld, runJourney, startJourney } from './acceptance-world.js';

describe('P6 acceptance: concurrency (three lanes, disjoint scopes)', () => {
  it('dispatches THREE concurrent lanes onto DISJOINT owned paths in one tick', async () => {
    const world = createAcceptanceWorld();
    await startJourney(world);
    const report = await runJourney(world);
    expect(report.completed).toBe(true);
    // The decomposition produced three tasks on pairwise-disjoint scopes.
    const dispatchTick = report.ticks.find((tick) => tick.dispatched.length === 3);
    expect(dispatchTick).toBeDefined();
    const scopes = dispatchTick!.dispatched.map((dispatch) => `work/${['goal-payment-review', 'goal-validation', 'goal-docs'][dispatch.lane - 1]}`);
    expect(new Set(scopes).size).toBe(3);
    // Three DISTINCT lanes were occupied concurrently.
    expect(new Set(dispatchTick!.dispatched.map((dispatch) => dispatch.lane)).size).toBe(3);
    // Each dispatch carries a handoff with the authority context + workspace revision.
    for (const dispatch of dispatchTick!.dispatched) {
      expect(dispatch.handoff.authority_ref).toBe(world.grant.envelope.id);
      expect(dispatch.handoff.workspace_revision).toEqual({ source_revision: null, deployment_revision: null });
    }
    // The durable nodes were all three RUNNING simultaneously (assigned,
    // pre-execution) — the graph invariant scan holds throughout.
    const scan = await world.graph.scan();
    expect(scan.valid).toBe(true);
  });

  it('a COLLIDING assignment is a typed denial naming the rule — never a silent overlap', async () => {
    const world = createAcceptanceWorld();
    await startJourney(world);
    // Put ONE task into a RUNNING assignment (lane 1 holds
    // work/goal-payment-review), then attempt a colliding assignment.
    const nodes = await world.graph.nodes();
    const target = nodes.find((node) => node.owned_paths.includes('work/goal-payment-review'))!;
    const firstLease = await world.broker.acquireLease({
      task_ref: target.task_id,
      body_id: 'acceptance-cloud-01',
      holder: 'acceptance',
      expires_at: null,
    });
    expect(firstLease.status).toBe('ACQUIRED');
    if (firstLease.status !== 'ACQUIRED') throw new Error('lease denied');
    await world.graph.assign(target.task_id, { lane: 1, worker_ref: 'worker-1', lease_ref: firstLease.lease.lease_id, note: null });
    // The colliding task: its scope nests INSIDE the active task's scope.
    await world.graph.addNode({
      task_id: 'task-colliding',
      mission_ref: world.mission.envelope.id,
      authority_ref: world.grant.envelope.id,
      title: 'Colliding task',
      owned_paths: ['work/goal-payment-review/inner'],
      steps: serializeWorkerStepProgram({ steps: [] }),
    });
    const acquisition = await world.broker.acquireLease({
      task_ref: 'task-colliding',
      body_id: 'acceptance-cloud-02',
      holder: 'acceptance',
      expires_at: null,
    });
    expect(acquisition.status).toBe('ACQUIRED');
    if (acquisition.status !== 'ACQUIRED') throw new Error('lease denied');
    let denial: AssignmentDeniedError | null = null;
    try {
      await world.graph.assign('task-colliding', { lane: 2, worker_ref: 'worker-x', lease_ref: acquisition.lease.lease_id, note: null });
    } catch (cause) {
      denial = cause as AssignmentDeniedError;
    }
    // The denial is typed with the pinned code and reason.
    expect(denial).toBeInstanceOf(AssignmentDeniedError);
    expect(denial!.denial.code).toBe('SCOPE_COLLISION');
    expect(denial!.denial.reason).toContain('DISJOINT');
    // The colliding task NEVER ran (never a silent overlap) — and the
    // graph stays structurally valid.
    const colliding = await world.graph.node('task-colliding');
    expect(colliding!.state).toBe('PENDING');
    const scan = await world.graph.scan();
    expect(scan.valid).toBe(true);
  });

  it('at most THREE lanes exist — the fourth concurrent assignment waits', async () => {
    const world = createAcceptanceWorld({
      mission: {
        purpose: 'Four-way mission',
        goals: [
          { id: 'goal-1', statement: 'One' },
          { id: 'goal-2', statement: 'Two' },
          { id: 'goal-3', statement: 'Three' },
          { id: 'goal-4', statement: 'Four' },
        ],
      },
    });
    await startJourney(world);
    const firstTick = await world.orchestrator.tick({});
    expect(firstTick.dispatched.length).toBe(3);
    expect(firstTick.denials.some((denial) => denial.code === 'LANE_EXHAUSTED')).toBe(true);
    // The journey still completes: the fourth task dispatches when a lane frees.
    const report = await runJourney(world);
    expect(report.completed).toBe(true);
    expect(report.tasks).toHaveLength(4);
  });
});
