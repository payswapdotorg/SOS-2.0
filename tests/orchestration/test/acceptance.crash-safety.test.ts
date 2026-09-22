/**
 * ACCEPTANCE SUITE 5 — CRASH SAFETY (Work Order P6, pinned).
 *
 * "worker crashes do not corrupt the task graph": worker crashes, body
 * loss and provider outages mid-journey produce TYPED task failures
 * that leave the graph STRUCTURALLY VALID (invariant scans) and the
 * failed task RECOVERABLE — no orphaned references, no partial writes,
 * no lost tasks, and nothing ever silently completed (recovery marks
 * the task retryable; the retry resumes from the checkpoint chain).
 */

import { describe, expect, it } from 'vitest';
import { createAcceptanceWorld, runJourney, startJourney } from './acceptance-world.js';

describe('P6 acceptance: crash safety (typed failures, valid graph, recoverable tasks)', () => {
  it('a mid-journey worker crash leaves the graph valid and the crashed task recovers from its checkpoint', async () => {
    const world = createAcceptanceWorld();
    await startJourney(world);
    // Crash the second lane (index 1) before step 3 — after its first
    // checkpoint: the durable checkpoint chain survives the crash.
    const firstTick = await world.orchestrator.tick({ crashes: { 1: 3 } });
    expect(firstTick.ingested.some((ingested) => ingested.outcome.kind === 'FAILED' && 'failure_kind' in ingested.outcome && ingested.outcome.failure_kind === 'WORKER_CRASH')).toBe(true);
    // The graph is STILL structurally valid immediately after the crash.
    const scanAfterCrash = await world.graph.scan();
    expect(scanAfterCrash.valid).toBe(true);
    // The crashed task is FAILED with RETRYABLE recovery (never silently done).
    const crashedNode = (await world.graph.nodes()).find((node) => node.state === 'FAILED');
    expect(crashedNode).toBeDefined();
    expect(crashedNode!.recovery.status).toBe('RETRYABLE');
    expect(crashedNode!.recovery.failure_kind).toBe('WORKER_CRASH');
    // The checkpoint chain survived (a crashed worker resumes from it, not from zero).
    expect(crashedNode!.checkpoint_chain.length).toBe(1);
    // No task was lost and none was silently completed.
    const nodesAfterCrash = await world.graph.nodes();
    expect(nodesAfterCrash.length).toBe(3);
    expect(nodesAfterCrash.filter((node) => node.state === 'COMPLETED').length).toBe(2);

    // The full journey recovers: the crashed task retries and completes.
    const report = await runJourney(world, { crashes: { 1: 3 } });
    expect(report.completed).toBe(true);
    const recovered = report.tasks.find((task) => task.retries > 0);
    expect(recovered).toBeDefined();
    expect(recovered!.retries).toBe(1);
    expect(recovered!.verification_ref).not.toBeNull();
    const finalScan = await world.graph.scan();
    expect(finalScan.valid).toBe(true);
  });

  it('body loss mid-journey is a TYPED BODY_LOST failure and the task recovers', async () => {
    const world = createAcceptanceWorld();
    await startJourney(world);
    // Assign one task, then suspend its body BEFORE the worker runs
    // (kill-mid-task: the lease is revoked durably).
    const target = (await world.graph.nodes()).find((node) => node.owned_paths.includes('work/goal-validation'))!;
    const acquisition = await world.broker.acquireLease({
      task_ref: target.task_id,
      body_id: 'acceptance-cloud-01',
      holder: 'acceptance',
      expires_at: null,
    });
    const leaseRef = acquisition.status === 'ACQUIRED' ? acquisition.lease.lease_id : 'x';
    await world.graph.assign(target.task_id, { lane: 1, worker_ref: 'worker-1', lease_ref: leaseRef, note: null });
    await world.broker.suspendBody('acceptance-cloud-01', 'planned maintenance (kill-mid-task)');
    const result = await world.worker.execute({ task_id: target.task_id, lane: 1, worker_ref: 'worker-1', lease_ref: leaseRef });
    expect(result.status).toBe('FAILED');
    expect(result.failure!.kind).toBe('BODY_LOST');
    expect(result.failure!.denial_code).toBe('LEASE_DENIED');
    // Record the typed failure + retry: the graph stays valid.
    await world.graph.recordFailure(target.task_id, { failure_kind: 'BODY_LOST', reason: result.failure!.reason, recovery: 'RETRYABLE' });
    const scan = await world.graph.scan();
    expect(scan.valid).toBe(true);
    await world.graph.retry(target.task_id);
    const retried = await world.graph.node(target.task_id);
    expect(retried!.state).toBe('PENDING');
    expect(retried!.retries).toBe(1);
    // No task was lost and none was silently completed.
    const nodes = await world.graph.nodes();
    expect(nodes.length).toBe(3);
    expect(nodes.filter((node) => node.state === 'COMPLETED').length).toBe(0);
  });

  it('no task is EVER silently completed: a rejected verification fails closed into a typed failure', async () => {
    const world = createAcceptanceWorld();
    await startJourney(world);
    const nodes = await world.graph.nodes();
    const node = nodes[0]!;
    const acquisition = await world.broker.acquireLease({ task_ref: node.task_id, body_id: 'acceptance-cloud-01', holder: 'acceptance', expires_at: null });
    await world.graph.assign(node.task_id, { lane: 1, worker_ref: 'worker-honest', lease_ref: acquisition.status === 'ACQUIRED' ? acquisition.lease.lease_id : 'x', note: null });
    // A worker result that did NOT run the whole program: verification
    // must reject it (honest) and the task must NOT complete.
    const partial = await world.worker.execute({ task_id: node.task_id, lane: 1, worker_ref: 'worker-honest', lease_ref: acquisition.status === 'ACQUIRED' ? acquisition.lease.lease_id : 'x' }, { crashBeforeStep: 4 });
    expect(partial.status).toBe('FAILED');
    // An INCOMPLETE report path: fabricate the shape the verifier rejects.
    const incompleteReport = {
      task_id: node.task_id,
      worker_id: 'worker-honest',
      status: 'COMPLETED_REPORT' as const,
      evidence_refs: [...partial.evidence_refs],
      workspace_revision: { source_revision: partial.workspace_revision.source_revision, deployment_revision: null },
      provenance: partial.provenance,
      uncertainty: [],
      failure: null,
      ask: null,
      resumed_from_checkpoint: partial.resumed_from_checkpoint,
      summary: 'incomplete program presented as a report',
      steps_executed: partial.steps_executed - 1,
      steps_total: partial.steps_total,
    };
    const verification = await world.verifier.verify({ task_id: node.task_id, worker_result: incompleteReport });
    expect(verification.verdict).toBe('REJECTED');
    expect(verification.checked.includes('C5:complete-program')).toBe(true);
    // The record verification gate refuses the REJECTED verdict (typed).
    let violation: unknown = null;
    try {
      const { assertVerificationGatesCompletion } = await import('@sos-2/orchestrator');
      assertVerificationGatesCompletion(verification);
    } catch (cause) {
      violation = cause;
    }
    expect(violation).not.toBeNull();
    expect((violation as Error).message).toContain('VERIFIED');
    // The task never completed through this path.
    const taskNode = await world.graph.node(node.task_id);
    expect(taskNode!.state).not.toBe('COMPLETED');
  });
});
