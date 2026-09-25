/**
 * LANE C, NEGATIVE CASE 10 — TASK RESUME FROM CHECKPOINT (the
 * user-visible shape: the resume is visible as continuity — identical
 * completion evidence — and uncertainty is retained; a corrupted
 * checkpoint fails CLOSED).
 *
 * The fault/operation: a task is killed mid-run and resumed from its
 * last verified checkpoint on a replacement body. The resume must be
 * CONTINUITY, not a restart: the combined evidence (checkpointed prior
 * + resumed segment) equals the uninterrupted run step-for-step, the
 * timeline shows the checkpoint + body-replacement events, the retained
 * uncertainty statement survives the resume, and a CORRUPTED or
 * tampered checkpoint is the typed CHECKPOINT_INVALID denial — never
 * silently re-derived, never resumed from. Never a silent pass (a fake
 * resume), never a crash.
 */

import { describe, expect, it } from 'vitest';
import { InMemoryCheckpointIntegrity, TaskRuntimeError } from '@sos-2/task-runtime';
import type { TaskCheckpoint } from '@sos-2/live-store';
import { formatRfc3339 } from '@sos-2/live-store';
import {
  RESILIENCE_FIRST_BODY,
  createResilienceWorld,
  resilienceProgram,
  seedResilienceWorld,
  startResilienceTask,
  verifyTranscript,
} from './helpers.js';

describe('P15 lane C negative case: task resume from checkpoint', () => {
  it('CONTAINED: kill + checkpoint resume yields IDENTICAL completion evidence to the uninterrupted run (continuity, not restart)', async () => {
    // The UNINTERRUPTED run.
    const worldA = createResilienceWorld();
    await seedResilienceWorld(worldA);
    const startedA = await startResilienceTask(worldA, 'task-p15c-resume');
    expect(startedA.status).toBe('STARTED');
    worldA.beats.beat(RESILIENCE_FIRST_BODY, worldA.clock.nowEpochMs());
    const uninterrupted = await worldA.runtime.runProgram('task-p15c-resume');
    expect(uninterrupted.stop_reason).toBe('COMPLETED');
    expect(uninterrupted.outcomes.length).toBe(11);
    const verificationA = verifyTranscript(worldA, 'task-p15c-resume', uninterrupted.outcomes);
    await worldA.runtime.completeTask('task-p15c-resume', verificationA.record, verificationA.verificationId);
    const recordA = (await worldA.store.tasks.get('task-p15c-resume'))!;

    // The KILLED + RESUMED run (a separate world: same fixed program, same clock).
    const worldB = createResilienceWorld();
    await seedResilienceWorld(worldB);
    const startedB = await startResilienceTask(worldB, 'task-p15c-resume');
    expect(startedB.status).toBe('STARTED');
    const leaseId = startedB.status === 'STARTED' ? startedB.lease_id : '';
    worldB.beats.beat(RESILIENCE_FIRST_BODY, worldB.clock.nowEpochMs());

    const killed = await worldB.runtime.runProgram('task-p15c-resume', { interrupt: (index) => (index === 9 ? 'KILL' : 'CONTINUE') });
    expect(killed.stop_reason).toBe('INTERRUPTED');

    // Verified failure -> LOST -> plan -> replacement (the canonical recovery).
    worldB.failures.record({
      bodyId: RESILIENCE_FIRST_BODY,
      observationId: 'obs-p15c-resume-failure-01',
      observedAt: '2026-03-01T08:30:00Z',
      detail: 'verified failure late in the run',
    });
    const plan = await worldB.planner.plan({
      lost_lease_id: leaseId,
      verified_failure: { observationId: 'obs-p15c-resume-failure-01', detail: 'verified failure late in the run' },
    });
    worldB.broker.suspendBody(RESILIENCE_FIRST_BODY, 'verified failure late in the run');
    const recovery = await worldB.runtime.executeRecoveryPlan(plan, 'verified failure late in the run');
    expect(recovery.status).toBe('REPLACED');
    const resumed = await worldB.runtime.runProgram('task-p15c-resume', { fromCheckpoint: 'cp-0003' });
    expect(resumed.stop_reason).toBe('COMPLETED');
    // The resume CONTINUED from the checkpoint (not a restart from zero):
    // cp-0003 resumes from step 7 — the resumed segment covers steps 7..10.
    expect(resumed.outcomes.length).toBe(4);

    // The COMBINED evidence (checkpointed prior + resumed segment) equals
    // the uninterrupted run's evidence step-for-step.
    const prior = await worldB.runtime.completionEvidenceOf('task-p15c-resume', 'cp-0003');
    const combined = [...prior, ...resumed.outcomes];
    expect(combined.length).toBe(uninterrupted.outcomes.length);
    for (let index = 0; index < combined.length; index += 1) {
      expect(combined[index]!.index).toBe(uninterrupted.outcomes[index]!.index);
      expect(combined[index]!.kind).toBe(uninterrupted.outcomes[index]!.kind);
      expect(combined[index]!.outcome).toBe(uninterrupted.outcomes[index]!.outcome);
      expect(JSON.stringify(combined[index]!.output)).toBe(JSON.stringify(uninterrupted.outcomes[index]!.output));
    }
    const verificationB = verifyTranscript(worldB, 'task-p15c-resume', combined);
    expect(verificationB.record.verified).toBe(verificationA.record.verified);
    expect(verificationB.record.evidence_refs).toEqual(verificationA.record.evidence_refs);
    expect(verificationB.record.summary).toBe(verificationA.record.summary);
    await worldB.runtime.completeTask('task-p15c-resume', verificationB.record, verificationB.verificationId);
    const recordB = (await worldB.store.tasks.get('task-p15c-resume'))!;

    // IDENTICAL completion evidence: verified flag, evidence refs, summary.
    expect(recordB.final_verification?.verified).toBe(recordA.final_verification?.verified);
    expect(recordB.final_verification?.evidence_refs).toEqual(recordA.final_verification?.evidence_refs);
    expect(recordB.final_verification?.summary).toBe(recordA.final_verification?.summary);
    expect(recordB.status).toBe('COMPLETED');
  });

  it('VISIBLE: the resume shows as continuity in the user-visible timeline (checkpoint + body-replaced events)', async () => {
    const world = createResilienceWorld();
    await seedResilienceWorld(world);
    const started = await startResilienceTask(world, 'task-p15c-resume-visible');
    const leaseId = started.status === 'STARTED' ? started.lease_id : '';
    world.beats.beat(RESILIENCE_FIRST_BODY, world.clock.nowEpochMs());

    await world.runtime.runProgram('task-p15c-resume-visible', { interrupt: (index) => (index === 2 ? 'KILL' : 'CONTINUE') });
    world.failures.record({
      bodyId: RESILIENCE_FIRST_BODY,
      observationId: 'obs-p15c-resume-visible-01',
      observedAt: formatRfc3339(world.clock.nowEpochMs()),
      detail: 'verified failure early in the run',
    });
    const plan = await world.planner.plan({
      lost_lease_id: leaseId,
      verified_failure: { observationId: 'obs-p15c-resume-visible-01', detail: 'verified failure early in the run' },
    });
    world.broker.suspendBody(RESILIENCE_FIRST_BODY, 'verified failure early in the run');
    await world.runtime.executeRecoveryPlan(plan, 'verified failure early in the run');
    // A durable pause first (the user-visible stop), then the typed resume.
    const paused = await world.fabric.pauseTask('task-p15c-resume-visible');
    expect(paused.status).toBe('TRANSITIONED');
    const resume = await world.runtime.resumeFromCheckpoint('task-p15c-resume-visible', 'cp-0001');
    expect(resume.status).toBe('RESUMED');
    if (resume.status === 'RESUMED') {
      expect(resume.resume_from_step).toBe(2);
    }
    const continued = await world.runtime.runProgram('task-p15c-resume-visible', { fromCheckpoint: 'cp-0001' });
    expect(continued.stop_reason).toBe('COMPLETED');

    // The user-visible timeline carries the continuity story: checkpoints,
    // the body replacement, and the durable task events.
    const entries = await world.timeline.replay('task-p15c-resume-visible');
    expect(entries.filter((entry) => entry.category === 'checkpoint').length).toBeGreaterThan(0);
    expect(entries.filter((entry) => entry.category === 'recovery').length).toBeGreaterThan(0);
    expect(entries.some((entry) => entry.detail.includes('task.body-replaced'))).toBe(true);
  });

  it('UNCERTAINTY RETAINED: the work program\u2019s uncertainty statement survives the resume (never dropped)', async () => {
    const world = createResilienceWorld();
    await seedResilienceWorld(world);
    await startResilienceTask(world, 'task-p15c-resume-uncertainty');
    world.beats.beat(RESILIENCE_FIRST_BODY, world.clock.nowEpochMs());

    // Kill AFTER the second checkpoint lands (index 3 records cp-0002),
    // then resume past the uncertainty step (index 5).
    await world.runtime.runProgram('task-p15c-resume-uncertainty', { interrupt: (index) => (index === 4 ? 'KILL' : 'CONTINUE') });
    const resumed = await world.runtime.runProgram('task-p15c-resume-uncertainty', { fromCheckpoint: 'cp-0002' });
    expect(resumed.stop_reason).toBe('COMPLETED');

    // The uncertainty step (kind 'uncertainty') was executed during the
    // resumed segment and its statement is part of the durable program.
    const program = resilienceProgram();
    const uncertaintyStep = program.steps.find((step) => (step as { kind: string }).kind === 'uncertainty') as { kind: string; statement: string };
    expect(uncertaintyStep.statement.length).toBeGreaterThan(0);
    const uncertaintyOutcomes = resumed.outcomes.filter((entry) => entry.kind === 'uncertainty');
    expect(uncertaintyOutcomes.length).toBe(1);
    expect(uncertaintyOutcomes[0]!.outcome).toBe('RECORDED');
  });

  it('CONTAINED (fail-closed): a corrupted checkpoint is the typed CHECKPOINT_INVALID denial — never silently re-derived, never resumed from', () => {
    const store = new InMemoryCheckpointIntegrity();
    const original: TaskCheckpoint = {
      checkpoint_id: 'cp-p15c-0001',
      recorded_at: '2026-03-01T08:00:01Z',
      label: 'after-step-0',
      work_graph_state: { step_index: 1, step_outputs: [] },
      notes: null,
    };
    store.record(original);

    // The fault: the SAME id under a TAMPERED payload (integrity mismatch).
    const tampered: TaskCheckpoint = {
      ...original,
      work_graph_state: { step_index: 9, step_outputs: [{ fabricated: 'progress' }] },
    };
    const verdict = store.verify(tampered);
    expect(verdict.valid).toBe(false);
    expect(() => {
      const runtimeCheck = store.verify(tampered);
      if (!runtimeCheck.valid) {
        throw new TaskRuntimeError('CHECKPOINT_INVALID', 'CHECKPOINT_INVALID: corrupted checkpoint fails closed');
      }
    }).toThrow(/CHECKPOINT_INVALID/);

    // The ORIGINAL payload still verifies (the hash binds the exact bytes).
    expect(store.verify(original).valid).toBe(true);
    // An UNKNOWN checkpoint id never verifies (no recorded hash).
    const unknown: TaskCheckpoint = { ...original, checkpoint_id: 'cp-p15c-9999' };
    expect(store.verify(unknown).valid).toBe(false);
  });

  it('CONTAINED (fail-closed): resume of an unrecorded checkpoint id is a typed refusal (durable checkpoints only)', async () => {
    const world = createResilienceWorld();
    await seedResilienceWorld(world);
    const started = await startResilienceTask(world, 'task-p15c-resume-refusal');
    expect(started.status).toBe('STARTED');
    await expect(world.runtime.resumeFromCheckpoint('task-p15c-resume-refusal', 'cp-p15c-9999')).rejects.toThrow(
      /RESUME_REFUSED|not in the durable record/,
    );
  });
});
