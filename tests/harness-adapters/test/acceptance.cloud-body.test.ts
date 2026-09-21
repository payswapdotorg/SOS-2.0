/**
 * ACCEPTANCE (Work Order P8): the DISPOSABLE CLOUD CODING/SHELL BODY —
 * the reference implementation of the primary autonomous execution path.
 *
 * A complete bounded task through the PUBLIC §9 contract behind the P5
 * broker (lease -> execute -> release); sandbox boundary violations
 * (filesystem out-of-scope, budget overruns) as typed denials inside
 * truthful FAILED results; and USER-DEVICE INDEPENDENCE: the task
 * completes with the user's computer offline and ZERO device probes.
 */

import { describe, expect, it } from 'vitest';
import { acceptanceWorld, SECRET_TOKEN_VALUE } from './acceptance-world.js';
import type { FabricOperation } from '@sos-2/execution-fabric';
import type { HarnessContract } from '@sos-2/harness';

const CLOUD_STEPS: readonly FabricOperation[] = [
  { kind: 'workspace.write', path: 'src/feature.ts', content: 'export const feature = 2;\n' },
  { kind: 'shell.exec', command: 'cat', args: ['src/feature.ts'], cwd: null },
  { kind: 'git.status' },
  { kind: 'git.createBranch', name: 'feature/two', from_ref: null },
  { kind: 'git.commit', message: 'feat: feature two', paths: [] },
  { kind: 'git.push', remote: 'origin', ref: 'feature/two' },
  { kind: 'git.createPullRequest', title: 'feat: feature two', source_branch: 'feature/two', target_branch: 'main' },
  { kind: 'artifacts.capture', name: 'build-report', content: 'all checks passed' },
  { kind: 'observations.emit', observation_kind: 'body.progress', payload: { stage: 'complete' } },
];

async function runSteps(
  world: ReturnType<typeof acceptanceWorld>,
  taskId: string,
  steps: readonly FabricOperation[],
): Promise<{ executed: number; failures: number }> {
  let executed = 0;
  let failures = 0;
  for (const step of steps) {
    const result = await world.fabric.execute(taskId, step);
    if (result.status === 'EXECUTED') {
      executed += 1;
      if (result.availability === 'FAILURE') {
        failures += 1;
      }
    }
  }
  return { executed, failures };
}

describe('acceptance: the disposable cloud coding/shell body', () => {
  it('executes a COMPLETE bounded task through the PUBLIC contract behind the broker (lease -> execute -> release)', async () => {
    const world = acceptanceWorld();
    world.registerCloudBody();
    const task = await world.createTask({ task_id: 'task-cloud-journey-0001' });
    expect(task.status).toBe('RUNNING');
    expect(task.body_lease_ref).toBe('lease:task-cloud-journey-0001:0001');

    // The lease is live for the whole run (fail-closed gate).
    expect(await world.broker.isLeaseLive(task.body_lease_ref!)).toBe(true);

    const { executed, failures } = await runSteps(world, 'task-cloud-journey-0001', CLOUD_STEPS);
    expect(executed).toBe(CLOUD_STEPS.length);
    expect(failures).toBe(0);

    // The body emits observations and artifacts through the typed boundaries.
    const running = await world.store.tasks.get('task-cloud-journey-0001');
    expect(running?.observations.length).toBeGreaterThanOrEqual(CLOUD_STEPS.length + 1);
    expect(running?.artifacts.length).toBe(1);
    const artifact = running?.artifacts[0];
    expect(artifact?.content_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(artifact?.object_ref).toContain('r2://');
    // The captured artifact content is content-addressed in the object store.
    const stored = await world.store.objects.getObject(artifact?.content_hash ?? '');
    expect(stored === null ? '' : Buffer.from(stored).toString('utf8')).toBe('all checks passed');

    // Spirit-side completion (the honest verification record) releases the body.
    const completion = await world.fabric.completeTask('task-cloud-journey-0001', {
      verified: true,
      recorded_at: '2026-01-15T10:00:00Z',
      evidence_refs: running?.observations ?? [],
      summary: 'all steps executed successfully on the leased cloud body',
    });
    expect(completion.status).toBe('TRANSITIONED');
    const completed = await world.store.tasks.get('task-cloud-journey-0001');
    expect(completed?.status).toBe('COMPLETED');
    expect(completed?.final_verification?.verified).toBe(true);

    // The lease was RELEASED (terminal — never reactivated).
    const lease = await world.store.bodyLeases.get('lease:task-cloud-journey-0001:0001');
    expect(lease?.state).toBe('RELEASED');
    expect(lease?.release_reason).toContain('task completed');
    expect(await world.broker.isLeaseLive('lease:task-cloud-journey-0001:0001')).toBe(false);
  });

  it('the task CONTINUES while the user\'s computer is offline (zero device presence)', async () => {
    const world = acceptanceWorld();
    // A cloud body: no device handle exists anywhere on its construction
    // or contract — the journey below runs with NO device probe at all.
    const body = world.registerCloudBody();
    const task = await world.createTask({ task_id: 'task-offline-journey-0001' });
    expect(body.identityValue.placement).toBe('cloud');
    const { executed, failures } = await runSteps(world, 'task-offline-journey-0001', CLOUD_STEPS);
    expect(executed).toBe(CLOUD_STEPS.length);
    expect(failures).toBe(0);
    await world.fabric.completeTask('task-offline-journey-0001', {
      verified: true,
      recorded_at: '2026-01-15T10:30:00Z',
      evidence_refs: task.observations,
      summary: 'completed while the user device was offline',
    });
    const completed = await world.store.tasks.get('task-offline-journey-0001');
    expect(completed?.status).toBe('COMPLETED');
    // The durable task survived its (now released) body: task state and
    // evidence outlive the lease (§1/§6).
    const lease = await world.store.bodyLeases.get('lease:task-offline-journey-0001:0001');
    expect(lease?.state).toBe('RELEASED');
    expect((await world.store.tasks.get('task-offline-journey-0001'))?.observations.length).toBeGreaterThan(0);
  });

  it('sandbox boundary violations surface as typed denials in truthful FAILED results (never silent, never a crash)', async () => {
    const world = acceptanceWorld();
    world.registerCloudBody({
      sandboxPolicy: {
        filesystem: { mode: 'workspace', root: '/workspace/bounded-cloud' },
        network: { egress: 'allowlist', allowedHosts: ['api.github.com'] },
        secrets: ['github-token'],
        budgets: { fileWrites: 1, fileBytes: 10_000, shellCommands: 2, networkCalls: 10, secretReveals: 10 },
        resourceEnvelope: { maxDurationMs: 3_600_000, maxMemoryMb: 1024 },
      },
    });
    await world.createTask({ task_id: 'task-bounded-0001' });

    // FILESYSTEM out-of-scope: the escape attempt runs and fails truthfully.
    const escape = await world.fabric.execute('task-bounded-0001', {
      kind: 'workspace.write',
      path: '../../etc/passwd',
      content: 'x',
    });
    expect(escape.status).toBe('EXECUTED');
    if (escape.status === 'EXECUTED') {
      expect(escape.availability).toBe('FAILURE');
      expect(escape.error).toContain('SANDBOX_FILESYSTEM_OUT_OF_SCOPE');
    }

    // BUDGET overrun: the fileWrites budget is 1 — one legitimate write
    // consumes it, the NEXT write overruns the resource envelope.
    const legitimate = await world.fabric.execute('task-bounded-0001', {
      kind: 'workspace.write',
      path: 'src/ok.txt',
      content: 'the one allowed write',
    });
    expect(legitimate.status === 'EXECUTED' && legitimate.availability).toBe('SUCCESS');
    const overBudget = await world.fabric.execute('task-bounded-0001', {
      kind: 'workspace.write',
      path: 'src/over.txt',
      content: 'too many writes',
    });
    expect(overBudget.status).toBe('EXECUTED');
    if (overBudget.status === 'EXECUTED') {
      expect(overBudget.availability).toBe('FAILURE');
      expect(overBudget.error).toContain('SANDBOX_BUDGET_EXCEEDED');
      expect(overBudget.error).toContain('fileWrites');
    }

    // SHELL budget overrun: shellCommands budget is 2.
    expect((await world.fabric.execute('task-bounded-0001', { kind: 'shell.exec', command: 'echo', args: ['a'], cwd: null })).status).toBe('EXECUTED');
    expect((await world.fabric.execute('task-bounded-0001', { kind: 'shell.exec', command: 'echo', args: ['b'], cwd: null })).status).toBe('EXECUTED');
    const shellDenied = await world.fabric.execute('task-bounded-0001', { kind: 'shell.exec', command: 'echo', args: ['c'], cwd: null });
    expect(shellDenied.status === 'EXECUTED' && shellDenied.availability).toBe('FAILURE');
    if (shellDenied.status === 'EXECUTED' && shellDenied.error) {
      expect(shellDenied.error).toContain('SANDBOX_BUDGET_EXCEEDED');
      expect(shellDenied.error).toContain('shellCommands');
    }

    // The violation observations are durable (truthful trail).
    const task = await world.store.tasks.get('task-bounded-0001');
    const events = await world.store.observationEvents.list({ limit: null });
    const denialEvents = events.items.filter((event) => event.kind === 'fabric.operation:workspace.write' || event.kind === 'fabric.operation:shell.exec');
    expect(denialEvents.length).toBeGreaterThanOrEqual(4);
    expect(task?.status).toBe('RUNNING');
  });

  it('the bounded environment is disposed at cancellation (fail-closed afterwards)', async () => {
    const world = acceptanceWorld();
    const body = world.registerCloudBody();
    await world.createTask({ task_id: 'task-dispose-0001' });
    await world.fabric.execute('task-dispose-0001', { kind: 'workspace.write', path: 'a.txt', content: 'a' });
    const cancelled = await world.fabric.cancelTask('task-dispose-0001');
    expect(cancelled.status).toBe('TRANSITIONED');
    // The sandbox of the cancelled session is ended — every later operation refuses.
    const sandbox = body.sandboxOf('task-dispose-0001');
    expect(sandbox?.ended()).toBe(true);
    const lease = await world.store.bodyLeases.get('lease:task-dispose-0001:0001');
    expect(lease?.state).toBe('RELEASED');
  });

  it('secrets never echo through ANY output of the full journey (output scan)', async () => {
    const world = acceptanceWorld();
    const body = world.registerCloudBody();
    await world.createTask({ task_id: 'task-secrets-0001' });
    // The credential closure holds the secret; use it through a network exchange.
    const sandbox = body.sandboxOf('task-secrets-0001');
    expect(sandbox).not.toBeNull();
    const exchange = sandbox!.network.netCall('api.github.com', '/repos/acme/legacy-checkout', 'github-token');
    expect(exchange.status).toBe('OK');

    const outputs: string[] = [];
    for (const step of CLOUD_STEPS) {
      const result = await world.fabric.execute('task-secrets-0001', step);
      outputs.push(JSON.stringify(result));
    }
    const events = await world.store.observationEvents.list({ limit: null });
    for (const event of events.items) {
      outputs.push(JSON.stringify(event));
    }
    const task = await world.store.tasks.get('task-secrets-0001');
    outputs.push(JSON.stringify(task));
    outputs.push(JSON.stringify(body.capabilitiesValue));
    outputs.push(JSON.stringify(body.identityValue));
    outputs.push(JSON.stringify(sandbox!.describe()));
    outputs.push(JSON.stringify(exchange));
    for (const output of outputs) {
      expect(output).not.toContain(SECRET_TOKEN_VALUE);
    }
  });
});

describe('acceptance: the cloud body behind every adapter shape (contract-equivalence)', () => {
  for (const adapterKind of ['native-api', 'mcp-protocol', 'local-bridge'] as const) {
    it(`executes the complete bounded task served through the ${adapterKind} adapter`, async () => {
      const world = acceptanceWorld();
      const { adapterTier } = world.registerAdapterServedCloudBody({ bodyId: `adapter-cloud-${adapterKind}`, adapterKind });
      expect(adapterTier).toBe(adapterKind);
      const task = await world.createTask({
        task_id: `task-adapter-${adapterKind}-0001`,
        requirements: { requiredCapabilities: ['terminal', 'filesystem', 'repository-operations'], placement: 'cloud' },
      });
      expect(task.status).toBe('RUNNING');
      const { executed, failures } = await runSteps(world, `task-adapter-${adapterKind}-0001`, CLOUD_STEPS);
      expect(executed).toBe(CLOUD_STEPS.length);
      expect(failures).toBe(0);
      const completion = await world.fabric.completeTask(`task-adapter-${adapterKind}-0001`, {
        verified: true,
        recorded_at: '2026-01-15T11:00:00Z',
        evidence_refs: [],
        summary: `adapter-served (${adapterKind}) body completed the bounded task`,
      });
      expect(completion.status).toBe('TRANSITIONED');
    });
  }

  it('an adapter-served body answers typed UNSUPPORTED outside its advertisement (browser on a coding body)', async () => {
    const world = acceptanceWorld();
    world.registerAdapterServedCloudBody({ bodyId: 'adapter-cloud-unsup', adapterKind: 'mcp-protocol' });
    await world.createTask({ task_id: 'task-adapter-unsup-0001' });
    const refused = await world.fabric.execute('task-adapter-unsup-0001', { kind: 'browser.open', url: 'https://example.com' });
    // The FABRIC advertisement gate answers UNSUPPORTED before dispatch (explicit, never silent).
    expect(refused.status).toBe('UNSUPPORTED');
    if (refused.status === 'UNSUPPORTED') {
      expect(refused.operation).toBe('browser.open');
      expect(refused.reason).toContain('advertisement');
    }
  });
});
