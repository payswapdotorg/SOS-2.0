/**
 * PINNED: abuse containment — a task exhibiting abuse signatures is
 * suspended pending ASK; the suspension is OBSERVED EVIDENCE (audited),
 * never silent termination.
 */
import { describe, expect, it } from 'vitest';
import {
  evaluateContainment,
  suspendTask,
  type ContainmentPolicy,
  type AbuseSignature,
} from '@sos-2/cost-policy';
import { InMemoryAuditTrail, auditDecision } from '@sos-2/security';
import { ManualClock } from './helpers.js';

const POLICY: ContainmentPolicy = {
  policyId: 'abuse-containment/default',
  suspendedSignatureIds: ['rapid-failed-actions', 'secret-probe-rate', 'budget-sprint'],
  enforcement: 'SUSPEND_PENDING_ASK',
};
const NOW = 1_000_000;

describe('acceptance: abuse containment (suspension pending ASK, observed)', () => {
  it('PINNED: abuse signatures suspend the task pending ASK — not terminate', () => {
    const signatures: AbuseSignature[] = [
      { signatureId: 'rapid-failed-actions', severity: 'HIGH', detail: '47 failed actions in 60s' },
    ];
    const decision = evaluateContainment(POLICY, signatures);
    expect(decision.kind).toBe('SUSPEND_PENDING_ASK');
    if (decision.kind !== 'SUSPEND_PENDING_ASK') return;
    const suspension = suspendTask('task-1', 'mission-1', 'body-1', decision, NOW);
    // suspended, recoverable, awaiting the human decision:
    expect(suspension.pendingAsk).toBe(true);
    expect(suspension.reason).toBe('ABUSE_SIGNATURES');
    expect(suspension.matchedSignatureIds).toEqual(['rapid-failed-actions']);
  });

  it('PINNED: the suspension is observed evidence — the DENY lands in the audit trail with trace links', () => {
    const clock = new ManualClock(NOW);
    const trail = new InMemoryAuditTrail(clock);
    const decision = evaluateContainment(POLICY, [
      { signatureId: 'secret-probe-rate', severity: 'SEVERE', detail: 'secret-shaped probes' },
    ]);
    expect(decision.kind).toBe('SUSPEND_PENDING_ASK');
    if (decision.kind !== 'SUSPEND_PENDING_ASK') return;
    const suspension = suspendTask('task-5', null, 'body-2', decision, NOW);
    const audited = auditDecision(
      trail,
      {
        decision: 'DENY',
        surface: 'abuse-containment',
        detail: suspension.detail,
        taskId: suspension.taskId,
        bodyId: suspension.bodyId,
        providerId: null,
        evidenceDigest: null,
        context: { matchedSignatureIds: [...suspension.matchedSignatureIds], askDeduplicationKey: suspension.askDeduplicationKey },
      },
      clock,
    );
    expect(audited.kind).toBe('APPLIED');
    // the suspension record is the evidence pack for the human ASK:
    expect(suspension.askDeduplicationKey).toBe('abuse-containment:task-5');
  });

  it('clean tasks continue (containment does not over-trigger)', () => {
    const decision = evaluateContainment(POLICY, [{ signatureId: 'benign-pattern', severity: 'LOW', detail: 'x' }]);
    expect(decision.kind).toBe('CONTINUE');
  });

  it('multiple matched signatures are all reported in the suspension evidence', () => {
    const decision = evaluateContainment(POLICY, [
      { signatureId: 'rapid-failed-actions', severity: 'HIGH', detail: 'x' },
      { signatureId: 'budget-sprint', severity: 'HIGH', detail: 'y' },
    ]);
    expect(decision.kind).toBe('SUSPEND_PENDING_ASK');
    if (decision.kind === 'SUSPEND_PENDING_ASK') {
      expect(decision.matchedSignatureIds).toEqual(['rapid-failed-actions', 'budget-sprint']);
    }
  });
});
