/**
 * LANE C, NEGATIVE CASE 08 — FAILED EVALUATION (completion denied; the
 * repair/ASK path taken).
 *
 * The fault: the independent evaluation FAILS the produced revision.
 * Completion is DENIED — never fabricated from failing evidence — the
 * bounded repair path runs, and when the bound is exhausted the journey
 * parks behind a TYPED ask (never a silent loop, never a crash). With
 * no connected evaluator at all, the verdict is honestly UNKNOWN and
 * completion is likewise refused. The evidence graph stays queryable
 * and truthful throughout.
 */

import { describe, expect, it } from 'vitest';
import { SCAFFOLD_COMPONENT_ID } from '@sos-2/implementation-orchestrator';
import {
  assertProductGraphQueryableAndTruthful,
  createProductWorld,
  driveOnCloudTicks,
  startFlagshipJourney,
} from './helpers.js';

describe('P15 lane C negative case: failed evaluation', () => {
  it('CONTAINED: a failing evaluation denies completion, drives bounded repair, then parks behind the typed repair-exhausted ask (never a fabricated pass)', async () => {
    // The fault: the tests evaluation FAILS every revision.
    const world = createProductWorld({ probes: { failTypes: ['tests'] } });
    await startFlagshipJourney(world);
    await driveOnCloudTicks(world);
    const state = world.journey.state();

    // Completion is DENIED: the journey parks, never completes.
    expect(state.status).toBe('AWAITING_ASK');
    expect(state.pendingAsk!.stage).toBe('COMPLETION');
    expect(state.pendingAsk!.reasonCode).toBe('EVALUATION_REPAIR_EXHAUSTED');
    expect(state.pendingAsk!.detail).toContain('repair bound 2');
    expect(world.journey.completionReport()).toBeNull();
    expect(state.stage).not.toBe('COMPLETED');

    // The repair attempts were BOUNDED (exactly the bound — no infinite loop).
    const repairCommits = world.executor.calls.filter(
      (call) => call.operation.op === 'git.commit' && call.operation.message.startsWith('repair:'),
    );
    expect(repairCommits.length).toBe(2);

    // The node parks in the DURABLE graph: AWAITING_INPUT (the ask overlay).
    const scaffoldRecord = await world.store.tasks.get(`p13-${SCAFFOLD_COMPONENT_ID}`);
    expect(scaffoldRecord!.status).toBe('AWAITING_INPUT');
    const node = await world.graph.node(`p13-${SCAFFOLD_COMPONENT_ID}`);
    expect(node!.state).toBe('PAUSED');
    expect(node!.pending_asks.length).toBe(1);

    // The ask is visible in the user-visible timeline (an event, not a crash).
    const timeline = await world.journey.timeline();
    expect(timeline.some((event) => event.kind === 'journey.ask-parked' && event.payload['reasonCode'] === 'EVALUATION_REPAIR_EXHAUSTED')).toBe(true);
  });

  it('CONTAINED: with NO connected runtime verifier the verdict is honestly UNKNOWN — completion is refused, an ask is parked (never a fabricated pass)', async () => {
    // The fault: the default evaluator registry — the runtime verifier is
    // NOT_YET_CONNECTED, so the runtime verification is UNKNOWN.
    const world = createProductWorld({ defaultEvaluatorRegistry: true });
    await startFlagshipJourney(world);
    await driveOnCloudTicks(world);
    const state = world.journey.state();

    // The implementation itself proceeded (connected probes gate nodes honestly)...
    expect(state.stage).toBe('DEPLOYED');
    expect(state.realizedCommits.length).toBeGreaterThan(0);
    // ...but completion is REFUSED on the UNKNOWN verdict — never fabricated.
    expect(state.status).toBe('AWAITING_ASK');
    expect(state.pendingAsk!.stage).toBe('COMPLETION');
    expect(state.pendingAsk!.reasonCode).toBe('RUNTIME_VERIFICATION_NOT_PASSED');
    expect(state.pendingAsk!.detail).toContain('UNKNOWN');
    expect(world.journey.completionReport()).toBeNull();
  });

  it('after the failed evaluations the evidence graph stays queryable and truthful (both fault worlds)', async () => {
    const failedWorld = createProductWorld({ probes: { failTypes: ['tests'] } });
    await startFlagshipJourney(failedWorld);
    await driveOnCloudTicks(failedWorld);
    await assertProductGraphQueryableAndTruthful(failedWorld);

    const unknownWorld = createProductWorld({ defaultEvaluatorRegistry: true });
    await startFlagshipJourney(unknownWorld);
    await driveOnCloudTicks(unknownWorld);
    await assertProductGraphQueryableAndTruthful(unknownWorld);

    // Truthfulness: no completed report exists in either world, and no
    // fabricated success evidence was minted for the failed revisions.
    expect(failedWorld.journey.completionReport()).toBeNull();
    expect(unknownWorld.journey.completionReport()).toBeNull();
    for (const event of failedWorld.actionEvents.entries()) {
      expect(['action.succeeded', 'action.denied']).toContain(event.type);
    }
  });
});
