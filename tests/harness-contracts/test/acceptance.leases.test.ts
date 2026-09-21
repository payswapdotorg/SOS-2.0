/**
 * ACCEPTANCE: body lease expiry/revocation FAILS CLOSED (Work Order P5).
 *
 * An expired, revoked or released lease CANNOT authorize any operation:
 * every refusal is a typed denial, the harness NEVER dispatches (run-flag
 * proofs), and the durable lease truth is recomputed from the record +
 * the injected clock (the P2 discipline consumed verbatim).
 */

import { describe, expect, it } from 'vitest';
import { formatRfc3339 } from '@sos-2/live-store';
import { acceptanceWorld } from './acceptance-world.js';
import { T0 } from './acceptance-world.js';

describe('acceptance: body lease expiry/revocation fails closed', () => {
  it('an EXPIRED lease authorizes nothing — the operation never dispatches (run-flag proof)', async () => {
    const w = acceptanceWorld();
    const body = w.registerBody({ bodyId: 'body:leased', providerName: 'reference-body-vendor' });
    const task = await w.createTask({ task_id: 'task-lease-0001', leaseExpiresAt: T0 + 300_000 });

    // Before expiry: the operation runs.
    const before = await w.fabric.execute(task.task_id, { kind: 'shell.exec', command: 'echo', args: ['ok'], cwd: null });
    expect(before.status).toBe('EXECUTED');
    expect(body.dispatches.get('shell.exec')).toBe(1);

    // The clock passes the lease expiry: the durable record still says
    // ACTIVE, but the recomputed truth is EXPIRED — fail closed.
    w.clock.advance(301_000);
    const after = await w.fabric.execute(task.task_id, { kind: 'shell.exec', command: 'echo', args: ['denied'], cwd: null });
    expect(after.status).toBe('DENIED');
    if (after.status === 'DENIED') {
      expect(after.denial.code).toBe('LEASE_DENIED');
      expect(after.denial.reason).toContain('lease gate refused');
    }
    // The operation NEVER ran.
    expect(body.dispatches.get('shell.exec')).toBe(1);

    // Even the RESUME path refuses under a dead lease.
    await w.fabric.pauseTask(task.task_id);
    const resume = await w.fabric.resumeTask(task.task_id);
    expect(resume.status).toBe('DENIED');
    if (resume.status === 'DENIED') {
      expect(resume.denial.code).toBe('LEASE_DENIED');
    }
  });

  it('P2 expireDue transitions the durable record; the gate denies identically', async () => {
    const w = acceptanceWorld();
    const body = w.registerBody({ bodyId: 'body:expire-due', providerName: 'reference-body-vendor' });
    const task = await w.createTask({ task_id: 'task-lease-0002', leaseExpiresAt: T0 + 60_000 });
    w.clock.advance(61_000);
    // The P2 repository's own expiry sweep transitions the durable record.
    const expired = await w.store.bodyLeases.expireDue(w.clock.nowEpochMs());
    expect(expired.map((lease) => lease.lease_id)).toContain(task.body_lease_ref);
    const after = await w.fabric.execute(task.task_id, { kind: 'shell.exec', command: 'echo', args: ['x'], cwd: null });
    expect(after.status).toBe('DENIED');
    if (after.status === 'DENIED') {
      expect(after.denial.code).toBe('LEASE_DENIED');
    }
    expect(body.dispatches.get('shell.exec')).toBeUndefined();
  });

  it('a REVOKED lease authorizes nothing (explicit revocation)', async () => {
    const w = acceptanceWorld();
    const body = w.registerBody({ bodyId: 'body:revoked', providerName: 'reference-body-vendor' });
    const task = await w.createTask({ task_id: 'task-lease-0003' });
    await w.broker.revokeLease(task.body_lease_ref!, 'security revocation');
    const result = await w.fabric.execute(task.task_id, { kind: 'git.status' });
    expect(result.status).toBe('DENIED');
    if (result.status === 'DENIED') {
      expect(result.denial.code).toBe('LEASE_DENIED');
      expect(result.denial.reason).toContain('lease gate refused');
    }
    expect(body.dispatches.get('git.status')).toBeUndefined();
  });

  it('suspending the body ends its leases and denies operations (the TASK survives)', async () => {
    const w = acceptanceWorld();
    const body = w.registerBody({ bodyId: 'body:suspended', providerName: 'reference-body-vendor' });
    const task = await w.createTask({ task_id: 'task-lease-0004' });
    const outcome = await w.broker.suspendBody('body:suspended', 'provider outage simulation');
    expect(outcome.endedLeases.map((lease) => lease.lease_id)).toContain(task.body_lease_ref);

    const result = await w.fabric.execute(task.task_id, { kind: 'shell.exec', command: 'echo', args: ['x'], cwd: null });
    expect(result.status).toBe('DENIED');
    if (result.status === 'DENIED') {
      expect(result.denial.code).toBe('LEASE_DENIED');
    }
    expect(body.dispatches.get('shell.exec')).toBeUndefined();

    // THE TASK SURVIVES: the durable record is intact with every trace.
    const after = await w.store.tasks.get(task.task_id);
    expect(after?.task_id).toBe('task-lease-0004');
    expect(after?.status).toBe('RUNNING');
    expect(after?.observations.length).toBeGreaterThan(0);
  });

  it('a RELEASED lease authorizes nothing (release is terminal)', async () => {
    const w = acceptanceWorld();
    const body = w.registerBody({ bodyId: 'body:released', providerName: 'reference-body-vendor' });
    const task = await w.createTask({ task_id: 'task-lease-0005' });
    await w.broker.releaseLease(task.body_lease_ref!, 'deliberate release');
    const result = await w.fabric.execute(task.task_id, { kind: 'shell.exec', command: 'echo', args: ['x'], cwd: null });
    expect(result.status).toBe('DENIED');
    expect(body.dispatches.get('shell.exec')).toBeUndefined();
  });

  it('an expired lease cannot renew itself (fail closed — a dead lease never reauthorizes)', async () => {
    const w = acceptanceWorld();
    w.registerBody({ bodyId: 'body:renew', providerName: 'reference-body-vendor' });
    const task = await w.createTask({ task_id: 'task-lease-0006', leaseExpiresAt: T0 + 60_000 });
    w.clock.advance(61_000);
    const renewal = await w.broker.renewLease(task.body_lease_ref!, { extend_to: formatRfc3339(T0 + 600_000) });
    expect(renewal.status).toBe('DENIED');
    if (renewal.status === 'DENIED') {
      expect(renewal.denial.code).toBe('LEASE_EXPIRED');
    }
    // And the lease still denies operations.
    const result = await w.fabric.execute(task.task_id, { kind: 'shell.exec', command: 'echo', args: ['x'], cwd: null });
    expect(result.status).toBe('DENIED');
  });

  it('a LIVE lease renews (the happy path stays available)', async () => {
    const w = acceptanceWorld();
    w.registerBody({ bodyId: 'body:renew-live', providerName: 'reference-body-vendor' });
    const task = await w.createTask({ task_id: 'task-lease-0007', leaseExpiresAt: T0 + 60_000 });
    const renewal = await w.broker.renewLease(task.body_lease_ref!, { extend_to: formatRfc3339(T0 + 600_000) });
    expect(renewal.status).toBe('RENEWED');
    w.clock.advance(300_000); // past the ORIGINAL expiry, before the renewed one
    const result = await w.fabric.execute(task.task_id, { kind: 'shell.exec', command: 'echo', args: ['still-live'], cwd: null });
    expect(result.status).toBe('EXECUTED');
  });

  it('every lease denial is a DURABLE observation (refusing-to-run is a recorded fact)', async () => {
    const w = acceptanceWorld();
    w.registerBody({ bodyId: 'body:observed', providerName: 'reference-body-vendor' });
    const task = await w.createTask({ task_id: 'task-lease-0008', leaseExpiresAt: T0 + 60_000 });
    w.clock.advance(61_000);
    const denied = await w.fabric.execute(task.task_id, { kind: 'shell.exec', command: 'echo', args: ['x'], cwd: null });
    expect(denied.status).toBe('DENIED');
    if (denied.status === 'DENIED') {
      expect(denied.observation_id).not.toBeNull();
      const event = await w.store.observationEvents.get(denied.observation_id!);
      expect(event?.kind).toBe('fabric.denied:shell.exec');
      expect((event?.payload as Record<string, unknown>)['denial']).toMatchObject({ code: 'LEASE_DENIED' });
    }
  });
});
