/**
 * P18-B deterministic reference-mode acceptance suite (3/8): IDEMPOTENCY.
 *
 * Typed action submissions are idempotent — the same envelope (the same
 * idempotency key) replays the RECORDED original receipt and the
 * providers are touched exactly ONCE. Pinned per consequential action
 * family and for the frozen forms' identity-INCOMPLETE envelopes (the
 * endpoint derives the identity from the envelope CONTENT, so
 * double-submitting a form is a replay, never a second execution).
 */

import { describe, expect, it } from 'vitest';
import type { HostedModelPort, HostedModelRequest, HostedModelCall } from '@sos-2/real-bodies';
import { createLiveActionHost } from '@live-mission/host';
import { summonBodyEnvelope, promotionEnvelope, rollbackEnvelope } from '@live-mission/envelopes';
import { vercelRecordsFetch } from './helpers/scripted-vercel';

const T0 = 1_797_123_600_000;
const ACTOR = 'console-user';
const BASE_SHA = '3717b6ccac8e0741e8a0eef7fd3b0aa92502f6ea';
const OLD_SHA = 'b5938ea4654144df287ce3e907389fc1f911ccf6';

class CountingModelPort implements HostedModelPort {
  readonly calls: HostedModelRequest[] = [];
  complete(request: HostedModelRequest): Promise<HostedModelCall> {
    this.calls.push(request);
    return Promise.resolve({
      ok: true,
      response: { id: `resp-idem-${String(this.calls.length).padStart(4, '0')}`, model: 'qwen/qwen3-coder-flash', content: 'ready', finish_reason: 'stop', usage: { prompt_tokens: 12, completion_tokens: 1, total_tokens: 13 } },
    });
  }
}

const GRANTS = 'body-lifecycle:*,promotion:production,rollback:*';

describe('idempotency through the endpoint host composition', () => {
  it('the same summon-body envelope replays the recorded receipt; the model provider is probed exactly ONCE', async () => {
    const modelPort = new CountingModelPort();
    const host = createLiveActionHost({ env: () => ({ LIVE_MISSION_GRANTS: GRANTS, BODY_PROVIDER_API_KEY: 'sk-or-v1-deterministic-scripted-not-a-real-credential' }), now: () => T0, modelPort });
    const envelope = summonBodyEnvelope({ actorId: ACTOR, bodyId: 'idem-body-1', baseSha: BASE_SHA, actionId: 'idem-action-1', idempotencyKey: 'idem-key-1', requestedAt: T0 });
    const first = await host.submitAction(envelope);
    const second = await host.submitAction(envelope);
    const third = await host.submitAction(envelope);
    expect(first.kind).toBe('executed');
    expect(second.kind).toBe('replayed');
    expect(third.kind).toBe('replayed');
    if (first.kind === 'executed' && second.kind === 'replayed' && third.kind === 'replayed') {
      expect(second.receipt).toEqual(first.receipt);
      expect(third.receipt).toEqual(first.receipt);
      // the replay carries the RECORDED real execution record
      expect(second.execution?.facts['bodyModelResponseId']).toBe(first.execution?.facts['bodyModelResponseId']);
    }
    expect(modelPort.calls).toHaveLength(1);
    // the replays appended their honest events — and the frozen event log's
    // replay protection DEDUPLICATES identical events (same request at the
    // same injected instant -> one recorded event, never duplicates).
    expect(host.stores.events.entries().filter((event) => event.type === 'action.replayed')).toHaveLength(1);
  });

  it('a DIFFERENT envelope (a different action) executes again — idempotency is per-intent, not a global lock', async () => {
    const modelPort = new CountingModelPort();
    const host = createLiveActionHost({ env: () => ({ LIVE_MISSION_GRANTS: GRANTS, BODY_PROVIDER_API_KEY: 'sk-or-v1-deterministic-scripted-not-a-real-credential' }), now: () => T0, modelPort });
    const first = await host.submitAction(summonBodyEnvelope({ actorId: ACTOR, bodyId: 'idem-body-2', baseSha: BASE_SHA, actionId: 'idem-action-2a', idempotencyKey: 'idem-key-2a', requestedAt: T0 }));
    const second = await host.submitAction(summonBodyEnvelope({ actorId: ACTOR, bodyId: 'idem-body-2', baseSha: OLD_SHA, actionId: 'idem-action-2b', idempotencyKey: 'idem-key-2b', requestedAt: T0 }));
    expect(first.kind === 'executed' && first.receipt.status).toBe('SUCCEEDED');
    expect(second.kind === 'executed' && second.receipt.status).toBe('SUCCEEDED');
    expect(modelPort.calls).toHaveLength(2);
  });

  it('the frozen forms double-submit: the same identity-INCOMPLETE envelope derives the SAME key — a replay, never a second execution', async () => {
    const modelPort = new CountingModelPort();
    const host = createLiveActionHost({ env: () => ({ LIVE_MISSION_GRANTS: GRANTS, BODY_PROVIDER_API_KEY: 'sk-or-v1-deterministic-scripted-not-a-real-credential' }), now: () => T0, modelPort });
    const formEnvelope = {
      family: 'body-lifecycle',
      actor: { kind: 'human', id: ACTOR },
      targetRevision: { kind: 'source', sha: BASE_SHA },
      payload: { family: 'body-lifecycle', bodyLifecycle: { bodyId: 'idem-form-body', operation: 'start' } },
    };
    const first = await host.submitAction(formEnvelope);
    const second = await host.submitAction(formEnvelope);
    expect(first.kind).toBe('executed');
    expect(second.kind).toBe('replayed');
    if (first.kind === 'executed' && second.kind === 'replayed') {
      expect(second.receipt.idempotencyKey).toBe(first.receipt.idempotencyKey);
    }
    expect(modelPort.calls).toHaveLength(1);
  });

  it('promotion replays idempotently (the environment-pointer ledger transitions once)', async () => {
    const host = createLiveActionHost({
      env: () => ({ LIVE_MISSION_GRANTS: GRANTS, VERCEL_TOKEN: 'deterministic-scripted', VERCEL_PROJECT_ID: 'prj_deterministic_scripted' }),
      now: () => T0,
      modelPort: new CountingModelPort(),
      vercelFetch: vercelRecordsFetch(),
    });
    const envelope = promotionEnvelope({ actorId: ACTOR, fromEnvironment: 'staging', toEnvironment: 'production', sourceSha: BASE_SHA, actionId: 'idem-promote-1', idempotencyKey: 'idem-promote-key-1', requestedAt: T0 });
    const first = await host.submitAction(envelope);
    const second = await host.submitAction(envelope);
    expect(first.kind).toBe('executed');
    expect(second.kind).toBe('replayed');
    expect(host.stores.environmentPointers.size).toBe(1);
  });

  it('rollback replays idempotently (the restored pointer transitions once)', async () => {
    const host = createLiveActionHost({
      env: () => ({ LIVE_MISSION_GRANTS: GRANTS, VERCEL_TOKEN: 'deterministic-scripted', VERCEL_PROJECT_ID: 'prj_deterministic_scripted' }),
      now: () => T0,
      modelPort: new CountingModelPort(),
      vercelFetch: vercelRecordsFetch(),
    });
    const envelope = rollbackEnvelope({
      actorId: ACTOR,
      deploymentId: 'dpl_deterministic_head_0001',
      fromSourceSha: BASE_SHA,
      toSourceSha: OLD_SHA,
      reasonCode: 'MANUAL_DIRECTIVE',
      reasonDetail: 'idempotency suite rollback',
      actionId: 'idem-rollback-1',
      idempotencyKey: 'idem-rollback-key-1',
      requestedAt: T0,
    });
    const first = await host.submitAction(envelope);
    const second = await host.submitAction(envelope);
    expect(first.kind).toBe('executed');
    expect(second.kind).toBe('replayed');
    expect(host.stores.environmentPointers.size).toBe(1);
  });

  it('ask resolution is terminal: the second resolution is a typed failure, never a duplicate decision', async () => {
    const { AskQueue } = await import('@sos-2/ask');
    const { seedConsoleAsk } = await import('@live-mission/console-ask-queue');
    const queue = new AskQueue();
    const seed = seedConsoleAsk(queue);
    const host = createLiveActionHost({ env: () => ({}), now: () => T0, askQueue: queue });
    const first = await host.submitAskResolution({ entryId: seed.id, resolvedBy: ACTOR, chosenAlternativeId: 'act-under-granted-authority', note: 'idempotency suite first' });
    const second = await host.submitAskResolution({ entryId: seed.id, resolvedBy: ACTOR, chosenAlternativeId: 'reject', note: 'second' });
    expect(first.kind).toBe('ask-resolved');
    expect(second.kind).toBe('ask-failed');
    if (second.kind === 'ask-failed') {
      expect(second.error.message).toContain('already RESOLVED');
    }
    expect(queue.size).toBe(1); // exactly one entry — no duplicate was minted
  });
});
