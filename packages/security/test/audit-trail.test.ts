// No vitest import: the borrowed toolchain runs with `globals: true`.
import {
  InMemoryAuditTrail,
  auditDecision,
  auditEventFor,
  assertValidAuditEventInput,
  AUDIT_EVENT_INPUT_FIELDS,
  AUDIT_EVENT_KIND,
  type PolicyDecision,
} from '../src/index.js';
import { ManualClock } from './helpers.js';

describe('the policy audit trail (P7 event discipline)', () => {
  it('audit events carry the exact P2 ObservationEventInput field set', () => {
    const clock = new ManualClock(1_700_000_000_000);
    const event = auditEventFor(
      {
        decision: 'DENY',
        surface: 'workspace-isolation',
        detail: 'cross-project denied',
        taskId: 'task-1',
        bodyId: 'body-1',
        providerId: null,
        evidenceDigest: null,
        context: { projectId: 'project-B' },
      },
      clock,
    );
    expect(Object.keys(event)).toEqual([...AUDIT_EVENT_INPUT_FIELDS]);
    assertValidAuditEventInput(event); // does not throw
    expect(event.kind).toBe(AUDIT_EVENT_KIND);
    expect(event.occurred_at).toBe('2023-11-14T22:13:20.000Z');
    expect(event.provenance.length).toBeGreaterThan(0);
  });

  it('record ids are content addresses: identical decisions are idempotent by content', () => {
    const clock = new ManualClock(1_700_000_000_000);
    const decision: PolicyDecision = {
      decision: 'ALLOW',
      surface: 'credential-scope',
      detail: 'granted',
      taskId: 'task-1',
      bodyId: 'body-1',
      providerId: null,
      evidenceDigest: null,
      context: null,
    };
    const first = auditEventFor(decision, clock);
    const second = auditEventFor(decision, new ManualClock(1_700_000_000_500));
    expect(first.id).toBe(second.id);
    expect(first.id.startsWith('security-audit:')).toBe(true);
  });

  it('PINNED: replay protection — duplicate append answers the typed DUPLICATE, never double-applies', () => {
    const clock = new ManualClock(1_700_000_000_000);
    const trail = new InMemoryAuditTrail(clock);
    const decision: PolicyDecision = {
      decision: 'REDACT',
      surface: 'secret-isolation',
      detail: 'artifact redacted',
      taskId: 'task-1',
      bodyId: 'body-1',
      providerId: null,
      evidenceDigest: null,
      context: { emissionId: 'artifact-1' },
    };
    const applied = auditDecision(trail, decision, clock);
    expect(applied.kind).toBe('APPLIED');

    clock.advance(5_000);
    const duplicate = auditDecision(trail, decision, clock);
    expect(duplicate.kind).toBe('DUPLICATE');
    if (duplicate.kind === 'DUPLICATE') {
      expect(duplicate.eventId).toBe(applied.kind === 'APPLIED' ? applied.event.id : '');
      expect(duplicate.firstReceivedAt).toBe('2023-11-14T22:13:20.000Z');
    }
    expect(trail.history().length).toBe(1);
  });

  it('every decision kind is auditable: ALLOW, DENY, REDACT, UNKNOWN', () => {
    const clock = new ManualClock(1_700_000_000_000);
    const trail = new InMemoryAuditTrail(clock);
    const kinds = ['ALLOW', 'DENY', 'REDACT', 'UNKNOWN'] as const;
    for (const decision of kinds) {
      clock.advance(1_000);
      const outcome = auditDecision(
        trail,
        {
          decision,
          surface: 'budget',
          detail: `budget ${decision}`,
          taskId: 'task-1',
          bodyId: null,
          providerId: null,
          evidenceDigest: null,
          context: null,
        },
        clock,
      );
      expect(outcome.kind).toBe('APPLIED');
    }
    const decisions = trail.history().map((event) => (event.payload as { decision: string }).decision);
    expect(decisions).toEqual([...kinds]);
  });

  it('trace links survive: taskId/bodyId/providerId are carried in the payload', () => {
    const clock = new ManualClock(1_700_000_000_000);
    const trail = new InMemoryAuditTrail(clock);
    auditDecision(
      trail,
      {
        decision: 'UNKNOWN',
        surface: 'provider-health',
        detail: 'provider unprobed',
        taskId: 'task-9',
        bodyId: 'body-3',
        providerId: 'provider-github',
        evidenceDigest: null,
        context: null,
      },
      clock,
    );
    const payload = trail.history()[0]?.payload as Record<string, unknown>;
    expect(payload['taskId']).toBe('task-9');
    expect(payload['bodyId']).toBe('body-3');
    expect(payload['providerId']).toBe('provider-github');
  });

  it('malformed audit events are typed rejections (never stored)', () => {
    const clock = new ManualClock(1_700_000_000_000);
    const trail = new InMemoryAuditTrail(clock);
    expect(() => trail.append({ id: '', source: 'x', kind: 'k', occurred_at: '2023-11-14T22:13:20Z', payload: null, provenance: ['p'] })).toThrow();
    expect(() =>
      trail.append({ id: 'a', source: 'x', kind: 'k', occurred_at: 'not-a-timestamp', payload: null, provenance: ['p'] }),
    ).toThrow();
    expect(() => trail.append({ id: 'a', source: 'x', kind: 'k', occurred_at: '2023-11-14T22:13:20Z', payload: null, provenance: [] })).toThrow();
    expect(trail.history().length).toBe(0);
  });
});
