/**
 * ACCEPTANCE SUITE 5 — REPLACEMENT IDENTITY (Work Order P12, pinned).
 *
 * "body replacement preserves task/artifact identity; in-flight side
 * effects are reconciled": the replacement inherits the same task id,
 * mission link, authority context, owned revisions and the full durable
 * checkpoint chain; the artifacts the durable store proves are carried
 * on the plan; the un-checkpointed in-flight work is RE-EXECUTED from
 * the last verified checkpoint (reconciled, never assumed); the
 * replacement body is a DIFFERENT body under a NEW single-use lease.
 */

import { describe, expect, it } from 'vitest';
import { createAutonomyWorld, seedWorld, startAcceptanceTask, FIRST_BODY, MISSED_BEAT_WINDOW_MS, verifyTranscript } from './world.js';
import { formatRfc3339 } from '@sos-2/live-store';

describe('P12 acceptance: body replacement preserves task/artifact identity', () => {
  it('identity fields survive the replacement verbatim (task id, mission, authority, revisions, checkpoints)', async () => {
    const world = createAutonomyWorld();
    await seedWorld(world);
    const started = await startAcceptanceTask(world, 'task-identity');
    expect(started.status).toBe('STARTED');
    const leaseId = started.status === 'STARTED' ? started.lease_id : '';
    world.beats.beat(FIRST_BODY, world.clock.nowEpochMs());

    // Run to a mid-task kill (after two checkpoints).
    await world.runtime.runProgram('task-identity', { interrupt: (index) => (index === 5 ? 'KILL' : 'CONTINUE') });
    // The mid-run durable state: the checkpoint chain the replacement must inherit.
    const mid = (await world.store.tasks.get('task-identity'))!;
    expect(mid.checkpoints.map((entry) => entry.checkpoint_id)).toEqual(['cp-0001', 'cp-0002']);

    world.beats.forgetBody(FIRST_BODY);
    world.clock.advance(MISSED_BEAT_WINDOW_MS + 1);
    world.failures.record({
      bodyId: FIRST_BODY,
      observationId: 'obs-verified-crash-identity',
      observedAt: formatRfc3339(world.clock.nowEpochMs()),
      detail: 'verified crash for the identity suite',
    });
    const plan = await world.planner.plan({
      lost_lease_id: leaseId,
      verified_failure: { observationId: 'obs-verified-crash-identity', detail: 'verified crash for the identity suite' },
    });
    world.broker.suspendBody(FIRST_BODY, 'verified crash for the identity suite');
    const recovery = await world.runtime.executeRecoveryPlan(plan, 'verified crash for the identity suite');
    expect(recovery.status).toBe('REPLACED');
    if (recovery.status !== 'REPLACED') return;

    const after = (await world.store.tasks.get('task-identity'))!;
    // IDENTITY: the same task record (identity preserved, never restarted).
    expect(after.task_id).toBe(mid.task_id);
    expect(after.mission_ref).toBe(mid.mission_ref);
    expect(after.authority_context.grant_refs).toEqual(mid.authority_context.grant_refs);
    expect(after.owned_revision).toEqual(mid.owned_revision);
    // The CHECKPOINT CHAIN is preserved (the replacement inherits it).
    expect(after.checkpoints.map((entry) => entry.checkpoint_id)).toEqual(mid.checkpoints.map((entry) => entry.checkpoint_id));
    // The replacement is a DIFFERENT body under a NEW lease; the old lease ended.
    expect(recovery.replacement_body_id).not.toBe(FIRST_BODY);
    expect(recovery.new_lease_id).not.toBe(leaseId);
    expect(after.body_lease_ref).toBe(recovery.new_lease_id);
    const ended = await world.store.bodyLeases.get(leaseId);
    expect(ended!.state).not.toBe('ACTIVE');
  });

  it('in-flight side effects are RECONCILED by re-execution from the checkpoint (identical final artifacts)', async () => {
    // The un-interrupted reference run.
    const worldA = createAutonomyWorld();
    await seedWorld(worldA);
    await startAcceptanceTask(worldA, 'task-reconcile');
    worldA.beats.beat(FIRST_BODY, worldA.clock.nowEpochMs());
    const uninterrupted = await worldA.runtime.runProgram('task-reconcile');
    expect(uninterrupted.stop_reason).toBe('COMPLETED');
    const referenceArtifacts = (await worldA.store.tasks.get('task-reconcile'))!.artifacts.map((entry) => entry.content_hash);

    // The killed run: the step at index 4 executed but was NEVER
    // checkpointed (the last checkpoint covers steps 0..3) — the
    // replacement re-executes it (reconciliation by re-execution).
    const worldB = createAutonomyWorld();
    await seedWorld(worldB);
    const startedB = await startAcceptanceTask(worldB, 'task-reconcile');
    const leaseId = startedB.status === 'STARTED' ? startedB.lease_id : '';
    worldB.beats.beat(FIRST_BODY, worldB.clock.nowEpochMs());
    const killed = await worldB.runtime.runProgram('task-reconcile', { interrupt: (index) => (index === 5 ? 'KILL' : 'CONTINUE') });
    expect(killed.stop_reason).toBe('INTERRUPTED');

    worldB.failures.record({
      bodyId: FIRST_BODY,
      observationId: 'obs-verified-crash-reconcile',
      observedAt: formatRfc3339(worldB.clock.nowEpochMs()),
      detail: 'verified crash mid-flight (un-checkpointed side effect pending)',
    });
    const lost = await worldB.supervisor.supervise(leaseId);
    expect(lost.state).toBe('LOST');
    const plan = await worldB.planner.plan({
      lost_lease_id: leaseId,
      verified_failure: { observationId: 'obs-verified-crash-reconcile', detail: 'verified crash mid-flight' },
    });
    // The plan carries the honestly-unknown in-flight effects.
    expect(plan.unknown_until_reverified.join(' ')).toContain('in-flight');
    worldB.broker.suspendBody(FIRST_BODY, 'verified crash mid-flight');
    const recovery = await worldB.runtime.executeRecoveryPlan(plan, 'verified crash mid-flight');
    expect(recovery.status).toBe('REPLACED');

    const resumed = await worldB.runtime.runProgram('task-reconcile', { fromCheckpoint: 'cp-0002' });
    expect(resumed.stop_reason).toBe('COMPLETED');
    // Reconciliation: the re-executed step produced the IDENTICAL durable effect.
    const prior = await worldB.runtime.completionEvidenceOf('task-reconcile', 'cp-0002');
    const combined = [...prior, ...resumed.outcomes];
    expect(combined.length).toBe(uninterrupted.outcomes.length);
    for (let index = 0; index < combined.length; index += 1) {
      expect(combined[index]!.index).toBe(uninterrupted.outcomes[index]!.index);
      expect(combined[index]!.outcome).toBe(uninterrupted.outcomes[index]!.outcome);
      expect(JSON.stringify(combined[index]!.output)).toBe(JSON.stringify(uninterrupted.outcomes[index]!.output));
    }

    // Completion with the independent verdict; the artifacts match the reference run.
    const verification = verifyTranscript(worldB, 'task-reconcile', combined);
    expect(verification.record.verified).toBe(true);
    await worldB.runtime.completeTask('task-reconcile', verification.record, verification.verificationId);
    const after = (await worldB.store.tasks.get('task-reconcile'))!;
    expect(after.status).toBe('COMPLETED');
    expect(after.artifacts.map((entry) => entry.content_hash)).toEqual(referenceArtifacts);
  });
});
