/**
 * ACCEPTANCE (Work Order P8): BODY PROVIDER REPLACEMENT PRESERVES TASK
 * SEMANTICS — swapping the ADAPTER underneath an active lease keeps the
 * task identity/state (the P5 broker's replacement guarantee exercised
 * through a REAL adapter swap: a native-api-served body is replaced by
 * an mcp-protocol-served body mid-task; the same durable task record
 * continues and completes).
 */

import { describe, expect, it } from 'vitest';
import { acceptanceWorld } from './acceptance-world.js';
import type { FabricOperation } from '@sos-2/execution-fabric';

const PHASE_ONE: readonly FabricOperation[] = [
  { kind: 'workspace.write', path: 'src/wip.ts', content: 'phase one output\n' },
  { kind: 'shell.exec', command: 'cat', args: ['src/wip.ts'], cwd: null },
];

const PHASE_TWO: readonly FabricOperation[] = [
  { kind: 'workspace.write', path: 'src/done.ts', content: 'phase two output\n' },
  { kind: 'git.status' },
  { kind: 'artifacts.capture', name: 'final-report', content: 'the task completed on the replacement provider' },
  { kind: 'observations.emit', observation_kind: 'body.progress', payload: { stage: 'replaced-and-completed' } },
];

describe('acceptance: adapter replacement preserves task semantics', () => {
  it('swaps a native-api-served body for an mcp-protocol-served body underneath the SAME active lease-owning task', async () => {
    const world = acceptanceWorld();
    // Two adapter-served providers with EQUIVALENT capability
    // advertisements but different §4 shapes (and different vendors —
    // provider identity is never semantic).
    const native = world.registerAdapterServedCloudBody({ bodyId: 'provider-native-a', adapterKind: 'native-api', providerName: 'vendor-alpha' });
    const mcp = world.registerAdapterServedCloudBody({ bodyId: 'provider-mcp-b', adapterKind: 'mcp-protocol', providerName: 'vendor-beta' });
    expect(native.adapterTier).toBe('native-api');
    expect(mcp.adapterTier).toBe('mcp-protocol');

    // The task starts on the native-api-served body (registration order).
    const task = await world.createTask({
      task_id: 'task-adapter-swap-0001',
      requirements: { requiredCapabilities: ['terminal', 'filesystem', 'repository-operations'], placement: 'cloud' },
    });
    expect(task.body_lease_ref).toBe('lease:task-adapter-swap-0001:0001');
    const firstLease = await world.store.bodyLeases.get('lease:task-adapter-swap-0001:0001');
    expect(firstLease?.body_id).toBe('provider-native-a');

    // Phase one executes on the native provider.
    for (const step of PHASE_ONE) {
      const result = await world.fabric.execute('task-adapter-swap-0001', step);
      expect(result.status === 'EXECUTED' && result.availability).toBe('SUCCESS');
    }
    await world.fabric.recordCheckpoint('task-adapter-swap-0001', { label: 'phase-1 done', work_graph_state: { phase: 1 }, notes: 'on provider-native-a' });

    // The native provider goes away (maintenance); the replacement must
    // ride the broker's guarantee: end the lease, keep the task.
    await world.broker.suspendBody('provider-native-a', 'native provider maintenance window');
    const replacement = await world.fabric.replaceBodyForTask('task-adapter-swap-0001', 'swap the provider adapter mid-task');
    expect(replacement.status).toBe('REPLACED');
    if (replacement.status !== 'REPLACED') {
      return;
    }
    expect(replacement.ended_lease.lease_id).toBe('lease:task-adapter-swap-0001:0001');
    expect(replacement.new_lease.lease_id).toBe('lease:task-adapter-swap-0001:0002');
    expect(replacement.body_id).toBe('provider-mcp-b');

    // TASK IDENTITY PRESERVED: the SAME durable record (id, checkpoint,
    // observations) now points at the new lease.
    const paused = await world.store.tasks.get('task-adapter-swap-0001');
    expect(paused?.task_id).toBe('task-adapter-swap-0001');
    expect(paused?.status).toBe('PAUSED');
    expect(paused?.checkpoints.map((checkpoint) => checkpoint.label)).toEqual(['phase-1 done']);
    expect(paused?.body_lease_ref).toBe('lease:task-adapter-swap-0001:0002');
    const observationsBefore = paused?.observations.length ?? 0;

    // The ended lease is terminal; the new lease is live.
    expect((await world.store.bodyLeases.get('lease:task-adapter-swap-0001:0001'))?.state).toBe('REVOKED');
    expect(await world.broker.isLeaseLive('lease:task-adapter-swap-0001:0002')).toBe(true);

    // Phase two continues on the mcp-protocol-served replacement — the
    // same step semantics, the same typed boundaries.
    const resumed = await world.fabric.resumeTask('task-adapter-swap-0001');
    expect(resumed.status).toBe('TRANSITIONED');
    for (const step of PHASE_TWO) {
      const result = await world.fabric.execute('task-adapter-swap-0001', step);
      expect(result.status === 'EXECUTED' && result.availability).toBe('SUCCESS');
    }

    // Spirit-side completion with the honest verification record.
    const finalTask = await world.store.tasks.get('task-adapter-swap-0001');
    const completion = await world.fabric.completeTask('task-adapter-swap-0001', {
      verified: true,
      recorded_at: '2026-01-15T12:00:00Z',
      evidence_refs: finalTask?.observations ?? [],
      summary: 'the task survived a native-api -> mcp-protocol provider swap mid-flight',
    });
    expect(completion.status).toBe('TRANSITIONED');
    const completed = await world.store.tasks.get('task-adapter-swap-0001');
    expect(completed?.status).toBe('COMPLETED');
    expect(completed?.final_verification?.verified).toBe(true);
    // Task semantics unchanged: the checkpoint survived, observations
    // only grew, and the artifact from the replacement phase landed.
    expect(completed?.checkpoints.map((checkpoint) => checkpoint.label)).toEqual(['phase-1 done']);
    expect((completed?.observations.length ?? 0)).toBeGreaterThan(observationsBefore);
    expect(completed?.artifacts.length).toBe(1);
    expect((await world.store.bodyLeases.get('lease:task-adapter-swap-0001:0002'))?.state).toBe('RELEASED');
  });

  it('a local-bridge-served body can replace an mcp-protocol-served body (the swap is shape-agnostic)', async () => {
    const world = acceptanceWorld();
    world.registerAdapterServedCloudBody({ bodyId: 'provider-mcp-c', adapterKind: 'mcp-protocol' });
    world.registerAdapterServedCloudBody({ bodyId: 'provider-bridge-d', adapterKind: 'local-bridge' });

    await world.createTask({
      task_id: 'task-adapter-swap-0002',
      requirements: { requiredCapabilities: ['terminal', 'filesystem', 'repository-operations'], placement: 'cloud' },
    });
    expect((await world.store.bodyLeases.get('lease:task-adapter-swap-0002:0001'))?.body_id).toBe('provider-mcp-c');

    await world.broker.suspendBody('provider-mcp-c', 'mcp provider rolling restart');
    const replacement = await world.fabric.replaceBodyForTask('task-adapter-swap-0002', 'rolling restart');
    expect(replacement.status).toBe('REPLACED');
    if (replacement.status === 'REPLACED') {
      expect(replacement.body_id).toBe('provider-bridge-d');
    }
    // The task record keeps its identity and points at the new lease.
    const task = await world.store.tasks.get('task-adapter-swap-0002');
    expect(task?.task_id).toBe('task-adapter-swap-0002');
    expect(task?.body_lease_ref).toBe('lease:task-adapter-swap-0002:0002');
    // Phase work continues through the replacement.
    const resumed = await world.fabric.resumeTask('task-adapter-swap-0002');
    expect(resumed.status).toBe('TRANSITIONED');
    const executed = await world.fabric.execute('task-adapter-swap-0002', { kind: 'shell.exec', command: 'echo', args: ['on-bridge'], cwd: null });
    expect(executed.status === 'EXECUTED' && executed.availability).toBe('SUCCESS');
    if (executed.status === 'EXECUTED' && executed.output) {
      expect((executed.output as { stdout: string }).stdout).toBe('on-bridge');
    }
  });

  it('replacement fails closed when no equivalent body is available (the task keeps its lease)', async () => {
    const world = acceptanceWorld();
    world.registerAdapterServedCloudBody({ bodyId: 'provider-solo', adapterKind: 'native-api' });
    await world.createTask({
      task_id: 'task-adapter-swap-0003',
      requirements: { requiredCapabilities: ['terminal', 'filesystem', 'repository-operations'], placement: 'cloud' },
    });
    // The only body goes away BEFORE any replacement exists.
    await world.broker.suspendBody('provider-solo', 'the only provider went away');
    const replacement = await world.fabric.replaceBodyForTask('task-adapter-swap-0003', 'no replacement exists');
    expect(replacement.status).toBe('DENIED');
    if (replacement.status === 'DENIED') {
      expect(replacement.denial.code).toBe('NO_BODY_AVAILABLE');
    }
    // Fail closed: the task was never parked; its (revoked) lease stands
    // and the durable record is untouched.
    const task = await world.store.tasks.get('task-adapter-swap-0003');
    expect(task?.status).toBe('RUNNING');
    expect(task?.body_lease_ref).toBe('lease:task-adapter-swap-0003:0001');
  });
});
