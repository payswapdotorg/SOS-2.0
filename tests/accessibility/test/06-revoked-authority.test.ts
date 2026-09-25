/**
 * LANE C, NEGATIVE CASE 06 — REVOKED AUTHORITY (the P9 action-time
 * re-evaluation: no privilege survives its authority).
 *
 * The fault: authority that was granted is REVOKED before a gated
 * action runs (mid-journey, or between grant and use at the gateway).
 * The system must fail CLOSED at ACTION TIME: the journey parks behind
 * a typed AUTHORITY_REQUIRED ask (never proceeds, never crashes), the
 * gateway denies with a typed GRANT_REVOKED record, the executor is
 * never invoked, the denials are durable evidence, and the evidence
 * graph stays queryable and truthful afterward. Never a silent pass.
 */

import { describe, expect, test } from 'vitest';
import {
  assertProductGraphQueryableAndTruthful,
  commitActionRequest,
  composeCredentialGateway,
  createProductWorld,
  driveOnCloudTicks,
  pushActionRequest,
  startFlagshipJourney,
} from './helpers.js';
import type { CredentialScopeRecord } from '@sos-2/security';

const NOW = 1_000_000;

function liveCredential(): CredentialScopeRecord {
  return {
    credentialId: 'cred-p15c-6',
    heldBy: 'body',
    holderId: 'body-1',
    families: ['commit', 'push'],
    expiresAt: NOW + 10_000,
    projectId: 'project-A',
  };
}

describe('P15 lane C negative case: revoked authority', () => {
  test('CONTAINED (journey): a mid-journey revocation parks the flagship journey behind a typed AUTHORITY_REQUIRED ask — nothing consequential runs', async () => {
    const world = createProductWorld();
    await startFlagshipJourney(world);
    // The user approved, but EVERY action-time grant is REVOKED before
    // the first consequential commit: the gateway denies; the journey parks.
    world.revokeJourneyAuthority();
    await driveOnCloudTicks(world);
    const state = world.journey.state();

    // Fail-closed: the journey parks, never proceeds to completion.
    expect(state.status).toBe('AWAITING_ASK');
    expect(state.pendingAsk!.stage).toBe('REALIZATION');
    expect(state.pendingAsk!.reasonCode).toBe('AUTHORITY_REQUIRED');
    // No completion was fabricated from revoked authority.
    expect(world.journey.completionReport()).toBeNull();
    // NOTHING was committed (the executor never ran a git.commit).
    expect(world.executor.calls.filter((call) => call.operation.op === 'git.commit')).toHaveLength(0);
    // The denial is typed, durable evidence in the gateway's action log.
    expect(world.actionEvents.entries().some((event) => event.type === 'action.denied')).toBe(true);
    for (const event of world.actionEvents.entries()) {
      if (event.type === 'action.denied') {
        expect(event.family).toBe('commit');
      }
    }
  });

  test('CONTAINED (journey): after the revocation the evidence graph stays queryable and truthful', async () => {
    const world = createProductWorld();
    await startFlagshipJourney(world);
    world.revokeJourneyAuthority();
    await driveOnCloudTicks(world);

    // The timeline still replays (including the honest ask-parked event).
    const timeline = await world.journey.timeline();
    expect(timeline.length).toBeGreaterThan(0);
    expect(timeline.some((event) => event.kind === 'journey.ask-parked')).toBe(true);
    // The shared truthfulness check: replayable evidence timeline + queryable stores.
    await assertProductGraphQueryableAndTruthful(world);
  });

  test('CONTAINED (gateway): a revoked grant fails closed — GRANT_REVOKED, executor NEVER invoked, denial durable', () => {
    const composed = composeCredentialGateway(liveCredential());
    const grantId = composed.authority.base.grant('body-1', 'commit', 'workspace');
    composed.authority.base.revoke(grantId); // the fault: revoked before use
    const outcome = composed.gateway.execute(commitActionRequest());
    expect(outcome.kind).toBe('executed');
    if (outcome.kind === 'executed') {
      expect(outcome.receipt.status).toBe('DENIED');
      expect(outcome.receipt.denial?.authority?.reason).toBe('GRANT_REVOKED');
    }
    expect(composed.executor.calls.length).toBe(0);
    expect(composed.eventLog.entries()[0]?.type).toBe('action.denied');
  });

  test('CONTAINED (gateway): revocation wipes EVERY family — no privilege survives its authority', () => {
    const composed = composeCredentialGateway(liveCredential());
    const grantIds = [
      composed.authority.base.grant('body-1', 'commit', 'workspace'),
      composed.authority.base.grant('body-1', 'push', 'main'),
    ];
    for (const grantId of grantIds) {
      composed.authority.base.revoke(grantId);
    }
    // Both families are denied at action time; the executor never runs.
    const commitOutcome = composed.gateway.execute(commitActionRequest({ actionId: 'act-p15c-6-commit', idempotencyKey: 'idem-p15c-6-commit' }));
    const pushOutcome = composed.gateway.execute(pushActionRequest({ actionId: 'act-p15c-6-push', idempotencyKey: 'idem-p15c-6-push' }));
    for (const outcome of [commitOutcome, pushOutcome]) {
      if (outcome.kind === 'executed') {
        expect(outcome.receipt.status).toBe('DENIED');
      }
    }
    expect(composed.executor.calls.length).toBe(0);
    expect(composed.authority.evaluations.length).toBe(2);
    for (const evaluation of composed.authority.evaluations) {
      expect(evaluation.snapshot.granted).toBe(false);
    }
  });
});
