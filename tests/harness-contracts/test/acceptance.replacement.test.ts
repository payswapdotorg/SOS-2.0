/**
 * ACCEPTANCE: body replacement preserves task identity (Work Order P5).
 *
 * The kill-mid-task journey: a bounded task runs on body A (workspace
 * writes, checkpoints, artifacts, observations durable) -> the body is
 * KILLED (suspended: its leases end, it leaves selection) -> operations
 * fail closed -> a replacement body from ANOTHER vendor is selected by
 * capability -> the task RESUMES through the new body -> the SAME task
 * id with the SAME durable state continues to completion.
 *
 * The task IS its durable TaskRecord (§6); bodies and leases are
 * ephemeral around it (§1: "a task owns a body lease; the task, evidence
 * and state survive body replacement").
 */

import { describe, expect, it } from 'vitest';
import { formatRfc3339 } from '@sos-2/live-store';
import { acceptanceWorld } from './acceptance-world.js';
import { ReferenceBody } from './reference-body.js';

describe('acceptance: body replacement preserves task identity', () => {
  it('kill mid-task -> new body -> resume -> same task id, same durable state', async () => {
    const w = acceptanceWorld();
    const bodyA = w.registerBody({ bodyId: 'body:original', providerName: 'vendor-one' });
    const bodyB = w.registerBody({ bodyId: 'body:replacement', providerName: 'vendor-two' });

    // The bounded task starts on body A (earliest registration).
    const task = await w.createTask({ task_id: 'task-replacement-0001' });
    expect(task.body_lease_ref).toBe('lease:task-replacement-0001:0001');

    // Work happens: a workspace write, a shell exec, a checkpoint and an
    // artifact — all durable.
    await w.fabric.execute(task.task_id, {
      kind: 'workspace.write',
      path: 'src/main.ts',
      content: 'export function main(): void { /* bounded work */ }\n',
    });
    await w.fabric.execute(task.task_id, { kind: 'shell.exec', command: 'echo', args: ['working'], cwd: null });
    await w.fabric.recordCheckpoint(task.task_id, {
      label: 'before-the-kill',
      work_graph_state: { steps: ['prepare-workspace', 'implement'], done: ['prepare-workspace'] },
      notes: 'checkpoint taken before the simulated kill',
    });
    await w.fabric.execute(task.task_id, {
      kind: 'artifacts.capture',
      name: 'pre-kill-snapshot',
      content: 'the state of the work right before the body died',
    });

    const beforeKill = await w.store.tasks.get(task.task_id);
    const checkpointCount = beforeKill!.checkpoints.length;
    const artifactCount = beforeKill!.artifacts.length;
    const observationCount = beforeKill!.observations.length;
    expect(checkpointCount).toBe(1);
    expect(artifactCount).toBe(1);

    // KILL THE BODY mid-task: suspension ends its lease (terminal) and
    // removes it from selection.
    const kill = await w.broker.suspendBody('body:original', 'simulated provider outage mid-task');
    expect(kill.endedLeases.map((lease) => lease.lease_id)).toContain(task.body_lease_ref);

    // Operations FAIL CLOSED through the dead lease (typed denial).
    const denied = await w.fabric.execute(task.task_id, {
      kind: 'shell.exec',
      command: 'echo',
      args: ['after-kill'],
      cwd: null,
    });
    expect(denied.status).toBe('DENIED');
    if (denied.status === 'DENIED') {
      expect(denied.denial.code).toBe('LEASE_DENIED');
    }
    expect(bodyA.dispatches.get('shell.exec')).toBe(1); // only the pre-kill dispatch

    // REPLACE THE BODY: the broker ends the (already dead) lease, selects
    // a replacement BY CAPABILITY (vendor-two's body — a different
    // vendor), and acquires a NEW single-use lease for the SAME task.
    const replacement = await w.fabric.replaceBodyForTask(task.task_id, 'body killed mid-task');
    expect(replacement.status).toBe('REPLACED');
    if (replacement.status === 'REPLACED') {
      expect(replacement.ended_lease.lease_id).toBe('lease:task-replacement-0001:0001');
      expect(replacement.ended_lease.state).toBe('REVOKED');
      expect(replacement.new_lease.lease_id).toBe('lease:task-replacement-0001:0002');
      expect(replacement.new_lease.task_ref).toBe('task-replacement-0001');
      expect(replacement.body_id).toBe('body:replacement'); // the OTHER vendor's body

      // TASK IDENTITY PRESERVED: same task id, all durable state intact,
      // only the lease pointer moved (revision bumped).
      expect(replacement.task.task_id).toBe('task-replacement-0001');
      expect(replacement.task.checkpoints).toHaveLength(checkpointCount);
      expect(replacement.task.artifacts).toHaveLength(artifactCount);
      expect(replacement.task.observations.length).toBeGreaterThan(observationCount); // the denial + replacement traces appended
      expect(replacement.task.body_lease_ref).toBe(replacement.new_lease.lease_id);
      expect(replacement.task.mission_ref).toBe(task.mission_ref);
      expect(replacement.task.authority_context).toEqual(task.authority_context);
    }

    // RESUME through the NEW body: the contract's resumeTask reattaches,
    // and the task keeps running under its original identity.
    const resumed = await w.fabric.resumeTask(task.task_id);
    expect(resumed.status).toBe('TRANSITIONED');
    if (resumed.status === 'TRANSITIONED') {
      expect(resumed.task.task_id).toBe('task-replacement-0001');
      expect(resumed.task.status).toBe('RUNNING');
    }
    expect(bodyB.dispatches.get('resumeTask')).toBe(1);

    // Work CONTINUES through the replacement body.
    const write = await w.fabric.execute(task.task_id, {
      kind: 'workspace.write',
      path: 'src/main.test.ts',
      content: 'import { main } from "./main.js";\n',
    });
    expect(write.status).toBe('EXECUTED');
    const commit = await w.fabric.execute(task.task_id, {
      kind: 'git.commit',
      message: 'resume work on the replacement body',
      paths: [],
    });
    expect(commit.status).toBe('EXECUTED');
    expect(bodyB.dispatches.get('workspace.write')).toBe(1);
    expect(bodyB.dispatches.get('git.commit')).toBe(1);

    // The old body NEVER dispatches again.
    expect(bodyA.dispatches.get('workspace.write')).toBe(1);
    expect(bodyA.dispatches.get('git.commit')).toBeUndefined();

    // The task COMPLETES under its original identity with the full
    // durable trace: pre-kill state + denial + replacement + resumed work.
    const final = await w.fabric.completeTask(task.task_id, {
      verified: true,
      recorded_at: formatRfc3339(w.clock.nowEpochMs()),
      evidence_refs: (await w.store.tasks.get(task.task_id))!.observations,
      summary: 'survived body replacement with identity and state intact',
    });
    expect(final.status).toBe('TRANSITIONED');
    if (final.status === 'TRANSITIONED') {
      expect(final.task.task_id).toBe('task-replacement-0001');
      expect(final.task.status).toBe('COMPLETED');
      expect(final.task.checkpoints).toHaveLength(checkpointCount);
      expect(final.task.artifacts).toHaveLength(artifactCount);
      expect(final.task.body_lease_ref).toBe('lease:task-replacement-0001:0002');
    }

    // The durable lease history of the task shows the whole journey.
    const leases = await w.broker.leasesForTask('task-replacement-0001');
    expect(leases.map((lease) => lease.lease_id)).toEqual(['lease:task-replacement-0001:0001', 'lease:task-replacement-0001:0002']);
    expect(leases[0]!.state).toBe('REVOKED');
    expect(leases[1]!.state).toBe('RELEASED'); // released on completion
  });

  it('the replacement body is selected BY CAPABILITY — a weaker body never silently takes over', async () => {
    const w = acceptanceWorld();
    w.registerBody({ bodyId: 'body:full', providerName: 'vendor-one' });
    // A vendor-two body registered under a NARROWED advertisement:
    // terminal-only (no filesystem, no repository operations). The
    // broker registration is the selection truth — capabilities, not
    // vendor identity.
    const limitedHarness = new ReferenceBody({ bodyId: 'body:limited', providerName: 'vendor-two' });
    w.broker.registerBody({
      body_id: 'body:limited',
      provider: { name: 'vendor-two', version: '1.0.0' },
      capabilities: {
        ...limitedHarness.capabilitiesValue,
        capabilities: ['terminal'],
        git: [],
        runtimeIntegrations: [],
      },
      placement: 'cloud',
      harness: limitedHarness,
    });

    // The task requires terminal+filesystem+repository-operations -> body:full.
    const task = await w.createTask({
      task_id: 'task-replacement-0002',
      requirements: { requiredCapabilities: ['terminal', 'filesystem', 'repository-operations'], placement: 'cloud' },
    });

    // Kill body:full. The weaker body does NOT match the task's
    // requirements — replacement is typed-denied (fail closed): the task
    // is never silently handed to a body that cannot do the work.
    await w.broker.suspendBody('body:full', 'killed mid-task');
    const denied = await w.fabric.replaceBodyForTask(task.task_id, 'body killed mid-task');
    expect(denied.status).toBe('DENIED');
    if (denied.status === 'DENIED') {
      expect(denied.denial.code).toBe('NO_BODY_AVAILABLE');
    }

    // A capable rescue body from a THIRD vendor registers: replacement
    // now succeeds onto it — capability-based, vendor-blind.
    w.registerBody({ bodyId: 'body:rescue', providerName: 'vendor-three' });
    const replacement = await w.fabric.replaceBodyForTask(task.task_id, 'body killed mid-task');
    expect(replacement.status).toBe('REPLACED');
    if (replacement.status === 'REPLACED') {
      expect(replacement.body_id).toBe('body:rescue');
      expect(replacement.task.task_id).toBe('task-replacement-0002');
    }
  });

  it('replacement is denied when NO available body matches (the task keeps its dead lease rather than a wrong body)', async () => {
    const w = acceptanceWorld();
    w.registerBody({ bodyId: 'body:sole', providerName: 'vendor-one' });
    const task = await w.createTask({ task_id: 'task-replacement-0003' });
    await w.broker.suspendBody('body:sole', 'the only body died');
    const replacement = await w.fabric.replaceBodyForTask(task.task_id, 'the only body died');
    expect(replacement.status).toBe('DENIED');
    if (replacement.status === 'DENIED') {
      expect(replacement.denial.code).toBe('NO_BODY_AVAILABLE');
    }
    // The durable task record is untouched by the failed replacement.
    const after = await w.store.tasks.get(task.task_id);
    expect(after?.task_id).toBe('task-replacement-0003');
    expect(after?.body_lease_ref).toBe(task.body_lease_ref);
  });
});
