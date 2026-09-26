/**
 * P18-B deterministic reference-mode acceptance suite (4/8):
 * ASK RESOLUTION CONTRACT through the endpoint host.
 *
 * The merged @sos-2/ask AskQueue.resolve() is the ONLY ask path: the
 * resolution authority is the HUMAN resolver, the queue mints the
 * Decision record (bound to the ask's exact input digest), and an entry
 * resolves at most once. The console seeds ONE deterministic reference ask
 * through the REAL decision machinery (evaluate -> ASK ->
 * createAskRequest -> enqueue) — pinned here by identity.
 */

import { describe, expect, it } from 'vitest';
import { AskQueue } from '@sos-2/ask';
import { seedConsoleAsk, consoleAskViews, CONSOLE_ASK_CREATED_AT, CONSOLE_ASK_SCOPE_NOTE } from '@live-mission/console-ask-queue';
import { createLiveActionHost } from '@live-mission/host';
import { askResolutionEnvelope } from '@live-mission/envelopes';

const T0 = 1_797_123_600_000;
const ACTOR = 'console-user';

function freshHost(queue: AskQueue) {
  return createLiveActionHost({ env: () => ({}), now: () => T0, askQueue: queue });
}

describe('the console reference ask (deterministic seed through the real machinery)', () => {
  it('is deterministic: the same literals mint the same content-addressed entry id', () => {
    const first = seedConsoleAsk(new AskQueue());
    const second = seedConsoleAsk(new AskQueue());
    expect(first.id).toBe(second.id);
    expect(first.id).toMatch(/^sos:\/\/AskRequest\//);
    expect(first.status).toBe('PENDING');
  });

  it('projects into the console ask view (the pure projection carries every decider-facing field)', () => {
    const queue = new AskQueue();
    seedConsoleAsk(queue);
    const views = consoleAskViews(queue);
    expect(views).toHaveLength(1);
    const view = views[0]!;
    expect(view.entryId).toMatch(/^sos:\/\/AskRequest\//);
    expect(view.decision).toContain('Revise the recorded mission');
    expect(view.alternatives.length).toBeGreaterThanOrEqual(3);
    expect(view.alternatives.map((alternative) => alternative.id)).toContain('act-under-granted-authority');
    expect(view.authorityInsufficiency.length).toBeGreaterThan(0);
    expect(view.enqueuedAt).toBe(CONSOLE_ASK_CREATED_AT);
    expect(view.evidenceQuality).toBe('NONE');
  });

  it('carries the honest process-local scope note (the durable ask store is UNAVAILABLE)', () => {
    expect(CONSOLE_ASK_SCOPE_NOTE).toContain('process-local');
    expect(CONSOLE_ASK_SCOPE_NOTE).toContain('UNAVAILABLE');
  });
});

describe('ask resolution through the endpoint host (human authority, real Decision records)', () => {
  it('resolves the pending ask and mints an ACT Decision record with the exact resolution provenance', async () => {
    const queue = new AskQueue();
    const seed = seedConsoleAsk(queue);
    const host = freshHost(queue);
    const outcome = await host.submitAskResolution({
      entryId: seed.id,
      resolvedBy: ACTOR,
      chosenAlternativeId: 'act-under-granted-authority',
      note: 'deterministic suite resolution',
      provenance: ['human:console-user', 'surface:live-mission'],
      createdAt: '2026-09-26T12:00:00.000Z',
    });
    expect(outcome.kind).toBe('ask-resolved');
    if (outcome.kind === 'ask-resolved') {
      expect(outcome.resolution.action).toBe('ACT');
      expect(outcome.resolution.decisionRef).toMatch(/^sos:\/\/Decision\//);
      expect(outcome.resolution.chosenAlternativeId).toBe('act-under-granted-authority');
      expect(outcome.resolution.createdAt).toBe('2026-09-26T12:00:00.000Z');
      expect(outcome.resolution.queue.pending).toBe(0);
    }
    expect(queue.pendingCount).toBe(0);
  });

  it('derives the receipt-time fields the form does not carry (created_at from the server clock, provenance from the resolver)', async () => {
    const queue = new AskQueue();
    const seed = seedConsoleAsk(queue);
    const host = freshHost(queue);
    const outcome = await host.submitAskResolution({
      entryId: seed.id,
      resolvedBy: ACTOR,
      chosenAlternativeId: 'experiment-first',
      note: 'form-flow resolution without explicit provenance or created_at',
    });
    expect(outcome.kind).toBe('ask-resolved');
    if (outcome.kind === 'ask-resolved') {
      expect(outcome.resolution.createdAt).toBe(new Date(T0).toISOString());
      expect(outcome.resolution.provenance).toEqual([`human:${ACTOR}`, 'surface:live-mission']);
    }
  });

  it('accepts the P17-C askResolutionEnvelope shape (the frozen builder output) verbatim', async () => {
    const queue = new AskQueue();
    const seed = seedConsoleAsk(queue);
    const host = freshHost(queue);
    const envelope = askResolutionEnvelope({
      entryId: seed.id,
      resolvedBy: ACTOR,
      chosenAlternativeId: 'reject',
      note: 'the frozen envelope builder output resolves through the host',
      provenance: ['human:console-user'],
      createdAt: '2026-09-26T12:30:00.000Z',
    });
    const outcome = await host.submitAskResolution({
      entryId: envelope.entryId,
      resolvedBy: envelope.resolution.resolved_by,
      chosenAlternativeId: envelope.resolution.chosen_alternative_id,
      note: envelope.resolution.note,
      provenance: [...envelope.resolution.provenance],
      createdAt: envelope.resolution.created_at,
    });
    expect(outcome.kind).toBe('ask-resolved');
  });

  it('typed-fails an UNKNOWN entry (never a fabricated resolution)', async () => {
    const host = freshHost(new AskQueue());
    const outcome = await host.submitAskResolution({ entryId: 'sos://AskRequest/unknown-00000000000000000000000000000000', resolvedBy: ACTOR, chosenAlternativeId: 'reject', note: 'n' });
    expect(outcome.kind).toBe('ask-failed');
    if (outcome.kind === 'ask-failed') {
      expect(outcome.error.code).toBe('ASK_RESOLUTION_REJECTED');
      expect(outcome.error.message).toContain('unknown ask queue entry');
    }
  });

  it('typed-fails a malformed resolution (empty mandatory fields)', async () => {
    const host = freshHost(new AskQueue());
    const empty = await host.submitAskResolution({ entryId: '', resolvedBy: '', chosenAlternativeId: '', note: '' });
    expect(empty.kind).toBe('ask-failed');
    expect((empty as { error: { code: string } }).error.code).toBe('ASK_SUBMISSION_MALFORMED');
    const badTime = await host.submitAskResolution({ entryId: 'x', resolvedBy: ACTOR, chosenAlternativeId: 'reject', note: 'n', createdAt: 'not-a-timestamp' });
    expect(badTime.kind).toBe('ask-failed');
    expect((badTime as { error: { code: string } }).error.code).toBe('ASK_SUBMISSION_MALFORMED');
  });
});
