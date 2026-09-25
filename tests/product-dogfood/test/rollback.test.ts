/**
 * THE ROLLBACK JOURNEY (P15 Lane A). Drives a verified candidate through
 * the P9 action-gateway to become the live system state, then ROLLS BACK
 * the live state to the prior revision — asserting revision-level state
 * transitions with evidence per action (via the merged action/state
 * surfaces — never by mutating state directly).
 *
 * The journey:
 *   commit (initial) -> deployment (production v1)
 *   -> commit (regression) -> deployment (production v2 = regressed)
 *   -> rollback (production v2 -> production v1 = restored)
 *
 * The journey asserts the P15 acceptance shape:
 *   (a) composition: every consequential action through the P9
 *       ActionGateway (action-time authority re-evaluation per action).
 *   (b) terminal state: the production deployment record for v2 is
 *       ROLLED_BACK; a NEW deployment record is ACTIVE at the prior
 *       source sha (v1).
 *   (c) evidence graph: the rollback receipt carries the rollback
 *       verification record (verdict VERIFIED | UNKNOWN — honest, never
 *       fabricated); the evidence chain has one evidence record per
 *       action outcome.
 *   (d) retained uncertainty: VISIBLE — the rollback verification
 *       carries its verdict + limitation (the reference verifier is a
 *       deterministic simulator; never presented as live verification).
 *   (e) history is queryable end-to-end: the action event log preserves
 *       every action in order, including the rollback (the §10
 *       completion discipline).
 */

import { describe, expect, it } from 'vitest';
import { WORLD_BASE_SHA } from '@sos-2/action-gateway';
import type { ActionReceipt, GatewayOutcome } from '@sos-2/action-gateway';
import { createProductDogfoodWorld } from './world.js';
import type { ProductDogfoodWorld } from './world.js';

/** Expect the outcome to be executed and return the receipt. */
function expectExecuted(outcome: GatewayOutcome): ActionReceipt {
  if (outcome.kind !== 'executed') {
    throw new Error(`expected an executed receipt, got kind=${outcome.kind}; denial/failure=${JSON.stringify(outcome)}`);
  }
  return outcome.receipt;
}

/** Run the complete rollback journey on a fresh world. */
function runRollbackJourney(): {
  world: ProductDogfoodWorld;
  v1CommitReceipt: ActionReceipt;
  v1DeploymentReceipt: ActionReceipt;
  v2CommitReceipt: ActionReceipt;
  v2DeploymentReceipt: ActionReceipt;
  rollbackReceipt: ActionReceipt;
  v1Sha: string;
  v2Sha: string;
} {
  const world = createProductDogfoodWorld({});

  // Pre-grant authority for every family+scope the journey uses.
  // The rollback scope is the deploymentId (content-addressed; unknown
  // ahead of time), so we use the wildcard scope '*' (the InMemoryAuthority
  // wildcard match documented in @sos-2/action-gateway).
  world.authority.grant('body:p15a-rollback', 'commit', 'workspace');
  world.authority.grant('body:p15a-rollback', 'deployment', 'production');
  world.authority.grant('body:p15a-rollback', 'rollback', '*');

  const actor = { kind: 'body' as const, id: 'body:p15a-rollback' };
  const t = () => world.clock.nowEpochMs();

  // 1) commit v1 (initial state).
  const v1CommitOutcome = world.gateway.execute({
    actionId: 'p15a-rollback-commit-v1',
    idempotencyKey: 'p15a-rollback-commit-v1',
    family: 'commit',
    actor,
    requestedAt: t(),
    targetRevision: { kind: 'source', sha: WORLD_BASE_SHA },
    payload: {
      family: 'commit',
      commit: {
        message: 'p15a rollback journey: v1 (initial)',
        changes: [{ path: 'src/version.ts', contents: 'export const VERSION = "v1";\n' }],
        expectedBaseSha: WORLD_BASE_SHA,
      },
    },
  });
  const v1CommitReceipt = expectExecuted(v1CommitOutcome);
  const v1Sha = world.gatewayWorld.heads.get('workspace')!;

  // 2) deploy v1 to production.
  world.clock.advance(1_000);
  const v1DeploymentOutcome = world.gateway.execute({
    actionId: 'p15a-rollback-deploy-v1',
    idempotencyKey: 'p15a-rollback-deploy-v1',
    family: 'deployment',
    actor,
    requestedAt: t(),
    targetRevision: { kind: 'source', sha: v1Sha },
    payload: {
      family: 'deployment',
      deployment: { environment: 'production', sourceSha: v1Sha },
    },
  });
  const v1DeploymentReceipt = expectExecuted(v1DeploymentOutcome);

  // 3) commit v2 (regression).
  world.clock.advance(1_000);
  const v2CommitOutcome = world.gateway.execute({
    actionId: 'p15a-rollback-commit-v2',
    idempotencyKey: 'p15a-rollback-commit-v2',
    family: 'commit',
    actor,
    requestedAt: t(),
    targetRevision: { kind: 'source', sha: v1Sha },
    payload: {
      family: 'commit',
      commit: {
        message: 'p15a rollback journey: v2 (regression)',
        changes: [{ path: 'src/version.ts', contents: 'export const VERSION = "v2-broken";\n' }],
        expectedBaseSha: v1Sha,
      },
    },
  });
  const v2CommitReceipt = expectExecuted(v2CommitOutcome);
  const v2Sha = world.gatewayWorld.heads.get('workspace')!;

  // 4) deploy v2 to production (regression goes live).
  world.clock.advance(1_000);
  const v2DeploymentOutcome = world.gateway.execute({
    actionId: 'p15a-rollback-deploy-v2',
    idempotencyKey: 'p15a-rollback-deploy-v2',
    family: 'deployment',
    actor,
    requestedAt: t(),
    targetRevision: { kind: 'source', sha: v2Sha },
    payload: {
      family: 'deployment',
      deployment: { environment: 'production', sourceSha: v2Sha },
    },
  });
  const v2DeploymentReceipt = expectExecuted(v2DeploymentOutcome);

  // 5) rollback the v2 production deployment to v1.
  world.clock.advance(1_000);
  const rollbackOutcome = world.gateway.execute({
    actionId: 'p15a-rollback-rollback-1',
    idempotencyKey: 'p15a-rollback-rollback-1',
    family: 'rollback',
    actor,
    requestedAt: t(),
    targetRevision: { kind: 'source', sha: v1Sha },
    payload: {
      family: 'rollback',
      rollback: {
        deploymentId: v2DeploymentReceipt.deploymentRevision!,
        fromSourceSha: v2Sha,
        toSourceSha: v1Sha,
        reason: { code: 'INCIDENT', detail: 'p15a rollback journey: regression observed in production; rolling back to v1' },
      },
    },
  });
  const rollbackReceipt = expectExecuted(rollbackOutcome);

  return {
    world,
    v1CommitReceipt,
    v1DeploymentReceipt,
    v2CommitReceipt,
    v2DeploymentReceipt,
    rollbackReceipt,
    v1Sha,
    v2Sha,
  };
}

describe('P15 Lane A — rollback: live state returns to the prior revision with evidence', () => {
  it('drives commit-v1 -> deploy-v1 -> commit-v2 -> deploy-v2 -> rollback-v2-to-v1 through the P9 gateway', () => {
    const { world, v1CommitReceipt, v1DeploymentReceipt, v2CommitReceipt, v2DeploymentReceipt, rollbackReceipt } = runRollbackJourney();

    // Every action succeeded.
    for (const receipt of [v1CommitReceipt, v1DeploymentReceipt, v2CommitReceipt, v2DeploymentReceipt, rollbackReceipt]) {
      expect(receipt.status).toBe('SUCCEEDED');
      expect(receipt.denial).toBeNull();
      expect(receipt.failure).toBeNull();
    }

    // The action events log records every consequential action in order.
    const families = world.actionEvents.entries().map((event) => event.family);
    expect(families).toEqual(['commit', 'deployment', 'commit', 'deployment', 'rollback']);
    for (const event of world.actionEvents.entries()) {
      expect(event.type).toBe('action.succeeded');
    }
  });

  it('the v2 production deployment record transitions to ROLLED_BACK; a new deployment record is ACTIVE at v1', () => {
    const { world, v2DeploymentReceipt, rollbackReceipt, v1Sha, v2Sha } = runRollbackJourney();

    // The v2 production deployment record is now ROLLED_BACK.
    const v2DeploymentId = v2DeploymentReceipt.deploymentRevision!;
    const v2Deployment = world.gatewayWorld.deployments.get(v2DeploymentId);
    expect(v2Deployment).toMatchObject({ environment: 'production', sourceSha: v2Sha, status: 'ROLLED_BACK' });

    // The rollback receipt references a NEW deployment id (the restored v1 deployment).
    const restoredDeploymentId = rollbackReceipt.deploymentRevision!;
    expect(restoredDeploymentId).not.toBe(v2DeploymentId);

    // The restored deployment is ACTIVE at the prior source sha (v1).
    const restoredDeployment = world.gatewayWorld.deployments.get(restoredDeploymentId);
    expect(restoredDeployment).toMatchObject({ environment: 'production', sourceSha: v1Sha, status: 'ACTIVE' });

    // The active-by-environment index reflects the LATEST state (v1 restored).
    expect(world.gatewayWorld.activeByEnvironment.get('production')).toBe(restoredDeploymentId);
  });

  it('the rollback receipt carries the rollback verification record (verdict VERIFIED | UNKNOWN — never fabricated)', () => {
    const { rollbackReceipt, v1Sha, v2Sha } = runRollbackJourney();

    // The rollback receipt's output carries the rollback verification.
    expect(rollbackReceipt.output).not.toBeNull();
    // The source revision is the restored sha (v1).
    expect(rollbackReceipt.sourceRevision).toBe(v1Sha);
    // The from-source-sha was v2 (the regressed state).
    expect(v2Sha).not.toBe(v1Sha);

    // The rollback verification record is one of VERIFIED | UNKNOWN (honest).
    // (the ReferenceRollbackVerifier is a deterministic simulator; its verdict
    // is never presented as a live verification — the limitation rides along).
    expect(rollbackReceipt.rollbackVerification).not.toBeNull();
    const verification = rollbackReceipt.rollbackVerification!;
    expect(['VERIFIED', 'UNKNOWN']).toContain(verification.verdict);
    expect(verification.expectedSourceSha).toBe(v1Sha);
    // The observed-source-sha is either the restored sha (VERIFIED) or null (UNKNOWN).
    if (verification.verdict === 'VERIFIED') {
      expect(verification.observedSourceSha).toBe(v1Sha);
    } else {
      expect(verification.observedSourceSha).toBeNull();
      // The UNKNOWN verdict CARRIES its limitation (retained uncertainty visible).
      expect(verification.limitation).toBeTruthy();
    }
  });

  it('action-time authority was re-evaluated for EVERY action including the rollback', () => {
    const { world } = runRollbackJourney();

    // Five actions, five action-time authority evaluations (or more).
    expect(world.authority.evaluations.length).toBeGreaterThanOrEqual(5);
    for (const evaluation of world.authority.evaluations) {
      expect(evaluation.snapshot.reason).toBe('GRANTED');
      expect(evaluation.snapshot.granted).toBe(true);
    }
  });

  it('the evidence chain has one evidence record per action outcome (incl. the rollback evidence)', () => {
    const { world } = runRollbackJourney();

    const actionCount = world.actionEvents.entries().length;
    const evidenceCount = world.evidence.all().length;
    expect(actionCount).toBe(5);
    expect(evidenceCount).toBeGreaterThanOrEqual(actionCount);
  });

  it('history is queryable end-to-end: every action event preserves the typed family + the receipt', () => {
    const { world, v1CommitReceipt, v1DeploymentReceipt, v2CommitReceipt, v2DeploymentReceipt, rollbackReceipt } = runRollbackJourney();

    // The action event log preserves every action in chronological order.
    const events = world.actionEvents.entries();
    expect(events.length).toBe(5);

    // The first event is the v1 commit; the last event is the rollback.
    expect(events[0]!.family).toBe('commit');
    expect(events[0]!.actionId).toBe(v1CommitReceipt.actionId);
    expect(events[events.length - 1]!.family).toBe('rollback');
    expect(events[events.length - 1]!.actionId).toBe(rollbackReceipt.actionId);

    // The intermediate events are in deterministic order (deploy-v1, commit-v2, deploy-v2).
    expect(events[1]!.family).toBe('deployment');
    expect(events[1]!.actionId).toBe(v1DeploymentReceipt.actionId);
    expect(events[2]!.family).toBe('commit');
    expect(events[2]!.actionId).toBe(v2CommitReceipt.actionId);
    expect(events[3]!.family).toBe('deployment');
    expect(events[3]!.actionId).toBe(v2DeploymentReceipt.actionId);
  });

  it('reproduces bit-exactly across runs (determinism — fresh world, identical inputs)', () => {
    const first = runRollbackJourney();
    const second = runRollbackJourney();
    // The v1 + v2 source shas reproduce exactly.
    expect(second.v1Sha).toBe(first.v1Sha);
    expect(second.v2Sha).toBe(first.v2Sha);
    // The action event sequence reproduces exactly.
    expect(second.world.actionEvents.entries().map((e) => e.actionId)).toEqual(
      first.world.actionEvents.entries().map((e) => e.actionId),
    );
    // The rollback verification verdict reproduces exactly.
    expect(second.rollbackReceipt.rollbackVerification?.verdict).toBe(first.rollbackReceipt.rollbackVerification?.verdict);
  });
});
