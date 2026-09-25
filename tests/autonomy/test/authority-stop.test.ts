/**
 * ACCEPTANCE SUITE 3 — AUTHORITY STOPS EXECUTION (Work Order P12, pinned).
 *
 * "expired/revoked authority stops execution" on BOTH authority
 * surfaces, fail-closed with typed denials:
 *   (a) the P9 gateway lease actions: a revoked/never-held actor grant
 *       denies the lease action — no durable lease write, no assignment,
 *       execution never starts;
 *   (b) the P5 fabric execution gate: the task's CURRENT authority
 *       grant (re-evaluated at action time from the durable grants)
 *       expired/revoked -> every operation is a typed DENIAL and the
 *       engine stops fail-closed.
 */

import { describe, expect, it } from 'vitest';
import { createAutonomyWorld, seedWorld, startAcceptanceTask, FIRST_BODY, TARGET_SHA, RUNTIME_ACTOR, HUMAN_ACTOR, acceptanceProgram } from './world.js';

describe('P12 acceptance: expired/revoked authority stops execution (fail closed)', () => {
  it('a revoked GATEWAY grant denies the lease action: no lease write, no assignment, execution never starts', async () => {
    const world = createAutonomyWorld();
    await seedWorld(world);
    // Revoke the runtime actor's standing body-lifecycle grant BEFORE the lease action.
    const grantId = world.authority.grant(RUNTIME_ACTOR.id, 'body-lifecycle', '*');
    world.authority.revoke(grantId);

    const outcome = await world.leaseActions.grantLease({
      task_id: 'task-revoked',
      body_id: FIRST_BODY,
      actor: RUNTIME_ACTOR,
      targetSha: TARGET_SHA,
      sequence: 1,
    });
    expect(outcome.status).toBe('DENIED');
    if (outcome.status === 'DENIED') {
      expect(outcome.denial.reason).toBe('ACTION_AUTHORITY_DENIED');
    }
    // No durable lease was written.
    const leases = await world.store.bodyLeases.list({ limit: null });
    expect(leases.items.filter((lease) => lease.task_ref === 'task-revoked').length).toBe(0);
  });

  it('startTask under a revoked gateway grant refuses to assign (typed DENIED outcome)', async () => {
    const world = createAutonomyWorld();
    await seedWorld(world);
    const grantId = world.authority.grant(RUNTIME_ACTOR.id, 'body-lifecycle', '*');
    world.authority.revoke(grantId);
    const started = await startAcceptanceTask(world, 'task-start-denied');
    expect(started.status).toBe('DENIED');
    // The node exists PENDING (durable), but no lease and no assignment: execution never started.
    const record = await world.store.tasks.get('task-start-denied');
    expect(record!.status).toBe('QUEUED');
    expect(record!.body_lease_ref).toBeNull();
  });

  it('an EXPIRED task authority grant denies every fabric operation (typed DENIAL, engine stops fail-closed)', async () => {
    // The task's grant_refs resolve at action time against the durable
    // grant store: a grant already expired at world start denies execution.
    const world = createAutonomyWorld({ grantDurationMs: -1_000 });
    await seedWorld(world);
    const started = await startAcceptanceTask(world, 'task-expired-grant');
    // The lease action runs on the GATEWAY authority (still granted) — the
    // task starts; the FABRIC's authority gate then denies every operation.
    expect(started.status).toBe('STARTED');
    const transcript = await world.runtime.runProgram('task-expired-grant');
    expect(transcript.stop_reason).toBe('DENIED');
    expect(transcript.outcomes[0]!.outcome).toBe('DENIED');
    // Fail closed: NOTHING ran (zero successful operations).
    const ok = transcript.outcomes.filter((entry) => entry.outcome === 'OK');
    expect(ok.length).toBe(0);
  });

  it('an expired gateway grant denies lease RENEWAL (a revoked authority stops execution mid-life too)', async () => {
    const world = createAutonomyWorld();
    await seedWorld(world);
    const started = await startAcceptanceTask(world, 'task-renew-denied');
    expect(started.status).toBe('STARTED');
    const leaseId = started.status === 'STARTED' ? started.lease_id : '';

    // Expire the runtime actor's gateway grant (clock past expiry).
    const grantId = world.authority.grant(RUNTIME_ACTOR.id, 'body-lifecycle', '*', { expiresAt: world.clock.nowEpochMs() + 1_000 });
    world.clock.advance(2_000);

    const renewed = await world.leaseActions.renewLease({
      task_id: 'task-renew-denied',
      body_id: FIRST_BODY,
      actor: RUNTIME_ACTOR,
      targetSha: TARGET_SHA,
      sequence: 2,
      current_lease_id: leaseId,
    });
    expect(renewed.status).toBe('DENIED');
    // The original lease was NOT released (the renewal never ran).
    const lease = await world.store.bodyLeases.get(leaseId);
    expect(lease!.state).toBe('ACTIVE');
  });

  it('a never-held actor grant is a typed denial (never-held == revoked for the fail-closed gate)', async () => {
    const world = createAutonomyWorld();
    await seedWorld(world);
    const outcome = await world.leaseActions.grantLease({
      task_id: 'task-never-held',
      body_id: FIRST_BODY,
      actor: { kind: 'human', id: 'nobody' },
      targetSha: TARGET_SHA,
      sequence: 1,
    });
    expect(outcome.status).toBe('DENIED');
    if (outcome.status === 'DENIED') {
      expect(outcome.denial.reason).toBe('ACTION_AUTHORITY_DENIED');
    }
  });

  it('cancellation through the action surface is also authority-gated (no bypass of the P9 surface)', async () => {
    const world = createAutonomyWorld();
    await seedWorld(world);
    const started = await startAcceptanceTask(world, 'task-cancel-gated');
    expect(started.status).toBe('STARTED');
    // An actor with NO body-lifecycle grant cannot cancel through the surface.
    const denied = await world.runtime.cancelTask('task-cancel-gated', {
      actor: { kind: 'human', id: 'stranger' },
      targetSha: TARGET_SHA,
      reason: 'unauthorized attempt',
    });
    expect(denied.status).toBe('DENIED');
    // The task was NOT cancelled (fail closed).
    const record = await world.store.tasks.get('task-cancel-gated');
    expect(record!.status).toBe('RUNNING');
    // The authorized human CAN.
    const allowed = await world.runtime.cancelTask('task-cancel-gated', {
      actor: HUMAN_ACTOR,
      targetSha: TARGET_SHA,
      reason: 'operator cancellation',
    });
    expect(allowed.status).toBe('CANCELLED');
  });

  it('acceptance program shape sanity (the fixture itself is a typed worker program)', () => {
    const program = acceptanceProgram();
    expect(program.steps.length).toBe(11);
    expect(program.steps.filter((step) => (step as { kind: string }).kind === 'checkpoint').length).toBe(4);
  });
});
