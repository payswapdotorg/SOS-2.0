// No vitest import: the borrowed toolchain runs with `globals: true`.
import { InMemoryAuditTrail, auditDecision, diagnose, type PolicyDecision } from '../src/index.js';
import { ManualClock } from './helpers.js';

describe('operational diagnostics (symptom -> responsible task/body/provider)', () => {
  it('attributes denied actions to the responsible task and body via audit trace links', () => {
    const clock = new ManualClock(1_700_000_000_000);
    const trail = new InMemoryAuditTrail(clock);
    const record = (decision: PolicyDecision) => {
      clock.advance(1_000);
      auditDecision(trail, decision, clock);
    };
    record({ decision: 'DENY', surface: 'credential-scope', detail: 'expired', taskId: 'task-1', bodyId: 'body-1', providerId: null, evidenceDigest: null, context: null });
    record({ decision: 'DENY', surface: 'credential-scope', detail: 'expired again', taskId: 'task-1', bodyId: 'body-1', providerId: null, evidenceDigest: null, context: null });
    record({ decision: 'DENY', surface: 'credential-scope', detail: 'other task', taskId: 'task-2', bodyId: 'body-2', providerId: null, evidenceDigest: null, context: null });
    record({ decision: 'ALLOW', surface: 'credential-scope', detail: 'fine', taskId: 'task-1', bodyId: 'body-1', providerId: null, evidenceDigest: null, context: null });

    const result = diagnose(trail.history(), 'denied-actions', { taskId: 'task-1' });
    expect(result.verdict).toBe('ATTRIBUTED');
    expect(result.attributions.length).toBe(1);
    const attribution = result.attributions[0];
    expect(attribution?.taskId).toBe('task-1');
    expect(attribution?.bodyId).toBe('body-1');
    expect(attribution?.denials).toBe(2);
    expect(result.matchedEvents.length).toBe(2);
  });

  it('attributes provider degradation to the responsible provider', () => {
    const clock = new ManualClock(1_700_000_000_000);
    const trail = new InMemoryAuditTrail(clock);
    auditDecision(trail, { decision: 'UNKNOWN', surface: 'provider-health', detail: 'outage window', taskId: 'task-1', bodyId: null, providerId: 'provider-neon', evidenceDigest: null, context: null }, clock);
    const result = diagnose(trail.history(), 'provider-degradation', {});
    expect(result.verdict).toBe('ATTRIBUTED');
    expect(result.attributions[0]?.providerId).toBe('provider-neon');
    expect(result.attributions[0]?.unknowns).toBe(1);
  });

  it('returns INSUFFICIENT_EVIDENCE honestly when the records do not name a responsible party', () => {
    const clock = new ManualClock(1_700_000_000_000);
    const trail = new InMemoryAuditTrail(clock);
    const result = diagnose(trail.history(), 'abuse-suspensions', {});
    expect(result.verdict).toBe('INSUFFICIENT_EVIDENCE');
    expect(result.attributions).toEqual([]);
    expect(result.matchedEvents).toEqual([]);
  });

  it('the since filter restricts the diagnosis window', () => {
    const clock = new ManualClock(1_700_000_000_000);
    const trail = new InMemoryAuditTrail(clock);
    auditDecision(trail, { decision: 'DENY', surface: 'rate-limit', detail: 'limited', taskId: 'task-1', bodyId: null, providerId: null, evidenceDigest: null, context: null }, clock);
    clock.advance(10_000);
    const later = auditDecision(trail, { decision: 'DENY', surface: 'rate-limit', detail: 'limited later', taskId: 'task-1', bodyId: null, providerId: null, evidenceDigest: null, context: null }, clock);
    const cutoff = later.kind === 'APPLIED' ? later.event.occurred_at : '';
    const result = diagnose(trail.history(), 'rate-limiting', { since: cutoff });
    expect(result.matchedEvents.length).toBe(1);
    expect((result.matchedEvents[0]?.payload as { detail: string }).detail).toBe('limited later');
  });
});
