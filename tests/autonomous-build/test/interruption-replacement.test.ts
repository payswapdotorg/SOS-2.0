/**
 * THE BODY INTERRUPTION -> REPLACEMENT -> RESUME JOURNEY (Work Order P15,
 * lane B) — the P12 lease/checkpoint discipline driven as dogfood: a leased
 * body is killed mid-task; a replacement is summoned; the task resumes from
 * the durable checkpoint WITHOUT losing semantic identity. The task record
 * shows CONTINUITY (same identity, same authority, accumulated checkpoints
 * and evidence), never a restart.
 */

import { describe, expect, it } from 'vitest';
import { formatRfc3339 } from '@sos-2/live-store';
import {
  FIRST_BODY,
  MISSED_BEAT_WINDOW_MS,
  dogfoodProgram,
  createAutonomyWorld,
  seedWorld,
  startDogfoodTask,
  verifyTranscript,
} from './world.js';

const TASK_ID = 'p15b-resume-identity';

describe('P15 lane-B body interruption -> replacement -> resume (semantic identity survives)', () => {
  it('killing the body mid-task loses NOTHING durable; the replacement resumes from the verified checkpoint', async () => {
    const world = createAutonomyWorld();
    await seedWorld(world);
    const started = await startDogfoodTask(world, TASK_ID);
    expect(started.status).toBe('STARTED');
    const leaseId = started.status === 'STARTED' ? started.lease_id : '';

    // Healthy start.
    world.beats.beat(FIRST_BODY, world.clock.nowEpochMs());
    expect((await world.supervisor.supervise(leaseId)).state).toBe('HEALTHY');

    // THE KILL: the leased body is interrupted mid-task (step index 5).
    const transcript = await world.runtime.runProgram(TASK_ID, { interrupt: (index) => (index === 5 ? 'KILL' : 'CONTINUE') });
    expect(transcript.stop_reason).toBe('INTERRUPTED');
    expect(transcript.stopped_at).toBe(5);

    // Killing the body did NOT lose the task: identity, authority, checkpoints stand.
    const interrupted = await world.store.tasks.get(TASK_ID);
    expect(interrupted).toBeDefined();
    expect(interrupted!.status).toBe('RUNNING');
    expect(interrupted!.mission_ref).toBe(world.mission.envelope.id);
    expect(interrupted!.authority_context.grant_refs).toEqual([world.grant.envelope.id]);
    expect(interrupted!.checkpoints.length).toBe(2); // cp-0001 (step 1) + cp-0002 (step 3)
    const preKillRevision = interrupted!.revision;

    // The body stops beating: SUSPECTED first (truthful UNKNOWN — never LOST).
    world.beats.forgetBody(FIRST_BODY);
    world.clock.advance(MISSED_BEAT_WINDOW_MS + 1_000);
    const suspected = await world.supervisor.supervise(leaseId);
    expect(suspected.state).toBe('SUSPECTED');
    expect(suspected.detail).toContain('UNKNOWN');

    // ONLY a verified failure observation transitions to LOST.
    world.failures.record({
      bodyId: FIRST_BODY,
      observationId: 'obs-p15b-verified-body-failure-01',
      observedAt: formatRfc3339(world.clock.nowEpochMs()),
      detail: 'the cloud provider attested the body crashed (verified failure observation)',
    });
    const lost = await world.supervisor.supervise(leaseId);
    expect(lost.state).toBe('LOST');
    expect(lost.verifiedFailure?.observationId).toBe('obs-p15b-verified-body-failure-01');

    // The recovery plan: the replacement inherits identity + the LAST durable checkpoint.
    const plan = await world.planner.plan({
      lost_lease_id: leaseId,
      verified_failure: { observationId: 'obs-p15b-verified-body-failure-01', detail: 'the cloud provider attested the body crashed (verified failure observation)' },
    });
    expect(plan.task_id).toBe(TASK_ID);
    expect(plan.inheritance.task_id).toBe(TASK_ID);
    expect(plan.inheritance.resume_from_checkpoint?.checkpoint_id).toBe('cp-0002');
    expect(plan.inheritance.authority_context.grant_refs).toEqual([world.grant.envelope.id]);
    expect(plan.unknown_until_reverified.length).toBe(3);

    // The failed body is suspended; the replacement is summoned + the task continues.
    await world.broker.suspendBody(FIRST_BODY, 'verified body failure (obs-p15b-verified-body-failure-01)');
    const recovery = await world.runtime.executeRecoveryPlan(plan, 'verified body loss (obs-p15b-verified-body-failure-01)');
    expect(recovery.status).toBe('REPLACED');
    if (recovery.status === 'REPLACED') {
      expect(recovery.replacement_body_id).not.toBe(FIRST_BODY);
      expect(recovery.new_lease_id).not.toBe(leaseId);
      expect(recovery.ended_lease_id).toBe(leaseId);
      expect(recovery.resume_from_checkpoint).toBe('cp-0002');
    }

    // CONTINUITY, not a restart: the record kept its identity, authority and
    // ACCUMULATED checkpoints, and its revision only moved forward.
    const replaced = await world.store.tasks.get(TASK_ID);
    expect(replaced!.task_id).toBe(TASK_ID);
    expect(replaced!.mission_ref).toBe(world.mission.envelope.id);
    expect(replaced!.authority_context.grant_refs).toEqual([world.grant.envelope.id]);
    expect(replaced!.checkpoints.map((checkpoint) => checkpoint.checkpoint_id)).toContain('cp-0001');
    expect(replaced!.checkpoints.map((checkpoint) => checkpoint.checkpoint_id)).toContain('cp-0002');
    expect(replaced!.revision).toBeGreaterThan(preKillRevision);
    const node = await world.graph.node(TASK_ID);
    expect(node!.mission_ref).toBe(world.mission.envelope.id);
    expect(node!.authority_ref).toBe(world.grant.envelope.id);

    // The replacement body beats; the task resumes FROM THE CHECKPOINT (7
    // remaining steps, not a 11-step restart).
    const replacementBody = recovery.status === 'REPLACED' ? recovery.replacement_body_id : FIRST_BODY;
    const replacementLeaseId = recovery.status === 'REPLACED' ? recovery.new_lease_id : leaseId;
    world.beats.beat(replacementBody, world.clock.nowEpochMs());
    expect((await world.supervisor.supervise(replacementLeaseId)).state).toBe('HEALTHY');
    const resumed = await world.runtime.runProgram(TASK_ID, { fromCheckpoint: 'cp-0002' });
    expect(resumed.stop_reason).toBe('COMPLETED');
    expect(resumed.outcomes.length).toBe(7); // steps 4..10 — continuity, not a restart

    // The accumulated evidence survived: prior checkpointed outputs + the
    // resumed segment == the FULL program, step-for-step.
    const prior = await world.runtime.completionEvidenceOf(TASK_ID, 'cp-0002');
    expect(prior.length).toBe(4); // steps 0..3
    const combined = [...prior, ...resumed.outcomes];
    expect(combined.length).toBe(dogfoodProgram().steps.length);
    for (let index = 0; index < combined.length; index += 1) {
      expect(combined[index]!.index).toBe(index);
    }

    // Independent verification + completion (no self-approval).
    const verification = verifyTranscript(world, TASK_ID, combined);
    expect(verification.record.verified).toBe(true);
    await world.runtime.completeTask(TASK_ID, verification.record, verification.verificationId);
    const completed = await world.store.tasks.get(TASK_ID);
    expect(completed!.status).toBe('COMPLETED');
    expect(completed!.final_verification!.verified).toBe(true);
    const completedNode = await world.graph.node(TASK_ID);
    expect(completedNode!.state).toBe('COMPLETED');
    expect(completedNode!.verification_ref).not.toBeNull();
  });

  it('the timeline records the whole journey: heartbeat, recovery, checkpoint, completion — in order', async () => {
    const world = createAutonomyWorld();
    await seedWorld(world);
    const started = await startDogfoodTask(world, TASK_ID);
    expect(started.status).toBe('STARTED');
    const leaseId = started.status === 'STARTED' ? started.lease_id : '';

    world.beats.beat(FIRST_BODY, world.clock.nowEpochMs());
    await world.runtime.runProgram(TASK_ID, { interrupt: (index) => (index === 5 ? 'KILL' : 'CONTINUE') });
    world.beats.forgetBody(FIRST_BODY);
    world.clock.advance(MISSED_BEAT_WINDOW_MS + 1_000);
    await world.supervisor.supervise(leaseId); // SUSPECTED -> durable event
    world.failures.record({
      bodyId: FIRST_BODY,
      observationId: 'obs-p15b-verified-body-failure-02',
      observedAt: formatRfc3339(world.clock.nowEpochMs()),
      detail: 'verified failure mid-task',
    });
    world.clock.advance(1_000);
    await world.supervisor.supervise(leaseId); // LOST -> durable event
    const plan = await world.planner.plan({
      lost_lease_id: leaseId,
      verified_failure: { observationId: 'obs-p15b-verified-body-failure-02', detail: 'verified failure mid-task' },
    });
    await world.broker.suspendBody(FIRST_BODY, 'verified failure mid-task');
    const recovery = await world.runtime.executeRecoveryPlan(plan, 'verified failure mid-task');
    expect(recovery.status).toBe('REPLACED');
    const replacementBody = recovery.status === 'REPLACED' ? recovery.replacement_body_id : FIRST_BODY;
    world.beats.beat(replacementBody, world.clock.nowEpochMs());
    world.clock.advance(1_000);
    const resumed = await world.runtime.runProgram(TASK_ID, { fromCheckpoint: 'cp-0002' });
    expect(resumed.stop_reason).toBe('COMPLETED');
    const verification = verifyTranscript(world, TASK_ID, [
      ...(await world.runtime.completionEvidenceOf(TASK_ID, 'cp-0002')),
      ...resumed.outcomes,
    ]);
    world.clock.advance(1_000);
    await world.runtime.completeTask(TASK_ID, verification.record, verification.verificationId);

    // The replayable timeline: every category of the journey is present.
    const timeline = await world.timeline.replay(TASK_ID);
    const categories = new Set(timeline.map((entry) => entry.category));
    expect(categories.has('heartbeat')).toBe(true); // lease.suspected + lease.lost
    expect(categories.has('recovery')).toBe(true); // task.body-replaced
    expect(categories.has('checkpoint')).toBe(true);
    expect(timeline.some((entry) => entry.detail.includes('task.completed'))).toBe(true); // the durable completion event

    // The honest UNKNOWN verdict preceded the verified LOST verdict, which
    // preceded the completion (deterministic (at, event_id) ordering).
    const suspectedIndex = timeline.findIndex((entry) => entry.event_id.includes('lease') && entry.detail.includes('lease.suspected'));
    const lostIndex = timeline.findIndex((entry) => entry.detail.includes('lease.lost'));
    const completionIndex = timeline.findIndex((entry) => entry.detail.includes('task.completed'));
    expect(suspectedIndex).toBeGreaterThan(-1);
    expect(lostIndex).toBeGreaterThan(suspectedIndex);
    expect(completionIndex).toBeGreaterThan(lostIndex);

    // The heartbeat entries carry the truthful UNKNOWN marker.
    const suspectedEntries = timeline.filter((entry) => entry.detail.includes('lease.suspected'));
    for (const entry of suspectedEntries) {
      expect(entry.detail).toContain('UNKNOWN');
    }
  });
});
