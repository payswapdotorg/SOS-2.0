import { describe, expect, it } from 'vitest';
import { contentAddress } from '@sos-2/action-gateway';
import {
  // buildPlan and EvaluationOrchestrator are imported from @sos-2/evaluation-orchestration below
  IndependentEvaluationService,
  // RepairLoop is imported from @sos-2/evaluation-orchestration below
  ScriptedReferenceProbe,
  // staleVerdictIds and aggregate are imported from @sos-2/evaluation-orchestration below
  EvaluatorRegistry,
} from '@sos-2/evaluator';
import type { } from '@sos-2/evaluator'; // (types imported below where needed)
import type { EvaluationActorRef, EvaluationTarget, ProbeObservation } from '@sos-2/evaluator';
import { IndependentEvaluationService as _IES } from '@sos-2/evaluator'; // barrel re-export check
import type { EvaluatorProbe } from '@sos-2/evaluator';
import type { RepairAsk, RepairExecutor } from '@sos-2/evaluation-orchestration';
import { aggregate, buildPlan, EvaluationOrchestrator, RepairLoop, staleVerdictIds } from '@sos-2/evaluation-orchestration';
import { ManualClock } from './helpers.js';

const BODY_1: EvaluationActorRef = { kind: 'body', id: 'body-1' };

function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('expected value');
  return value;
}

function failingObs(rev: string): ProbeObservation {
  return {
    status: 'EVIDENCE_COLLECTED',
    limitations: [],
    evidence: {
      evidenceType: 'tests',
      summary: 'tests failed',
      checks: [{ check: 'tests:unit', passed: false, detail: `suite red at ${rev}`, expected: 'green', actual: 'red' }],
      artifactDigest: `digest-${rev}`,
    },
  };
}

function makeHarness(types: ('tests' | 'static-contract-checks')[], probe: EvaluatorProbe, maxRepairAttempts: number, initialRev: string) {
  const clock = new ManualClock();
  const registry = new EvaluatorRegistry().register(probe);
  if (types.includes('static-contract-checks')) {
    registry.register(new ScriptedReferenceProbe({ evaluatorId: 'eval-static', type: 'static-contract-checks' }));
  }
  const orchestration = new EvaluationOrchestrator(new IndependentEvaluationService(registry, clock), clock);
  const plan = buildPlan({
    steps: types.map((type) => ({ stepId: `s-${type}`, type, maxAttempts: 1 })),
    applicability: [{ families: ['*'], missions: '*', types }],
    maxRepairAttempts,
  });
  const asks: RepairAsk[] = [];
  const askPort = { submitAsk: (ask: RepairAsk) => { asks.push(ask); return { askId: ask.askId, accepted: true }; } };
  const target: EvaluationTarget = { sourceRevision: initialRev, deploymentRevision: null, producedBy: BODY_1 };
  const context = { plan, target, requestedBy: BODY_1, family: 'commit' as const, mission: null };
  return { clock, orchestration, plan, asks, askPort, context };
}

describe('P9 failed evaluations feed repair/retry or ASK', () => {
  it('drives repair into a NEW revision and re-runs the FULL suite (no verdict carryover)', () => {
    const rev1 = contentAddress({ rev: 1 }, 'source');
    const rev2 = contentAddress({ rev: 2 }, 'source');
    const probe = new ScriptedReferenceProbe({
      evaluatorId: 'eval-tests',
      type: 'tests',
      results: new Map([[rev1, failingObs(rev1)]]),
    });
    const repairCalls: number[] = [];
    const repairExecutor: RepairExecutor = {
      repair: ({ attempt }) => {
        repairCalls.push(attempt);
        return { newSourceRevision: rev2, detail: 'reverted the failing change' };
      },
    };
    const harness = makeHarness(['tests', 'static-contract-checks'], probe, 2, rev1);
    const loop = new RepairLoop(harness.orchestration, repairExecutor, harness.askPort, null, harness.clock);
    const result = loop.drive(harness.context);

    expect(result.kind).toBe('ALL_VERDICTS_PASS');
    expect(result.ask).toBeNull();
    expect(result.runs).toHaveLength(2);
    expect(repairCalls).toEqual([1]);
    expect(must(result.runs[0]).target.sourceRevision).toBe(rev1);
    expect(must(result.runs[1]).target.sourceRevision).toBe(rev2);
    const run2 = must(result.runs[1]);
    expect(run2.results.map((r) => r.type).sort()).toEqual(['static-contract-checks', 'tests']);
    for (const step of run2.results) {
      expect(step.outcome.kind).toBe('verdict');
      if (step.outcome.kind === 'verdict') {
        expect(step.outcome.verdict.verdict).toBe('PASS');
        expect(step.outcome.verdict.target.sourceRevision).toBe(rev2);
      }
    }
    expect(staleVerdictIds(run2, rev2)).toEqual([]);
    expect(harness.asks).toHaveLength(0);
  });

  it('repair is bounded: attempts exhaust, then a typed ASK is submitted (never infinite retry)', () => {
    const rev1 = contentAddress({ rev: 'base' }, 'source');
    const probe = new ScriptedReferenceProbe({
      evaluatorId: 'eval-tests',
      type: 'tests',
      defaultObservation: failingObs('always'),
    });
    let repairs = 0;
    const repairExecutor: RepairExecutor = {
      repair: () => {
        repairs += 1;
        return { newSourceRevision: contentAddress({ child: repairs }, 'source'), detail: 'attempted fix' };
      },
    };
    const harness = makeHarness(['tests'], probe, 2, rev1);
    const loop = new RepairLoop(harness.orchestration, repairExecutor, harness.askPort, null, harness.clock);
    const result = loop.drive(harness.context);

    expect(result.kind).toBe('ASK_SUBMITTED');
    expect(result.runs).toHaveLength(3); // initial + 2 repairs
    expect(repairs).toBe(2);
    const ask = must(result.ask);
    expect(ask.kind).toBe('EVALUATION_REPAIR_EXHAUSTED');
    expect(ask.attempts).toBe(3);
    expect(ask.failedChecks.length).toBeGreaterThan(0);
    expect(ask.failedChecks[0]?.check).toBe('tests:unit');
    expect(ask.sourceRevision).toBeTruthy();
  });

  it('an unavailable repair escalates to ASK immediately', () => {
    const rev1 = contentAddress({ rev: 'base2' }, 'source');
    const probe = new ScriptedReferenceProbe({
      evaluatorId: 'eval-tests',
      type: 'tests',
      defaultObservation: failingObs('always'),
    });
    const repairExecutor: RepairExecutor = { repair: () => ({ newSourceRevision: null, detail: 'no repair strategy bound' }) };
    const harness = makeHarness(['tests'], probe, 3, rev1);
    const loop = new RepairLoop(harness.orchestration, repairExecutor, harness.askPort, null, harness.clock);
    const result = loop.drive(harness.context);
    expect(result.kind).toBe('ASK_SUBMITTED');
    expect(result.runs).toHaveLength(1);
    expect(must(result.ask).kind).toBe('REPAIR_UNAVAILABLE');
  });

  it('probe retries are bounded by the step attempt bound', () => {
    const observations: ProbeObservation[] = [
      { status: 'PROBE_FAILED', retryable: true, limitations: ['flaky harness'] },
      { status: 'PROBE_FAILED', retryable: true, limitations: ['flaky harness'] },
      {
        status: 'EVIDENCE_COLLECTED',
        limitations: [],
        evidence: {
          evidenceType: 'tests',
          summary: 'ok',
          checks: [{ check: 'tests:unit', passed: true, detail: 'ok', expected: null, actual: null }],
          artifactDigest: 'digest-pass',
        },
      },
    ];
    let calls = 0;
    const probe: EvaluatorProbe = {
      evaluatorId: 'eval-flaky',
      type: 'tests',
      boundActor: null,
      capability: 'REFERENCE',
      run: () => {
        const observation = must(observations[calls]);
        calls += 1;
        return observation;
      },
    };
    const clock = new ManualClock();
    const orchestration = new EvaluationOrchestrator(
      new IndependentEvaluationService(new EvaluatorRegistry().register(probe), clock),
      clock,
    );
    const target: EvaluationTarget = { sourceRevision: 'rev-x', deploymentRevision: null, producedBy: BODY_1 };
    const suiteCtx = { requestedBy: BODY_1, family: null, mission: null };
    const plan3 = buildPlan({ steps: [{ stepId: 's', type: 'tests', maxAttempts: 3 }], applicability: [{ families: ['*'], missions: '*', types: ['tests'] }], maxRepairAttempts: 0 });
    const run = orchestration.runSuite({ plan: plan3, target, ...suiteCtx });
    expect(calls).toBe(3);
    const step = must(run.results[0]);
    if (step.outcome.kind !== 'verdict') throw new Error('expected verdict');
    expect(step.outcome.verdict.verdict).toBe('PASS');
    expect(step.outcome.attempts).toBe(3);

    calls = 0;
    const plan2 = buildPlan({ steps: [{ stepId: 's', type: 'tests', maxAttempts: 2 }], applicability: [{ families: ['*'], missions: '*', types: ['tests'] }], maxRepairAttempts: 0 });
    const run2 = orchestration.runSuite({ plan: plan2, target, ...suiteCtx });
    expect(calls).toBe(2); // no third probe invocation
    const step2 = must(run2.results[0]);
    if (step2.outcome.kind !== 'verdict') throw new Error('expected verdict');
    expect(step2.outcome.verdict.verdict).toBe('UNKNOWN');
    expect(step2.outcome.verdict.uncertainty).toContain('probe failed (retryable)');

    const summary = aggregate(run2);
    expect(summary.certification).toBe('NOT_ASSERTED');
    expect(summary.unknown).toBe(1);
    expect((orchestration as unknown as Record<string, unknown>)['certify']).toBeUndefined();
  });
});
