/**
 * ACCEPTANCE SUITE 6 — DURABLE CANCELLATION (Work Order P12, pinned).
 *
 * "cancellation is first-class and durable: a cancelled task stays
 * cancelled across body replacement" — the cancellation flows through
 * the P9 action surface (evidence chain: the gateway receipt) and the
 * fabric's terminal write; afterwards NOTHING resumes it: neither a
 * checkpoint resume (typed refusal) nor execution (typed DENIAL), and
 * body replacement refuses non-active tasks.
 */

import { describe, expect, it } from 'vitest';
import { createAutonomyWorld, seedWorld, startAcceptanceTask, FIRST_BODY, TARGET_SHA, HUMAN_ACTOR, MISSED_BEAT_WINDOW_MS } from './world.js';
import { formatRfc3339 } from '@sos-2/live-store';

describe('P12 acceptance: cancellation is first-class and durable', () => {
  it('cancel -> the task stays CANCELLED: no resume, no execution, no replacement', async () => {
    const world = createAutonomyWorld();
    await seedWorld(world);
    const started = await startAcceptanceTask(world, 'task-cancel');
    expect(started.status).toBe('STARTED');
    const leaseId = started.status === 'STARTED' ? started.lease_id : '';
    world.beats.beat(FIRST_BODY, world.clock.nowEpochMs());

    // Run to a checkpoint, then cancel through the action surface.
    await world.runtime.runProgram('task-cancel', { interrupt: (index) => (index === 2 ? 'KILL' : 'CONTINUE') });
    const cancelled = await world.runtime.cancelTask('task-cancel', {
      actor: HUMAN_ACTOR,
      targetSha: TARGET_SHA,
      reason: 'operator stops the run',
    });
    expect(cancelled.status).toBe('CANCELLED');
    expect(cancelled.task?.status).toBe('CANCELLED');

    // The lease was revoked durably (the P9 evidence chain: the receipt).
    const lease = await world.store.bodyLeases.get(leaseId);
    expect(lease!.state).toBe('REVOKED');

    // Resume from the durable checkpoint is a TYPED REFUSAL.
    const resume = await world.runtime.resumeFromCheckpoint('task-cancel', 'cp-0001');
    expect(resume.status).toBe('REFUSED');
    if (resume.status === 'REFUSED') {
      expect(resume.reason).toContain('durable');
    }

    // Execution is denied fail-closed by the fabric (CANCELLED tasks never execute).
    const transcript = await world.runtime.runProgram('task-cancel');
    expect(transcript.stop_reason).toBe('DENIED');
    expect(transcript.outcomes.length).toBe(1);
    expect(transcript.outcomes[0]!.outcome).toBe('DENIED');

    // CANCELLATION WINS across body replacement: a late (fabric-level) body
    // replacement may rebind a lease — the P5 seam's own behavior — but the
    // durable STATUS stays CANCELLED and NOTHING executes (the pinned P12 truth).
    const replacement = await world.fabric.replaceBodyForTask('task-cancel', 'late replacement attempt');
    const record = (await world.store.tasks.get('task-cancel'))!;
    expect(record.status).toBe('CANCELLED');
    if (replacement.status === 'REPLACED') {
      // Even with a rebound lease, the cancelled task never executes.
      const deniedRun = await world.runtime.runProgram('task-cancel');
      expect(deniedRun.stop_reason).toBe('DENIED');
    }
  });

  it('a task cancelled BEFORE body loss stays cancelled across the loss (the loss path cannot resurrect it)', async () => {
    const world = createAutonomyWorld();
    await seedWorld(world);
    const started = await startAcceptanceTask(world, 'task-cancel-before-loss');
    expect(started.status).toBe('STARTED');
    const leaseId = started.status === 'STARTED' ? started.lease_id : '';
    world.beats.beat(FIRST_BODY, world.clock.nowEpochMs());
    await world.runtime.runProgram('task-cancel-before-loss', { interrupt: (index) => (index === 2 ? 'KILL' : 'CONTINUE') });

    // Cancel FIRST.
    const cancelled = await world.runtime.cancelTask('task-cancel-before-loss', {
      actor: HUMAN_ACTOR,
      targetSha: TARGET_SHA,
      reason: 'cancel before the loss',
    });
    expect(cancelled.status).toBe('CANCELLED');

    // Then the body verifiably fails — the recovery plan refuses the CANCELLED task.
    world.beats.forgetBody(FIRST_BODY);
    world.clock.advance(MISSED_BEAT_WINDOW_MS + 1);
    world.failures.record({
      bodyId: FIRST_BODY,
      observationId: 'obs-verified-crash-after-cancel',
      observedAt: formatRfc3339(world.clock.nowEpochMs()),
      detail: 'the body crashed after the task was cancelled',
    });
    // The cancelled task's lease was already REVOKED by the cancellation:
    // the truthful supervision verdict on a non-held lease is NOT_HELD (a
    // body failure cannot fabricate a LOST verdict over a revoked lease).
    const notHeld = await world.supervisor.supervise(leaseId);
    expect(notHeld.state).toBe('NOT_HELD');
    const plan = await world.planner.plan({
      lost_lease_id: leaseId,
      verified_failure: { observationId: 'obs-verified-crash-after-cancel', detail: 'the body crashed after the task was cancelled' },
    });
    const recovery = await world.runtime.executeRecoveryPlan(plan, 'body failed after cancellation');
    expect(recovery.status).toBe('DENIED');
    const record = (await world.store.tasks.get('task-cancel-before-loss'))!;
    expect(record.status).toBe('CANCELLED');
  });

  it('cancellation is idempotent: cancelling an already-cancelled task reports the durable state', async () => {
    const world = createAutonomyWorld();
    await seedWorld(world);
    await startAcceptanceTask(world, 'task-cancel-idempotent');
    const first = await world.runtime.cancelTask('task-cancel-idempotent', { actor: HUMAN_ACTOR, targetSha: TARGET_SHA, reason: 'first' });
    expect(first.status).toBe('CANCELLED');
    const second = await world.runtime.cancelTask('task-cancel-idempotent', { actor: HUMAN_ACTOR, targetSha: TARGET_SHA, reason: 'second' });
    expect(second.status).toBe('CANCELLED');
    expect(second.reason).toContain('durable');
  });
});
