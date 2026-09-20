import { describe, expect, it } from 'vitest';
import {
  REFERENCE_ENGINE_ID,
  createInMemoryReferenceEngine,
  evaluateMonitor,
} from '../src/index.js';
import type { MonitorDefinition, MonitorEvent } from '../src/index.js';
import { context } from './helpers.js';

describe('in-memory reference engine — ALWAYS semantics', () => {
  const monitor: MonitorDefinition = {
    id: 'monitor:idempotency',
    property: {
      kind: 'ALWAYS',
      predicate: 'payment.idempotency_key_present',
      description: 'Every payment request carries an idempotency key.',
    },
  };

  it('SATISFIED / SUCCESS when every observed point holds', () => {
    const result = evaluateMonitor(
      createInMemoryReferenceEngine(),
      monitor,
      [
        { predicate: 'payment.idempotency_key_present', holds: true, at: '2025-06-01T00:00:30.000Z' },
        { predicate: 'payment.idempotency_key_present', holds: true, at: '2025-06-01T00:01:30.000Z' },
      ],
      context(),
    );
    expect(result.verdict).toBe('SATISFIED');
    expect(result.availability).toBe('SUCCESS');
    expect(result.evidence.availability).toBe('SUCCESS');
    expect(result.evidence.kind).toBe('runtime-monitor');
  });

  it('VIOLATED / FAILURE on a positively witnessed violation (earliest cited)', () => {
    const result = evaluateMonitor(
      createInMemoryReferenceEngine(),
      monitor,
      [
        { predicate: 'payment.idempotency_key_present', holds: false, at: '2025-06-01T00:00:30.000Z' },
        { predicate: 'payment.idempotency_key_present', holds: false, at: '2025-06-01T00:05:00.000Z' },
      ],
      context(),
    );
    expect(result.verdict).toBe('VIOLATED');
    expect(result.availability).toBe('FAILURE');
    expect(result.reason).toContain('2025-06-01T00:00:30.000Z');
    expect(result.evidence.availability).toBe('FAILURE');
  });

  it('INCONCLUSIVE / UNAVAILABLE when no observations of the predicate exist (a gap is no data)', () => {
    const result = evaluateMonitor(
      createInMemoryReferenceEngine(),
      monitor,
      [{ predicate: 'unrelated.predicate', holds: true, at: '2025-06-01T00:00:30.000Z' }],
      context(),
    );
    expect(result.verdict).toBe('INCONCLUSIVE');
    expect(result.availability).toBe('UNAVAILABLE');
    expect(result.reason).toContain('never read as satisfaction');
  });

  it('ignores events about other predicates', () => {
    const result = evaluateMonitor(
      createInMemoryReferenceEngine(),
      monitor,
      [
        { predicate: 'other', holds: false, at: '2025-06-01T00:00:30.000Z' },
        { predicate: 'payment.idempotency_key_present', holds: true, at: '2025-06-01T00:01:00.000Z' },
      ],
      context(),
    );
    expect(result.verdict).toBe('SATISFIED');
  });
});

describe('in-memory reference engine — RESPONSE semantics', () => {
  const monitor = (within_ms: number | null): MonitorDefinition => ({
    id: 'monitor:payment-settles',
    property: {
      kind: 'RESPONSE',
      trigger: 'payment.initiated',
      response: 'payment.settled',
      within_ms,
      description: 'Every initiated payment settles.',
    },
  });

  it('SATISFIED / SUCCESS when every trigger is answered in bound', () => {
    const result = evaluateMonitor(
      createInMemoryReferenceEngine(),
      monitor(60_000),
      [
        { predicate: 'payment.initiated', holds: true, at: '2025-06-01T00:00:00.000Z' },
        { predicate: 'payment.settled', holds: true, at: '2025-06-01T00:00:59.000Z' },
        { predicate: 'payment.initiated', holds: true, at: '2025-06-01T00:01:00.000Z' },
        { predicate: 'payment.settled', holds: true, at: '2025-06-01T00:01:30.000Z' },
      ],
      context(),
    );
    expect(result.verdict).toBe('SATISFIED');
    expect(result.availability).toBe('SUCCESS');
  });

  it('VIOLATED / FAILURE on a witnessed deadline miss', () => {
    // Trigger at 00:00:00 with a 60s deadline; no response; now = 00:10:00.
    const result = evaluateMonitor(
      createInMemoryReferenceEngine(),
      monitor(60_000),
      [{ predicate: 'payment.initiated', holds: true, at: '2025-06-01T00:00:00.000Z' }],
      context(),
    );
    expect(result.verdict).toBe('VIOLATED');
    expect(result.availability).toBe('FAILURE');
    expect(result.reason).toContain('missed its response deadline');
  });

  it('INCONCLUSIVE / UNKNOWN while every deadline is still open', () => {
    // Deadline 600s from 00:09:30; now is 00:10:00 -> still open.
    const result = evaluateMonitor(
      createInMemoryReferenceEngine(),
      monitor(600_000),
      [{ predicate: 'payment.initiated', holds: true, at: '2025-06-01T00:09:30.000Z' }],
      context(),
    );
    expect(result.verdict).toBe('INCONCLUSIVE');
    expect(result.availability).toBe('UNKNOWN');
  });

  it('INCONCLUSIVE / PARTIAL when some triggers are answered and others still open', () => {
    const result = evaluateMonitor(
      createInMemoryReferenceEngine(),
      monitor(600_000),
      [
        { predicate: 'payment.initiated', holds: true, at: '2025-06-01T00:01:00.000Z' },
        { predicate: 'payment.settled', holds: true, at: '2025-06-01T00:01:10.000Z' },
        { predicate: 'payment.initiated', holds: true, at: '2025-06-01T00:09:00.000Z' },
      ],
      context(),
    );
    expect(result.verdict).toBe('INCONCLUSIVE');
    expect(result.availability).toBe('PARTIAL');
    expect(result.reason).toContain('1 of 2');
  });

  it('INCONCLUSIVE / UNKNOWN when the property is never exercised (vacuous satisfaction never reported)', () => {
    const result = evaluateMonitor(
      createInMemoryReferenceEngine(),
      monitor(null),
      [{ predicate: 'payment.settled', holds: true, at: '2025-06-01T00:00:00.000Z' }],
      context(),
    );
    expect(result.verdict).toBe('INCONCLUSIVE');
    expect(result.availability).toBe('UNKNOWN');
    expect(result.reason).toContain('never exercised');
    expect(result.reason).toContain('VACUOUS');
  });

  it('unbounded (within_ms null) response is never violated by the clock alone', () => {
    const result = evaluateMonitor(
      createInMemoryReferenceEngine(),
      monitor(null),
      [{ predicate: 'payment.initiated', holds: true, at: '2025-06-01T00:00:00.000Z' }],
      context(),
    );
    expect(result.verdict).toBe('INCONCLUSIVE');
    expect(result.availability).toBe('UNKNOWN');
  });

  it('a late response outside the bound does not answer the trigger', () => {
    // Trigger 00:00:00, bound 60s, response at 00:09:00 (late), now 00:10:00.
    const result = evaluateMonitor(
      createInMemoryReferenceEngine(),
      monitor(60_000),
      [
        { predicate: 'payment.initiated', holds: true, at: '2025-06-01T00:00:00.000Z' },
        { predicate: 'payment.settled', holds: true, at: '2025-06-01T00:09:00.000Z' },
      ],
      context(),
    );
    expect(result.verdict).toBe('VIOLATED');
  });

  it('trigger events with holds=false do not fire the property', () => {
    const result = evaluateMonitor(
      createInMemoryReferenceEngine(),
      monitor(60_000),
      [{ predicate: 'payment.initiated', holds: false, at: '2025-06-01T00:00:00.000Z' }],
      context(),
    );
    expect(result.verdict).toBe('INCONCLUSIVE');
    expect(result.availability).toBe('UNKNOWN');
    expect(result.reason).toContain('never exercised');
  });
});

describe('in-memory reference engine — CUSTOM and unsupported properties', () => {
  it('truthfully reports UNSUPPORTED for CUSTOM properties (distinct from UNKNOWN)', () => {
    const monitor: MonitorDefinition = {
      id: 'monitor:ltl-custom',
      property: {
        kind: 'CUSTOM',
        engine: 'ltl-engine-v2',
        payload: { formula: 'G(req -> F(resp))' },
        description: 'An LTL property the reference engine cannot evaluate.',
      },
    };
    const engine = createInMemoryReferenceEngine();
    expect(engine.supportedProperties).toEqual(['ALWAYS', 'RESPONSE']);
    const result = evaluateMonitor(engine, monitor, [], context());
    expect(result.verdict).toBe('INCONCLUSIVE');
    expect(result.availability).toBe('UNSUPPORTED');
    expect(result.reason).toContain('UNSUPPORTED is never folded into UNKNOWN');
    expect(result.evidence.availability).toBe('UNSUPPORTED');
  });
});

describe('monitor result evidence binding', () => {
  const monitor: MonitorDefinition = {
    id: 'monitor:binding',
    property: { kind: 'ALWAYS', predicate: 'p.holds', description: 'Predicate p always holds.' },
  };
  const events: MonitorEvent[] = [{ predicate: 'p.holds', holds: true, at: '2025-06-01T00:01:00.000Z' }];

  it('evidence binds to the exact SystemState/implementation revisions', () => {
    const ctx = context();
    const result = evaluateMonitor(createInMemoryReferenceEngine(), monitor, events, ctx);
    expect(result.evidence.subject_ref).toBe(ctx.system_state_id);
    expect(result.evidence.subject_revision).toBe(ctx.subject_revision);
    expect(result.evidence.source_revision).toBe(ctx.implementation_revision);
    expect(result.evidence.deployment_revision).toBe(ctx.deployment_revision);
    expect(result.evidence.evidence_class).toBe('OBSERVATIONAL');
    expect(result.evidence.observational).toBe(true);
    expect(result.evidence.method).toBe(`runtime-verification:${REFERENCE_ENGINE_ID}`);
    expect(result.evidence.provenance.join('\n')).toContain('runtime-monitor:monitor:binding');
    expect(result.evidence.provenance.join('\n')).toContain(`system-state:${ctx.system_state_id}@v1`);
    // The observation window encloses the events.
    expect(result.evidence.window).toEqual({ start: '2025-06-01T00:01:00.000Z', end: '2025-06-01T00:01:00.000Z' });
  });

  it('mints an OBSERVES link to the monitored SystemState', () => {
    const ctx = context();
    const result = evaluateMonitor(createInMemoryReferenceEngine(), monitor, events, ctx);
    expect(result.links.length).toBe(1);
    expect(result.links[0]).toMatchObject({
      source: result.evidence.id,
      target: ctx.system_state_id,
      type: 'OBSERVES',
    });
  });

  it('empty event lists produce null windows and UNAVAILABLE/UNKNOWN verdicts', () => {
    const result = evaluateMonitor(createInMemoryReferenceEngine(), monitor, [], context());
    expect(result.evidence.window).toBeNull();
    expect(result.availability).toBe('UNAVAILABLE');
  });

  it('null revisions are preserved, never defaulted', () => {
    const ctx = context({ implementation_revision: null, deployment_revision: null });
    const result = evaluateMonitor(createInMemoryReferenceEngine(), monitor, events, ctx);
    expect(result.evidence.source_revision).toBeNull();
    expect(result.evidence.deployment_revision).toBeNull();
  });
});
