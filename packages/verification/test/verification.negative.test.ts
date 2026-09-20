import { describe, expect, it } from 'vitest';
import {
  assertValidMonitorEvaluationContext,
  createInMemoryReferenceEngine,
  evaluateMonitor,
} from '../src/index.js';
import type { MonitorDefinition } from '../src/index.js';
import { context } from './helpers.js';

/**
 * Negative tests for @sos-2/verification: malformed contexts, malformed
 * monitors/events at the sanctioned entry point, and the adapter-authority
 * boundary. Every refusal is loud.
 */

const MONITOR: MonitorDefinition = {
  id: 'monitor:negative',
  property: { kind: 'ALWAYS', predicate: 'p', description: 'A property.' },
};

describe('evaluation context validation (negative)', () => {
  it('rejects non-object and wrong-field-set contexts', () => {
    expect(() => assertValidMonitorEvaluationContext(null)).toThrow(/must be an object/);
    expect(() => assertValidMonitorEvaluationContext('ctx')).toThrow(/must be an object/);
    expect(() => assertValidMonitorEvaluationContext({ ...context(), extra: true })).toThrow(/exact field set/);
    const { now, ...missing } = context();
    expect(() => assertValidMonitorEvaluationContext(missing)).toThrow(/exact field set/);
  });

  it('rejects malformed instants, ids, versions and revision tokens', () => {
    expect(() => assertValidMonitorEvaluationContext({ ...context(), now: 'tomorrow' })).toThrow(/RFC3339/);
    expect(() => assertValidMonitorEvaluationContext({ ...context(), system_state_id: 'not-an-id' })).toThrow(
      /well-formed spine artifact id/,
    );
    expect(() => assertValidMonitorEvaluationContext({ ...context(), system_state_version: 0 })).toThrow(/integer >= 1/);
    expect(() => assertValidMonitorEvaluationContext({ ...context(), system_state_version: 1.5 })).toThrow(/integer >= 1/);
    expect(() => assertValidMonitorEvaluationContext({ ...context(), subject_revision: '' })).toThrow(
      /non-empty revision token/,
    );
    expect(() => assertValidMonitorEvaluationContext({ ...context(), implementation_revision: '' })).toThrow(
      /implementation_revision/,
    );
    expect(() => assertValidMonitorEvaluationContext({ ...context(), deployment_revision: '' })).toThrow(
      /deployment_revision/,
    );
  });

  it('rejects invalid producers', () => {
    expect(() => assertValidMonitorEvaluationContext({ ...context(), producer: { tool: '' } as never })).toThrow(
      /producer/,
    );
  });
});

describe('sanctioned entry point rejects malformed inputs (negative)', () => {
  it('rejects malformed monitors and events before any engine is consulted', () => {
    expect(() =>
      evaluateMonitor(createInMemoryReferenceEngine(), null as never, [], context()),
    ).toThrow(/exact fields/);
    expect(() =>
      evaluateMonitor(
        createInMemoryReferenceEngine(),
        { id: 'm', property: { kind: 'NOPE' } as never },
        [],
        context(),
      ),
    ).toThrow(/ALWAYS \/ RESPONSE \/ CUSTOM/);
    expect(() =>
      evaluateMonitor(createInMemoryReferenceEngine(), MONITOR, [{ predicate: 'p', holds: true, at: 'x' }], context()),
    ).toThrow(/RFC3339/);
    expect(() => evaluateMonitor(createInMemoryReferenceEngine(), MONITOR, 'events' as never, context())).toThrow(
      /array/,
    );
  });

  it('rejects engines that are not RuntimeMonitorEngines', () => {
    expect(() => evaluateMonitor(null as never, MONITOR, [], context())).toThrow(/RuntimeMonitorEngine/);
    expect(() =>
      evaluateMonitor({ id: 'x', supportedProperties: ['KIND'], evaluate: () => null } as never, MONITOR, [], context()),
    ).toThrow(/RuntimeMonitorEngine/);
  });

  it('an engine throwing inside evaluate surfaces loudly (never silently swallowed)', () => {
    const exploding: never = {
      id: 'exploding-engine',
      supportedProperties: ['ALWAYS'],
      evaluate: () => {
        throw new Error('engine exploded');
      },
    } as never;
    expect(() => evaluateMonitor(exploding, MONITOR, [], context())).toThrow(/engine exploded/);
  });

  it('an engine returning a non-object result is refused', () => {
    const nullResult: never = {
      id: 'null-engine',
      supportedProperties: ['ALWAYS'],
      evaluate: () => null,
    } as never;
    expect(() => evaluateMonitor(nullResult, MONITOR, [], context())).toThrow(/must be an object/);
  });

  it('an engine returning a wrong monitor_id echo is refused', () => {
    const ctx = context();
    const honest = createInMemoryReferenceEngine().evaluate(MONITOR, [], ctx);
    const wrongEcho: never = {
      id: 'echo-engine',
      supportedProperties: ['ALWAYS'],
      evaluate: () => ({ ...honest, monitor_id: 'monitor:someone-elses' }),
    } as never;
    expect(() => evaluateMonitor(wrongEcho, MONITOR, [], ctx)).toThrow(/echo/);
  });

  it('an engine returning an empty reason is refused', () => {
    const ctx = context();
    const honest = createInMemoryReferenceEngine().evaluate(MONITOR, [], ctx);
    const emptyReason: never = {
      id: 'silent-engine',
      supportedProperties: ['ALWAYS'],
      evaluate: () => ({ ...honest, reason: '' }),
    } as never;
    expect(() => evaluateMonitor(emptyReason, MONITOR, [], ctx)).toThrow(/reason/);
  });

  it('an engine returning no links is refused (results must OBSERVE the SystemState)', () => {
    const ctx = context();
    const honest = createInMemoryReferenceEngine().evaluate(MONITOR, [], ctx);
    const noLinks: never = {
      id: 'unlinked-engine',
      supportedProperties: ['ALWAYS'],
      evaluate: () => ({ ...honest, links: [] }),
    } as never;
    expect(() => evaluateMonitor(noLinks, MONITOR, [], ctx)).toThrow(/links/);
  });
});
