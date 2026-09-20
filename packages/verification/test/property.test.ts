import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  MONITOR_VERDICT_AVAILABILITY,
  availabilityAllowedForVerdict,
  createInMemoryReferenceEngine,
  evaluateMonitor,
  validateMonitorDefinition,
} from '../src/index.js';
import type { MonitorDefinition, MonitorEvent } from '../src/index.js';
import { context } from './helpers.js';

/**
 * Property tests for @sos-2/verification (fixed seed — deterministic and
 * reproducible across runs): evaluation determinism + canonical round trips
 * + mapping totality over randomized monitors and event lists.
 */

const fcPredicate = fc.stringMatching(/^[a-z][a-z0-9_.]{2,24}$/);

const fcMonitor: fc.Arbitrary<MonitorDefinition> = fc
  .record({
    id: fc.stringMatching(/^monitor:[a-z][a-z0-9-]{2,20}$/),
    kind: fc.constantFrom<'ALWAYS' | 'RESPONSE'>('ALWAYS', 'RESPONSE'),
    predicate: fcPredicate,
    trigger: fcPredicate,
    response: fcPredicate,
    within: fc.option(fc.integer({ min: 1, max: 600_000 }), { nil: null }),
  })
  .filter((partial) => partial.trigger !== partial.response)
  .map((partial) => {
    if (partial.kind === 'ALWAYS') {
      return {
        id: partial.id,
        property: {
          kind: 'ALWAYS' as const,
          predicate: partial.predicate,
          description: 'A generated invariant property.',
        },
      };
    }
    return {
      id: partial.id,
      property: {
        kind: 'RESPONSE' as const,
        trigger: partial.trigger,
        response: partial.response,
        within_ms: partial.within,
        description: 'A generated response property.',
      },
    };
  });

const INSTANTS = [
  '2025-06-01T00:00:00.000Z',
  '2025-06-01T00:00:30.000Z',
  '2025-06-01T00:01:00.000Z',
  '2025-06-01T00:05:00.000Z',
  '2025-06-01T00:09:59.000Z',
] as const;

const fcEvent: fc.Arbitrary<MonitorEvent> = fc
  .record({
    predicate: fcPredicate,
    holds: fc.boolean(),
    at: fc.constantFrom(...INSTANTS),
  })
  .map((event) => ({ predicate: event.predicate, holds: event.holds, at: event.at }));

describe('property: randomized monitors', () => {
  it('every generated monitor is valid and evaluates deterministically to identical evidence ids', () => {
    fc.assert(
      fc.property(fcMonitor, fc.array(fcEvent, { maxLength: 8 }), (monitor, events) => {
        expect(validateMonitorDefinition(monitor)).toBe(true);
        const ctx = context();
        const a = evaluateMonitor(createInMemoryReferenceEngine(), monitor, events, ctx);
        const b = evaluateMonitor(createInMemoryReferenceEngine(), monitor, JSON.parse(JSON.stringify(events)), {
          ...ctx,
        });
        expect(a).toEqual(b);
        expect(a.evidence.id).toMatch(/^sos:\/\/Evidence\/[0-9a-f]{32}$/);
        // Different events (by content) yield different evidence, EXCEPT when
        // the differing events are irrelevant to the property — the monitor
        // consults only its declared predicates (documented semantics).
        return true;
      }),
    );
  });

  it('the frozen verdict/availability mapping holds for every generated evaluation', () => {
    fc.assert(
      fc.property(fcMonitor, fc.array(fcEvent, { maxLength: 8 }), (monitor, events) => {
        const result = evaluateMonitor(createInMemoryReferenceEngine(), monitor, events, context());
        expect(availabilityAllowedForVerdict(result.verdict, result.availability)).toBe(true);
        expect(result.evidence.availability).toBe(result.availability);
        expect(MONITOR_VERDICT_AVAILABILITY[result.verdict]).toContain(result.availability);
        return true;
      }),
    );
  });

  it('canonical round trips: JSON serialize -> parse -> identical result', () => {
    fc.assert(
      fc.property(fcMonitor, fc.array(fcEvent, { maxLength: 6 }), (monitor, events) => {
        const result = evaluateMonitor(createInMemoryReferenceEngine(), monitor, events, context());
        const round = JSON.parse(JSON.stringify(result));
        expect(round).toEqual(result);
        return true;
      }),
    );
  });

  it('ALWAYS over all-holding events is SATISFIED; a single violation flips it to VIOLATED', () => {
    fc.assert(
      fc.property(fcPredicate, fc.array(fc.boolean(), { minLength: 1, maxLength: 8 }), (predicate, holdsList) => {
        const monitor: MonitorDefinition = {
          id: 'monitor:generated-always',
          property: { kind: 'ALWAYS', predicate, description: 'Generated.' },
        };
        const events: MonitorEvent[] = holdsList.map((holds, index) => ({
          predicate,
          holds,
          at: INSTANTS[index % INSTANTS.length]!,
        }));
        const result = evaluateMonitor(createInMemoryReferenceEngine(), monitor, events, context());
        expect(result.verdict).toBe(holdsList.every((holds) => holds) ? 'SATISFIED' : 'VIOLATED');
        expect(result.availability).toBe(holdsList.every((holds) => holds) ? 'SUCCESS' : 'FAILURE');
        return true;
      }),
    );
  });

  it('an ALWAYS monitor over an empty trace is never SATISFIED (gap semantics)', () => {
    fc.assert(
      fc.property(fcPredicate, (predicate) => {
        const monitor: MonitorDefinition = {
          id: 'monitor:generated-always',
          property: { kind: 'ALWAYS', predicate, description: 'Generated.' },
        };
        const result = evaluateMonitor(createInMemoryReferenceEngine(), monitor, [], context());
        expect(result.verdict).toBe('INCONCLUSIVE');
        expect(result.availability).toBe('UNAVAILABLE');
        return true;
      }),
    );
  });
});
