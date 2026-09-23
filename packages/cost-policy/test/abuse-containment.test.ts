// No vitest import: the borrowed toolchain runs with `globals: true`.
import {
  evaluateContainment,
  suspendTask,
  assertValidContainmentPolicy,
  AbusePolicyError,
  type ContainmentPolicy,
  type AbuseSignature,
} from '../src/index.js';

const POLICY: ContainmentPolicy = {
  policyId: 'abuse-containment/default',
  suspendedSignatureIds: ['rapid-failed-actions', 'secret-probe-rate'],
  enforcement: 'SUSPEND_PENDING_ASK',
};

const NOW = 1_000_000;

describe('abuse containment (suspension pending ASK — observed evidence, never silent termination)', () => {
  it('a task with no matching signatures continues', () => {
    const decision = evaluateContainment(POLICY, [
      { signatureId: 'unrelated-signature', severity: 'LOW', detail: 'benign pattern' },
    ]);
    expect(decision.kind).toBe('CONTINUE');
  });

  it('PINNED: a task exhibiting abuse signatures is SUSPENDED PENDING ASK (not terminated)', () => {
    const decision = evaluateContainment(POLICY, [
      { signatureId: 'rapid-failed-actions', severity: 'HIGH', detail: '47 failed actions in 60s' },
    ]);
    expect(decision.kind).toBe('SUSPEND_PENDING_ASK');
    if (decision.kind === 'SUSPEND_PENDING_ASK') {
      expect(decision.matchedSignatureIds).toEqual(['rapid-failed-actions']);
      expect(decision.detail).toContain('never silent termination');
    }
  });

  it('multiple matched signatures are all reported', () => {
    const decision = evaluateContainment(POLICY, [
      { signatureId: 'rapid-failed-actions', severity: 'HIGH', detail: 'x' },
      { signatureId: 'secret-probe-rate', severity: 'SEVERE', detail: 'y' },
    ]);
    expect(decision.kind).toBe('SUSPEND_PENDING_ASK');
    if (decision.kind === 'SUSPEND_PENDING_ASK') {
      expect(decision.matchedSignatureIds).toEqual(['rapid-failed-actions', 'secret-probe-rate']);
    }
  });

  it('PINNED: the suspension is observed evidence — a typed durable record with the ASK reference', () => {
    const decision = evaluateContainment(POLICY, [
      { signatureId: 'secret-probe-rate', severity: 'SEVERE', detail: 'secret-shaped probes' },
    ]);
    const suspension = suspendTask('task-9', 'mission-3', 'body-2', decision, NOW);
    expect(suspension.taskId).toBe('task-9');
    expect(suspension.reason).toBe('ABUSE_SIGNATURES');
    expect(suspension.matchedSignatureIds).toEqual(['secret-probe-rate']);
    expect(suspension.suspendedAt).toBe(NOW);
    expect(suspension.pendingAsk).toBe(true);
    expect(suspension.askDeduplicationKey).toBe('abuse-containment:task-9');
    expect(suspension.detail).toContain('suspended pending ASK');
  });

  it('suspendTask rejects a CONTINUE decision (nothing to suspend)', () => {
    const decision = evaluateContainment(POLICY, []);
    expect(() => suspendTask('task-1', null, null, decision, NOW)).toThrow(AbusePolicyError);
  });

  it('malformed policies and signatures are typed rejections', () => {
    expect(() =>
      assertValidContainmentPolicy({ policyId: 'x', suspendedSignatureIds: [], enforcement: 'SUSPEND_PENDING_ASK' }),
    ).toThrow(AbusePolicyError);
    expect(() =>
      evaluateContainment(POLICY, [{ signatureId: 'x', severity: 'EXTREME' as never, detail: 'y' }]),
    ).toThrow(AbusePolicyError);
  });
});
