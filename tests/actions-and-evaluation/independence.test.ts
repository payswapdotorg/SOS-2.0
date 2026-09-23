import { describe, expect, it } from 'vitest';
import { contentAddress } from '@sos-2/action-gateway';
import { EvaluatorRegistry, IndependentEvaluationService, ScriptedReferenceProbe } from '@sos-2/evaluator';
import type { EvaluationActorRef, EvaluationRequest, EvaluationTarget } from '@sos-2/evaluator';
import { ManualClock } from './helpers.js';

const BODY_1: EvaluationActorRef = { kind: 'body', id: 'body-1' };
const BODY_2: EvaluationActorRef = { kind: 'body', id: 'body-2' };

function target(producedBy: EvaluationActorRef = BODY_1): EvaluationTarget {
  return { sourceRevision: contentAddress({ rev: 1 }, 'source'), deploymentRevision: null, producedBy };
}

describe('P9 evaluation independence (no self-approval)', () => {
  it('a body cannot approve its own output: typed denial, probe never runs', () => {
    const probe = new ScriptedReferenceProbe({ evaluatorId: 'eval-t', type: 'tests', boundActor: BODY_1 });
    const service = new IndependentEvaluationService(new EvaluatorRegistry().register(probe), new ManualClock());
    const request: EvaluationRequest = { evaluationId: 'e1', type: 'tests', target: target(BODY_1), requestedBy: BODY_1 };
    const result = service.evaluate(request);
    expect(result.kind).toBe('denied');
    if (result.kind !== 'denied') throw new Error('unreachable');
    expect(result.denial.code).toBe('EVALUATION_INDEPENDENCE_VIOLATION');
    expect(result.denial.boundActor).toEqual(BODY_1);
    expect(probe.observations).toHaveLength(0);
  });

  it('a bound evaluator cannot certify its producer even when the requester differs', () => {
    const probe = new ScriptedReferenceProbe({ evaluatorId: 'eval-t', type: 'tests', boundActor: BODY_1 });
    const service = new IndependentEvaluationService(new EvaluatorRegistry().register(probe), new ManualClock());
    const result = service.evaluate({
      evaluationId: 'e2',
      type: 'tests',
      target: target(BODY_1),
      requestedBy: { kind: 'system', id: 'orchestrator' },
    });
    expect(result.kind).toBe('denied');
  });

  it('an independent evaluator may certify, and another body-bound evaluator may evaluate foreign output', () => {
    const independent = new ScriptedReferenceProbe({ evaluatorId: 'eval-independent', type: 'tests' });
    const body2Bound = new ScriptedReferenceProbe({ evaluatorId: 'eval-body-2', type: 'static-contract-checks', boundActor: BODY_2 });
    const registry = new EvaluatorRegistry().register(independent).register(body2Bound);
    const service = new IndependentEvaluationService(registry, new ManualClock());
    const verdict1 = service.evaluate({ evaluationId: 'e3', type: 'tests', target: target(BODY_1), requestedBy: BODY_1 });
    expect(verdict1.kind).toBe('verdict');
    const verdict2 = service.evaluate({ evaluationId: 'e4', type: 'static-contract-checks', target: target(BODY_1), requestedBy: BODY_1 });
    expect(verdict2.kind).toBe('verdict');
    expect(independent.observations).toHaveLength(1);
    expect(body2Bound.observations).toHaveLength(1);
  });
});
