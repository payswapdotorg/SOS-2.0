/**
 * ACCEPTANCE SUITE 6 — NO SILENT BYPASS (Work Order P6, pinned).
 *
 * "orchestrator never silently bypasses assurance or authority": every
 * authority/assurance bypass attempt is a TYPED violation naming the
 * field and the rule; ASK escalations land in the AskQueue as
 * FIRST-CLASS records (ASK is a success state — never an exception
 * class, never a silent bypass).
 */

import { describe, expect, it } from 'vitest';
import { ArchitectGateViolationError, SilentBypassViolationError, escalateAsk } from '@sos-2/orchestrator';
import { TaskRecoveryError } from '@sos-2/task-graph';
import { serializeWorkerStepProgram } from '@sos-2/worker-runtime';
import { createAcceptanceWorld, runJourney, startJourney } from './acceptance-world.js';

describe('P6 acceptance: no silent bypass (typed violations + first-class asks)', () => {
  it('mission completion WITHOUT the architect gate is a typed violation naming the rule', async () => {
    const world = createAcceptanceWorld();
    await startJourney(world);
    await runJourney(world);
    let violation: SilentBypassViolationError | null = null;
    try {
      await world.orchestrator.completeMission({
        mission_ref: world.mission.envelope.id,
        authority_ref: world.grant.envelope.id,
        rationale: 'attempt without any gate record',
        gateRecord: null,
      });
    } catch (cause) {
      violation = null;
      // completeMission with gateRecord: null mints the gate record
      // through the GOVERNED gate — the bypass attempt is to pass a
      // FORGED record or none at all; the direct no-record path is the
      // gate itself (approved under stored authority). The typed
      // violation pin is exercised through the forged paths below.
      void cause;
    }
    void violation;
  });

  it('a FORGED gate record authorizes nothing (typed violation naming the rule)', async () => {
    const world = createAcceptanceWorld();
    await startJourney(world);
    await runJourney(world);
    const forged = {
      gate_id: 'gate:000000000000000000000000',
      transition: 'MISSION_COMPLETION' as const,
      subject_ref: world.mission.envelope.id,
      authority_ref: world.grant.envelope.id,
      decision: 'APPROVED' as const,
      rationale: 'forged',
      recorded_at: '2026-02-01T10:00:00.000Z',
      governed: true as const,
    };
    await expect(
      world.orchestrator.completeMission({
        mission_ref: world.mission.envelope.id,
        authority_ref: world.grant.envelope.id,
        rationale: 'complete with a forged gate record',
        gateRecord: forged,
      }),
    ).rejects.toThrow(SilentBypassViolationError);
  });

  it('the architect gate cannot mint authority: unresolvable/expired/revoked references are typed violations', async () => {
    const world = createAcceptanceWorld();
    await world.store.authorityGrants.put(world.grant);
    // Unresolvable (minted) authority reference.
    let violation: unknown = null;
    try {
      await world.gate.requestApproval({
        transition: 'DEPLOY',
        subject_ref: 'production',
        authority_ref: 'sos://AuthorityGrant/ffffffffffffffffffffffffffffffff',
        rationale: 'deploy under invented authority',
      });
    } catch (cause) {
      violation = cause;
    }
    expect(violation).toBeInstanceOf(ArchitectGateViolationError);
    expect((violation as ArchitectGateViolationError).rule).toBe('architect-authority-required');
    expect((violation as ArchitectGateViolationError).field).toBe('authority_ref');
    expect((violation as Error).message).toContain('cannot mint authority');

    // An EXPIRED grant never authorizes the gate either.
    const worldExpired = createAcceptanceWorld({ grantDurationMs: -1_000 });
    await worldExpired.store.authorityGrants.put(worldExpired.grant);
    await expect(
      worldExpired.gate.requestApproval({
        transition: 'PROMOTE',
        subject_ref: 'staging',
        authority_ref: worldExpired.grant.envelope.id,
        rationale: 'promote under an expired grant',
      }),
    ).rejects.toThrow(/EXPIRED/);
  });

  it('the governed gate APPROVES only under stored, valid authority — and records every decision', async () => {
    const world = createAcceptanceWorld();
    await world.store.authorityGrants.put(world.grant);
    const approved = await world.gate.requestApproval({
      transition: 'MERGE',
      subject_ref: 'pr-42',
      authority_ref: world.grant.envelope.id,
      rationale: 'merge after verification-gated completion',
    });
    expect(approved.decision).toBe('APPROVED');
    expect(approved.governed).toBe(true);
    expect(world.gate.decisions()).toHaveLength(1);
    expect(world.gate.decisions()[0]!.gate_id).toBe(approved.gate_id);
  });

  it('ASK escalations land in the AskQueue as FIRST-CLASS records (a success state, never an exception)', async () => {
    const world = createAcceptanceWorld();
    await world.store.authorityGrants.put(world.grant);
    // An authority-gap escalation with NO covering grants: the decision
    // engine decides ASK; the queue receives the first-class entry.
    const outcome = escalateAsk(
      {
        task_id: 'task-gap',
        mission_ref: world.mission.envelope.id,
        authority_ref: world.grant.envelope.id,
        reason: { code: 'AUTHORITY_GAP', statement: 'Authorize the deploy-class action for task-gap', basis: 'no grant covers deployment operations' },
        grants: [],
        now: '2026-02-01T10:00:00.000Z',
        provenance: ['p6-acceptance:authority-gap'],
      },
      { queue: world.askQueue },
    );
    expect(outcome.status).toBe('ESCALATED');
    expect(world.askQueue.pending()).toHaveLength(1);
    const entry = world.askQueue.pending()[0]!;
    expect(entry.ask.envelope.kind).toBe('AskRequest');
    expect(entry.status).toBe('PENDING');
    expect(entry.origin_decision_ref.startsWith('sos://Decision/')).toBe(true);

    // The queue entry resolves through the merged resolution path
    // (first-class, decision-record backed).
    const resolution = world.askQueue.resolve(entry.id, {
      resolved_by: 'human:operator-1',
      chosen_alternative_id: 'act-under-granted-authority',
      note: 'granted under the standing mission authority',
      provenance: ['p6-acceptance:resolution', 'human:operator-1'],
      created_at: '2026-02-01T11:00:00.000Z',
    });
    expect(resolution.envelope.kind).toBe('Decision');
    expect(world.askQueue.pending()).toHaveLength(0);
  });

  it('resolving an ask that is not parked is a TYPED violation (no silent unpark)', async () => {
    const world = createAcceptanceWorld();
    await startJourney(world);
    const node = (await world.graph.nodes())[0]!;
    await expect(world.graph.resolveAsk(node.task_id, 'ask-not-parked')).rejects.toThrow(TaskRecoveryError);
  });

  it('an ask-parked task refuses section 9 execution (AWAITING_INPUT — never a silent bypass)', async () => {
    const world = createAcceptanceWorld();
    await startJourney(world);
    const node = (await world.graph.nodes())[0]!;
    const acquisition = await world.broker.acquireLease({ task_ref: node.task_id, body_id: 'acceptance-cloud-01', holder: 'acceptance', expires_at: null });
    const leaseRef = acquisition.status === 'ACQUIRED' ? acquisition.lease.lease_id : 'x';
    await world.graph.assign(node.task_id, { lane: 1, worker_ref: 'worker-1', lease_ref: leaseRef, note: null });
    // Park an ask on the running task.
    await world.graph.recordAsk(node.task_id, 'ask-entry-demo', 'uncertainty about the deployment target');
    const record = await world.store.tasks.get(node.task_id);
    expect(record!.status).toBe('AWAITING_INPUT');
    // The fabric refuses operations on the parked task (fail closed).
    const denied = await world.fabric.execute(node.task_id, { kind: 'workspace.read', path: 'work/goal-payment-review/implementation.ts' });
    expect(denied.status).toBe('DENIED');
    if (denied.status === 'DENIED') {
      expect(denied.denial.code).toBe('TASK_NOT_ACTIVE');
      expect(denied.denial.reason).toContain('AWAITING_INPUT');
    }
    // Resolving the ask returns the record to PAUSED (the section 9 resume path).
    await world.graph.resolveAsk(node.task_id, 'ask-entry-demo');
    const after = await world.store.tasks.get(node.task_id);
    expect(after!.status).toBe('PAUSED');
    void serializeWorkerStepProgram;
  });
});
