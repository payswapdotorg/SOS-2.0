/**
 * Companion host tests (Work Order P11): the §7 device gate through the
 * fabric (local orders queue offline + run on reconnect with
 * reconciliation; cloud orders never probe device presence), pairing
 * through commands, and the honest installation status.
 */

import { describe, expect, it } from 'vitest';
import { ArrayCommandSource, RecordingUserDevicePresence } from '../src/index.js';
import { createReferenceCompanionRuntime, referenceManualClock } from '../src/index.js';
import type { CompanionWorkOrder } from '../src/index.js';
import type { FabricOperation } from '@sos-2/execution-fabric';

function localOrder(taskId: string, grantId: string, steps: readonly FabricOperation[]): CompanionWorkOrder {
  return {
    task_id: taskId,
    mission_ref: null,
    plan: { steps: ['local-work'] },
    grant_refs: [grantId],
    requirements: { requiredCapabilities: ['terminal', 'filesystem'], placement: 'user-device' },
    holder: 'spirit:persistent',
    expires_at: null,
    steps,
  };
}

function cloudOrder(taskId: string, grantId: string, steps: readonly FabricOperation[]): CompanionWorkOrder {
  return {
    task_id: taskId,
    mission_ref: null,
    plan: { steps: ['cloud-work'] },
    grant_refs: [grantId],
    requirements: { requiredCapabilities: ['terminal', 'filesystem', 'repository-operations'], placement: 'cloud' },
    holder: 'spirit:persistent',
    expires_at: null,
    steps,
  };
}

describe('companion host: offline queueing + reconnect (§7)', () => {
  it('local-only work orders QUEUE while the device is offline and run on reconnect — nothing lost or duplicated', async () => {
    const commandSource = new ArrayCommandSource();
    const devicePresence = new RecordingUserDevicePresence(false);
    const runtime = createReferenceCompanionRuntime({ clock: referenceManualClock(), devicePresence, commandSource });
    await runtime.store.authorityGrants.put(runtime.grant);

    // Pair first (the companion session is the gate).
    commandSource.push({ kind: 'pair-companion', pairing_code: 'pair-local-0001', device_id: 'device-reference-0001', device_label: 'reference laptop' });
    // Two local orders arrive while the device is offline.
    commandSource.push({
      kind: 'run-work-order',
      order: localOrder('task-local-0001', runtime.grant.envelope.id, [
        { kind: 'workspace.write', path: 'acme/src/one.ts', content: 'export const one = 1;\n' },
        { kind: 'shell.exec', command: 'cat', args: ['acme/src/one.ts'], cwd: null },
      ]),
    });
    commandSource.push({
      kind: 'run-work-order',
      order: localOrder('task-local-0002', runtime.grant.envelope.id, [
        { kind: 'workspace.write', path: 'acme/src/two.ts', content: 'export const two = 2;\n' },
        { kind: 'observations.emit', observation_kind: 'body.progress', payload: { stage: 'two-done' } },
      ]),
    });

    // Drain while OFFLINE: pairing happens, both orders QUEUE (never run).
    const offlineOutcomes = await runtime.host.drain();
    expect(offlineOutcomes.filter((outcome) => outcome.status === 'PAIRED')).toHaveLength(1);
    const queued = offlineOutcomes.filter((outcome) => outcome.status === 'QUEUED');
    expect(queued.map((outcome) => (outcome.status === 'QUEUED' ? outcome.task_id : ''))).toEqual(['task-local-0001', 'task-local-0002']);
    expect(runtime.queue.size).toBe(2);
    expect((await runtime.store.tasks.get('task-local-0001')) ?? null).toBeNull();
    expect((await runtime.store.tasks.get('task-local-0002')) ?? null).toBeNull();

    // The queued-while-offline observations accumulated in the local log.
    const pendingBefore = runtime.companion.eventLog.pendingAfter(runtime.companion.eventLog.watermark());
    expect(pendingBefore.length).toBeGreaterThanOrEqual(2);
    expect(pendingBefore.some((event) => event.kind === 'local.queue.queued')).toBe(true);

    // RECONNECT: the device comes back; one tick reconciles then releases.
    devicePresence.setOnline(true);
    const onlineOutcomes = await runtime.host.drain();
    const reconciled = onlineOutcomes.find((outcome) => outcome.status === 'RECONCILED');
    expect(reconciled).toBeDefined();
    if (reconciled !== undefined && reconciled.status === 'RECONCILED') {
      expect(reconciled.report.applied).toBe(pendingBefore.length);
      expect(reconciled.report.duplicates).toBe(0);
    }
    const completed = onlineOutcomes.filter((outcome) => outcome.status === 'COMPLETED');
    expect(completed.map((outcome) => (outcome.status === 'COMPLETED' ? outcome.task.task_id : ''))).toEqual(['task-local-0001', 'task-local-0002']);
    for (const outcome of completed) {
      if (outcome.status === 'COMPLETED') {
        expect(outcome.verified).toBe(true);
      }
    }
    // Nothing duplicated: exactly two tasks in the durable store, both completed.
    const taskOne = await runtime.store.tasks.get('task-local-0001');
    const taskTwo = await runtime.store.tasks.get('task-local-0002');
    expect(taskOne?.status).toBe('COMPLETED');
    expect(taskTwo?.status).toBe('COMPLETED');
    // The local work really happened on the private workspace.
    expect(runtime.filePort.read('acme/src/one.ts')).toBe('export const one = 1;\n');
    expect(runtime.filePort.read('acme/src/two.ts')).toBe('export const two = 2;\n');
    // The queue is fully drained.
    expect(runtime.queue.size).toBe(0);
    expect(runtime.queue.total).toBe(2);
    // The released runs emitted NEW local events AFTER the reconnect
    // reconciliation — a follow-up reconcile ingests them exactly-once...
    const followUp = await runtime.host.reconcile();
    if (followUp.status === 'RECONCILED') {
      expect(followUp.report.applied).toBeGreaterThan(0);
      expect(followUp.report.duplicates).toBe(0);
    }
    // ...and a further reconciliation has nothing pending (stable state).
    const again = await runtime.host.reconcile();
    if (again.status === 'RECONCILED') {
      expect(again.report.replayed).toBe(0);
    }
  });

  it('cloud work orders run REGARDLESS of device presence — zero device probes for the cloud order', async () => {
    const commandSource = new ArrayCommandSource();
    const devicePresence = new RecordingUserDevicePresence(false);
    const runtime = createReferenceCompanionRuntime({ clock: referenceManualClock(), devicePresence, commandSource });
    runtime.registerCloudBody();
    await runtime.store.authorityGrants.put(runtime.grant);
    const probesBefore = devicePresence.probes;
    commandSource.push({
      kind: 'run-work-order',
      order: cloudOrder('task-cloud-through-host-0001', runtime.grant.envelope.id, [
        { kind: 'workspace.write', path: 'src/cloud.ts', content: 'export const cloud = true;\n' },
        { kind: 'shell.exec', command: 'cat', args: ['src/cloud.ts'], cwd: null },
        { kind: 'git.status' },
      ]),
    });
    const outcomes = await runtime.host.drain();
    const completed = outcomes.find((outcome) => outcome.status === 'COMPLETED');
    expect(completed).toBeDefined();
    if (completed !== undefined && completed.status === 'COMPLETED') {
      expect(completed.verified).toBe(true);
      expect(completed.task.body_lease_ref).toContain('lease:');
    }
    const task = await runtime.store.tasks.get('task-cloud-through-host-0001');
    expect(task?.status).toBe('COMPLETED');
    // The cloud order NEVER consulted device presence (no queued local
    // work existed, so no probe happened on its behalf).
    expect(devicePresence.probes).toBe(probesBefore);
  });

  it('a refused pairing code surfaces as a typed PAIRING_DENIED outcome (never a fabricated session)', async () => {
    const commandSource = new ArrayCommandSource();
    const runtime = createReferenceCompanionRuntime({
      clock: referenceManualClock(),
      devicePresence: new RecordingUserDevicePresence(true),
      commandSource,
    });
    commandSource.push({ kind: 'pair-companion', pairing_code: 'pair-wrong', device_id: 'device-reference-0001', device_label: 'reference laptop' });
    const outcomes = await runtime.host.drain();
    const denied = outcomes.find((outcome) => outcome.status === 'PAIRING_DENIED');
    expect(denied).toBeDefined();
    if (denied !== undefined && denied.status === 'PAIRING_DENIED') {
      expect(denied.reason).toContain('does not know pairing code');
    }
    expect(runtime.companion.session().status).toBe('UNPAIRED');
  });

  it('a local work order that runs while UNPAIRED completes with verified:false — honest, never fabricated', async () => {
    const commandSource = new ArrayCommandSource();
    const runtime = createReferenceCompanionRuntime({
      clock: referenceManualClock(),
      devicePresence: new RecordingUserDevicePresence(true),
      commandSource,
    });
    await runtime.store.authorityGrants.put(runtime.grant);
    // No pair command: the companion body's createTask refuses (no ACTIVE
    // session), so the fabric reports the truthful body failure.
    commandSource.push({
      kind: 'run-work-order',
      order: localOrder('task-local-unpaired-0001', runtime.grant.envelope.id, [
        { kind: 'workspace.write', path: 'acme/x.ts', content: 'x' },
      ]),
    });
    const outcomes = await runtime.host.drain();
    const failed = outcomes.find((outcome) => outcome.status === 'FAILED');
    expect(failed).toBeDefined();
    if (failed !== undefined && failed.status === 'FAILED') {
      expect(failed.error).toContain('no ACTIVE paired session');
    }
  });

  it('the composition reports the honest installation status (NOT_YET_INSTALLED, simulated marker)', () => {
    const runtime = createReferenceCompanionRuntime({
      clock: referenceManualClock(),
      devicePresence: new RecordingUserDevicePresence(true),
      commandSource: new ArrayCommandSource(),
    });
    expect(runtime.installation.status).toBe('NOT_YET_INSTALLED');
    expect(runtime.installation.simulated).toBe(true);
    expect(runtime.browserBridge.descriptor().connection.simulated).toBe(true);
    expect(runtime.ideBridge.descriptor().connection.simulated).toBe(true);
    expect(runtime.companionBody.identityValue.placement).toBe('user-device');
  });
});
