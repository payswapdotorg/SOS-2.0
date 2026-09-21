/**
 * ADVERSARIAL CLASS 6 — ASSURANCE MONITOR FAILURE (monitor-down is NOT
 * monitor-green; the failure is surfaced).
 *
 * The fault: the runtime verification monitor cannot establish its property
 * (no events observed, unsupported property kind, or the property is
 * actively violated). The system must return INCONCLUSIVE/VIOLATED verdicts
 * with their honest availability mapping (UNAVAILABLE/UNKNOWN/UNSUPPORTED
 * — never SUCCESS), never "SATISFIED by absence of data" — and the trace
 * chain stays queryable.
 */

import { describe, expect, test } from 'vitest';
import {
  MONITOR_VERDICT_AVAILABILITY,
  availabilityAllowedForVerdict,
  createInMemoryReferenceEngine,
  evaluateMonitor,
} from '@sos-2/verification';
import type { MonitorEvaluationContext } from '@sos-2/verification';
import { assertTraceQueryable, subjectId, toolProducer } from './helpers.js';
import { T1 } from './helpers.js';

const CONTEXT: MonitorEvaluationContext = {
  now: T1,
  system_state_id: subjectId('SystemState', 'adversarial-6-state'),
  system_state_version: 1,
  subject_revision: 'system-state@v1',
  implementation_revision: 'git:31f2a9c07d9e5b864a2c0f7d3e8b1a6c95d4f0e2',
  deployment_revision: 'oci:sha256:' + 'a'.repeat(64),
  producer: toolProducer(),
};

describe('adversarial class 6: assurance monitor failure', () => {
  test('an ALWAYS monitor with NO events is INCONCLUSIVE + UNAVAILABLE (monitor-down is not monitor-green)', () => {
    const engine = createInMemoryReferenceEngine();
    const monitor = {
      id: 'monitor:always-no-events',
      property: { kind: 'ALWAYS', predicate: 'error_rate < 0.01', description: 'the error rate stays under 1%' },
    } as const;
    const result = evaluateMonitor(engine, monitor, [], CONTEXT);
    expect(result.verdict).toBe('INCONCLUSIVE');
    expect(result.availability).toBe('UNAVAILABLE');
    expect(result.reason.length).toBeGreaterThan(0);
    // The evidence record carries the honest truth state.
    expect(result.evidence.availability).toBe('UNAVAILABLE');
    expect(result.evidence.kind).toBe('runtime-monitor');
  });

  test('an unsupported property kind is INCONCLUSIVE + UNSUPPORTED (distinct from unknown)', () => {
    const engine = createInMemoryReferenceEngine();
    const monitor = {
      id: 'monitor:custom-property',
      property: { kind: 'CUSTOM', engine: 'some-external-engine', payload: { query: '...' }, description: 'a property the reference engine cannot evaluate' },
    } as const;
    const result = evaluateMonitor(engine, monitor, [], CONTEXT);
    expect(result.verdict).toBe('INCONCLUSIVE');
    expect(result.availability).toBe('UNSUPPORTED');
    expect(result.evidence.availability).toBe('UNSUPPORTED');
  });

  test('a RESPONSE monitor with no trigger observed is INCONCLUSIVE (vacuous satisfaction never reported)', () => {
    const engine = createInMemoryReferenceEngine();
    const monitor = {
      id: 'monitor:response-idle',
      property: { kind: 'RESPONSE', trigger: 'alert:page-load', response: 'action:mitigate', within_ms: 30000, description: 'mitigation follows every alert' },
    } as const;
    const result = evaluateMonitor(engine, monitor, [], CONTEXT);
    expect(result.verdict).toBe('INCONCLUSIVE');
    expect(['UNKNOWN', 'UNAVAILABLE']).toContain(result.availability);
  });

  test('an actively violated monitor is VIOLATED + FAILURE (surfaced, never green)', () => {
    const engine = createInMemoryReferenceEngine();
    const monitor = {
      id: 'monitor:always-violated',
      property: { kind: 'ALWAYS', predicate: 'error_rate < 0.01', description: 'the error rate stays under 1%' },
    } as const;
    const events = [
      { predicate: 'error_rate < 0.01', holds: true, at: '2025-06-01T00:00:30.000Z' },
      { predicate: 'error_rate < 0.01', holds: false, at: '2025-06-01T00:01:00.000Z' },
    ];
    const result = evaluateMonitor(engine, monitor, events, CONTEXT);
    expect(result.verdict).toBe('VIOLATED');
    expect(result.availability).toBe('FAILURE');
    expect(result.evidence.availability).toBe('FAILURE');
  });

  test('the frozen verdict<->availability mapping refuses dishonest pairings', () => {
    expect(availabilityAllowedForVerdict('SATISFIED', 'SUCCESS')).toBe(true);
    // Monitor-down is NEVER satisfiable.
    expect(availabilityAllowedForVerdict('SATISFIED', 'UNAVAILABLE')).toBe(false);
    expect(availabilityAllowedForVerdict('SATISFIED', 'UNKNOWN')).toBe(false);
    expect(availabilityAllowedForVerdict('VIOLATED', 'SUCCESS')).toBe(false);
    expect(MONITOR_VERDICT_AVAILABILITY.INCONCLUSIVE).toContain('UNAVAILABLE');
    expect(MONITOR_VERDICT_AVAILABILITY.INCONCLUSIVE).toContain('UNKNOWN');
    expect(MONITOR_VERDICT_AVAILABILITY.INCONCLUSIVE).toContain('UNSUPPORTED');
    expect(MONITOR_VERDICT_AVAILABILITY.INCONCLUSIVE).toContain('PARTIAL');
  });

  test('the trace chain stays queryable after the monitor failure', () => {
    const engine = createInMemoryReferenceEngine();
    const monitor = {
      id: 'monitor:always-no-events-b',
      property: { kind: 'ALWAYS', predicate: 'error_rate < 0.01', description: 'the error rate stays under 1%' },
    } as const;
    const result = evaluateMonitor(engine, monitor, [], CONTEXT);
    // The failed monitor's evidence still OBSERVES the system state.
    const { queryFrom, queryTo } = assertTraceQueryable([result.links[0]!]);
    expect(queryFrom(result.evidence.id).length).toBe(1);
    expect(queryTo(CONTEXT.system_state_id).length).toBe(1);
    expect(result.links[0]!.type).toBe('OBSERVES');
  });
});
