import { describe, expect, it } from 'vitest';
import { expectExecuted, buildFixture, commitRequest, ManualClock, requestForFamily } from './helpers.js';
import './helpers.js'; // ACTION_FAMILIES re-export

describe('P9 authority re-evaluation at action time (fail closed)', () => {
  it('fails closed when the grant is revoked between planning and action', () => {
    const fx = buildFixture();
    const grantId = fx.authority.grant('body-1', 'commit', 'workspace', { grantId: 'g-1' });
    fx.authority.revoke(grantId);
    const outcome = fx.gateway.execute(commitRequest(), { planId: 'plan-1', planningGrantId: grantId });
    const receipt = expectExecuted(outcome);
    expect(receipt.status).toBe('DENIED');
    expect(receipt.denial?.reason).toBe('ACTION_AUTHORITY_DENIED');
    expect(receipt.denial?.authority?.reason).toBe('GRANT_REVOKED');
    expect(fx.executor.calls).toHaveLength(0);
    expect(receipt.evidenceIds).toHaveLength(1);
    const stored = fx.evidence.all()[0];
    if (stored?.evidenceType !== 'action.outcome') throw new Error('expected action outcome evidence');
    expect(stored.status).toBe('DENIED');
    expect(stored.sourceRevision).toBe(WORLD_BASE_SHA_VALUE);
    expect(fx.events.entries().map((e) => e.type)).toEqual(['action.denied']);
  });

  it('fails closed when the grant expires between planning and action (injected clock)', () => {
    const clock = new ManualClock(1_000_000);
    const fx = buildFixture(clock);
    fx.authority.grant('body-1', 'commit', 'workspace', { grantId: 'g-2', expiresAt: clock.now() + 500 });
    clock.advance(1_000);
    const receipt = expectExecuted(fx.gateway.execute(commitRequest(), { planningGrantId: 'g-2' }));
    expect(receipt.denial?.authority?.reason).toBe('GRANT_EXPIRED');
    expect(fx.executor.calls).toHaveLength(0);
    // the evaluation happened at ACTION time with the CURRENT clock
    expect(fx.authority.evaluations[0]?.now).toBe(1_001_000);
  });

  it('fails closed when no grant was ever held, even if a planning grant id is cited', () => {
    const fx = buildFixture();
    const receipt = expectExecuted(fx.gateway.execute(commitRequest(), { planningGrantId: 'g-never' }));
    expect(receipt.denial?.authority?.reason).toBe('GRANT_NEVER_HELD');
    expect(fx.executor.calls).toHaveLength(0);
  });

  it('fails closed for EVERY action family', () => {
    for (const family of ALL_FAMILIES()) {
      const fx = buildFixture();
      const receipt = expectExecuted(fx.gateway.execute(requestForFamily(family, 1)));
      expect(receipt.status, family).toBe('DENIED');
      expect(receipt.denial?.reason, family).toBe('ACTION_AUTHORITY_DENIED');
      expect(fx.executor.calls, family).toHaveLength(0);
    }
  });

  it('never retries a denied action into success', () => {
    const fx = buildFixture();
    for (let i = 1; i <= 3; i += 1) {
      const receipt = expectExecuted(fx.gateway.execute(commitRequest({ actionId: `act-${i}`, idempotencyKey: `idem-${i}` })));
      expect(receipt.status).toBe('DENIED');
    }
    expect(fx.executor.calls).toHaveLength(0);
    expect(fx.idempotency.size()).toBe(3);
  });

  it('a live grant at action time proceeds', () => {
    const fx = buildFixture();
    fx.authority.grant('body-1', 'commit', 'workspace', { grantId: 'g-live' });
    const receipt = expectExecuted(fx.gateway.execute(commitRequest()));
    expect(receipt.status).toBe('SUCCEEDED');
    expect(receipt.output).toEqual({ produced: { repo: 'workspace', newSha: expect.any(String) } });
  });
});

import { ACTION_FAMILIES as FAMILIES, WORLD_BASE_SHA as WORLD_BASE_SHA_VALUE } from './helpers.js';
function ALL_FAMILIES() {
  return FAMILIES;
}
