/**
 * ACCEPTANCE (Work Order P11): OFFLINE QUEUEING — local-only work orders
 * QUEUE while the device reports offline and run when it reconnects;
 * nothing is lost or duplicated. Cloud work orders through the same host
 * never consult device presence (the §7 independence discipline).
 */

import { describe, expect, it } from 'vitest';
import { acceptanceWorld, localWorkOrder, pairCommand, serializedWorldSurfaces, SECRET_SESSION_TOKEN_PREFIX, SECRET_OUT_OF_SCOPE_CONTENT } from './acceptance-world.js';
import type { FabricOperation } from '@sos-2/execution-fabric';

const LOCAL_STEPS: readonly FabricOperation[] = [
  { kind: 'workspace.write', path: 'acme/src/local-one.ts', content: 'export const localOne = 1;\n' },
  { kind: 'shell.exec', command: 'cat', args: ['acme/src/local-one.ts'], cwd: null },
  { kind: 'artifacts.capture', name: 'local-evidence', content: 'export const localOne = 1;\n' },
  { kind: 'observations.emit', observation_kind: 'body.progress', payload: { stage: 'local-complete' } },
];

describe('acceptance: local-only tasks queue while the device is offline', () => {
  it('queue while offline, run on reconnect — nothing lost, nothing duplicated, secrets never echo', async () => {
    const world = acceptanceWorld();
    await world.store.authorityGrants.put(world.grant);
    world.devicePresence.setOnline(false);

    // Pair + enqueue two local work orders while the device is offline.
    world.commandSource.push(pairCommand());
    world.commandSource.push({ kind: 'run-work-order', order: localWorkOrder('task-local-offline-0001', world.grant, LOCAL_STEPS) });
    world.commandSource.push({
      kind: 'run-work-order',
      order: localWorkOrder('task-local-offline-0002', world.grant, [
        { kind: 'workspace.write', path: 'acme/src/local-two.ts', content: 'export const localTwo = 2;\n' },
        { kind: 'observations.emit', observation_kind: 'body.progress', payload: { stage: 'two-complete' } },
      ]),
    });

    // Drain while OFFLINE: pairing happens; BOTH orders queue (never run).
    const offlineOutcomes = await world.host.drain();
    expect(offlineOutcomes.filter((outcome) => outcome.status === 'PAIRED')).toHaveLength(1);
    const queued = offlineOutcomes.filter((outcome) => outcome.status === 'QUEUED');
    expect(queued).toHaveLength(2);
    expect(world.queue.size).toBe(2);
    expect(await world.store.tasks.get('task-local-offline-0001')).toBeUndefined();
    expect(await world.store.tasks.get('task-local-offline-0002')).toBeUndefined();

    // NOTHING LOST while offline: the queue observations accumulated in
    // the durable local event log (the pending replay suffix).
    const pending = world.companion.eventLog.pendingAfter(world.companion.eventLog.watermark());
    expect(pending.filter((event) => event.kind === 'local.queue.queued')).toHaveLength(2);

    // RECONNECT: reconcile FIRST (exactly-once), then release + run both.
    world.devicePresence.setOnline(true);
    const onlineOutcomes = await world.host.drain();
    const reconciled = onlineOutcomes.find((outcome) => outcome.status === 'RECONCILED');
    expect(reconciled).toBeDefined();
    if (reconciled !== undefined && reconciled.status === 'RECONCILED') {
      expect(reconciled.report.applied).toBe(pending.length);
      expect(reconciled.report.duplicates).toBe(0);
    }
    const completed = onlineOutcomes.filter((outcome) => outcome.status === 'COMPLETED');
    expect(completed).toHaveLength(2);
    for (const outcome of completed) {
      if (outcome.status === 'COMPLETED') {
        expect(outcome.verified).toBe(true);
        expect(outcome.steps.filter((step) => step.status === 'EXECUTED' && step.availability === 'SUCCESS').length).toBe(outcome.steps.length);
      }
    }

    // Nothing duplicated: exactly two durable task records, both COMPLETED.
    const taskOne = await world.store.tasks.get('task-local-offline-0001');
    const taskTwo = await world.store.tasks.get('task-local-offline-0002');
    expect(taskOne?.status).toBe('COMPLETED');
    expect(taskTwo?.status).toBe('COMPLETED');
    expect(taskOne?.final_verification?.verified).toBe(true);
    expect(taskTwo?.final_verification?.verified).toBe(true);

    // The local work REALLY happened on the private workspace through the
    // granted scope (the §9 contract behind the P5 broker leased the
    // user-device companion body).
    expect(world.filePort.read('acme/src/local-one.ts')).toBe('export const localOne = 1;\n');
    expect(world.filePort.read('acme/src/local-two.ts')).toBe('export const localTwo = 2;\n');

    // The queue drained completely (total preserved — the audit trail).
    expect(world.queue.size).toBe(0);
    expect(world.queue.total).toBe(2);

    // SECRETS NEVER ECHO: the session token value never appears in any
    // serialized companion surface across the whole journey.
    expect(serializedWorldSurfaces(world)).not.toContain(SECRET_SESSION_TOKEN_PREFIX);
    // The out-of-scope private content never surfaced either.
    expect(JSON.stringify(world.companion.eventLog.events())).not.toContain(SECRET_OUT_OF_SCOPE_CONTENT);
  });

  it('a cloud work order through the SAME host runs with the device offline and ZERO device probes', async () => {
    const world = acceptanceWorld();
    // A cloud body for the cloud order (the P8 reference cloud body).
    const { CloudCodingShellBody } = await import('@sos-2/body-runtimes');
    const cloudBody = new CloudCodingShellBody({
      bodyId: 'acceptance-cloud-shell',
      sandboxPolicy: {
        filesystem: { mode: 'workspace', root: '/workspace/acceptance-cloud' },
        network: { egress: 'allowlist', allowedHosts: ['api.github.com'] },
        secrets: [],
        budgets: { fileWrites: 50, fileBytes: 100_000, shellCommands: 50, networkCalls: 50, secretReveals: 50 },
        resourceEnvelope: { maxDurationMs: 3_600_000, maxMemoryMb: 1024 },
      },
    });
    world.broker.registerBody({
      body_id: 'acceptance-cloud-shell',
      provider: { name: 'reference-cloud-shell', version: '1.0.0' },
      capabilities: cloudBody.capabilities(),
      placement: 'cloud',
      harness: cloudBody,
    });
    await world.store.authorityGrants.put(world.grant);
    world.devicePresence.setOnline(false);
    const probesBefore = world.devicePresence.probes;

    world.commandSource.push({
      kind: 'run-work-order',
      order: {
        task_id: 'task-cloud-offline-0001',
        mission_ref: null,
        plan: { steps: ['cloud-work'] },
        grant_refs: [world.grant.envelope.id],
        requirements: { requiredCapabilities: ['terminal', 'filesystem', 'repository-operations'], placement: 'cloud' },
        holder: 'spirit:persistent',
        expires_at: null,
        steps: [
          { kind: 'workspace.write', path: 'src/cloud.ts', content: 'export const cloud = true;\n' },
          { kind: 'shell.exec', command: 'cat', args: ['src/cloud.ts'], cwd: null },
          { kind: 'git.status' },
        ],
      },
    });
    const outcomes = await world.host.drain();
    const completed = outcomes.find((outcome) => outcome.status === 'COMPLETED');
    expect(completed).toBeDefined();
    if (completed !== undefined && completed.status === 'COMPLETED') {
      expect(completed.verified).toBe(true);
    }
    const task = await world.store.tasks.get('task-cloud-offline-0001');
    expect(task?.status).toBe('COMPLETED');
    // The cloud order NEVER probed device presence (no local work was
    // queued on its behalf — cloud scheduling is device-independent).
    expect(world.devicePresence.probes).toBe(probesBefore);
  });
});
