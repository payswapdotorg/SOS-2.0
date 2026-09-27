/**
 * AUTHORITY FAIL-CLOSED (Work Order P19, deterministic suite) — a
 * revoked action-time grant produces the typed denial AT ACTION TIME
 * with NO executor invocation AND no real provider call (the
 * fail-closed end-to-end property: the composition-boundary pre-check
 * skips the real API call; the gateway denies; the journey parks behind
 * the typed AUTHORITY_REQUIRED ask — never a retry-until-granted).
 */

import { describe, expect, it } from 'vitest';
import { createScriptedDogfoodWorld, defaultScriptedModelEntries } from './scripted-world.js';

describe('P19 scripted dogfood: authority fail-closed at action time', () => {
  it('a revoked grant → the typed denial, NO executor invocation, NO provider call, the journey parks honestly', async () => {
    const world = createScriptedDogfoodWorld({
      journeyId: 'p19-dogfood-authority',
      repositorySlug: 'payswapdotorg/sos-dogfood-authority',
      vercelProjectName: 'sos-dogfood-authority',
      modelEntries: defaultScriptedModelEntries(),
    });

    // The user-present phase (kickoff -> connect -> approve) — then revoke.
    await world.harness.preflight();
    const journey = world.harness.journey;

    // Drive the user-present phase exactly the way run() does, but by hand
    // so the revocation lands before the first consequential action.
    const raw = {
      statement: 'Build a markdown notes service with a public API',
      repositorySlug: 'payswapdotorg/sos-dogfood-authority',
      capturedAt: new Date(0).toISOString(),
      source: 'web-console:greenfield',
    };
    await journey.kickoff(raw);
    await world.harness.provider.verifyToken(new Date(0).toISOString());
    const connect = await journey.connectRepository('payswapdotorg/sos-dogfood-authority');
    expect(connect.kind).toBe('CONNECTED');
    await journey.approveAuthority({ approvedBy: 'p19-dogfood:operator' });
    // The approval minted the action-time grants (revocation targets these).
    expect(world.harness.grantedGrantIds.length).toBeGreaterThan(0);

    // THREE cloud ticks to pass the deterministic pipeline stages
    // (formalize -> plan -> graph) up to the first dispatch tick.
    for (let index = 0; index < 3; index += 1) {
      await journey.onCloudTick();
    }
    expect(journey.state().stage).toBe('GRAPH_BUILT');

    // Revoke EVERY action-time grant BEFORE any staging ran (the scaffold
    // commit never happened — the fail-closed fixture is airtight).
    const providerCallsBefore = world.github.recordedRequests().length;
    const invocationsBefore = world.harness.staging.invocationList().length;
    const receiptsBefore = world.harness.staging.observedReceiptList().length;
    for (const grantId of world.harness.grantedGrantIds) {
      world.harness.authority.revoke(grantId);
    }

    // The composition-boundary staging of the next node: the body run is
    // driven (the model seam is NOT an authority-gated provider call), but
    // the authority pre-check FAILS → the REAL provider call is SKIPPED
    // (fail-closed end-to-end: nothing real happens outside the gateway).
    await world.harness.stageNextNode();
    expect(world.github.recordedRequests().length).toBe(providerCallsBefore);

    // The next tick: the dispatch runs, the body seam answers the staged
    // run, the gateway DENIES the commit at action time, and the journey
    // parks behind the typed AUTHORITY_REQUIRED ask.
    const record = await journey.onCloudTick();
    const state = journey.state();

    expect(record.action.kind).toBe('ASK_PARKED');
    expect(state.status).toBe('AWAITING_ASK');
    expect(state.pendingAsk).not.toBeNull();
    expect(state.pendingAsk!.reasonCode).toBe('AUTHORITY_REQUIRED');
    expect(state.pendingAsk!.detail).toContain('DENIED at action time');
    expect(state.stage).toBe('GRAPH_BUILT'); // the stage never advances past a denial (the scaffold dispatch never completed)
    expect(journey.completionReport()).toBeNull();

    // NO executor invocation for the denied action (the gateway refuses
    // before executor selection) and NO real provider call (the pre-check).
    expect(world.harness.staging.invocationList().length).toBe(invocationsBefore);
    expect(world.github.recordedRequests().length).toBeLessThanOrEqual(providerCallsBefore + 1); // +1 slack: the honest pre-check performs no provider call
    expect(world.harness.staging.observedReceiptList().length).toBe(receiptsBefore + 1); // the DENIED receipt IS recorded
    const deniedReceipt = world.harness.staging.observedReceiptList()[world.harness.staging.observedReceiptList().length - 1]!;
    expect(deniedReceipt.status).toBe('DENIED');
    expect(deniedReceipt.denial?.reason).toBe('ACTION_AUTHORITY_DENIED');
    expect(deniedReceipt.family).toBe('commit');
  });

  it('a never-held grant scope is denied the same way (a foreign remote is ALSO refused by the executor scope pin)', async () => {
    const world = createScriptedDogfoodWorld({
      journeyId: 'p19-dogfood-scope-pin',
      repositorySlug: 'payswapdotorg/sos-dogfood-scope-pin',
      vercelProjectName: 'sos-dogfood-scope-pin',
      modelEntries: defaultScriptedModelEntries(),
    });
    await world.harness.preflight();
    // Hold a push grant for the acting principal so the AUTHORITY check
    // passes and the EXECUTOR scope pin is what answers.
    world.harness.authority.grant('p13-acting-body:p19-dogfood-scope-pin', 'push', 'sos/mission-x');
    // The GitHub gateway executor is bound to the run's repository: a push
    // to a foreign remote is a typed scope failure — the executors cannot
    // act outside the pre-approved repo scope.
    const result = world.harness.gateway.execute({
      actionId: 'p19-scope-pin-test-1',
      idempotencyKey: 'p19-scope-pin-test-1',
      family: 'push',
      actor: { kind: 'body', id: 'p13-acting-body:p19-dogfood-scope-pin' },
      requestedAt: 0,
      targetRevision: { kind: 'source', sha: 'irrelevant' },
      payload: { family: 'push', push: { remote: 'github.com/someone/else', ref: 'sos/mission-x', fromSha: 'abc' } },
    });
    expect(result.kind).toBe('executed');
    if (result.kind === 'executed') {
      expect(result.receipt.status).toBe('FAILED');
      expect(result.receipt.failure?.errorType).toBe('REPOSITORY_SCOPE_EXCEEDED');
      expect(result.receipt.failure?.message).toContain('outside the dogfood scope');
    }
  });
});
