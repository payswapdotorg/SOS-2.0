/**
 * THE USER-COMPUTER-OFFLINE JOURNEY (Work Order P15, lane B) — the P12 §7
 * device model as product dogfood: the user's computer is OFFLINE for the
 * WHOLE cloud execution; the cloud ticks advance the journey anyway; when
 * the user "returns", the full disconnected timeline replays with EXACT
 * revisions and RETAINED uncertainty — nothing was hidden while they were
 * away, and nothing changes because they came back.
 */

import { describe, expect, it } from 'vitest';
import { WORLD_BASE_SHA } from '@sos-2/action-gateway';
import {
  DEFAULT_RAW_MISSION,
  EMPTY_REPOSITORY_SLUG,
  FLAGSHIP_JOURNEY_ID,
  ScriptedPresence,
  createDogfoodWorld,
  driveOnCloudTicks,
  startFlagshipJourney,
} from './world.js';

/** Run the complete flagship journey with the user offline throughout. */
async function runOfflineJourney() {
  const presence = new ScriptedPresence(false);
  const world = createDogfoodWorld({ presence });
  await startFlagshipJourney(world);
  await driveOnCloudTicks(world);
  return { world, presence };
}

describe('P15 lane-B user computer offline during cloud execution (§7 device-optional)', () => {
  it('cloud ticks advance the journey to completion while the user device stays offline', async () => {
    const { world, presence } = await runOfflineJourney();
    const state = world.journey.state();

    expect(state.stage).toBe('COMPLETED');
    expect(state.status).toBe('COMPLETED');
    expect(presence.userDeviceOnline()).toBe(false);

    // Every cloud tick recorded the honest offline marker (presence is
    // RECORDED, never required).
    const ticks = world.journey.ticks();
    expect(ticks.length).toBeGreaterThan(0);
    expect(ticks.every((tick) => tick.userDeviceOnline === false)).toBe(true);

    // Every observation event payload carries the offline marker too.
    const timeline = await world.journey.timeline();
    expect(timeline.length).toBeGreaterThan(0);
    for (const event of timeline) {
      expect(event.payload['userDeviceOnline']).toBe(false);
    }
  });

  it('on return, the disconnected-user timeline replays with EXACT revisions and retained uncertainty', async () => {
    const { world, presence } = await runOfflineJourney();

    // The timeline + report the disconnected user replays on return.
    const timelineBefore = await world.journey.timeline();
    const evidenceBefore = await world.journey.evidenceTimeline();
    const reportBefore = world.journey.completionReport()!;
    const ticksBefore = world.journey.ticks();

    // THE RETURN: the user's computer comes back online.
    presence.returnOnline();
    expect(presence.userDeviceOnline()).toBe(true);

    // The replay is IDENTICAL: the recorded history did not change, and the
    // recorded events still honestly say the user was offline when they happened.
    const timelineAfter = await world.journey.timeline();
    const evidenceAfter = await world.journey.evidenceTimeline();
    expect(timelineAfter).toEqual(timelineBefore);
    expect(evidenceAfter).toEqual(evidenceBefore);
    for (const event of timelineAfter) {
      expect(event.payload['userDeviceOnline']).toBe(false);
    }
    expect(world.journey.ticks()).toEqual(ticksBefore);

    // The completion record is unchanged by the return.
    expect(world.journey.completionReport()).toEqual(reportBefore);
    expect(world.journey.state().status).toBe('COMPLETED');
    expect(world.journey.state().pendingAsk).toBeNull();

    // EXACT-REVISION LINKS (repository / runtime / deployment / evidence):
    const head = reportBefore.sourceRevisions.workspaceHead;
    expect(head).toMatch(/^source:[0-9a-f]+$/);
    expect(head).not.toBe(WORLD_BASE_SHA);
    expect(world.gatewayWorld.heads.get('workspace')).toBe(head);
    expect(world.gatewayWorld.pushes).toEqual([{ remote: `github.com/${EMPTY_REPOSITORY_SLUG}`, ref: `sos/mission-${FLAGSHIP_JOURNEY_ID}`, sha: head }]);
    const deployment = world.gatewayWorld.deployments.get(reportBefore.sourceRevisions.deployment!.deploymentId);
    expect(deployment).toMatchObject({ environment: 'production', sourceSha: head, status: 'ACTIVE' });
    for (const ref of reportBefore.evaluation.verdictRefs) {
      expect(ref.targetSourceRevision).toBe(head);
    }

    // RETAINED UNCERTAINTY: everything unresolved stayed visible — no
    // uncertainty was resolved by the user coming back.
    expect(reportBefore.remainingUncertainty.length).toBeGreaterThan(0);
    expect(reportBefore.remainingUncertainty.some((entry) => entry.includes('SIMULATED'))).toBe(true);
    expect(reportBefore.providerStatuses.length).toBeGreaterThan(0);
  });

  it('an online user device changes NOTHING about cloud work (presence is inert)', async () => {
    // The SAME journey id + inputs: only the presence flag differs. The
    // presence flag must not leak into any decision.
    const offline = await runOfflineJourney();
    const onlineWorld = createDogfoodWorld({ presence: new ScriptedPresence(true), journeyId: FLAGSHIP_JOURNEY_ID });
    await startFlagshipJourney(onlineWorld, { raw: DEFAULT_RAW_MISSION });
    await driveOnCloudTicks(onlineWorld);

    const offlineReport = offline.world.journey.completionReport()!;
    const onlineReport = onlineWorld.journey.completionReport()!;
    expect(onlineReport.completionId).toBe(offlineReport.completionId);
    expect(onlineReport.tasks).toEqual(offlineReport.tasks);
    expect(onlineReport.sourceRevisions).toEqual(offlineReport.sourceRevisions);
  });
});
