/**
 * @sos-2/worker-runtime contract tests (Work Order P6).
 *
 * Pins:
 *  - execution through the §9 fabric gates on a real (reference) body;
 *  - capability-checked calls: an unadvertised operation is a typed
 *    CAPABILITY_UNSUPPORTED failure naming the operation — never silent;
 *  - checkpoint discipline: checkpoints chain into the task graph and a
 *    crashed worker RESUMES FROM CHECKPOINT (not from zero);
 *  - honest results: evidence refs are durable ids, the exact workspace
 *    revision is the commit ref, a completion REPORT never certifies;
 *  - typed state refusals (wrong state / wrong lease);
 *  - body loss mid-run classifies as BODY_LOST (typed).
 */

import { describe, expect, it } from 'vitest';
import { CloudCodingShellBody } from '@sos-2/body-runtimes';
import { BodyBroker } from '@sos-2/body-broker';
import { ExecutionFabric } from '@sos-2/execution-fabric';
import { ManualClock, createInMemoryLiveStore, formatRfc3339 } from '@sos-2/live-store';
import { createGrant } from '@sos-2/authority';
import { TaskGraph } from '@sos-2/task-graph';
import { WorkerRuntime } from '../src/index.js';
import type { WorkerStepProgram } from '../src/index.js';
import { serializeWorkerStepProgram } from '../src/index.js';

const MISSION_REF = 'sos://Mission/0123456789abcdef0123456789abcdef';

function sandboxPolicy(root: string) {
  return {
    filesystem: { mode: 'workspace' as const, root },
    network: { egress: 'allowlist' as const, allowedHosts: ['api.github.com', 'registry.npmjs.org'] },
    secrets: ['github-token'],
    budgets: { fileWrites: 200, fileBytes: 1_000_000, shellCommands: 500, networkCalls: 200, secretReveals: 100 },
    resourceEnvelope: { maxDurationMs: 7_200_000, maxMemoryMb: 2048 },
  };
}

function world() {
  const clock = new ManualClock(Date.parse('2026-02-01T10:00:00Z'));
  const store = createInMemoryLiveStore({ clock });
  const broker = new BodyBroker({ leases: store.bodyLeases, clock });
  const fabric = new ExecutionFabric({
    tasks: store.tasks,
    authorityGrants: store.authorityGrants,
    observationEvents: store.observationEvents,
    objects: store.objects,
    broker,
    clock,
  });
  const graph = new TaskGraph({ tasks: store.tasks, observationEvents: store.observationEvents, clock });
  const worker = new WorkerRuntime({ fabric, broker, graph, tasks: store.tasks, clock });

  const body = new CloudCodingShellBody({
    bodyId: 'cloud-shell-a',
    provider: { name: 'reference-cloud-shell', version: '1.0.0' },
    placement: 'cloud',
    sandboxPolicy: sandboxPolicy('/workspace/cloud-a'),
    secrets: {},
  });
  broker.registerBody({
    body_id: 'cloud-shell-a',
    provider: { name: 'reference-cloud-shell', version: '1.0.0' },
    capabilities: body.capabilitiesValue,
    placement: 'cloud',
    harness: body,
  });

  const now = clock.nowEpochMs();
  const grant = createGrant({
    grantee: 'spirit:persistent',
    scope: { kind: 'KIND', artifact_kind: 'Mission' },
    permissions: ['READ', 'REVISE'],
    expiry: { kind: 'TIME', at: formatRfc3339(now + 86_400_000) },
    provenance: ['p6-worker-runtime-test'],
    created_at: formatRfc3339(now),
    status: 'ACTIVE',
  });

  return { clock, store, broker, fabric, graph, worker, body, grant };
}

async function assignTask(
  w: ReturnType<typeof world>,
  taskId: string,
  program: WorkerStepProgram,
  ownedPaths: string[] = ['packages/target'],
) {
  await w.store.authorityGrants.put(w.grant);
  await w.graph.addNode({
    task_id: taskId,
    mission_ref: MISSION_REF,
    authority_ref: w.grant.envelope.id,
    title: 'Advance the mission',
    owned_paths: ownedPaths,
    steps: serializeWorkerStepProgram(program),
  });
  const acquisition = await w.broker.acquireLease({
    task_ref: taskId,
    body_id: 'cloud-shell-a',
    holder: 'orchestrator',
    expires_at: null,
  });
  if (acquisition.status !== 'ACQUIRED') {
    throw new Error(`lease acquisition failed: ${JSON.stringify(acquisition)}`);
  }
  await w.graph.assign(taskId, { lane: 1, worker_ref: 'worker-01', lease_ref: acquisition.lease.lease_id, note: null });
  return { lease: acquisition.lease };
}

describe('worker execution through the §9 fabric gates', () => {
  it('executes a work program and emits an honest COMPLETION REPORT (never a certification)', async () => {
    const w = world();
    const program: WorkerStepProgram = {
      steps: [
        { kind: 'operation', operation: { kind: 'workspace.write', path: 'src/feature.ts', content: 'export const feature = 1;\n' } },
        { kind: 'operation', operation: { kind: 'git.status' } },
        { kind: 'operation', operation: { kind: 'git.commit', message: 'feat: advance the mission', paths: [] } },
        { kind: 'operation', operation: { kind: 'artifacts.capture', name: 'feature-summary', content: 'the feature landed' } },
      ],
    };
    const { lease } = await assignTask(w, 'task-run-1', program);
    const result = await w.worker.execute({ task_id: 'task-run-1', lane: 1, worker_ref: 'worker-01', lease_ref: lease.lease_id });
    expect(result.status).toBe('COMPLETED_REPORT');
    expect(result.steps_executed).toBe(4);
    expect(result.evidence_refs.length).toBeGreaterThanOrEqual(5); // 4 observations + 1 artifact
    expect(result.evidence_refs.every((ref) => ref.startsWith('fabric-obs:') || ref.startsWith('artifact:') || !ref.includes(' '))).toBe(true);
    expect(result.workspace_revision.source_revision).not.toBeNull(); // the exact commit ref
    expect(result.provenance.worker_id).toBe('worker-01');
    expect(result.provenance.body_id).toBe('cloud-shell-a');
    expect(result.resumed_from_checkpoint).toBeNull();
    // The report explicitly declares itself a report, not a certification.
    expect(result.summary).not.toContain('certif');
  });

  it('refuses to execute a task in the wrong state or under the wrong lease (typed)', async () => {
    const w = world();
    await w.store.authorityGrants.put(w.grant);
    await w.graph.addNode({
      task_id: 'task-pending-1',
      mission_ref: MISSION_REF,
      authority_ref: w.grant.envelope.id,
      title: 'Pending task',
      owned_paths: ['packages/target'],
      steps: serializeWorkerStepProgram({ steps: [] }),
    });
    await expect(
      w.worker.execute({ task_id: 'task-pending-1', lane: 1, worker_ref: 'worker-01', lease_ref: 'lease:none:0001' }),
    ).rejects.toThrow(/RUNNING/);
  });
});

describe('capability-checked calls (typed UNSUPPORTED, never silent)', () => {
  it('fails with a typed CAPABILITY_UNSUPPORTED for an unadvertised operation (no browser on the cloud shell)', async () => {
    const w = world();
    const program: WorkerStepProgram = {
      steps: [
        { kind: 'operation', operation: { kind: 'browser.open', url: 'https://example.com' } },
      ],
    };
    const { lease } = await assignTask(w, 'task-unsupported-1', program);
    const result = await w.worker.execute({ task_id: 'task-unsupported-1', lane: 1, worker_ref: 'worker-01', lease_ref: lease.lease_id });
    expect(result.status).toBe('FAILED');
    expect(result.failure!.kind).toBe('CAPABILITY_UNSUPPORTED');
    expect(result.failure!.reason).toContain('browser.open');
    expect(result.failure!.reason).toContain('advertisement');
    // The unadvertised operation never dispatched (no run-flag evidence).
    expect(w.body.dispatches.get('browser.open') ?? 0).toBe(0);
  });
});

describe('checkpoint discipline + crash recovery', () => {
  it('chains checkpoints into the graph and resumes from checkpoint after a crash', async () => {
    const w = world();
    const program: WorkerStepProgram = {
      steps: [
        { kind: 'operation', operation: { kind: 'workspace.write', path: 'src/part-1.ts', content: 'part1\n' } },
        { kind: 'checkpoint', label: 'after part 1', notes: 'part 1 written' },
        { kind: 'operation', operation: { kind: 'workspace.write', path: 'src/part-2.ts', content: 'part2\n' } },
        { kind: 'checkpoint', label: 'after part 2', notes: 'part 2 written' },
        { kind: 'operation', operation: { kind: 'git.commit', message: 'feat: both parts', paths: [] } },
      ],
    };
    const { lease } = await assignTask(w, 'task-crash-1', program);
    // Crash before step 4 (the second checkpoint): steps 1-3 ran.
    const crashed = await w.worker.execute(
      { task_id: 'task-crash-1', lane: 1, worker_ref: 'worker-01', lease_ref: lease.lease_id },
      { crashBeforeStep: 4 },
    );
    expect(crashed.status).toBe('FAILED');
    expect(crashed.failure!.kind).toBe('WORKER_CRASH');
    expect(crashed.failure!.simulated).toBe(true);
    // The checkpoint chain survived the crash (durable).
    const failedNode = await w.graph.node('task-crash-1');
    expect(failedNode!.checkpoint_chain.length).toBe(1);
    expect(failedNode!.checkpoint_chain[0]!.step_index).toBe(2);

    // Record the typed failure, retry, re-assign and RESUME from checkpoint.
    await w.graph.recordFailure('task-crash-1', {
      failure_kind: 'WORKER_CRASH',
      reason: crashed.failure!.reason,
      recovery: 'RETRYABLE',
    });
    await w.broker.releaseLease(lease.lease_id, 'retry after crash');
    await w.graph.retry('task-crash-1');
    const reacquisition = await w.broker.acquireLease({
      task_ref: 'task-crash-1',
      body_id: 'cloud-shell-a',
      holder: 'orchestrator',
      expires_at: null,
    });
    if (reacquisition.status !== 'ACQUIRED') {
      throw new Error('re-acquisition failed');
    }
    await w.graph.assign('task-crash-1', { lane: 1, worker_ref: 'worker-01', lease_ref: reacquisition.lease.lease_id, note: 'retry after crash' });
    const resumed = await w.worker.execute({ task_id: 'task-crash-1', lane: 1, worker_ref: 'worker-01', lease_ref: reacquisition.lease.lease_id });
    expect(resumed.status).toBe('COMPLETED_REPORT');
    expect(resumed.resumed_from_checkpoint).toBe(failedNode!.checkpoint_chain[0]!.checkpoint_id);
    expect(resumed.steps_total).toBe(5);
    // The resumed run did NOT redo steps 1-2 (resume from index 2): the
    // whole program is covered (steps_executed counts program progress
    // across runs: 2 checkpointed + 3 this run = 5).
    expect(resumed.steps_executed).toBe(5);
    const finalNode = await w.graph.node('task-crash-1');
    expect(finalNode!.retries).toBe(1);
    expect(finalNode!.checkpoint_chain.length).toBe(2);
  });
});

describe('body loss mid-run (typed BODY_LOST)', () => {
  it('classifies a revoked lease as BODY_LOST with the denial code (the fabric gate refuses)', async () => {
    const w = world();
    const program: WorkerStepProgram = {
      steps: [
        { kind: 'operation', operation: { kind: 'workspace.write', path: 'src/x.ts', content: 'x\n' } },
        { kind: 'checkpoint', label: 'mid', notes: null },
        { kind: 'operation', operation: { kind: 'workspace.write', path: 'src/y.ts', content: 'y\n' } },
      ],
    };
    const { lease } = await assignTask(w, 'task-body-lost-1', program);
    // The body is suspended BETWEEN dispatch and execution (the lease is
    // revoked durably — the kill-mid-task flow): the next dispatched
    // operation hits the fabric's fail-closed lease gate.
    await w.broker.suspendBody('cloud-shell-a', 'maintenance window');
    const result = await w.worker.execute({ task_id: 'task-body-lost-1', lane: 1, worker_ref: 'worker-01', lease_ref: lease.lease_id });
    expect(result.status).toBe('FAILED');
    expect(result.failure!.kind).toBe('BODY_LOST');
    expect(result.failure!.denial_code).toBe('LEASE_DENIED');
    // The graph is still structurally valid after the body loss (the
    // failure is typed, the task is recoverable).
    const report = await w.graph.scan();
    expect(report.valid).toBe(true);
    // Recovery: record the typed failure, retry, and the task re-queues.
    await w.graph.recordFailure('task-body-lost-1', {
      failure_kind: 'BODY_LOST',
      reason: result.failure!.reason,
      recovery: 'RETRYABLE',
    });
    const retried = await w.graph.retry('task-body-lost-1');
    expect(retried.state).toBe('PENDING');
    expect(retried.retries).toBe(1);
  });
});

describe('the ask step (ASK is a success state)', () => {
  it('stops the run with an ASK_REQUIRED result carrying the escalation payload', async () => {
    const w = world();
    const program: WorkerStepProgram = {
      steps: [
        { kind: 'operation', operation: { kind: 'workspace.write', path: 'src/a.ts', content: 'a\n' } },
        { kind: 'uncertainty', statement: 'the deployment target policy is ambiguous' },
        { kind: 'ask', statement: 'Which deployment target should this mission promote to?', basis: 'the mission constraints name two candidate targets with no ranking' },
      ],
    };
    const { lease } = await assignTask(w, 'task-ask-1', program);
    const result = await w.worker.execute({ task_id: 'task-ask-1', lane: 1, worker_ref: 'worker-01', lease_ref: lease.lease_id });
    expect(result.status).toBe('ASK_REQUIRED');
    expect(result.ask!.statement).toContain('deployment target');
    expect(result.uncertainty).toContain('the deployment target policy is ambiguous');
    expect(result.failure).toBeNull();
  });
});
