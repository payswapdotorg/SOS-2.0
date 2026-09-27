/**
 * IDEMPOTENCY (Work Order P19, deterministic suite) — the gateway's
 * replay protection over the real executor seam: double-submitting the
 * SAME action (the same actionId + idempotency key, exactly the way the
 * realizer derives them deterministically from the payload) replays the
 * RECORDED original receipt — one world transition, the executor NOT
 * re-invoked, and the replay is itself recorded.
 */

import { describe, expect, it } from 'vitest';
import { fnv1a64, canonicalJson } from '@sos-2/action-gateway';
import { createScriptedDogfoodWorld, defaultScriptedModelEntries } from './scripted-world.js';

describe('P19 scripted dogfood: idempotency (double-submit replays the recorded receipt)', () => {
  it('re-submitting the same commit action returns the SAME receipt without re-invoking the executor', async () => {
    const world = createScriptedDogfoodWorld({
      journeyId: 'p19-dogfood-idem',
      repositorySlug: 'payswapdotorg/sos-dogfood-idem',
      vercelProjectName: 'sos-dogfood-idem',
      modelEntries: defaultScriptedModelEntries(),
    });
    await world.harness.preflight();

    // The user-present phase (kickoff -> the scripted whoami handshake ->
    // connect -> the typed approval): the approval mints the action-time
    // grants the commit below acts under (the gateway re-evaluates them at
    // action time — exactly the production composition).
    const journey = world.harness.journey;
    await journey.kickoff({
      statement: 'Build a markdown notes service with a public API',
      repositorySlug: 'payswapdotorg/sos-dogfood-idem',
      capturedAt: new Date(0).toISOString(),
      source: 'web-console:greenfield',
    });
    await world.harness.provider.verifyToken(new Date(0).toISOString());
    const connect = await journey.connectRepository('payswapdotorg/sos-dogfood-idem');
    expect(connect.kind).toBe('CONNECTED');
    await journey.approveAuthority({ approvedBy: 'p19-dogfood:operator' });
    expect(world.harness.grantedGrantIds.length).toBeGreaterThan(0);

    // The harness approval minted the action-time grants; stage a real
    // (scripted-provider) commit outcome exactly the way the drive loop does.
    const message = 'Implement: idempotency probe (attempt 1)';
    const baseSha = world.harness.realizer.currentHead();
    const changes = [{ path: 'README.md', contents: '# idempotency probe\n' }];
    const committed = await world.harness.provider.commitFiles({
      repository: { owner: 'payswapdotorg', name: 'sos-dogfood-idem' },
      branch: 'sos/mission-p19-dogfood-idem',
      message,
      files: changes,
    });
    if (committed.status !== 'OK') {
      throw new Error(`the scripted provider commit failed: ${committed.reason}`);
    }
    world.harness.staging.stageCommit({ message, baseSha, changes }, {
      newSha: committed.result.sha,
      committedAt: committed.result.committed_at,
      providerNote: 'the idempotency probe commit',
    });

    // The request the realizer derives (the deterministic idempotency key
    // over family + payload + head + discriminator — realizer.execute's format).
    const digest = fnv1a64(
      canonicalJson({
        family: 'commit',
        payloadFields: { commit: { message, changes, expectedBaseSha: baseSha } },
        head: baseSha,
        discriminator: { discriminator: `task:p13-idem`, baseSha },
      }),
    );
    const request = {
      actionId: `p13-act-commit-${digest}`,
      idempotencyKey: `p13-idem-commit-${digest}`,
      family: 'commit' as const,
      actor: { kind: 'body' as const, id: 'p13-acting-body:p19-dogfood-idem' },
      requestedAt: 0,
      targetRevision: { kind: 'source' as const, sha: baseSha },
      payload: { family: 'commit' as const, commit: { message, changes, expectedBaseSha: baseSha } },
    };

    const first = world.harness.gateway.execute(request);
    expect(first.kind).toBe('executed');
    if (first.kind !== 'executed') {
      throw new Error('unreachable: the staged outcome answers');
    }
    expect(first.receipt.status).toBe('SUCCEEDED');
    const invocationsAfterFirst = world.harness.staging.invocationList().length;

    // DOUBLE-SUBMIT the same action: the REPLAY returns the recorded receipt.
    const replay = world.harness.gateway.execute(request);
    expect(replay.kind).toBe('replayed');
    if (replay.kind === 'replayed') {
      expect(replay.receipt.actionId).toBe(first.receipt.actionId);
      expect(replay.receipt.idempotencyKey).toBe(first.receipt.idempotencyKey);
      expect(replay.receipt.status).toBe('SUCCEEDED');
      expect(replay.receipt.sourceRevision).toBe(first.receipt.sourceRevision);
      // The commit receipt carries the EXACT staged (scripted-provider) sha.
      expect((replay.receipt.output as { produced: { newSha: string } }).produced.newSha).toBe(committed.result.sha);
    }
    // The executor was NOT re-invoked (the replay protection held).
    expect(world.harness.staging.invocationList().length).toBe(invocationsAfterFirst);
  });
});
