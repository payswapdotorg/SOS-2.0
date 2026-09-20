import { describe, expect, it } from 'vitest';
import {
  assertValidMonitorDefinition,
  assertValidMonitorEvent,
  assertValidMonitorEvents,
  validateMonitorDefinition,
  validateMonitorProperty,
} from '../src/index.js';
import type { MonitorDefinition, MonitorEvent } from '../src/index.js';

describe('monitor definitions', () => {
  it('accepts a valid ALWAYS definition', () => {
    const monitor: MonitorDefinition = {
      id: 'monitor:payments-idempotent',
      property: {
        kind: 'ALWAYS',
        predicate: 'payment.idempotency_key_present',
        description: 'Every payment request carries an idempotency key.',
      },
    };
    expect(validateMonitorDefinition(monitor)).toBe(true);
  });

  it('accepts a valid RESPONSE definition with and without a deadline', () => {
    const bounded: MonitorDefinition = {
      id: 'monitor:payment-settles',
      property: {
        kind: 'RESPONSE',
        trigger: 'payment.initiated',
        response: 'payment.settled',
        within_ms: 60_000,
        description: 'Every initiated payment settles within 60 seconds.',
      },
    };
    const eventual: MonitorDefinition = {
      id: 'monitor:refund-eventually',
      property: {
        kind: 'RESPONSE',
        trigger: 'payment.failed',
        response: 'refund.issued',
        within_ms: null,
        description: 'Every failed payment is eventually refunded.',
      },
    };
    expect(validateMonitorDefinition(bounded)).toBe(true);
    expect(validateMonitorDefinition(eventual)).toBe(true);
  });

  it('accepts a valid CUSTOM definition (engine-specific payload)', () => {
    const monitor: MonitorDefinition = {
      id: 'monitor:ltl-custom',
      property: {
        kind: 'CUSTOM',
        engine: 'ltl-engine-v2',
        payload: { formula: 'G(req -> F(resp))', alphabet: ['req', 'resp'] },
        description: 'An LTL property evaluated by an external engine.',
      },
    };
    expect(validateMonitorDefinition(monitor)).toBe(true);
    expect(validateMonitorProperty(monitor.property)).toBe(true);
  });

  it('rejects wrong field sets and empty ids', () => {
    expect(() =>
      assertValidMonitorDefinition({ id: '', property: { kind: 'ALWAYS', predicate: 'p', description: 'd' } }),
    ).toThrow(/id/);
    expect(() =>
      assertValidMonitorDefinition({
        id: 'm',
        property: { kind: 'ALWAYS', predicate: 'p', description: 'd' },
        extra: true,
      } as never),
    ).toThrow(/exact fields/);
  });

  it('rejects unknown property kinds and per-kind field violations', () => {
    expect(() => assertValidMonitorDefinition({ id: 'm', property: { kind: 'SOMETIMES' } as never })).toThrow(
      /ALWAYS \/ RESPONSE \/ CUSTOM/,
    );
    expect(() =>
      assertValidMonitorDefinition({
        id: 'm',
        property: { kind: 'ALWAYS', predicate: '', description: 'd' },
      }),
    ).toThrow(/predicate/);
    expect(() =>
      assertValidMonitorDefinition({
        id: 'm',
        property: { kind: 'RESPONSE', trigger: 't', response: 't', within_ms: null, description: 'd' },
      }),
    ).toThrow(/distinct/);
    expect(() =>
      assertValidMonitorDefinition({
        id: 'm',
        property: { kind: 'RESPONSE', trigger: 't', response: 'r', within_ms: 0, description: 'd' },
      }),
    ).toThrow(/within_ms/);
  });

  it('rejects CUSTOM payloads that are not canonical-serializable', () => {
    expect(() =>
      assertValidMonitorDefinition({
        id: 'm',
        property: { kind: 'CUSTOM', engine: 'e', payload: undefined, description: 'd' },
      }),
    ).toThrow(/payload/);
    expect(() =>
      assertValidMonitorDefinition({
        id: 'm',
        property: { kind: 'CUSTOM', engine: 'e', payload: () => 1, description: 'd' },
      }),
    ).toThrow(/payload/);
  });
});

describe('monitor events', () => {
  it('accepts valid events and event lists', () => {
    const events: MonitorEvent[] = [
      { predicate: 'p', holds: true, at: '2025-06-01T00:00:00.000Z' },
      { predicate: 'p', holds: false, at: '2025-06-01T00:01:00.000Z' },
    ];
    expect(() => assertValidMonitorEvents(events)).not.toThrow();
    expect(() => assertValidMonitorEvent(events[0]!)).not.toThrow();
  });

  it('rejects malformed events', () => {
    expect(() => assertValidMonitorEvent({ predicate: '', holds: true, at: '2025-06-01T00:00:00.000Z' })).toThrow(
      /predicate/,
    );
    expect(() => assertValidMonitorEvent({ predicate: 'p', holds: 'yes', at: '2025-06-01T00:00:00.000Z' })).toThrow(
      /holds/,
    );
    expect(() => assertValidMonitorEvent({ predicate: 'p', holds: true, at: 'yesterday' })).toThrow(/RFC3339/);
    expect(() => assertValidMonitorEvent({ predicate: 'p', holds: true })).toThrow(/exact fields/);
  });
});
