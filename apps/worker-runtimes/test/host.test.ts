/**
 * Deterministic worker-runtime-host tests (Work Order P8): the local
 * reference of the external worker topology — lease through the broker,
 * bounded task execution through the fabric, observations/artifacts
 * through the typed boundaries, honest completion, the §7 user-device
 * gate (cloud work continues while the user's computer is offline;
 * local work queues), and body replacement preserving task identity.
 */

import { describe, expect, it } from 'vitest';
import { WorkerRuntimeHost } from '../src/host.js';
import { ArrayCommandSource, RecordingDevicePresence } from '../src/commands.js';
import { createReferenceWorkerRuntime, referenceManualClock } from '../src/composition.js';
import type { BoundedWorkOrder } from '../src/commands.js';
import type { WorkerCommand } from '../src/commands.js';
import type { FabricOperation } from '@sos-2/execution-fabric';

function world(deviceOnline: boolean) {
  const clock = referenceManualClock();
  const commandSource = new ArrayCommandSource();
  const device = new RecordingDevicePresence(deviceOnline);
  const runtime = createReferenceWorkerRuntime({ clock, devicePresence: device, commandSource });
  runtime.registerCloudBody();
  return { clock, commandSource, device, runtime, host: runtime.host, store: runtime.store, broker: runtime.broker };
}

function cloudOrder(overrides: Partial<BoundedWorkOrder> = {}): BoundedWorkOrder {
  return {
    task_id: 'task-host-0001',
    mission_ref: null,
    plan: { steps: ['write', 'verify', 'report'] },
    grant_refs: [], // filled by the caller with the world's grant
    requirements: { requiredCapabilities: ['terminal', 'filesystem', 'repository-operations'], placement: 'cloud' },
    holder: 'spirit:persistent',
    expires_at: null,
    steps: [
      { kind: 'workspace.write', path: 'src/a.ts', content: 'export const a = 1;\n' },
      { kind: 'shell.exec', command: 'cat', args: ['src/a.ts'], cwd: null },
      { kind: 'git.status' },
      { kind: 'artifacts.capture', name: 'a-source', content: 'export const a = 1;\n' },
      { kind: 'observations.emit', observation_kind: 'body.progress', payload: { stage: 'done' } },
    ],
    ...overrides,
  };
}

async function drainOne(host: WorkerRuntimeHost, command: WorkerCommand) {
  const source = new ArrayCommandSource();
  source.push(command);
  // drive through the host's own tick path via a temp host? Simpler: use runCommand.
  return host.runCommand(command);
}

describe('worker runtime host: the bounded task lifecycle through the reference topology', () => {
  it('leases a body, executes the bounded task, emits observations/artifacts, and releases the body', async () => {
    const { runtime, host, store } = world(true);
    await store.authorityGrants.put(runtime.grant);
    const outcome = await drainOne(host, {
      kind: 'run-bounded-task',
      order: cloudOrder({ grant_refs: [runtime.grant.envelope.id] }),
    });
    expect(outcome.status).toBe('COMPLETED');
    if (outcome.status !== 'COMPLETED') {
      return;
    }
    expect(outcome.verified).toBe(true);
    expect(outcome.steps.map((step) => step.status)).toEqual(['EXECUTED', 'EXECUTED', 'EXECUTED', 'EXECUTED', 'EXECUTED']);
    expect(outcome.task.status).toBe('COMPLETED');
    expect(outcome.task.final_verification?.verified).toBe(true);
    // Observations and artifacts landed through the typed boundaries.
    expect(outcome.task.observations.length).toBeGreaterThanOrEqual(6);
    expect(outcome.task.artifacts.length).toBe(1);
    expect(outcome.task.artifacts[0]?.artifact_id).toContain('task-host-0001:artifacts:');
    expect(outcome.evidence_refs.length).toBeGreaterThanOrEqual(6);
    // The lease was released by completion (terminal, never reactivated).
    const lease = await store.bodyLeases.get(outcome.task.body_lease_ref!);
    expect(lease?.state).toBe('RELEASED');
    expect(lease?.release_reason).toContain('task completed');
  });

  it('runs on the injected tick/command source (drain until idle)', async () => {
    const { runtime, host, commandSource, store } = world(true);
    await store.authorityGrants.put(runtime.grant);
    commandSource.push({
      kind: 'run-bounded-task',
      order: cloudOrder({ task_id: 'task-tick-0001', grant_refs: [runtime.grant.envelope.id], steps: [{ kind: 'git.status' }] }),
    });
    const outcomes = await host.drain();
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]?.status).toBe('COMPLETED');
    const tick = await host.tick();
    expect(tick.idle).toBe(true);
    expect(tick.processed).toHaveLength(0);
  });
});

describe('worker runtime host: §7 user-device model', () => {
  it('a CLOUD task completes while the user\'s computer is OFFLINE (device independence)', async () => {
    const { runtime, host, store, device } = world(false);
    await store.authorityGrants.put(runtime.grant);
    const outcome = await drainOne(host, {
      kind: 'run-bounded-task',
      order: cloudOrder({ task_id: 'task-offline-cloud-0001', grant_refs: [runtime.grant.envelope.id] }),
    });
    // The device stayed offline for the WHOLE run.
    expect(device.probes).toBe(0); // cloud scheduling never consults device presence
    expect(outcome.status).toBe('COMPLETED');
    if (outcome.status === 'COMPLETED') {
      expect(outcome.verified).toBe(true);
      expect(outcome.task.status).toBe('COMPLETED');
    }
  });

  it('a USER-DEVICE task queues while the device is offline and runs when it returns', async () => {
    const { runtime, host, store, device } = world(false);
    runtime.registerCloudBody({ bodyId: 'reference-local-shell', placement: 'user-device' });
    await store.authorityGrants.put(runtime.grant);
    const order = cloudOrder({
      task_id: 'task-local-0001',
      grant_refs: [runtime.grant.envelope.id],
      requirements: { requiredCapabilities: ['terminal', 'filesystem', 'repository-operations'], placement: 'user-device' },
      steps: [{ kind: 'workspace.write', path: 'local.txt', content: 'local work\n' }],
    });
    const queued = await drainOne(host, { kind: 'run-bounded-task', order });
    expect(queued.status).toBe('QUEUED');
    if (queued.status === 'QUEUED') {
      expect(queued.task_id).toBe('task-local-0001');
      expect(queued.reason).toContain('offline');
    }
    // No task record exists yet — the local work queues safely (§7).
    expect(await store.tasks.get('task-local-0001')).toBeUndefined();
    // The device comes back: the next tick drains the parked order.
    device.setOnline(true);
    const tick = await host.tick();
    expect(tick.processed).toHaveLength(1);
    expect(tick.processed[0]?.status).toBe('COMPLETED');
  });
});

describe('worker runtime host: honest completion discipline (§10)', () => {
  it('completes with verified:false when a step runs and fails (truthful, never fabricated)', async () => {
    const { runtime, host, store } = world(true);
    await store.authorityGrants.put(runtime.grant);
    const failingSteps: readonly FabricOperation[] = [
      { kind: 'workspace.write', path: 'ok.txt', content: 'fine' },
      { kind: 'workspace.read', path: 'missing-file.txt' },
      { kind: 'git.status' },
    ];
    const outcome = await drainOne(host, {
      kind: 'run-bounded-task',
      order: cloudOrder({ task_id: 'task-fail-0001', grant_refs: [runtime.grant.envelope.id], steps: failingSteps }),
    });
    expect(outcome.status).toBe('COMPLETED');
    if (outcome.status !== 'COMPLETED') {
      return;
    }
    expect(outcome.verified).toBe(false);
    expect(outcome.steps[1]).toMatchObject({ status: 'EXECUTED', availability: 'FAILURE' });
    expect(outcome.steps[2]?.status).toBe('SKIPPED');
    expect(outcome.summary).toContain('verified:false');
    expect(outcome.task.final_verification?.verified).toBe(false);
  });

  it('completes with verified:false when a step is unsupported by the body advertisement', async () => {
    const { runtime, host, store } = world(true);
    await store.authorityGrants.put(runtime.grant);
    const outcome = await drainOne(host, {
      kind: 'run-bounded-task',
      order: cloudOrder({
        task_id: 'task-unsup-0001',
        grant_refs: [runtime.grant.envelope.id],
        steps: [{ kind: 'browser.open', url: 'https://example.com' }],
      }),
    });
    expect(outcome.status).toBe('COMPLETED');
    if (outcome.status !== 'COMPLETED') {
      return;
    }
    expect(outcome.verified).toBe(false);
    expect(outcome.steps[0]?.status).toBe('UNSUPPORTED');
    expect(outcome.summary).toContain('advertisement');
  });
});

describe('worker runtime host: body replacement preserves task identity', () => {
  it('swaps the body mid-task through the host command and keeps the durable task state', async () => {
    const { runtime, host, store, broker } = world(true);
    await store.authorityGrants.put(runtime.grant);
    // A second, equivalent cloud body registers BEFORE replacement (the
    // honest provider-maintenance flow: the old provider suspends; the
    // replacement takes over the SAME task).
    runtime.registerCloudBody({ bodyId: 'reference-cloud-shell-2' });

    // Start the task with a two-phase program we drive manually.
    const created = await runtime.fabric.createBoundedTask({
      task_id: 'task-replace-0001',
      mission_ref: null,
      plan: { steps: ['phase-1', 'phase-2'] },
      grant_refs: [runtime.grant.envelope.id],
      requirements: { requiredCapabilities: ['terminal', 'filesystem', 'repository-operations'], placement: 'cloud' },
      holder: 'spirit:persistent',
      expires_at: null,
    });
    expect(created.status).toBe('CREATED');
    if (created.status !== 'CREATED') {
      return;
    }
    const firstLeaseId = created.lease.lease_id;
    expect(created.body_id).toBe('reference-cloud-shell');

    await runtime.fabric.execute('task-replace-0001', { kind: 'workspace.write', path: 'src/wip.ts', content: 'work in progress\n' });
    await runtime.fabric.recordCheckpoint('task-replace-0001', { label: 'phase-1 done', work_graph_state: { phase: 1 }, notes: null });

    // The old provider goes away (suspended — its leases are revoked).
    await broker.suspendBody('reference-cloud-shell', 'provider maintenance window');

    // Replace the body through the HOST COMMAND (the worker topology path).
    const replacement = await drainOne(host, { kind: 'replace-body', task_id: 'task-replace-0001', reason: 'provider maintenance window' });
    expect(replacement.status).toBe('REPLACED');
    if (replacement.status !== 'REPLACED') {
      return;
    }
    expect(replacement.ended_lease_id).toBe(firstLeaseId);
    expect(replacement.new_body_id).toBe('reference-cloud-shell-2');
    expect(replacement.new_lease_id).not.toBe(firstLeaseId);

    // Task identity preserved: the SAME task record carries its
    // checkpoints/observations and now points at the new lease.
    const task = await store.tasks.get('task-replace-0001');
    expect(task?.task_id).toBe('task-replace-0001');
    expect(task?.status).toBe('PAUSED');
    expect(task?.checkpoints.map((checkpoint) => checkpoint.label)).toEqual(['phase-1 done']);
    expect(task?.body_lease_ref).toBe(replacement.new_lease_id);

    // The ended lease is terminal; the new lease is live.
    const ended = await store.bodyLeases.get(firstLeaseId);
    expect(ended?.state).toBe('REVOKED');
    expect(await broker.isLeaseLive(replacement.new_lease_id)).toBe(true);

    // Resume through the new body and complete the second phase.
    const resumed = await runtime.fabric.resumeTask('task-replace-0001');
    expect(resumed.status).toBe('TRANSITIONED');
    const executed = await runtime.fabric.execute('task-replace-0001', { kind: 'shell.exec', command: 'ls', args: [], cwd: null });
    expect(executed.status).toBe('EXECUTED');
    const completion = await runtime.fabric.completeTask('task-replace-0001', {
      verified: true,
      recorded_at: '2026-01-15T10:00:00Z',
      evidence_refs: [`task-replace-0001`],
      summary: 'resumed on the replacement body and completed',
    });
    expect(completion.status).toBe('TRANSITIONED');
    const finalTask = await store.tasks.get('task-replace-0001');
    expect(finalTask?.status).toBe('COMPLETED');
  });
});

describe('worker runtime host: lifecycle commands ride the fabric transitions', () => {
  it('pauses, resumes and cancels through the host command surface', async () => {
    const { runtime, host, store } = world(true);
    await store.authorityGrants.put(runtime.grant);
    const created = await runtime.fabric.createBoundedTask({
      task_id: 'task-lifecycle-0001',
      mission_ref: null,
      plan: {},
      grant_refs: [runtime.grant.envelope.id],
      requirements: { requiredCapabilities: ['terminal', 'filesystem', 'repository-operations'], placement: 'cloud' },
      holder: 'spirit:persistent',
      expires_at: null,
    });
    expect(created.status).toBe('CREATED');

    const paused = await drainOne(host, { kind: 'pause-task', task_id: 'task-lifecycle-0001' });
    expect(paused.status).toBe('TRANSITIONED');
    const resumed = await drainOne(host, { kind: 'resume-task', task_id: 'task-lifecycle-0001' });
    expect(resumed.status).toBe('TRANSITIONED');
    const cancelled = await drainOne(host, { kind: 'cancel-task', task_id: 'task-lifecycle-0001' });
    expect(cancelled.status).toBe('TRANSITIONED');
    const task = await store.tasks.get('task-lifecycle-0001');
    expect(task?.status).toBe('CANCELLED');
    const lease = await store.bodyLeases.get(task?.body_lease_ref ?? '');
    expect(lease?.state).toBe('RELEASED');
  });
});
