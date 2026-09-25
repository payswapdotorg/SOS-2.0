/**
 * ACCEPTANCE SUITE 1 — BODY LOSS (Work Order P12, pinned).
 *
 * "killing a body does not lose the task" + "body replacement preserves
 * task/artifact identity": a mid-task kill leaves the durable record
 * intact; the lease goes SUSPECTED (truthful UNKNOWN) then LOST (only
 * via a verified failure); the recovery plan inherits identity + the
 * last durable checkpoint; the replacement body executes the recovery
 * and the task completes.
 */

import { describe, expect, it } from 'vitest';
import { createAutonomyWorld, seedWorld, startAcceptanceTask, acceptanceProgram, FIRST_BODY, MISSED_BEAT_WINDOW_MS, TARGET_SHA, RUNTIME_ACTOR } from './world.js';
import { formatRfc3339 } from '@sos-2/live-store';
import { verifyTranscript } from './world.js';

describe('P12 acceptance: killing a body does not lose the task', () => {
  it('the durable record survives the kill (identity, checkpoints, authority all intact)', async () => {
    const world = createAutonomyWorld();
    await seedWorld(world);
    const started = await startAcceptanceTask(world, 'task-body-loss');
    expect(started.status).toBe('STARTED');
    const leaseId = started.status === 'STARTED' ? started.lease_id : '';

    world.beats.beat(FIRST_BODY, world.clock.nowEpochMs());
    const healthy = await world.supervisor.supervise(leaseId);
    expect(healthy.state).toBe('HEALTHY');

    // THE KILL: interrupt the run mid-task (step index 5).
    const transcript = await world.runtime.runProgram('task-body-loss', { interrupt: (index) => (index === 5 ? 'KILL' : 'CONTINUE') });
    expect(transcript.stop_reason).toBe('INTERRUPTED');
    expect(transcript.stopped_at).toBe(5);

    // Killing the body did NOT lose the task: the durable record stands.
    const record = await world.store.tasks.get('task-body-loss');
    expect(record).toBeDefined();
    expect(record!.status).toBe('RUNNING');
    expect(record!.checkpoints.length).toBe(2);
    expect(record!.authority_context.grant_refs).toEqual([world.grant.envelope.id]);

    // The body stops beating: SUSPECTED first (truthful UNKNOWN — never LOST).
    world.beats.forgetBody(FIRST_BODY);
    world.clock.advance(MISSED_BEAT_WINDOW_MS + 1_000);
    const suspected = await world.supervisor.supervise(leaseId);
    expect(suspected.state).toBe('SUSPECTED');
    expect(suspected.detail).toContain('UNKNOWN');

    // ONLY a verified failure observation transitions to LOST.
    world.failures.record({
      bodyId: FIRST_BODY,
      observationId: 'obs-verified-body-failure-01',
      observedAt: formatRfc3339(world.clock.nowEpochMs()),
      detail: 'the cloud provider attested the body crashed (verified failure observation)',
    });
    const lost = await world.supervisor.supervise(leaseId);
    expect(lost.state).toBe('LOST');
    expect(lost.verifiedFailure?.observationId).toBe('obs-verified-body-failure-01');

    // The recovery plan: the replacement inherits identity + the LAST durable checkpoint.
    const plan = await world.planner.plan({
      lost_lease_id: leaseId,
      verified_failure: { observationId: 'obs-verified-body-failure-01', detail: 'the cloud provider attested the body crashed (verified failure observation)' },
    });
    expect(plan.task_id).toBe('task-body-loss');
    expect(plan.inheritance.task_id).toBe('task-body-loss');
    expect(plan.inheritance.resume_from_checkpoint?.checkpoint_id).toBe('cp-0002');
    expect(plan.inheritance.authority_context.grant_refs).toEqual([world.grant.envelope.id]);
    expect(plan.unknown_until_reverified.length).toBe(3);

    // The provider-side fact: the failed body is suspended (every ACTIVE
    // lease of the body is revoked — the replacement picks a HEALTHY body).
    await world.broker.suspendBody(FIRST_BODY, 'verified body failure (obs-verified-body-failure-01)');
    // Execute the recovery: replacement body + new lease; the task continues.
    const recovery = await world.runtime.executeRecoveryPlan(plan, 'verified body loss (obs-verified-body-failure-01)');
    expect(recovery.status).toBe('REPLACED');
    if (recovery.status === 'REPLACED') {
      expect(recovery.replacement_body_id).not.toBe(FIRST_BODY);
      expect(recovery.new_lease_id).not.toBe(leaseId);
      expect(recovery.ended_lease_id).toBe(leaseId);
    }

    // The replacement body beats; the task runs to completion from the checkpoint.
    const replacementBody = recovery.status === 'REPLACED' ? recovery.replacement_body_id : FIRST_BODY;
    world.beats.beat(replacementBody, world.clock.nowEpochMs());
    const resumed = await world.runtime.runProgram('task-body-loss', { fromCheckpoint: 'cp-0002' });
    expect(resumed.stop_reason).toBe('COMPLETED');
    expect(resumed.outcomes.length).toBe(7); // steps 4..10

    // Independent verification + completion (no self-approval).
    const prior = await world.runtime.completionEvidenceOf('task-body-loss', 'cp-0002');
    const verification = verifyTranscript(world, 'task-body-loss', [...prior, ...resumed.outcomes]);
    expect(verification.record.verified).toBe(true);
    await world.runtime.completeTask('task-body-loss', verification.record, verification.verificationId);
    const completed = await world.store.tasks.get('task-body-loss');
    expect(completed!.status).toBe('COMPLETED');
    expect(completed!.final_verification?.verified).toBe(true);
  });

  it('a task with NO checkpoints recovers from the start of its program (resume null -> full run)', async () => {
    const world = createAutonomyWorld();
    await seedWorld(world);
    const started = await world.runtime.startTask({
      node: {
        task_id: 'task-no-checkpoint',
        mission_ref: world.mission.envelope.id,
        authority_ref: world.grant.envelope.id,
        title: 'No-checkpoint run',
        owned_paths: ['work/no-checkpoint'],
      },
      program: { steps: acceptanceProgram().steps.slice(0, 2) } as { steps: never[] },
      body_id: FIRST_BODY,
      actor: RUNTIME_ACTOR,
      targetSha: TARGET_SHA,
    });
    expect(started.status).toBe('STARTED');
    const leaseId = started.status === 'STARTED' ? started.lease_id : '';
    world.beats.beat(FIRST_BODY, world.clock.nowEpochMs());

    const killed = await world.runtime.runProgram('task-no-checkpoint', { interrupt: (index) => (index === 1 ? 'KILL' : 'CONTINUE') });
    expect(killed.stop_reason).toBe('INTERRUPTED');

    world.failures.record({
      bodyId: FIRST_BODY,
      observationId: 'obs-verified-body-failure-02',
      observedAt: formatRfc3339(world.clock.nowEpochMs()),
      detail: 'verified failure before any checkpoint',
    });
    const lost = await world.supervisor.supervise(leaseId);
    expect(lost.state).toBe('LOST');
    const plan = await world.planner.plan({
      lost_lease_id: leaseId,
      verified_failure: { observationId: 'obs-verified-body-failure-02', detail: 'verified failure before any checkpoint' },
    });
    expect(plan.inheritance.resume_from_checkpoint).toBeNull();
    await world.broker.suspendBody(FIRST_BODY, 'verified failure before any checkpoint');
    const recovery = await world.runtime.executeRecoveryPlan(plan, 'verified failure before any checkpoint');
    expect(recovery.status).toBe('REPLACED');
    const rerun = await world.runtime.runProgram('task-no-checkpoint');
    expect(rerun.stop_reason).toBe('COMPLETED');
  });
});
