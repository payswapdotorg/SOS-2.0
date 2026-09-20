import { describe, expect, it } from 'vitest';
import {
  assertValidMonitorEvaluationResult,
  createInMemoryReferenceEngine,
  evaluateMonitor,
  isRuntimeMonitorEngine,
  mintMonitorEvidence,
  monitorObservesLink,
} from '../src/index.js';
import type {
  MonitorDefinition,
  MonitorEvaluationContext,
  MonitorEvaluationResult,
  MonitorEvent,
  RuntimeMonitorEngine,
} from '../src/index.js';
import { validateTraceLink } from '@sos-2/semantic-spine';
import { createEvidence } from '@sos-2/evidence';
import { context, toolProducer } from './helpers.js';

describe('engine contract guard', () => {
  it('recognizes the reference engine as a RuntimeMonitorEngine', () => {
    expect(isRuntimeMonitorEngine(createInMemoryReferenceEngine())).toBe(true);
  });

  it('rejects non-engine shapes', () => {
    expect(isRuntimeMonitorEngine(null)).toBe(false);
    expect(isRuntimeMonitorEngine({ id: 'x' })).toBe(false);
    expect(isRuntimeMonitorEngine({ id: 'x', supportedProperties: 'ALL' })).toBe(false);
    expect(isRuntimeMonitorEngine({ id: 'x', supportedProperties: [], evaluate: 42 })).toBe(false);
    expect(isRuntimeMonitorEngine({ id: '', supportedProperties: [], evaluate: () => null })).toBe(false);
  });

  it('evaluateMonitor rejects non-engines and invalid inputs loudly', () => {
    const monitor: MonitorDefinition = {
      id: 'monitor:x',
      property: { kind: 'ALWAYS', predicate: 'p', description: 'd' },
    };
    const events: MonitorEvent[] = [];
    expect(() => evaluateMonitor({} as RuntimeMonitorEngine, monitor, events, context())).toThrow(/RuntimeMonitorEngine/);
    expect(() =>
      evaluateMonitor(createInMemoryReferenceEngine(), { id: '', property: monitor.property }, events, context()),
    ).toThrow(/id/);
    expect(() =>
      evaluateMonitor(createInMemoryReferenceEngine(), monitor, [{ predicate: 'p', holds: 'maybe', at: 'x' }] as never, context()),
    ).toThrow(/holds/);
    expect(() => evaluateMonitor(createInMemoryReferenceEngine(), monitor, events, { ...context(), now: 'soon' })).toThrow(
      /RFC3339/,
    );
  });
});

describe('adapters are not authority — dishonest engine outputs are refused', () => {
  const monitor: MonitorDefinition = {
    id: 'monitor:rogue',
    property: { kind: 'ALWAYS', predicate: 'p', description: 'd' },
  };
  const events: MonitorEvent[] = [{ predicate: 'p', holds: false, at: '2025-06-01T00:00:30.000Z' }];

  function buildRogueResult(
    mutate: (result: MonitorEvaluationResult, ctx: MonitorEvaluationContext) => MonitorEvaluationResult,
  ): (ctx: MonitorEvaluationContext) => MonitorEvaluationResult {
    return (ctx: MonitorEvaluationContext) => {
      const honest = createInMemoryReferenceEngine().evaluate(monitor, events, ctx);
      return mutate(honest, ctx);
    };
  }

  function rogueEngine(result: (ctx: MonitorEvaluationContext) => MonitorEvaluationResult): RuntimeMonitorEngine {
    return {
      id: 'rogue-engine',
      supportedProperties: ['ALWAYS'],
      evaluate: (_monitor: MonitorDefinition, _events: readonly MonitorEvent[], ctx: MonitorEvaluationContext) =>
        result(ctx),
    };
  }

  it('rejects verdict VIOLATED with availability SUCCESS (mapping violation)', () => {
    const ctx = context();
    const rogue = rogueEngine(
      buildRogueResult((result) => ({ ...result, availability: 'SUCCESS' })),
    );
    expect(() => evaluateMonitor(rogue, monitor, events, ctx)).toThrow(
      /dishonest monitor result: verdict VIOLATED can never carry availability SUCCESS/,
    );
  });

  it('rejects verdict SATISFIED with availability UNKNOWN (mapping violation)', () => {
    const ctx = context();
    const passingMonitor: MonitorDefinition = {
      id: 'monitor:rogue',
      property: { kind: 'ALWAYS', predicate: 'p', description: 'd' },
    };
    const passingEvents: MonitorEvent[] = [{ predicate: 'p', holds: true, at: '2025-06-01T00:00:30.000Z' }];
    const honest = createInMemoryReferenceEngine().evaluate(passingMonitor, passingEvents, ctx);
    const rogue: RuntimeMonitorEngine = {
      id: 'rogue-engine',
      supportedProperties: ['ALWAYS'],
      evaluate: () => ({ ...honest, availability: 'UNKNOWN' }),
    };
    expect(() => evaluateMonitor(rogue, passingMonitor, passingEvents, ctx)).toThrow(/dishonest monitor result/);
  });

  it('rejects evidence rebound to a different SystemState (forged binding)', () => {
    const ctx = context();
    const rogue = rogueEngine((innerCtx) => {
      const forged = mintMonitorEvidence({
        engineId: 'rogue-engine',
        monitor,
        events,
        context: { ...innerCtx, system_state_id: ctx.system_state_id, subject_revision: 'other@v9' },
        verdict: 'VIOLATED',
        availability: 'FAILURE',
        reason: 'rogue',
      });
      const honest = createInMemoryReferenceEngine().evaluate(monitor, events, innerCtx);
      return { ...honest, evidence: forged };
    });
    expect(() => evaluateMonitor(rogue, monitor, events, ctx)).toThrow(/subject_revision/);
  });

  it('rejects evidence of the wrong kind and non-OBSERVES links', () => {
    const ctx = context();
    const honest = createInMemoryReferenceEngine().evaluate(monitor, events, ctx);
    const wrongKind: RuntimeMonitorEngine = {
      id: 'rogue-engine',
      supportedProperties: ['ALWAYS'],
      evaluate: () => ({
        ...honest,
        evidence: { ...honest.evidence, kind: 'telemetry' },
      }),
    };
    expect(() => evaluateMonitor(wrongKind, monitor, events, ctx)).toThrow(/runtime-monitor/);

    const badLinks: RuntimeMonitorEngine = {
      id: 'rogue-engine',
      supportedProperties: ['ALWAYS'],
      evaluate: () => ({
        ...honest,
        links: [
          {
            source: honest.evidence.id,
            target: ctx.system_state_id,
            type: 'VERIFIES' as never,
            provenance: ['rogue'],
          },
        ],
      }),
    };
    expect(() => evaluateMonitor(badLinks, monitor, events, ctx)).toThrow(/OBSERVE/);
  });

  it('rejects a result whose evidence is not a valid W3 record', () => {
    const ctx = context();
    const honest = createInMemoryReferenceEngine().evaluate(monitor, events, ctx);
    const invalid: RuntimeMonitorEngine = {
      id: 'rogue-engine',
      supportedProperties: ['ALWAYS'],
      evaluate: () => ({ ...honest, evidence: { ...honest.evidence, provenance: [] } }),
    };
    expect(() => evaluateMonitor(invalid, monitor, events, ctx)).toThrow(/not a valid W3 record/);
  });

  it('the guard accepts honest results (the reference engine passes its own contract)', () => {
    const ctx = context();
    const result = createInMemoryReferenceEngine().evaluate(monitor, events, ctx);
    expect(() => assertValidMonitorEvaluationResult(result, monitor, ctx)).not.toThrow();
  });

  it('mintMonitorEvidence + monitorObservesLink produce contract-valid results for third-party engines', () => {
    const ctx = context();
    const passingEvents: MonitorEvent[] = [{ predicate: 'p', holds: true, at: '2025-06-01T00:00:30.000Z' }];
    const evidence = mintMonitorEvidence({
      engineId: 'third-party-monitor',
      monitor,
      events: passingEvents,
      context: ctx,
      verdict: 'SATISFIED',
      availability: 'SUCCESS',
      reason: 'third-party engine verdict',
    });
    const link = monitorObservesLink(evidence, ctx);
    expect(validateTraceLink(link)).toBe(true);
    const result: MonitorEvaluationResult = {
      monitor_id: monitor.id,
      verdict: 'SATISFIED',
      availability: 'SUCCESS',
      reason: 'third-party engine verdict',
      evidence,
      links: [link],
    };
    expect(() => assertValidMonitorEvaluationResult(result, monitor, ctx)).not.toThrow();
  });
});

describe('evidence authority integration', () => {
  it('monitor evidence is a first-class W3 record minted by the merged authority', () => {
    const ctx = context();
    const monitor: MonitorDefinition = {
      id: 'monitor:authority',
      property: { kind: 'RESPONSE', trigger: 't', response: 'r', within_ms: 1000, description: 'd' },
    };
    const result = evaluateMonitor(
      createInMemoryReferenceEngine(),
      monitor,
      [{ predicate: 't', holds: true, at: '2025-06-01T00:00:00.000Z' }],
      ctx,
    );
    // Reconstruct the identical evidence through the W3 authority directly:
    // identical content must reproduce the identical content-addressed id.
    const reconstructed = createEvidence({
      kind: 'runtime-monitor',
      subject_ref: ctx.system_state_id,
      availability: result.availability,
      evidence_class: 'OBSERVATIONAL',
      method: result.evidence.method,
      provenance: result.evidence.provenance,
      source_revision: ctx.implementation_revision,
      deployment_revision: ctx.deployment_revision,
      window: result.evidence.window,
      subject_revision: ctx.subject_revision,
      producer: toolProducer(),
    });
    expect(reconstructed.id).toBe(result.evidence.id);
  });
});
