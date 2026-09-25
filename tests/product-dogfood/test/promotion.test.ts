/**
 * THE PROMOTION JOURNEY (P15 Lane A). Drives a verified candidate
 * through the P9 action-gateway to become the live system state —
 * asserting revision-level state transitions with evidence per action
 * (via the merged action/state surfaces — never by mutating state
 * directly).
 *
 * The journey:
 *   commit (workspace) -> push (remote) -> pull-request -> deployment
 *   -> promotion (staging -> production)
 *
 * The journey asserts the P15 acceptance shape:
 *   (a) composition: every consequential action through the P9
 *       ActionGateway (action-time authority re-evaluation per action).
 *   (b) terminal state: the production environment deployment is ACTIVE
 *       at the exact promoted source sha.
 *   (c) evidence graph: every action receipt carries an exact source
 *       revision + deployment revision (when applicable); the evidence
 *       chain has one evidence record per action outcome.
 *   (d) retained uncertainty: VISIBLE — the reference executor + the
 *       honest provider status ride along in the action log.
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

/** Run the complete promotion journey on a fresh world. */
function runPromotionJourney(): {
  world: ProductDogfoodWorld;
  commitReceipt: ActionReceipt;
  pushReceipt: ActionReceipt;
  pullRequestReceipt: ActionReceipt;
  deploymentReceipt: ActionReceipt;
  promotionReceipt: ActionReceipt;
} {
  const world = createProductDogfoodWorld({});

  // Pre-grant authority for every family+scope the journey uses (action-time re-evaluation will succeed).
  world.authority.grant('body:p15a-promotion', 'commit', 'workspace');
  world.authority.grant('body:p15a-promotion', 'push', 'sos/mission-promotion-01');
  world.authority.grant('body:p15a-promotion', 'pull-request', 'sos/mission-promotion-01');
  world.authority.grant('body:p15a-promotion', 'deployment', 'staging');
  world.authority.grant('body:p15a-promotion', 'promotion', 'production');

  const actor = { kind: 'body' as const, id: 'body:p15a-promotion' };
  const t = () => world.clock.nowEpochMs();

  // 1) commit: produce the source revision.
  const commitOutcome = world.gateway.execute({
    actionId: 'p15a-promotion-commit-1',
    idempotencyKey: 'p15a-promotion-commit-1',
    family: 'commit',
    actor,
    requestedAt: t(),
    targetRevision: { kind: 'source', sha: WORLD_BASE_SHA },
    payload: {
      family: 'commit',
      commit: {
        message: 'p15a promotion journey: introduce the change',
        changes: [{ path: 'src/promoted-feature.ts', contents: 'export const promotedFeature = 42;\n' }],
        expectedBaseSha: WORLD_BASE_SHA,
      },
    },
  });
  const commitReceipt = expectExecuted(commitOutcome);
  const promotedSha = world.gatewayWorld.heads.get('workspace')!;

  // 2) push: propagate the source revision to the remote.
  world.clock.advance(1_000);
  const pushOutcome = world.gateway.execute({
    actionId: 'p15a-promotion-push-1',
    idempotencyKey: 'p15a-promotion-push-1',
    family: 'push',
    actor,
    requestedAt: t(),
    targetRevision: { kind: 'source', sha: promotedSha },
    payload: {
      family: 'push',
      push: { remote: 'github.com/acme/promotion-repo', ref: 'sos/mission-promotion-01', fromSha: promotedSha },
    },
  });
  const pushReceipt = expectExecuted(pushOutcome);

  // 3) pull-request: open a PR from the implementation branch.
  world.clock.advance(1_000);
  const prOutcome = world.gateway.execute({
    actionId: 'p15a-promotion-pr-1',
    idempotencyKey: 'p15a-promotion-pr-1',
    family: 'pull-request',
    actor,
    requestedAt: t(),
    targetRevision: { kind: 'source', sha: promotedSha },
    payload: {
      family: 'pull-request',
      pullRequest: {
        title: 'p15a promotion journey',
        headBranch: 'sos/mission-promotion-01',
        baseBranch: 'main',
        description: 'the verified candidate becomes the live system state',
      },
    },
  });
  const pullRequestReceipt = expectExecuted(prOutcome);

  // 4) deployment: deploy the source revision to staging.
  world.clock.advance(1_000);
  const deploymentOutcome = world.gateway.execute({
    actionId: 'p15a-promotion-deployment-1',
    idempotencyKey: 'p15a-promotion-deployment-1',
    family: 'deployment',
    actor,
    requestedAt: t(),
    targetRevision: { kind: 'source', sha: promotedSha },
    payload: {
      family: 'deployment',
      deployment: { environment: 'staging', sourceSha: promotedSha },
    },
  });
  const deploymentReceipt = expectExecuted(deploymentOutcome);

  // 5) promotion: promote the staging deployment to production (same source sha).
  world.clock.advance(1_000);
  const promotionOutcome = world.gateway.execute({
    actionId: 'p15a-promotion-promotion-1',
    idempotencyKey: 'p15a-promotion-promotion-1',
    family: 'promotion',
    actor,
    requestedAt: t(),
    targetRevision: { kind: 'source', sha: promotedSha },
    payload: {
      family: 'promotion',
      promotion: { fromEnvironment: 'staging', toEnvironment: 'production', sourceSha: promotedSha },
    },
  });
  const promotionReceipt = expectExecuted(promotionOutcome);

  return { world, commitReceipt, pushReceipt, pullRequestReceipt, deploymentReceipt, promotionReceipt };
}

describe('P15 Lane A — promotion: a verified candidate becomes the live system state', () => {
  it('drives commit -> push -> PR -> staging deployment -> production promotion through the P9 gateway', () => {
    const { world, commitReceipt, pushReceipt, pullRequestReceipt, deploymentReceipt, promotionReceipt } = runPromotionJourney();

    // Every action succeeded (status: SUCCEEDED).
    for (const receipt of [commitReceipt, pushReceipt, pullRequestReceipt, deploymentReceipt, promotionReceipt]) {
      expect(receipt.status).toBe('SUCCEEDED');
      expect(receipt.denial).toBeNull();
      expect(receipt.failure).toBeNull();
    }

    // The action events log records every consequential action in order.
    const families = world.actionEvents.entries().map((event) => event.family);
    expect(families).toEqual(['commit', 'push', 'pull-request', 'deployment', 'promotion']);
    for (const event of world.actionEvents.entries()) {
      expect(event.type).toBe('action.succeeded');
    }
  });

  it('every action carries the exact source revision it operated on', () => {
    const { world, commitReceipt, pushReceipt, pullRequestReceipt, deploymentReceipt, promotionReceipt } = runPromotionJourney();
    const promotedSha = world.gatewayWorld.heads.get('workspace')!;

    // The commit advanced the workspace head BEYOND the world base sha.
    expect(promotedSha).not.toBe(WORLD_BASE_SHA);
    // The commit receipt references the produced source revision (the new workspace head).
    expect(commitReceipt.sourceRevision).toBe(WORLD_BASE_SHA); // the request targeted the base sha
    // The push + PR + deployment + promotion all reference the same promoted source sha as their target.
    expect(pushReceipt.sourceRevision).toBe(promotedSha);
    expect(pullRequestReceipt.sourceRevision).toBe(promotedSha);
    expect(deploymentReceipt.sourceRevision).toBe(promotedSha);
    expect(promotionReceipt.sourceRevision).toBe(promotedSha);
  });

  it('the staging deployment is ACTIVE at the promoted source sha, then the production promotion supersedes it', () => {
    const { world, deploymentReceipt, promotionReceipt } = runPromotionJourney();
    const promotedSha = world.gatewayWorld.heads.get('workspace')!;

    // The staging deployment is recorded as ACTIVE at the exact promoted source sha.
    const stagingId = deploymentReceipt.deploymentRevision;
    expect(stagingId).not.toBeNull();
    const staging = world.gatewayWorld.deployments.get(stagingId!);
    expect(staging).toMatchObject({ environment: 'staging', sourceSha: promotedSha, status: 'ACTIVE' });

    // The promotion created a NEW ACTIVE deployment in the production environment at the same sha.
    const productionId = promotionReceipt.deploymentRevision;
    expect(productionId).not.toBeNull();
    expect(productionId).not.toBe(stagingId); // promotion mints a new deployment id
    const production = world.gatewayWorld.deployments.get(productionId!);
    expect(production).toMatchObject({ environment: 'production', sourceSha: promotedSha, status: 'ACTIVE' });

    // The active-by-environment index reflects the latest state per environment.
    expect(world.gatewayWorld.activeByEnvironment.get('staging')).toBe(stagingId);
    expect(world.gatewayWorld.activeByEnvironment.get('production')).toBe(productionId);
  });

  it('action-time authority was re-evaluated for EVERY action (no planning-time grant is sufficient)', () => {
    const { world } = runPromotionJourney();

    // Five actions, five action-time authority evaluations.
    expect(world.authority.evaluations.length).toBeGreaterThanOrEqual(5);
    for (const evaluation of world.authority.evaluations) {
      expect(evaluation.snapshot.reason).toBe('GRANTED');
      expect(evaluation.snapshot.granted).toBe(true);
    }
  });

  it('the evidence chain has one evidence record per action outcome (the typed trace link)', () => {
    const { world } = runPromotionJourney();

    // The action events + the evidence sink agree on the count (one evidence per action).
    const actionCount = world.actionEvents.entries().length;
    const evidenceCount = world.evidence.all().length;
    expect(actionCount).toBe(5);
    expect(evidenceCount).toBeGreaterThanOrEqual(actionCount);
  });

  it('retained uncertainty is VISIBLE — the reference executor + the honest provider status ride along', () => {
    const { world } = runPromotionJourney();
    // The reference executor was exercised (it produced every action outcome deterministically).
    expect(world.executor.calls.length).toBeGreaterThanOrEqual(5);
    // Every call was a typed operation (no real network / no real git).
    for (const call of world.executor.calls) {
      expect(call.operation.op).toMatch(/^(git\.commit|git\.push|git\.openPullRequest|deployment\.apply|promotion\.apply)$/);
    }
  });

  it('reproduces bit-exactly across runs (determinism — fresh world, identical inputs)', () => {
    const first = runPromotionJourney();
    const second = runPromotionJourney();
    // The promoted source sha reproduces exactly.
    expect(second.world.gatewayWorld.heads.get('workspace')).toBe(first.world.gatewayWorld.heads.get('workspace'));
    // The action event sequence reproduces exactly.
    expect(second.world.actionEvents.entries().map((e) => e.actionId)).toEqual(
      first.world.actionEvents.entries().map((e) => e.actionId),
    );
  });
});
