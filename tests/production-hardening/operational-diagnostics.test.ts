/**
 * PINNED: operational diagnostics identify the responsible task/body/
 * provider — a multi-surface incident scenario attributing through
 * audit trace links, with honest INSUFFICIENT_EVIDENCE.
 */
import { describe, expect, it } from 'vitest';
import {
  InMemoryAuditTrail,
  auditDecision,
  diagnose,
  type PolicyDecision,
} from '@sos-2/security';
import { ManualClock } from './helpers.js';

describe('acceptance: operational diagnostics identify the responsible task/body/provider', () => {
  it('PINNED: a multi-surface incident attributes to the right task/body/provider via trace links', () => {
    const clock = new ManualClock(1_700_000_000_000);
    const trail = new InMemoryAuditTrail(clock);
    const record = (decision: PolicyDecision) => {
      clock.advance(1_000);
      auditDecision(trail, decision, clock);
    };

    // The incident: task-77 (body-4) hammers the gateway (rate limits),
    // trips a scope violation, and its provider degrades. (Each audit
    // record carries a distinct context — content-addressed ids dedupe
    // IDENTICAL decisions by design, so the two rate-limit denials below
    // are distinct records through their window context.)
    record({ decision: 'DENY', surface: 'rate-limit', detail: 'limited', taskId: 'task-77', bodyId: 'body-4', providerId: null, evidenceDigest: null, context: { window: 1 } });
    record({ decision: 'DENY', surface: 'rate-limit', detail: 'limited', taskId: 'task-77', bodyId: 'body-4', providerId: null, evidenceDigest: null, context: { window: 2 } });
    record({ decision: 'DENY', surface: 'credential-scope', detail: 'SCOPE_EXCEEDED', taskId: 'task-77', bodyId: 'body-4', providerId: null, evidenceDigest: null, context: null });
    record({ decision: 'UNKNOWN', surface: 'provider-health', detail: 'outage window', taskId: 'task-77', bodyId: 'body-4', providerId: 'provider-github', evidenceDigest: null, context: null });
    // Unrelated noise:
    record({ decision: 'DENY', surface: 'workspace-isolation', detail: 'cross-project', taskId: 'task-99', bodyId: 'body-9', providerId: null, evidenceDigest: null, context: null });

    // Rate-limit diagnosis:
    const rateLimited = diagnose(trail.history(), 'rate-limiting', {});
    expect(rateLimited.verdict).toBe('ATTRIBUTED');
    expect(rateLimited.attributions[0]?.taskId).toBe('task-77');
    expect(rateLimited.attributions[0]?.bodyId).toBe('body-4');
    expect(rateLimited.attributions[0]?.denials).toBe(2);

    // Denied-actions diagnosis (scope):
    const denied = diagnose(trail.history(), 'denied-actions', { taskId: 'task-77' });
    expect(denied.verdict).toBe('ATTRIBUTED');
    expect(denied.attributions[0]?.surfaces).toContain('credential-scope');

    // Provider-degradation diagnosis:
    const degraded = diagnose(trail.history(), 'provider-degradation', {});
    expect(degraded.attributions[0]?.providerId).toBe('provider-github');
    expect(degraded.attributions[0]?.taskId).toBe('task-77'); // the affected task
  });

  it('a symptom with no matching records is INSUFFICIENT_EVIDENCE (honest, never guessed)', () => {
    const trail = new InMemoryAuditTrail(new ManualClock(1_700_000_000_000));
    const result = diagnose(trail.history(), 'abuse-suspensions', {});
    expect(result.verdict).toBe('INSUFFICIENT_EVIDENCE');
    expect(result.attributions).toEqual([]);
  });

  it('every audit record carries the full trace-link triple in its payload', () => {
    const clock = new ManualClock(1_700_000_000_000);
    const trail = new InMemoryAuditTrail(clock);
    auditDecision(
      trail,
      {
        decision: 'REDACT',
        surface: 'secret-isolation',
        detail: 'artifact redacted',
        taskId: 'task-1',
        bodyId: 'body-1',
        providerId: 'provider-r2',
        evidenceDigest: null,
        context: null,
      },
      clock,
    );
    const payload = trail.history()[0]?.payload as Record<string, unknown>;
    expect(payload['taskId']).toBe('task-1');
    expect(payload['bodyId']).toBe('body-1');
    expect(payload['providerId']).toBe('provider-r2');
    expect(payload['surface']).toBe('secret-isolation');
    expect(payload['decision']).toBe('REDACT');
  });

  it('diagnosis is repeat-safe: replayed audit events do not double-count (content-addressed ids)', () => {
    const clock = new ManualClock(1_700_000_000_000);
    const trail = new InMemoryAuditTrail(clock);
    const decision: PolicyDecision = {
      decision: 'DENY',
      surface: 'budget',
      detail: 'exhausted',
      taskId: 'task-1',
      bodyId: null,
      providerId: null,
      evidenceDigest: null,
      context: null,
    };
    auditDecision(trail, decision, clock);
    clock.advance(5_000);
    const replay = auditDecision(trail, decision, clock);
    expect(replay.kind).toBe('DUPLICATE');
    expect(trail.history().length).toBe(1);
    const result = diagnose(trail.history(), 'budget-exhaustion', {});
    expect(result.matchedEvents.length).toBe(1);
  });
});
