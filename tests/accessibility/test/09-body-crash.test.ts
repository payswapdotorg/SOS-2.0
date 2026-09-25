/**
 * LANE C, NEGATIVE CASE 09 — BODY CRASH (the user-visible shape: the
 * crash is visible as an event, the task survives, uncertainty is
 * retained; death is never inferred from silence).
 *
 * The fault: the body executing a durable task crashes mid-run (an
 * injected kill) and then stops beating. The supervision discipline:
 * withheld beats are SUSPECTED (truthful UNKNOWN — a missing beat is
 * NOT evidence of death); ONLY a VERIFIED failure observation
 * transitions the lease to LOST; the recovery plan retains what only
 * the replacement can re-verify (uncertainty retained); the crash is
 * visible as typed durable events the user can replay (the task
 * timeline); and the task NEVER completes without independent
 * verification. Never a silent pass, never a crash of the system.
 */

import { describe, expect, it } from 'vitest';
import { formatRfc3339 } from '@sos-2/live-store';
import {
  MISSED_BEAT_WINDOW_MS,
  RESILIENCE_FIRST_BODY,
  createResilienceWorld,
  seedResilienceWorld,
  startResilienceTask,
} from './helpers.js';

const VERIFIED_FAILURE_ID = 'obs-p15c-verified-body-crash-01';
const VERIFIED_FAILURE_DETAIL = 'the cloud provider attested the body crashed (verified failure observation)';

describe('P15 lane C negative case: body crash', () => {
  it('DETECTED: the kill leaves the durable record intact (identity, checkpoints, authority — the task is never lost)', async () => {
    const world = createResilienceWorld();
    await seedResilienceWorld(world);
    const started = await startResilienceTask(world, 'task-p15c-crash');
    expect(started.status).toBe('STARTED');
    const leaseId = started.status === 'STARTED' ? started.lease_id : '';

    world.beats.beat(RESILIENCE_FIRST_BODY, world.clock.nowEpochMs());
    const healthy = await world.supervisor.supervise(leaseId);
    expect(healthy.state).toBe('HEALTHY');

    // THE CRASH: interrupt the run mid-task (step index 5).
    const transcript = await world.runtime.runProgram('task-p15c-crash', { interrupt: (index) => (index === 5 ? 'KILL' : 'CONTINUE') });
    expect(transcript.stop_reason).toBe('INTERRUPTED');
    expect(transcript.stopped_at).toBe(5);

    // The crash did NOT lose the task: the durable record stands.
    const record = await world.store.tasks.get('task-p15c-crash');
    expect(record).toBeDefined();
    expect(record!.status).toBe('RUNNING');
    expect(record!.checkpoints.length).toBe(2);
    expect(record!.authority_context.grant_refs).toEqual([world.grant.envelope.id]);
  });

  it('DETECTED (truthful UNKNOWN): withheld beats are SUSPECTED, never LOST; only a VERIFIED failure transitions to LOST', async () => {
    const world = createResilienceWorld();
    await seedResilienceWorld(world);
    const started = await startResilienceTask(world, 'task-p15c-crash-silence');
    const leaseId = started.status === 'STARTED' ? started.lease_id : '';

    world.beats.beat(RESILIENCE_FIRST_BODY, world.clock.nowEpochMs());
    await world.runtime.runProgram('task-p15c-crash-silence', { interrupt: (index) => (index === 3 ? 'KILL' : 'CONTINUE') });

    // The body stops beating: SUSPECTED first (truthful UNKNOWN — never LOST).
    world.beats.forgetBody(RESILIENCE_FIRST_BODY);
    world.clock.advance(MISSED_BEAT_WINDOW_MS + 1_000);
    const suspected = await world.supervisor.supervise(leaseId);
    expect(suspected.state).toBe('SUSPECTED');
    expect(suspected.detail).toContain('UNKNOWN');

    // ONLY a verified failure observation transitions to LOST.
    world.failures.record({
      bodyId: RESILIENCE_FIRST_BODY,
      observationId: VERIFIED_FAILURE_ID,
      observedAt: formatRfc3339(world.clock.nowEpochMs()),
      detail: VERIFIED_FAILURE_DETAIL,
    });
    const lost = await world.supervisor.supervise(leaseId);
    expect(lost.state).toBe('LOST');
    expect(lost.verifiedFailure?.observationId).toBe(VERIFIED_FAILURE_ID);
  });

  it('VISIBLE: the crash is visible as typed durable events the user can replay (the task timeline)', async () => {
    const world = createResilienceWorld();
    await seedResilienceWorld(world);
    const started = await startResilienceTask(world, 'task-p15c-crash-visible');
    const leaseId = started.status === 'STARTED' ? started.lease_id : '';

    world.beats.beat(RESILIENCE_FIRST_BODY, world.clock.nowEpochMs());
    await world.runtime.runProgram('task-p15c-crash-visible', { interrupt: (index) => (index === 5 ? 'KILL' : 'CONTINUE') });
    world.beats.forgetBody(RESILIENCE_FIRST_BODY);
    world.clock.advance(MISSED_BEAT_WINDOW_MS + 1_000);
    await world.supervisor.supervise(leaseId); // emits the SUSPECTED observation
    world.failures.record({
      bodyId: RESILIENCE_FIRST_BODY,
      observationId: VERIFIED_FAILURE_ID,
      observedAt: formatRfc3339(world.clock.nowEpochMs()),
      detail: VERIFIED_FAILURE_DETAIL,
    });
    await world.supervisor.supervise(leaseId); // emits the LOST observation

    // The user-visible timeline replays the crash story as typed entries.
    const entries = await world.timeline.replay('task-p15c-crash-visible');
    expect(entries.length).toBeGreaterThan(0);
    const heartbeatEntries = entries.filter((entry) => entry.category === 'heartbeat');
    expect(heartbeatEntries.length).toBeGreaterThan(0);
    expect(entries.some((entry) => entry.detail.includes('lease.lost'))).toBe(true);
    for (const entry of entries) {
      expect(entry.event_id.length).toBeGreaterThan(0);
      expect(entry.at).toMatch(/^\d{4}-/);
    }
  });

  it('CONTAINED: the recovery plan retains what only the replacement can re-verify (uncertainty retained, never dropped)', async () => {
    const world = createResilienceWorld();
    await seedResilienceWorld(world);
    const started = await startResilienceTask(world, 'task-p15c-crash-plan');
    const leaseId = started.status === 'STARTED' ? started.lease_id : '';

    world.beats.beat(RESILIENCE_FIRST_BODY, world.clock.nowEpochMs());
    await world.runtime.runProgram('task-p15c-crash-plan', { interrupt: (index) => (index === 5 ? 'KILL' : 'CONTINUE') });
    world.failures.record({
      bodyId: RESILIENCE_FIRST_BODY,
      observationId: VERIFIED_FAILURE_ID,
      observedAt: formatRfc3339(world.clock.nowEpochMs()),
      detail: VERIFIED_FAILURE_DETAIL,
    });

    const plan = await world.planner.plan({
      lost_lease_id: leaseId,
      verified_failure: { observationId: VERIFIED_FAILURE_ID, detail: VERIFIED_FAILURE_DETAIL },
    });
    // Identity is preserved (the replacement inherits the SAME task).
    expect(plan.task_id).toBe('task-p15c-crash-plan');
    expect(plan.inheritance.task_id).toBe('task-p15c-crash-plan');
    // The uncertainty the crash created is RETAINED (in-flight side
    // effects stay honestly unknown until the replacement re-verifies).
    expect(plan.unknown_until_reverified.length).toBeGreaterThan(0);
    expect(plan.inheritance.unresolved_uncertainty).toBeDefined();
    // The last durable checkpoint is inherited.
    expect(plan.inheritance.resume_from_checkpoint?.checkpoint_id).toBe('cp-0002');
  });

  it('NO FABRICATED COMPLETION: the crashed task stays un-completed until the replacement runs AND an independent verification exists', async () => {
    const world = createResilienceWorld();
    await seedResilienceWorld(world);
    await startResilienceTask(world, 'task-p15c-crash-nocompletion');
    world.beats.beat(RESILIENCE_FIRST_BODY, world.clock.nowEpochMs());
    await world.runtime.runProgram('task-p15c-crash-nocompletion', { interrupt: (index) => (index === 4 ? 'KILL' : 'CONTINUE') });

    // After the crash (and BEFORE any replacement/verification): the
    // durable truth is RUNNING with NO final verification — never a
    // fabricated completion.
    const record = await world.store.tasks.get('task-p15c-crash-nocompletion');
    expect(record!.status).toBe('RUNNING');
    expect(record!.final_verification).toBeNull();
  });
});
