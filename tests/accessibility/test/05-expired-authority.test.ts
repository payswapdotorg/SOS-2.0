/**
 * LANE C, NEGATIVE CASE 05 — EXPIRED AUTHORITY (the P9 action-time
 * re-evaluation, the P14 contract).
 *
 * The fault: authority that was valid once has EXPIRED by the time a
 * gated action runs. The system must re-evaluate authority AT ACTION
 * TIME and fail CLOSED: the gated action is denied with a typed record,
 * the executor is NEVER invoked, the denial lands in the durable event
 * log + audit trail, and no privilege survives its authority — not at
 * the gateway, not at the promotion gate, not mid-journey. Never a
 * silent pass, never a crash.
 */

import { describe, expect, test } from 'vitest';
import { InMemoryAuditTrail, auditDecision } from '@sos-2/security';
import type { CredentialScopeRecord } from '@sos-2/security';
import { evaluatePromotion } from '@sos-2/promotion';
import { createCandidateState } from '@sos-2/experiments';
import { createGrant } from '@sos-2/authority';
import { LANE_ANCHOR, LANE_PROVENANCE, T0, T2, commitActionRequest, composeCredentialGateway, promoteGrant } from './helpers.js';

const NOW = 1_000_000;

function credential(overrides: Partial<CredentialScopeRecord> = {}): CredentialScopeRecord {
  return {
    credentialId: 'cred-p15c-1',
    heldBy: 'body',
    holderId: 'body-1',
    families: ['commit', 'push'],
    expiresAt: NOW + 10_000,
    projectId: 'project-A',
    ...overrides,
  };
}

describe('P15 lane C negative case: expired authority', () => {
  test('CONTAINED: an EXPIRED credential fails closed at action time — DENIED receipt, executor NEVER invoked', () => {
    const expired = credential({ expiresAt: NOW }); // expired at the evaluation instant
    const composed = composeCredentialGateway(expired);
    composed.authority.base.grant('body-1', 'commit', 'workspace'); // the gateway grant itself is "live"
    const outcome = composed.gateway.execute(commitActionRequest());
    expect(outcome.kind).toBe('executed');
    if (outcome.kind === 'executed') {
      expect(outcome.receipt.status).toBe('DENIED');
      expect(outcome.receipt.denial?.reason).toBe('ACTION_AUTHORITY_DENIED');
      expect(outcome.receipt.denial?.authority?.reason).toBe('GRANT_EXPIRED');
    }
    // The executor seam was never reached (fail-closed BEFORE execution):
    expect(composed.executor.calls.length).toBe(0);
    // The denial is durable evidence (the observation discipline).
    expect(composed.eventLog.entries()[0]?.type).toBe('action.denied');
  });

  test('CONTAINED: expiry crossing DURING the journey still fails closed at action time (exactly one re-evaluation per action)', () => {
    const expiring = credential({ expiresAt: NOW + 5_000 });
    const composed = composeCredentialGateway(expiring);
    composed.authority.base.grant('body-1', 'commit', 'workspace');
    composed.clock.advance(6_000); // now past expiry — the action comes LATE
    const outcome = composed.gateway.execute(commitActionRequest());
    if (outcome.kind === 'executed') {
      expect(outcome.receipt.status).toBe('DENIED');
      expect(outcome.receipt.denial?.authority?.reason).toBe('GRANT_EXPIRED');
    }
    expect(composed.authority.evaluations.length).toBe(1); // re-evaluated AT ACTION TIME
    expect(composed.executor.calls.length).toBe(0);
  });

  test('CONTAINED: an expired authority grant NEVER authorizes promotion (confidence is not authorization)', () => {
    const candidate = createCandidateState({
      content: {
        invariants: ['i'],
        predicted_effects: [],
        causal_claim: false,
        confidence: { kind: 'QUALITATIVE', uncertainty_class: 'STRONG' }, // a strong confidence mark — irrelevant for authority
        base_subject_revision: null,
        hypothesis_ref: null,
        bounded_subgraph_ref: null,
        context: { environment: 'production' },
      },
      provenance: [...LANE_PROVENANCE, 'p15c-05:candidate'],
      created_at: T0,
      authority_ref: LANE_ANCHOR,
    });
    // A grant that EXPIRED before the promotion instant.
    const expiredGrant = createGrant({
      grantee: 'p15-lane-c-runner',
      scope: { kind: 'KIND', artifact_kind: 'CandidateState' },
      permissions: ['READ', 'PROMOTE'],
      expiry: { kind: 'TIME', at: T0 },
      provenance: [...LANE_PROVENANCE, 'authority:expired-promote-grant'],
      created_at: T0,
      status: 'ACTIVE',
    });
    const evaluation = evaluatePromotion(candidate, {
      authority: { grant: expiredGrant, now: T2 },
      assurance: null,
      evidence: [],
      provenance: [...LANE_PROVENANCE, 'p15c-05:promotion-gate'],
      created_at: T2,
    });
    // Fail-closed at DECISION time: expired never authorizes.
    expect(evaluation.decision).toBe('REJECT');
    expect(evaluation.gates.authority.passes).toBe(false);
    expect(evaluation.gates.authority.reasons.join(' ')).toContain('EXPIRED');
    // The control (the same grant still inside its validity) is NOT rejected on authority:
    const liveEvaluation = evaluatePromotion(candidate, {
      authority: { grant: promoteGrant('CandidateState'), now: T2 },
      assurance: null,
      evidence: [],
      provenance: [...LANE_PROVENANCE, 'p15c-05:promotion-gate-control'],
      created_at: T2,
    });
    expect(liveEvaluation.gates.authority.passes).toBe(true);
  });

  test('the expired-authority denial is RECORDED (audit trail) and the evidence graph stays truthful', () => {
    const expired = credential({ expiresAt: NOW });
    const composed = composeCredentialGateway(expired);
    composed.authority.base.grant('body-1', 'commit', 'workspace');
    const outcome = composed.gateway.execute(commitActionRequest());
    const denial = outcome.kind === 'executed' ? outcome.receipt.denial : null;

    // The denial is auditable (the P14 policy-decision audit trail).
    const trail = new InMemoryAuditTrail(composed.clock);
    const audited = auditDecision(
      trail,
      {
        decision: 'DENY',
        surface: 'credential-scope',
        detail: denial?.detail ?? 'authority re-evaluated at action time: GRANT_EXPIRED',
        taskId: null,
        bodyId: 'body-1',
        providerId: null,
        evidenceDigest: null,
        context: { family: 'commit', reason: 'GRANT_EXPIRED' },
      },
      composed.clock,
    );
    expect(audited.kind).toBe('APPLIED');
    expect(trail.history().length).toBe(1);
    const auditedRecord = trail.history()[0]!;
    expect((auditedRecord.payload as Record<string, unknown>)['decision']).toBe('DENY');
    expect(auditedRecord.source).toContain('credential-scope');

    // The evidence the gateway emitted for the denial is truthful (never
    // a fabricated success) and the event log stays queryable.
    expect(composed.eventLog.entries().length).toBe(1);
    expect(composed.eventLog.entries()[0]!.type).toBe('action.denied');
    expect(composed.evidence.all().length).toBeGreaterThan(0);
    for (const record of composed.evidence.all()) {
      expect(JSON.stringify(record)).toContain('DENIED');
    }
  });
});
