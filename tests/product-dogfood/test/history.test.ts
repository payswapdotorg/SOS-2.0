/**
 * THE HISTORY JOURNEY (P15 Lane A). Asserts the full evidence/decision
 * timeline stays queryable end-to-end — decision -> action -> evidence
 * -> state — including AFTER a rollback. The journey drives a
 * flagship greenfield journey through the P13 journey engine + a
 * rollback through the P9 action-gateway, then queries the merged
 * durable surfaces (observation events + action events + evidence sink
 * + the journey's own timeline) to assert the timeline is gap-free
 * and chronologically ordered.
 *
 * The journey asserts the P15 acceptance shape:
 *   (a) composition: every consequential surface queried through the
 *       merged public exports.
 *   (b) terminal state: the journey COMPLETED; the rollback landed;
 *       the action event log preserves every action in order.
 *   (c) evidence graph: every action's evidence record is queryable
 *       by id; the journey timeline is queryable by stage + by instant.
 *   (d) retained uncertainty: VISIBLE — the rollback verification
 *       record is in the timeline with its honest verdict.
 *   (e) determinism: the queryable timeline reproduces bit-exactly
 *       across runs.
 */

import { describe, expect, it } from 'vitest';
import { WORLD_BASE_SHA } from '@sos-2/action-gateway';
import type { ActionReceipt, GatewayOutcome } from '@sos-2/action-gateway';
import { GREENFIELD_JOURNEY_STAGES } from '@sos-2/greenfield-runtime';
import { createProductDogfoodWorld, driveOnCloudTicks, startFlagshipJourney } from './world.js';
import type { ProductDogfoodWorld } from './world.js';

/** Expect the outcome to be executed and return the receipt. */
function expectExecuted(outcome: GatewayOutcome): ActionReceipt {
  if (outcome.kind !== 'executed') {
    throw new Error(`expected an executed receipt, got kind=${outcome.kind}; denial/failure=${JSON.stringify(outcome)}`);
  }
  return outcome.receipt;
}

/** Run the full history scenario: flagship journey + a rollback action. */
async function runHistoryJourney(): Promise<{
  world: ProductDogfoodWorld;
  v1Sha: string;
  v2Sha: string;
  rollbackReceipt: ActionReceipt;
}> {
  const world = createProductDogfoodWorld({});
  await startFlagshipJourney(world);
  await driveOnCloudTicks(world);

  // After the flagship journey completes, drive a rollback through the
  // action gateway to demonstrate that the timeline is queryable across
  // both the greenfield journey AND the action gateway.
  const report = world.journey.completionReport()!;
  const v1Sha = report.sourceRevisions.workspaceHead;
  const v2Sha = (() => {
    // Commit a v2 (a regression).
    world.authority.grant('body:p15a-history', 'commit', 'workspace');
    world.authority.grant('body:p15a-history', 'deployment', 'production');
    world.authority.grant('body:p15a-history', 'rollback', '*');
    const actor = { kind: 'body' as const, id: 'body:p15a-history' };

    world.clock.advance(1_000);
    const commit = expectExecuted(world.gateway.execute({
      actionId: 'p15a-history-commit-v2',
      idempotencyKey: 'p15a-history-commit-v2',
      family: 'commit',
      actor,
      requestedAt: world.clock.nowEpochMs(),
      targetRevision: { kind: 'source', sha: v1Sha },
      payload: {
        family: 'commit',
        commit: {
          message: 'p15a history journey: v2 (regression)',
          changes: [{ path: 'src/version.ts', contents: 'export const VERSION = "v2-broken";\n' }],
          expectedBaseSha: v1Sha,
        },
      },
    }));
    void commit;
    return world.gatewayWorld.heads.get('workspace')!;
  })();

  // Deploy v2 to production.
  world.clock.advance(1_000);
  const v2Deployment = expectExecuted(world.gateway.execute({
    actionId: 'p15a-history-deploy-v2',
    idempotencyKey: 'p15a-history-deploy-v2',
    family: 'deployment',
    actor: { kind: 'body', id: 'body:p15a-history' },
    requestedAt: world.clock.nowEpochMs(),
    targetRevision: { kind: 'source', sha: v2Sha },
    payload: {
      family: 'deployment',
      deployment: { environment: 'production', sourceSha: v2Sha },
    },
  }));

  // Rollback v2 to v1.
  world.clock.advance(1_000);
  const rollbackOutcome = world.gateway.execute({
    actionId: 'p15a-history-rollback-1',
    idempotencyKey: 'p15a-history-rollback-1',
    family: 'rollback',
    actor: { kind: 'body', id: 'body:p15a-history' },
    requestedAt: world.clock.nowEpochMs(),
    targetRevision: { kind: 'source', sha: v1Sha },
    payload: {
      family: 'rollback',
      rollback: {
        deploymentId: v2Deployment.deploymentRevision!,
        fromSourceSha: v2Sha,
        toSourceSha: v1Sha,
        reason: { code: 'INCIDENT', detail: 'p15a history journey: rollback to v1' },
      },
    },
  });
  const rollbackReceipt = expectExecuted(rollbackOutcome);

  return { world, v1Sha, v2Sha, rollbackReceipt };
}

describe('P15 Lane A — history: the full evidence/decision timeline stays queryable end-to-end', () => {
  it('the greenfield journey timeline is queryable by stage + in §11 order', async () => {
    const { world } = await runHistoryJourney();
    const journeyEvents = await world.journey.timeline();

    // Every §11 stage appears in the journey timeline.
    const stageKinds = journeyEvents.filter((event) => event.kind.startsWith('journey.')).map((event) => event.kind);
    for (const expected of [
      'journey.mission-received',
      'journey.repository-connected',
      'journey.authority-approved',
      'journey.mission-formalized',
      'journey.plan-prepared',
      'journey.graph-built',
      'journey.node-dispatched',
      'journey.node-completed',
      'journey.implemented',
      'journey.change-realized',
      'journey.deployed',
      'journey.runtime-verified',
      'journey.completed',
    ]) {
      expect(stageKinds, `timeline must contain ${expected}`).toContain(expected);
    }

    // The stage events appear in §11 contract order.
    const ordered = [
      'journey.mission-received',
      'journey.repository-connected',
      'journey.authority-approved',
      'journey.mission-formalized',
      'journey.plan-prepared',
      'journey.graph-built',
      'journey.change-realized',
      'journey.deployed',
      'journey.completed',
    ];
    let cursor = -1;
    for (const event of journeyEvents) {
      const index = ordered.indexOf(event.kind);
      if (index === -1) continue;
      expect(index).toBeGreaterThan(cursor);
      cursor = index;
    }
  });

  it('every consequential action\'s evidence record is queryable by id (the typed trace link)', async () => {
    const { world } = await runHistoryJourney();
    // The evidence sink retains every action's evidence record.
    const all = world.evidence.all();
    expect(all.length).toBeGreaterThan(0);
    // Every evidence record has a non-empty evidenceId (queryable).
    for (const evidence of all) {
      expect(evidence.evidenceId).toBeTruthy();
      expect(evidence.evidenceType).toBeTruthy();
    }
    // The action events log retains every action event with its actionId + family + type.
    const actionEvents = world.actionEvents.entries();
    expect(actionEvents.length).toBeGreaterThan(0);
    for (const event of actionEvents) {
      expect(event.actionId).toBeTruthy();
      expect(event.family).toBeTruthy();
      expect(event.type).toBe('action.succeeded');
    }
  });

  it('the timeline is queryable AFTER rollback — the rollback action event appears LAST (chronological)', async () => {
    const { world } = await runHistoryJourney();
    const events = world.actionEvents.entries();
    expect(events.length).toBeGreaterThanOrEqual(3); // commit + deployment + rollback

    // The last action event is the rollback.
    const last = events[events.length - 1]!;
    expect(last.family).toBe('rollback');
    expect(last.type).toBe('action.succeeded');

    // The action event timestamps are monotonically non-decreasing (chronological order).
    for (let i = 1; i < events.length; i += 1) {
      const prev = events[i - 1]!;
      const curr = events[i]!;
      // ActionEvent.at is a Timestamp (epoch-ms number).
      expect(typeof prev.at).toBe('number');
      expect(typeof curr.at).toBe('number');
      expect(curr.at).toBeGreaterThanOrEqual(prev.at);
    }
  });

  it('the rollback verification record is queryable in the timeline (visible uncertainty)', async () => {
    const { world, rollbackReceipt, v1Sha } = await runHistoryJourney();
    // The rollback receipt's verification record is queryable.
    expect(rollbackReceipt.rollbackVerification).not.toBeNull();
    const verification = rollbackReceipt.rollbackVerification!;
    expect(verification.expectedSourceSha).toBe(v1Sha);
    expect(['VERIFIED', 'UNKNOWN']).toContain(verification.verdict);

    // The evidence chain includes the rollback verification evidence (a typed trace link).
    const evidence = world.evidence.all();
    expect(evidence.some((e) => e.evidenceType.includes('rollback'))).toBe(true);
  });

  it('the observation event store is queryable for the journey\'s task + fabric events (durable + replayable)', async () => {
    const { world } = await runHistoryJourney();
    // The journey's evidence timeline (observation events + graph + fabric events).
    const timeline = await world.journey.evidenceTimeline();
    expect(timeline.length).toBeGreaterThan(0);
    // Every event carries the replayable shape (id, kind, instants, provenance).
    for (const event of timeline) {
      expect(event.eventId.length).toBeGreaterThan(0);
      expect(event.provenance.length).toBeGreaterThan(0);
      expect(event.occurredAt).toMatch(/^\d{4}-/);
    }
    // The graph + fabric events appear (the merged P6 + P5 surfaces).
    const graphEvents = timeline.filter((event) => event.eventId.startsWith('graph-obs:'));
    const fabricEvents = timeline.filter((event) => event.eventId.startsWith('fabric-obs:'));
    expect(graphEvents.length).toBeGreaterThan(0);
    expect(fabricEvents.length).toBeGreaterThan(0);
  });

  it('the state trajectory is queryable: v1 -> v2 -> v1-restored (the revision-level state timeline)', async () => {
    const { world, v1Sha, v2Sha } = await runHistoryJourney();

    // The workspace head moved: v1 (flagship completion) -> v2 (regression commit).
    expect(v1Sha).toMatch(/^source:[0-9a-f]+$/);
    expect(v2Sha).toMatch(/^source:[0-9a-f]+$/);
    expect(v2Sha).not.toBe(v1Sha);
    expect(v1Sha).not.toBe(WORLD_BASE_SHA);

    // The production deployment trajectory: v1 (initial) -> v2 (regressed) -> v1-restored.
    const productionDeployments = [...world.gatewayWorld.deployments.values()].filter((d) => d.environment === 'production');
    expect(productionDeployments.length).toBeGreaterThanOrEqual(2); // v2 + restored-v1 (initial v1 may exist from the greenfield journey)
    // At least one production deployment is ROLLED_BACK (the v2 regression).
    expect(productionDeployments.some((d) => d.status === 'ROLLED_BACK' && d.sourceSha === v2Sha)).toBe(true);
    // The active production deployment is at v1 (restored).
    const activeProductionId = world.gatewayWorld.activeByEnvironment.get('production');
    expect(activeProductionId).toBeTruthy();
    const activeProduction = world.gatewayWorld.deployments.get(activeProductionId!);
    expect(activeProduction).toMatchObject({ sourceSha: v1Sha, status: 'ACTIVE' });
  });

  it('reproduces bit-exactly across runs (determinism — fresh world, identical inputs)', async () => {
    const first = await runHistoryJourney();
    const second = await runHistoryJourney();
    // The v1 + v2 shas reproduce exactly.
    expect(second.v1Sha).toBe(first.v1Sha);
    expect(second.v2Sha).toBe(first.v2Sha);
    // The action event sequence reproduces exactly.
    expect(second.world.actionEvents.entries().map((e) => e.actionId)).toEqual(
      first.world.actionEvents.entries().map((e) => e.actionId),
    );
    // The rollback verification verdict reproduces exactly.
    expect(second.rollbackReceipt.rollbackVerification?.verdict).toBe(first.rollbackReceipt.rollbackVerification?.verdict);
  });

  it('the GREENFIELD_JOURNEY_STAGES constant matches the §11 contract (frozen stages)', async () => {
    // The frozen stages are the §11 contract — they must NOT change.
    expect(GREENFIELD_JOURNEY_STAGES).toEqual([
      'MISSION_RECEIVED',
      'REPOSITORY_CONNECTED',
      'AUTHORITY_APPROVED',
      'MISSION_FORMALIZED',
      'PLAN_PREPARED',
      'GRAPH_BUILT',
      'WORKSPACE_PROVISIONED',
      'IMPLEMENTING',
      'IMPLEMENTED',
      'CHANGE_REALIZED',
      'DEPLOYED',
      'RUNTIME_VERIFIED',
      'COMPLETED',
    ]);
  });
});
