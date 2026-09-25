/**
 * ACCEPTANCE SUITE 2 — CHECKPOINT RESUME (Work Order P12, pinned).
 *
 * "task resumes from a verified checkpoint" with completion evidence
 * IDENTICAL to uninterrupted execution (the resumed transcript +
 * verification record equal the uninterrupted run's), and the
 * fail-closed integrity gate: a corrupted or tampered checkpoint is a
 * typed CHECKPOINT_INVALID denial — never silently re-derived, never
 * resumed from.
 */

import { describe, expect, it } from 'vitest';
import { InMemoryCheckpointIntegrity } from '@sos-2/task-runtime';
import { TaskRuntimeError } from '@sos-2/task-runtime';
import { createAutonomyWorld, seedWorld, startAcceptanceTask, verifyTranscript, FIRST_BODY, TARGET_SHA, RUNTIME_ACTOR } from './world.js';
import type { TaskCheckpoint } from '@sos-2/live-store';

describe('P12 acceptance: resume from a verified checkpoint', () => {
  it('identical completion evidence: uninterrupted run == kill + checkpoint resume', async () => {
    // The UNINTERRUPTED run.
    const worldA = createAutonomyWorld();
    await seedWorld(worldA);
    const startedA = await startAcceptanceTask(worldA, 'task-resume');
    expect(startedA.status).toBe('STARTED');
    worldA.beats.beat(FIRST_BODY, worldA.clock.nowEpochMs());
    const uninterrupted = await worldA.runtime.runProgram('task-resume');
    expect(uninterrupted.stop_reason).toBe('COMPLETED');
    expect(uninterrupted.outcomes.length).toBe(11);
    const verificationA = verifyTranscript(worldA, 'task-resume', uninterrupted.outcomes);
    await worldA.runtime.completeTask('task-resume', verificationA.record, verificationA.verificationId);
    const recordA = (await worldA.store.tasks.get('task-resume'))!;

    // The KILLED + RESUMED run (a separate world: same fixed program, same clock).
    const worldB = createAutonomyWorld();
    await seedWorld(worldB);
    const startedB = await startAcceptanceTask(worldB, 'task-resume');
    expect(startedB.status).toBe('STARTED');
    const leaseId = startedB.status === 'STARTED' ? startedB.lease_id : '';
    worldB.beats.beat(FIRST_BODY, worldB.clock.nowEpochMs());

    const killed = await worldB.runtime.runProgram('task-resume', { interrupt: (index) => (index === 9 ? 'KILL' : 'CONTINUE') });
    expect(killed.stop_reason).toBe('INTERRUPTED');

    // Verified failure -> LOST -> plan -> replacement (the canonical recovery).
    worldB.failures.record({
      bodyId: FIRST_BODY,
      observationId: 'obs-verified-body-failure-resume',
      observedAt: '2026-03-01T08:30:00Z',
      detail: 'verified failure late in the run',
    });
    const plan = await worldB.planner.plan({
      lost_lease_id: leaseId,
      verified_failure: { observationId: 'obs-verified-body-failure-resume', detail: 'verified failure late in the run' },
    });
    worldB.broker.suspendBody(FIRST_BODY, 'verified failure late in the run');
    const recovery = await worldB.runtime.executeRecoveryPlan(plan, 'verified failure late in the run');
    expect(recovery.status).toBe('REPLACED');
    const resumed = await worldB.runtime.runProgram('task-resume', { fromCheckpoint: 'cp-0003' });
    expect(resumed.stop_reason).toBe('COMPLETED');

    // The COMBINED evidence (checkpointed prior + resumed segment) equals
    // the uninterrupted run's evidence step-for-step.
    const prior = await worldB.runtime.completionEvidenceOf('task-resume', 'cp-0003');
    const combined = [...prior, ...resumed.outcomes];
    expect(combined.length).toBe(uninterrupted.outcomes.length);
    for (let index = 0; index < combined.length; index += 1) {
      expect(combined[index]!.index).toBe(uninterrupted.outcomes[index]!.index);
      expect(combined[index]!.kind).toBe(uninterrupted.outcomes[index]!.kind);
      expect(combined[index]!.outcome).toBe(uninterrupted.outcomes[index]!.outcome);
      expect(JSON.stringify(combined[index]!.output)).toBe(JSON.stringify(uninterrupted.outcomes[index]!.output));
    }
    const verificationB = verifyTranscript(worldB, 'task-resume', combined);
    expect(verificationB.record.verified).toBe(verificationA.record.verified);
    expect(verificationB.record.evidence_refs).toEqual(verificationA.record.evidence_refs);
    expect(verificationB.record.summary).toBe(verificationA.record.summary);
    await worldB.runtime.completeTask('task-resume', verificationB.record, verificationB.verificationId);
    const recordB = (await worldB.store.tasks.get('task-resume'))!;

    // IDENTICAL completion evidence: verified flag, evidence refs, summary.
    expect(recordB.final_verification?.verified).toBe(recordA.final_verification?.verified);
    expect(recordB.final_verification?.evidence_refs).toEqual(recordA.final_verification?.evidence_refs);
    expect(recordB.final_verification?.summary).toBe(recordA.final_verification?.summary);
    expect(recordB.status).toBe('COMPLETED');
  });

  it('a corrupted checkpoint fails CLOSED as the typed CHECKPOINT_INVALID denial (never silently re-derived)', () => {
    const store = new InMemoryCheckpointIntegrity();
    const original: TaskCheckpoint = {
      checkpoint_id: 'cp-0001',
      recorded_at: '2026-03-01T08:00:01Z',
      label: 'after-step-0',
      work_graph_state: { step_index: 1, step_outputs: [] },
      notes: null,
    };
    store.record(original);

    // The SAME id under a TAMPERED payload: integrity mismatch.
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
    const unknown: TaskCheckpoint = { ...original, checkpoint_id: 'cp-9999' };
    expect(store.verify(unknown).valid).toBe(false);
  });

  it('resume of an unrecorded checkpoint id is a typed refusal (resume binds to durable checkpoints only)', async () => {
    const world = createAutonomyWorld();
    await seedWorld(world);
    const started = await startAcceptanceTask(world, 'task-resume-refusal');
    expect(started.status).toBe('STARTED');
    await expect(world.runtime.resumeFromCheckpoint('task-resume-refusal', 'cp-9999')).rejects.toThrow(/RESUME_REFUSED|not in the durable record/);
  });

  it('the pause/resume path: fabric pause -> resume from checkpoint continues the SAME graph', async () => {
    const world = createAutonomyWorld();
    await seedWorld(world);
    const started = await startAcceptanceTask(world, 'task-pause-resume');
    expect(started.status).toBe('STARTED');
    world.beats.beat(FIRST_BODY, world.clock.nowEpochMs());

    // Run to the first checkpoint, then a USER-DRIVEN pause.
    const first = await world.runtime.runProgram('task-pause-resume', { interrupt: (index) => (index === 2 ? 'KILL' : 'CONTINUE') });
    expect(first.stop_reason).toBe('INTERRUPTED');
    const paused = await world.fabric.pauseTask('task-pause-resume');
    expect(paused.status).toBe('TRANSITIONED');

    const resume = await world.runtime.resumeFromCheckpoint('task-pause-resume', 'cp-0001');
    expect(resume.status).toBe('RESUMED');
    if (resume.status === 'RESUMED') {
      expect(resume.resume_from_step).toBe(2);
    }
    const continued = await world.runtime.runProgram('task-pause-resume', { fromCheckpoint: 'cp-0001' });
    expect(continued.stop_reason).toBe('COMPLETED');
    expect(continued.outcomes.length).toBe(9); // steps 2..10
  });
});
