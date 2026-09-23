import { describe, expect, it } from 'vitest';
import { contentAddress } from '@sos-2/action-gateway';
import { EvaluatorRegistry, IndependentEvaluationService, ScriptedReferenceProbe, verdictMatchesTarget } from '@sos-2/evaluator';
import type { EvaluationActorRef, EvaluationTarget } from '@sos-2/evaluator';
import { buildFixture, commitRequest, expectExecuted, ManualClock, requestForFamily, WORLD_BASE_SHA } from './helpers.js';

const BODY_1: EvaluationActorRef = { kind: 'body', id: 'body-1' };

describe('P9 evidence binding to exact revisions', () => {
  it('action evidence is content-addressed over the exact revisions acted on', () => {
    const fx = buildFixture();
    fx.authority.grant('body-1', 'commit', 'workspace', {});
    const receipt = expectExecuted(fx.gateway.execute(commitRequest()));
    expect(receipt.status).toBe('SUCCEEDED');
    const stored = fx.evidence.all()[0];
    if (stored?.evidenceType !== 'action.outcome') throw new Error('expected action outcome evidence');
    expect(stored.sourceRevision).toBe(WORLD_BASE_SHA);
    expect(stored.deploymentRevision).toBeNull();
    const { evidenceId, ...core } = stored;
    expect(evidenceId).toBe(contentAddress(core, 'action-evidence'));
  });

  it('deployment-family actions bind BOTH the source sha and the deployment revision', () => {
    const fx = buildFixture();
    fx.authority.grant('body-1', 'deployment', '*');
    const receipt = expectExecuted(fx.gateway.execute(requestForFamily('deployment', 1)));
    expect(receipt.status).toBe('SUCCEEDED');
    expect(receipt.sourceRevision).toBe(WORLD_BASE_SHA);
    expect(receipt.deploymentRevision).toEqual(expect.stringMatching(/^deployment:/));
    const stored = fx.evidence.all()[0];
    if (stored?.evidenceType !== 'action.outcome') throw new Error('expected action outcome evidence');
    expect(stored.deploymentRevision).toBe(receipt.deploymentRevision);
  });

  it('a verdict never floats free of its target', () => {
    const probe = new ScriptedReferenceProbe({ evaluatorId: 'eval-t', type: 'tests' });
    const service = new IndependentEvaluationService(new EvaluatorRegistry().register(probe), new ManualClock());
    const rev1 = contentAddress({ rev: 'r1' }, 'source');
    const rev2 = contentAddress({ rev: 'r2' }, 'source');
    const t1: EvaluationTarget = { sourceRevision: rev1, deploymentRevision: null, producedBy: BODY_1 };
    const t2: EvaluationTarget = { sourceRevision: rev2, deploymentRevision: null, producedBy: BODY_1 };
    const v1 = service.evaluate({ evaluationId: 'e1', type: 'tests', target: t1, requestedBy: BODY_1 });
    if (v1.kind !== 'verdict') throw new Error('expected verdict');
    expect(verdictMatchesTarget(v1.verdict, t1)).toBe(true);
    expect(verdictMatchesTarget(v1.verdict, t2)).toBe(false);
    const v2 = service.evaluate({ evaluationId: 'e2', type: 'tests', target: t2, requestedBy: BODY_1 });
    if (v2.kind !== 'verdict') throw new Error('expected verdict');
    expect(v2.verdict.verdictId).not.toBe(v1.verdict.verdictId);
  });
});
