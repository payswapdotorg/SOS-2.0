/**
 * THE OFFLINE-USER ACCEPTANCE SUITE (Work Order P13) — the §7
 * device-optional pin: "let SOS run without the user's computer
 * remaining online" / "the journey must continue without the user's
 * computer remaining online when all required resources are remote."
 *
 *   - the journey progresses through CLOUD tick sources with the user
 *     tick absent and completes;
 *   - the journey's body requirements pin CLOUD placement (a
 *     user-device-only pool is an honest typed refusal, never a hidden
 *     prerequisite);
 *   - user presence is RECORDED (the observation timeline carries it),
 *     never consulted for progress.
 */

import { describe, expect, it } from 'vitest';
import { ReferenceArchitecturePlanner, ReferenceMissionFormalizer } from '@sos-2/implementation-orchestrator';
import { createAcceptanceWorld, driveOnCloudTicks, startFlagshipJourney, WORLD_T0 } from './world.js';
import { formatRfc3339 } from '@sos-2/live-store';

describe('P13 offline-user journeys (§7 device-optional)', () => {
  it('the journey completes with the user device offline THROUGHOUT (cloud ticks only)', async () => {
    const world = createAcceptanceWorld({ presence: { userDeviceOnline: () => false } });
    await startFlagshipJourney(world);
    await driveOnCloudTicks(world);
    const state = world.journey.state();

    expect(state.stage).toBe('COMPLETED');
    expect(state.status).toBe('COMPLETED');

    // Every cloud tick recorded the honest offline marker.
    const ticks = world.journey.ticks();
    expect(ticks.length).toBeGreaterThan(0);
    expect(ticks.every((tick) => tick.userDeviceOnline === false)).toBe(true);

    // Every observation event payload carries the offline marker too
    // (presence is RECORDED, never required).
    const timeline = await world.journey.timeline();
    expect(timeline.length).toBeGreaterThan(0);
    for (const event of timeline) {
      expect(event.payload['userDeviceOnline']).toBe(false);
    }
  });

  it('a user-device-only body pool is an honest typed NO_BODY_AVAILABLE refusal (never a hidden prerequisite)', async () => {
    const world = createAcceptanceWorld({ userDeviceBodies: true, presence: { userDeviceOnline: () => false } });
    await startFlagshipJourney(world);
    await driveOnCloudTicks(world);
    const state = world.journey.state();

    // The journey REFUSES to summon a user-device body while the user is
    // offline: it parks with the typed ask instead of pretending.
    expect(state.status).toBe('AWAITING_ASK');
    expect(state.pendingAsk!.reasonCode).toBe('NO_BODY_AVAILABLE');
    expect(state.pendingAsk!.detail).toContain('placement cloud');
    // No task ever ran, nothing was committed.
    expect(world.executor.calls.filter((call) => call.operation.op === 'git.commit')).toHaveLength(0);
  });

  it('the reference plan pins CLOUD placement for every component (§11 "summon cloud body")', async () => {
    const formalizer = new ReferenceMissionFormalizer({ createdAt: formatRfc3339(WORLD_T0) });
    const formalized = formalizer.formalize({
      statement: 'Build a URL shortener service with a public API',
      repositorySlug: 'acme/empty-repo',
      capturedAt: formatRfc3339(WORLD_T0),
      source: 'web-console:greenfield',
    });
    if (formalized.kind !== 'FORMALIZED') throw new Error('unreachable');
    const planner = new ReferenceArchitecturePlanner({ createdAt: formatRfc3339(WORLD_T0) });
    const planned = planner.plan({ mission: formalized.mission });
    if (planned.kind !== 'PLANNED') throw new Error('unreachable');
    for (const component of planned.plan.components) {
      expect(component.placement).toBe('cloud');
      expect(component.requiredCapabilities.length).toBeGreaterThan(0);
    }

    // And the world's bodies are all registered at cloud placement for
    // the default composition (the report pins the actual body ids).
    const world = createAcceptanceWorld();
    for (const body of world.broker.bodies()) {
      expect(body.placement).toBe('cloud');
    }
  });

  it('an online user device changes nothing about the journey (presence is inert for cloud work)', async () => {
    const offlineWorld = createAcceptanceWorld({ presence: { userDeviceOnline: () => false } });
    await startFlagshipJourney(offlineWorld);
    await driveOnCloudTicks(offlineWorld);
    const offlineReport = offlineWorld.journey.completionReport()!;

    const onlineWorld = createAcceptanceWorld({ presence: { userDeviceOnline: () => true }, journeyId: 'flagship-01' });
    await startFlagshipJourney(onlineWorld);
    await driveOnCloudTicks(onlineWorld);
    const onlineReport = onlineWorld.journey.completionReport()!;

    // Same journey id + same inputs: the presence flag does not leak into
    // any decision — the completion records are identical.
    expect(onlineReport.completionId).toBe(offlineReport.completionId);
    expect(onlineReport.tasks).toEqual(offlineReport.tasks);
  });
});
