import { describe, expect, it } from 'vitest';
import type { ActionRequest } from '@sos-2/action-gateway';
import { buildFixture, expectExecuted, requestForFamily, WORLD_BASE_SHA } from './helpers.js';

function rollbackRequest(deploymentId: string, index: number): ActionRequest {
  return {
    actionId: `act-rollback-${index}`,
    idempotencyKey: `idem-rollback-${index}`,
    family: 'rollback',
    actor: { kind: 'body', id: 'body-1' },
    requestedAt: 1_000_000,
    targetRevision: { kind: 'source', sha: WORLD_BASE_SHA },
    payload: {
      family: 'rollback',
      rollback: {
        deploymentId,
        fromSourceSha: WORLD_BASE_SHA,
        toSourceSha: 'seed-previous-sha',
        reason: { code: 'FAILED_VERIFICATION', detail: 'deployment verification failed' },
      },
    },
  };
}

function deployFirst() {
  const fx = buildFixture();
  fx.authority.grant('body-1', 'deployment', '*');
  fx.authority.grant('body-1', 'rollback', '*');
  const deployReceipt = expectExecuted(fx.gateway.execute(requestForFamily('deployment', 0)));
  const deploymentId = deployReceipt.deploymentRevision ?? '';
  if (deploymentId === '') throw new Error('expected a deployment revision');
  return { fx, deploymentId };
}

describe('P9 rollback is a first-class action with its own evidence chain', () => {
  it('records what, from which revision to which, why, and the VERIFIED rolled-back state', () => {
    const { fx, deploymentId } = deployFirst();
    const receipt = expectExecuted(fx.gateway.execute(rollbackRequest(deploymentId, 1)));
    expect(receipt.status).toBe('SUCCEEDED');
    const restoredDeploymentId = receipt.deploymentRevision ?? '';
    expect(restoredDeploymentId).not.toBe(deploymentId);
    expect(receipt.rollbackVerification?.verdict).toBe('VERIFIED');
    expect(receipt.rollbackVerification?.expectedSourceSha).toBe('seed-previous-sha');
    expect(receipt.rollbackVerification?.observedSourceSha).toBe('seed-previous-sha');

    const outcomes = fx.evidence.ofType('rollback.outcome');
    expect(outcomes).toHaveLength(1);
    const outcomeRecord = outcomes[0];
    if (outcomeRecord?.evidenceType !== 'rollback.outcome') throw new Error('unreachable');
    expect(outcomeRecord.deploymentId).toBe(deploymentId);
    expect(outcomeRecord.fromSourceSha).toBe(WORLD_BASE_SHA);
    expect(outcomeRecord.toSourceSha).toBe('seed-previous-sha');
    expect(outcomeRecord.reason.code).toBe('FAILED_VERIFICATION');

    const verifications = fx.evidence.ofType('rollback.verification');
    expect(verifications).toHaveLength(1);

    // the world actually reflects the rolled-back state
    expect(fx.world.activeByEnvironment.get('staging')).toBe(restoredDeploymentId);
    expect(fx.world.deployments.get(deploymentId)?.status).toBe('ROLLED_BACK');

    // every rollback evidence record is bound to this action
    for (const record of fx.evidence.all()) {
      if (record.evidenceType !== 'action.outcome') {
        expect(record.actionId).toBe('act-rollback-1');
      }
    }
  });

  it('an unobservable rolled-back state is recorded honestly as UNKNOWN, never fabricated as VERIFIED', () => {
    const fx = buildFixture();
    fx.authority.grant('body-1', 'rollback', '*');
    fx.world.script('rollback.apply', {
      status: 'ok',
      output: { produced: { deploymentId: 'deployment:unobserved', sourceSha: 'seed-previous-sha' } },
    });
    const receipt = expectExecuted(fx.gateway.execute(rollbackRequest('deployment:some-id', 2)));
    expect(receipt.status).toBe('SUCCEEDED'); // the executor reported success...
    expect(receipt.rollbackVerification?.verdict).toBe('UNKNOWN'); // ...but verification honestly says UNKNOWN
    expect(receipt.rollbackVerification?.limitation ?? '').toContain('not observed');
    const verifications = fx.evidence.ofType('rollback.verification');
    const verification = verifications[0];
    if (verification?.evidenceType !== 'rollback.verification') throw new Error('expected rollback verification evidence');
    expect(verification.verdict).toBe('UNKNOWN');
  });
});
