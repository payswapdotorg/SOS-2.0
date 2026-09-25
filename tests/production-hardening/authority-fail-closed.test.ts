/**
 * PINNED: stale/expired authority fails closed — composition with the
 * REAL merged P9 action gateway (imported through the test-time alias).
 *
 * The composition: a real ActionGateway whose AuthorityPort is the
 * P14 ScopedCredentialAuthority adapter (credential-scope evaluation
 * ANDed with the gateway grant). Everything runs offline against the
 * deterministic reference world.
 */
import { describe, expect, it } from 'vitest';
import { InMemoryAuditTrail, auditDecision } from '@sos-2/security';
import type { CredentialScopeRecord } from '@sos-2/security';
import { commitRequest, composeGateway, pushRequest } from './helpers.js';

const NOW = 1_000_000;

function credential(overrides: Partial<CredentialScopeRecord> = {}): CredentialScopeRecord {
  return {
    credentialId: 'cred-1',
    heldBy: 'body',
    holderId: 'body-1',
    families: ['commit', 'push'],
    expiresAt: NOW + 10_000,
    projectId: 'project-A',
    ...overrides,
  };
}

describe('stale/expired authority fails closed (composed with the P9 gateway)', () => {
  it('a live grant + in-scope, unexpired credential executes through the real gateway', () => {
    const composed = composeGateway(credential());
    composed.authority.base.grant('body-1', 'commit', 'workspace');
    const outcome = composed.gateway.execute(commitRequest());
    expect(outcome.kind).toBe('executed');
    if (outcome.kind === 'executed') {
      expect(outcome.receipt.status).toBe('SUCCEEDED');
    }
    expect(composed.executor.calls.length).toBeGreaterThan(0);
  });

  it('PINNED: an EXPIRED credential fails closed — DENIED receipt, GRANT_EXPIRED, executor NEVER invoked, no retry', () => {
    const expired = credential({ expiresAt: NOW }); // expired at the evaluation instant
    const composed = composeGateway(expired);
    composed.authority.base.grant('body-1', 'commit', 'workspace'); // the grant itself is "live"
    const outcome = composed.gateway.execute(commitRequest());
    expect(outcome.kind).toBe('executed');
    if (outcome.kind === 'executed') {
      expect(outcome.receipt.status).toBe('DENIED');
      expect(outcome.receipt.denial?.reason).toBe('ACTION_AUTHORITY_DENIED');
      expect(outcome.receipt.denial?.authority?.reason).toBe('GRANT_EXPIRED');
    }
    // the executor seam was never reached:
    expect(composed.executor.calls.length).toBe(0);
    // the denial is auditable (the audit trail receives the DENY record):
    const trail = new InMemoryAuditTrail(composed.clock);
    const denyReceipt = outcome.kind === 'executed' ? outcome.receipt : null;
    const audited = auditDecision(
      trail,
      {
        decision: 'DENY',
        surface: 'credential-scope',
        detail: denyReceipt?.denial?.detail ?? 'authority re-evaluated at action time: GRANT_EXPIRED',
        taskId: null,
        bodyId: 'body-1',
        providerId: null,
        evidenceDigest: null,
        context: { family: 'commit' },
      },
      composed.clock,
    );
    expect(audited.kind).toBe('APPLIED');
  });

  it('PINNED: a credential scoped away from the requested family fails closed (SCOPE_EXCEEDED)', () => {
    const narrow = credential({ families: ['commit'] }); // no push
    const composed = composeGateway(narrow);
    composed.authority.base.grant('body-1', 'push', 'main');
    const outcome = composed.gateway.execute(pushRequest());
    expect(outcome.kind).toBe('executed');
    if (outcome.kind === 'executed') {
      expect(outcome.receipt.status).toBe('DENIED');
      expect(outcome.receipt.denial?.authority?.reason).toBe('SCOPE_EXCEEDED');
    }
    expect(composed.executor.calls.length).toBe(0);
  });

  it('an absent credential holds nothing: every family is denied (fail-closed)', () => {
    const composed = composeGateway(null);
    composed.authority.base.grant('body-1', 'commit', 'workspace');
    const outcome = composed.gateway.execute(commitRequest());
    if (outcome.kind === 'executed') {
      expect(outcome.receipt.status).toBe('DENIED');
      expect(outcome.receipt.denial?.authority?.reason).toBe('SCOPE_EXCEEDED');
    }
    expect(composed.executor.calls.length).toBe(0);
  });

  it('a revoked grant fails closed through the same composition (the P9 discipline)', () => {
    const composed = composeGateway(credential());
    const grantId = composed.authority.base.grant('body-1', 'commit', 'workspace');
    composed.authority.base.revoke(grantId);
    const outcome = composed.gateway.execute(commitRequest());
    if (outcome.kind === 'executed') {
      expect(outcome.receipt.status).toBe('DENIED');
      expect(outcome.receipt.denial?.authority?.reason).toBe('GRANT_REVOKED');
    }
    expect(composed.executor.calls.length).toBe(0);
  });

  it('expiry crossing DURING the gateway lifetime still fails closed at action time (exactly one re-evaluation)', () => {
    const expiring = credential({ expiresAt: NOW + 5_000 });
    const composed = composeGateway(expiring);
    composed.authority.base.grant('body-1', 'commit', 'workspace');
    composed.clock.advance(6_000); // now past expiry
    const outcome = composed.gateway.execute(commitRequest());
    if (outcome.kind === 'executed') {
      expect(outcome.receipt.status).toBe('DENIED');
    }
    expect(composed.authority.evaluations.length).toBe(1); // exactly one re-evaluation per action
    expect(composed.executor.calls.length).toBe(0);
  });

  it('every gateway outcome lands in the durable event log (the observation discipline)', () => {
    const composed = composeGateway(credential());
    composed.authority.base.grant('body-1', 'commit', 'workspace');
    composed.gateway.execute(commitRequest());
    expect(composed.eventLog.entries().length).toBe(1);
    expect(composed.eventLog.entries()[0]?.type).toBe('action.succeeded');

    const denied = composeGateway(credential({ expiresAt: NOW }));
    denied.authority.base.grant('body-1', 'commit', 'workspace');
    denied.gateway.execute(commitRequest());
    expect(denied.eventLog.entries()[0]?.type).toBe('action.denied');
  });

  it('idempotent replay: a second execution of the same idempotency key replays the ORIGINAL outcome', () => {
    const composed = composeGateway(credential());
    composed.authority.base.grant('body-1', 'commit', 'workspace');
    const first = composed.gateway.execute(commitRequest());
    const callsAfterFirst = composed.executor.calls.length;
    const replay = composed.gateway.execute(commitRequest());
    expect(replay.kind).toBe('replayed');
    expect(composed.executor.calls.length).toBe(callsAfterFirst); // no double execution
    if (first.kind === 'executed' && replay.kind === 'replayed') {
      expect(replay.receipt.status).toBe(first.receipt.status);
    }
  });
});
