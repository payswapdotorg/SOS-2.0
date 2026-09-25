/**
 * THE INDEPENDENCE ACCEPTANCE SUITE (Work Order P13) — the no-self-
 * approval pin: "The worker/body may not declare success without the
 * independent completion gate."
 *
 *   - the ACTING BODY requesting certification of its own output is a
 *     typed independence violation, denied BEFORE any probe runs;
 *   - the P9 bound-evaluator denial (EVALUATION_INDEPENDENCE_VIOLATION)
 *     surfaces verbatim through the P13 certifier — never a grant;
 *   - the journey's own certification requests are ALWAYS system-
 *     requested (the pipeline requests; the evaluator decides);
 *   - a journey whose runtime verifier is bound to the acting body
 *     parks with a typed ask and NEVER completes.
 */

import { describe, expect, it } from 'vitest';
import { CompletionCertifier } from '@sos-2/greenfield-runtime';
import { EvaluationOrchestrator } from '@sos-2/evaluation-orchestration';
import { EvaluatorRegistry, IndependentEvaluationService, ScriptedReferenceProbe } from '@sos-2/evaluator';
import { createAcceptanceWorld, driveOnCloudTicks, startFlagshipJourney, WORLD_T0 } from './world.js';

const ACTING_BODY = { kind: 'body' as const, id: 'p13-acting-body:flagship-01' };
const SYSTEM = { kind: 'system' as const, id: 'greenfield-runtime' };

function targetFor(producedBy: typeof ACTING_BODY) {
  return { sourceRevision: 'source:independence-fixture', deploymentRevision: null, producedBy };
}

function certifierOver(probe: ScriptedReferenceProbe): CompletionCertifier {
  const service = new IndependentEvaluationService(new EvaluatorRegistry().register(probe), { now: () => WORLD_T0 });
  return new CompletionCertifier({ orchestration: new EvaluationOrchestrator(service, { now: () => WORLD_T0 }), clock: { now: () => WORLD_T0 } });
}

describe('P13 evaluation independence (no self-approval)', () => {
  it('the acting body cannot certify its own output: typed independence denial, probe never runs', () => {
    const probe = new ScriptedReferenceProbe({ evaluatorId: 'eval-tests', type: 'tests', boundActor: ACTING_BODY });
    const real = certifierOver(probe);
    const outcome = real.request({
      requirements: ['tests'],
      target: targetFor(ACTING_BODY),
      requestedBy: ACTING_BODY,
      family: 'commit',
      mission: null,
    });
    expect(outcome.kind).toBe('INDEPENDENCE_DENIED');
    if (outcome.kind !== 'INDEPENDENCE_DENIED') throw new Error('unreachable');
    expect(outcome.denial.code).toBe('EVALUATION_INDEPENDENCE');
    expect(probe.observations).toHaveLength(0);
    expect(outcome.certificationId).toBeNull();
  });

  it('the P9 bound-evaluator denial surfaces verbatim through the certifier (never a grant)', () => {
    const probe = new ScriptedReferenceProbe({ evaluatorId: 'eval-tests', type: 'tests', boundActor: ACTING_BODY });
    const certifier = certifierOver(probe);
    // The PIPELINE requests (system actor), but the evaluator is BOUND to
    // the producer — the P9 service denies before the probe runs.
    const outcome = certifier.request({
      requirements: ['tests'],
      target: targetFor(ACTING_BODY),
      requestedBy: SYSTEM,
      family: 'commit',
      mission: null,
    });
    expect(outcome.kind).toBe('INDEPENDENCE_DENIED');
    if (outcome.kind !== 'INDEPENDENCE_DENIED') throw new Error('unreachable');
    expect(outcome.denial.code).toBe('EVALUATION_INDEPENDENCE_VIOLATION');
    expect(probe.observations).toHaveLength(0);
  });

  it('an independent evaluator grants for a system-requested certification of body output', () => {
    const probe = new ScriptedReferenceProbe({ evaluatorId: 'eval-tests', type: 'tests' });
    const certifier = certifierOver(probe);
    const outcome = certifier.request({
      requirements: ['tests'],
      target: targetFor(ACTING_BODY),
      requestedBy: SYSTEM,
      family: 'commit',
      mission: null,
    });
    expect(outcome.kind).toBe('GRANTED');
  });

  it('every evaluation request the journey issues is system-requested (the pipeline requests, never the body)', async () => {
    const world = createAcceptanceWorld();
    await startFlagshipJourney(world);
    await driveOnCloudTicks(world);
    expect(world.journey.state().stage).toBe('COMPLETED');
    expect(world.evaluationRequests.length).toBeGreaterThan(0);
    for (const request of world.evaluationRequests) {
      expect(request.requestedBy.kind, `${request.type} must be requested by the system actor`).toBe('system');
      expect(request.requestedBy.id).toBe('greenfield-runtime');
      expect(request.producedBy.kind).toBe('body');
    }
  });

  it('a journey whose runtime verifier is bound to the acting body parks with a typed ask and never completes', async () => {
    const world = createAcceptanceWorld({
      probes: { bindToActingBody: ['runtime-verification'] },
    });
    await startFlagshipJourney(world);
    await driveOnCloudTicks(world);
    const state = world.journey.state();

    // The implementation and deployment proceeded (per-node gates are
    // independent); the RUNTIME VERIFICATION was refused on independence.
    expect(state.stage).toBe('DEPLOYED');
    expect(state.status).toBe('AWAITING_ASK');
    expect(state.pendingAsk).not.toBeNull();
    expect(state.pendingAsk!.stage).toBe('COMPLETION');
    expect(state.pendingAsk!.reasonCode).toBe('RUNTIME_VERIFICATION_NOT_PASSED');
    expect(state.pendingAsk!.detail).toContain('independence');
    expect(world.journey.completionReport()).toBeNull();
  });

  it('the completion report records the requester as the system actor (never the producer)', async () => {
    const world = createAcceptanceWorld();
    await startFlagshipJourney(world);
    await driveOnCloudTicks(world);
    const report = world.journey.completionReport()!;
    expect(report.certifiedUponRequestBy).toEqual(SYSTEM);
    expect(report.producedBy).toEqual(ACTING_BODY);
    expect(report.completedAt).toMatch(/^\d{4}-/);
  });
});
