/**
 * PINNED: body crash and provider outage recover cleanly through the
 * typed records — dead-letter + bounded retry (then ASK, never silent
 * drop, never infinite retry) and honest UNKNOWN provider health
 * during outage windows (the P7 truthful-stale discipline).
 *
 * The provider-health aggregate is verified EQUIVALENT to the merged
 * P3 infra/deployment diagnostics aggregate (imported directly from
 * the merged module through the relative source path).
 */
import { describe, expect, it } from 'vitest';
import {
  initialDeadLetterState,
  recordFailure,
  evaluateRetry,
  escalateToAsk,
  ProviderHealthTracker,
  aggregateProviderHealth,
  type ProbeReport,
  type RetryBackoffPolicy,
  type DeadLetterState,
} from '@sos-2/cost-policy';
import { aggregateProviderHealth as p3AggregateProviderHealth } from '../../infra/deployment/src/health/diagnostics.ts';
import { ManualClock } from './helpers.js';

const POLICY: RetryBackoffPolicy = { maxAttempts: 3, backoffBaseMs: 100, backoffMaxMs: 1_000 };
const NOW = 1_000_000;

describe('acceptance: body crash and provider outage recover cleanly (typed records)', () => {
  it('PINNED: a body crash lands in the typed dead-letter state and retries on a bounded, capped schedule', () => {
    let state = initialDeadLetterState('task-1', 'mission-1', 'executor:invoke');
    state = recordFailure(state, 'BODY_CRASH', NOW);
    const first = evaluateRetry(state, POLICY, true, NOW);
    expect(first.kind).toBe('RETRY');
    if (first.kind === 'RETRY') {
      expect(first.delayMs).toBe(200); // capped exponential: base * 2^(attempt-1)
      expect(first.nextAttemptAt).toBe(NOW + 200);
    }
    // the durable recovery data survives (identity + attempt history):
    expect(state.taskId).toBe('task-1');
    expect(state.attempts).toBe(1);
    expect(state.lastErrorType).toBe('BODY_CRASH');
  });

  it('PINNED: retries are BOUNDED — exhaustion escalates to ASK (never an infinite loop)', () => {
    let state = initialDeadLetterState('task-2', null, 'provider:call');
    for (let attempt = 0; attempt < POLICY.maxAttempts; attempt += 1) {
      state = recordFailure(state, 'PROVIDER_TIMEOUT', NOW + attempt * 1_000);
    }
    const decision = evaluateRetry(state, POLICY, true, NOW + 10_000);
    expect(decision.kind).toBe('ESCALATE_ASK');
    if (decision.kind === 'ESCALATE_ASK') {
      expect(decision.reason).toBe('RETRIES_EXHAUSTED');
      const escalation = escalateToAsk(state, 'RETRIES_EXHAUSTED', decision.detail, NOW + 10_000);
      expect(escalation.taskId).toBe('task-2');
      expect(escalation.deduplicationKey).toBe('dead-letter:task-2:RETRIES_EXHAUSTED');
    }
  });

  it('PINNED: never a silent drop — non-retryable errors escalate to ASK immediately', () => {
    const state = recordFailure(initialDeadLetterState('task-3', null, 'action:push'), 'CONTRACT_VIOLATION', NOW);
    const decision = evaluateRetry(state, POLICY, false, NOW);
    expect(decision.kind).toBe('ESCALATE_ASK');
    if (decision.kind === 'ESCALATE_ASK') {
      expect(decision.reason).toBe('NON_RETRYABLE');
    }
  });

  it('PINNED: provider outage windows keep health honest — UNKNOWN without observations, never fabricated', () => {
    const clock = new ManualClock(NOW);
    const tracker = new ProviderHealthTracker(clock);
    // During an outage window with NO observations, an unprobed provider is UNKNOWN:
    expect(tracker.current('provider-neon').status).toBe('UNKNOWN');
    // An observation of unavailability says so:
    tracker.reportProbe('provider-neon', 'probe-1', { status: 'UNAVAILABLE', detail: 'connection refused' });
    expect(tracker.current('provider-neon').status).toBe('UNAVAILABLE');
    // Recovery requires a NEW observation (never assumed from silence):
    clock.advance(60_000);
    expect(tracker.current('provider-neon').status).toBe('UNAVAILABLE'); // last observed evidence stands
    tracker.reportProbe('provider-neon', 'probe-1', { status: 'HEALTHY', detail: 'recovered' });
    expect(tracker.current('provider-neon').status).toBe('HEALTHY');
  });

  it('PINNED: HEALTHY only with at least one probe and every probe HEALTHY (no fabricated health)', () => {
    expect(aggregateProviderHealth([])).toBe('UNKNOWN');
    expect(aggregateProviderHealth([probe('p1', 'UNKNOWN', 1)])).toBe('UNKNOWN');
    expect(aggregateProviderHealth([probe('p1', 'HEALTHY', 1), probe('p2', 'UNKNOWN', 2)])).toBe('UNKNOWN');
    expect(aggregateProviderHealth([probe('p1', 'HEALTHY', 1)])).toBe('HEALTHY');
  });

  it('the P14 health aggregate agrees with the merged P3 diagnostics aggregate on every combination', () => {
    const statuses = ['UNKNOWN', 'UNAVAILABLE', 'DEGRADED', 'HEALTHY'] as const;
    for (const a of statuses) {
      for (const b of statuses) {
        for (const c of statuses) {
          const reports: ProbeReport[] = [
            probe('p1', a, 1),
            probe('p2', b, 2),
            probe('p3', c, 3),
          ];
          const p3Reports = reports.map((report) => ({ probeId: report.probeId, status: report.status, detail: report.detail ?? undefined, checkedAtMs: report.checkedAt }));
          expect(aggregateProviderHealth(reports), `${a},${b},${c}`).toBe(p3AggregateProviderHealth(p3Reports));
        }
      }
    }
  });

  it('a full crash-recovery walk: crash -> bounded retries -> ASK with durable state intact', () => {
    let state: DeadLetterState = initialDeadLetterState('task-9', 'mission-4', 'body:lease');
    const timeline: string[] = [];
    for (let attempt = 0; attempt < POLICY.maxAttempts; attempt += 1) {
      state = recordFailure(state, 'BODY_CRASH', NOW + attempt * 500);
      const decision = evaluateRetry(state, POLICY, true, NOW + attempt * 500);
      if (decision.kind === 'RETRY') {
        timeline.push(`retry:${decision.delayMs}`);
      } else {
        timeline.push(`ask:${decision.reason}`);
        const escalation = escalateToAsk(state, decision.reason, decision.detail, NOW + attempt * 500);
        expect(escalation.taskId).toBe('task-9');
        expect(escalation.provenance.length).toBeGreaterThan(0);
      }
    }
    expect(timeline).toEqual(['retry:200', 'retry:400', 'ask:RETRIES_EXHAUSTED']);
    expect(state.missionId).toBe('mission-4'); // durable link survives
    expect(state.attempts).toBe(POLICY.maxAttempts);
  });
});

function probe(probeId: string, status: ProbeReport['status'], checkedAt: number): ProbeReport {
  return { probeId, status, detail: null, checkedAt };
}
