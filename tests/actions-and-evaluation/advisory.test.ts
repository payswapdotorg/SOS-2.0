import { describe, expect, it } from 'vitest';
import { contentAddress } from '@sos-2/action-gateway';
import {
  EvaluatorRegistry,
  IndependentEvaluationService,
  ScriptedReferenceProbe,
} from '@sos-2/evaluator';
import type { EvaluationActorRef, EvaluationTarget, StructuredFailure } from '@sos-2/evaluator';
import type { AdvisoryNote, ReasoningPort, RepairAsk } from '@sos-2/evaluation-orchestration';
import { buildPlan, EvaluationOrchestrator, recordAdvisory, RepairLoop } from '@sos-2/evaluation-orchestration';
import { ManualClock } from './helpers.js';

const BODY_1: EvaluationActorRef = { kind: 'body', id: 'body-1' };

class ScriptedReasoning implements ReasoningPort {
  readonly notes: AdvisoryNote[] = [];
  triage(input: { failures: readonly StructuredFailure[]; summary: unknown }): AdvisoryNote {
    const note: AdvisoryNote = {
      label: 'ADVISORY_REASONING',
      nonAuthoritative: true,
      advice: `reasoning suggests approving despite ${input.failures.length} failures`,
      suggestedVerdict: 'PASS',
    };
    this.notes.push(note);
    return note;
  }
}

describe('P9 advisory reasoning is never authoritative', () => {
  it('advisory triage is labelled, ledgered, and never flips a verdict or a summary', () => {
    const clock = new ManualClock();
    const failingProbe = new ScriptedReferenceProbe({
      evaluatorId: 'eval-tests',
      type: 'tests',
      defaultObservation: {
        status: 'EVIDENCE_COLLECTED',
        limitations: [],
        evidence: {
          evidenceType: 'tests',
          summary: 'tests failed',
          checks: [{ check: 'tests:unit', passed: false, detail: 'red', expected: 'green', actual: 'red' }],
          artifactDigest: 'digest-fail',
        },
      },
    });
    const registry = new EvaluatorRegistry().register(failingProbe);
    const orchestration = new EvaluationOrchestrator(new IndependentEvaluationService(registry, clock), clock);
    const plan = buildPlan({
      steps: [{ stepId: 's-tests', type: 'tests', maxAttempts: 1 }],
      applicability: [{ families: ['*'], missions: '*', types: ['tests'] }],
      maxRepairAttempts: 0,
    });
    const asks: RepairAsk[] = [];
    const reasoning = new ScriptedReasoning();
    const loop = new RepairLoop(
      orchestration,
      { repair: () => ({ newSourceRevision: null, detail: 'unbound' }) },
      { submitAsk: (ask) => { asks.push(ask); return { askId: ask.askId, accepted: true }; } },
      reasoning,
      clock,
    );
    const target: EvaluationTarget = { sourceRevision: contentAddress({ rev: 'adv' }, 'source'), deploymentRevision: null, producedBy: BODY_1 };
    const result = loop.drive({ plan, target, requestedBy: BODY_1, family: 'commit', mission: null });

    expect(result.kind).toBe('ASK_SUBMITTED'); // the FAIL verdict — not the advisory — drove the outcome
    expect(result.advisories).toHaveLength(1);
    const entry = result.advisories[0];
    expect(entry?.note.label).toBe('ADVISORY_REASONING');
    expect(entry?.note.nonAuthoritative).toBe(true);
    expect(entry?.note.suggestedVerdict).toBe('PASS');

    const summariesJson = JSON.stringify(result.summaries);
    expect(summariesJson).not.toContain('suggestedVerdict');
    expect(summariesJson).not.toContain('reasoning suggests');
    const summary = result.summaries[0];
    expect(summary?.failed).toBe(1);
    expect(summary?.certification).toBe('NOT_ASSERTED');

    for (const step of result.runs[0]?.results ?? []) {
      if (step.outcome.kind === 'verdict') {
        expect(step.outcome.verdict.verdict).toBe('FAIL'); // untouched by the advisory
      }
    }
  });

  it('unlabelled reasoning output is rejected outright', () => {
    expect(() =>
      recordAdvisory(
        { label: 'OTHER' as 'ADVISORY_REASONING', nonAuthoritative: false as true, advice: 'x', suggestedVerdict: null },
        0,
      ),
    ).toThrow();
  });
});
