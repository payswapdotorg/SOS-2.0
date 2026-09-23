import { describe, expect, it } from 'vitest';
import { buildHost, ManualClock } from './helpers-host.js';
import {
  EvaluatorRegistry,
  IndependentEvaluationService,
  NotYetConnectedProbe,
  ScriptedReferenceProbe,
  defaultRegistry,
} from '@sos-2/evaluator';
import type { EvaluationActorRef, EvaluationType } from '@sos-2/evaluator';

const BODY_1: EvaluationActorRef = { kind: 'body', id: 'body-1' };
const DISCONNECTED: readonly EvaluationType[] = [
  'browser-journeys',
  'runtime-verification',
  'security-checks',
  'mission-metrics',
  'deployment-checks',
];

describe('P9 honest statuses', () => {
  it('NOT_YET_CONNECTED probes yield honest UNKNOWN verdicts — never a PASS', () => {
    const service = new IndependentEvaluationService(defaultRegistry(), new ManualClock());
    for (const type of DISCONNECTED) {
      const result = service.evaluate({
        evaluationId: `e-${type}`,
        type,
        target: { sourceRevision: 'rev', deploymentRevision: null, producedBy: BODY_1 },
        requestedBy: BODY_1,
      });
      if (result.kind !== 'verdict') throw new Error('expected verdict');
      expect(result.verdict.verdict, type).toBe('UNKNOWN');
      expect(result.verdict.evidence, type).toBeNull();
      expect(result.verdict.uncertainty.join(' | '), type).toContain('NOT_YET_CONNECTED');
    }
  });

  it('a probe with no evidence yields UNKNOWN with retained uncertainty, never PASS', () => {
    const probe = new ScriptedReferenceProbe({
      evaluatorId: 'eval-empty',
      type: 'tests',
      defaultObservation: { status: 'NO_EVIDENCE', limitations: ['harness produced nothing'] },
    });
    const service = new IndependentEvaluationService(new EvaluatorRegistry().register(probe), new ManualClock());
    const result = service.evaluate({
      evaluationId: 'e-tests',
      type: 'tests',
      target: { sourceRevision: 'rev', deploymentRevision: null, producedBy: BODY_1 },
      requestedBy: BODY_1,
    });
    if (result.kind !== 'verdict') throw new Error('expected verdict');
    expect(result.verdict.verdict).toBe('UNKNOWN');
    expect(result.verdict.uncertainty).toContain('no evidence was collected');
  });

  it('a standalone not-connected probe reports the honest status', () => {
    const probe = new NotYetConnectedProbe('p-security', 'security-checks');
    const observation = probe.run({
      evaluationId: 'e',
      type: 'security-checks',
      target: { sourceRevision: 'rev', deploymentRevision: null, producedBy: BODY_1 },
      requestedBy: BODY_1,
    });
    expect(observation.status).toBe('NOT_YET_CONNECTED');
  });

  it('the host reports provider statuses honestly', () => {
    const host = buildHost(new ManualClock());
    const statuses = host.providerStatus();
    expect(statuses.length).toBeGreaterThan(0);
    for (const status of statuses) {
      expect(['REFERENCE', 'NOT_YET_CONNECTED']).toContain(status.status);
    }
    expect(statuses.filter((s) => s.status === 'NOT_YET_CONNECTED').map((s) => s.provider)).toContain('deployment-target');
  });

  it('the host runs on the injected tick source only', () => {
    const host = buildHost(new ManualClock());
    expect(host.tickCount()).toBe(0);
    host.onTick();
    expect(host.tickCount()).toBe(1);
  });
});
