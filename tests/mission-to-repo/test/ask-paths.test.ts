/**
 * THE ASK-PATH ACCEPTANCE SUITE (Work Order P13) — "ASK when authority
 * or evidence is insufficient": insufficient authority/evidence produce
 * TYPED ASKs at every stage (formalization, planning, realization,
 * completion) — never a guess, never a silent default, never an invented
 * approval. ASK IS A SUCCESS STATE: the journey parks, records the ask
 * first-class and refuses to proceed until a decision authority resolves
 * it.
 */

import { describe, expect, it } from 'vitest';
import { createMission } from '@sos-2/mission';
import type { MissionFormalizerPort, MissionFormalizationResult, RawUserMission } from '@sos-2/implementation-orchestrator';
import { createAcceptanceWorld, driveOnCloudTicks, startFlagshipJourney, WORLD_T0 } from './world.js';
import { formatRfc3339 } from '@sos-2/live-store';

describe('P13 typed ASK paths (first-class, every stage)', () => {
  it('FORMALIZATION: an empty mission statement parks with a typed EMPTY_MISSION ask', async () => {
    const world = createAcceptanceWorld();
    const raw: RawUserMission = {
      statement: '   ',
      repositorySlug: 'acme/empty-repo',
      capturedAt: formatRfc3339(WORLD_T0),
      source: 'web-console:greenfield',
    };
    await startFlagshipJourney(world, { raw });
    await driveOnCloudTicks(world);
    const state = world.journey.state();

    expect(state.stage).toBe('AUTHORITY_APPROVED');
    expect(state.status).toBe('AWAITING_ASK');
    expect(state.pendingAsk!.stage).toBe('FORMALIZATION');
    expect(state.pendingAsk!.reasonCode).toBe('EMPTY_MISSION');
    expect(state.pendingAsk!.openQuestions).toContain('What should this mission accomplish?');
    expect(world.journey.completionReport()).toBeNull();

    // The ask is parked in the durable observation timeline.
    const timeline = await world.journey.timeline();
    expect(timeline.some((event) => event.kind === 'journey.ask-parked' && event.payload['reasonCode'] === 'EMPTY_MISSION')).toBe(true);
  });

  it('FORMALIZATION: an unresolvable ambiguity parks with a typed IRRESOLVABLE_AMBIGUITY ask', async () => {
    const world = createAcceptanceWorld();
    const raw: RawUserMission = {
      statement: 'Build something great, but should it be a web app or a CLI?',
      repositorySlug: 'acme/empty-repo',
      capturedAt: formatRfc3339(WORLD_T0),
      source: 'web-console:greenfield',
    };
    await startFlagshipJourney(world, { raw });
    await driveOnCloudTicks(world);
    const state = world.journey.state();
    expect(state.status).toBe('AWAITING_ASK');
    expect(state.pendingAsk!.stage).toBe('FORMALIZATION');
    expect(state.pendingAsk!.reasonCode).toBe('IRRESOLVABLE_AMBIGUITY');
    expect(state.pendingAsk!.openQuestions.length).toBeGreaterThan(0);
  });

  it('PLANNING: a mission without goals parks with a typed MISSION_NOT_FORMALIZED ask', async () => {
    // A custom formalizer that produces a goal-less (unformalized) mission.
    const goalless: MissionFormalizerPort = {
      formalize(raw: RawUserMission): MissionFormalizationResult {
        const mission = createMission({
          content: {
            purpose: raw.statement,
            goals: [],
            outcomes: [],
            stakeholders: [],
            measures: [],
            assumptions: [],
            ambiguities: [],
            constraints: [],
          },
          provenance: ['p13-ask-path-test:goalless-formalizer'],
          created_at: formatRfc3339(WORLD_T0),
          status: 'ACTIVE',
        });
        return { kind: 'FORMALIZED', mission, ambiguitiesResolved: [] };
      },
    };
    const world = createAcceptanceWorld({ formalizer: goalless });
    await startFlagshipJourney(world);
    await driveOnCloudTicks(world);
    const state = world.journey.state();

    expect(state.stage).toBe('MISSION_FORMALIZED');
    expect(state.status).toBe('AWAITING_ASK');
    expect(state.pendingAsk!.stage).toBe('PLANNING');
    expect(state.pendingAsk!.reasonCode).toBe('MISSION_NOT_FORMALIZED');
    // The formalized mission is durable (the ask is about the plan, not the mission).
    expect(state.mission).not.toBeNull();
    expect(world.journey.completionReport()).toBeNull();
  });

  it('REALIZATION: connecting a NON-EMPTY repository parks with a typed REPOSITORY_NOT_EMPTY ask', async () => {
    const world = createAcceptanceWorld();
    const connect = await (async () => {
      await world.journey.kickoff({
        statement: 'Build a URL shortener service with a public API',
        repositorySlug: 'acme/legacy-checkout',
        capturedAt: formatRfc3339(WORLD_T0),
        source: 'web-console:greenfield',
      });
      return world.journey.connectRepository('acme/legacy-checkout');
    })();
    expect(connect.kind).toBe('NOT_EMPTY');
    if (connect.kind !== 'NOT_EMPTY') throw new Error('unreachable');
    expect(connect.ask.stage).toBe('REALIZATION');
    expect(connect.ask.reasonCode).toBe('REPOSITORY_NOT_EMPTY');
    const state = world.journey.state();
    expect(state.status).toBe('AWAITING_ASK');
    expect(state.pendingAsk!.reasonCode).toBe('REPOSITORY_NOT_EMPTY');
    // No gateway action ever ran (no authority was even requested).
    expect(world.executor.calls).toHaveLength(0);
  });

  it('REALIZATION: revoked action-time authority parks with a typed AUTHORITY_REQUIRED ask (fail-closed)', async () => {
    const world = createAcceptanceWorld();
    await startFlagshipJourney(world);
    // The user approved, but the action-time grant is REVOKED before the
    // first consequential commit: the gateway denies; the journey parks.
    world.revokeJourneyAuthority();
    await driveOnCloudTicks(world);
    const state = world.journey.state();

    expect(state.status).toBe('AWAITING_ASK');
    expect(state.pendingAsk!.stage).toBe('REALIZATION');
    expect(state.pendingAsk!.reasonCode).toBe('AUTHORITY_REQUIRED');
    // The graph was built (formalization + planning are not consequential)...
    expect(['PLAN_PREPARED', 'GRAPH_BUILT']).toContain(state.stage);
    // ...but NOTHING was committed (the executor never ran a git.commit).
    expect(world.executor.calls.filter((call) => call.operation.op === 'git.commit')).toHaveLength(0);
    // The denial is typed evidence in the gateway's action log.
    expect(world.actionEvents.entries().some((event) => event.type === 'action.denied')).toBe(true);
    expect(world.journey.completionReport()).toBeNull();
  });

  it('REALIZATION: no available cloud body parks with a typed NO_BODY_AVAILABLE ask (honest refusal)', async () => {
    const world = createAcceptanceWorld({ userDeviceBodies: true });
    await startFlagshipJourney(world);
    await driveOnCloudTicks(world);
    const state = world.journey.state();

    expect(state.status).toBe('AWAITING_ASK');
    expect(state.pendingAsk!.stage).toBe('REALIZATION');
    expect(state.pendingAsk!.reasonCode).toBe('NO_BODY_AVAILABLE');
    // The ask names the required capabilities and the cloud placement honestly.
    expect(state.pendingAsk!.detail).toContain('placement cloud');
  });

  it('COMPLETION: a failing runtime verification parks with a typed RUNTIME_VERIFICATION_NOT_PASSED ask', async () => {
    const world = createAcceptanceWorld({ probes: { failTypes: ['runtime-verification'] } });
    await startFlagshipJourney(world);
    await driveOnCloudTicks(world);
    const state = world.journey.state();

    // The implementation, the change realization and the deployment all
    // happened; the independent RUNTIME verification refused to pass.
    expect(state.stage).toBe('DEPLOYED');
    expect(state.status).toBe('AWAITING_ASK');
    expect(state.pendingAsk!.stage).toBe('COMPLETION');
    expect(state.pendingAsk!.reasonCode).toBe('RUNTIME_VERIFICATION_NOT_PASSED');
    expect(state.deployment).not.toBeNull();
    expect(world.journey.completionReport()).toBeNull();
  });
});
