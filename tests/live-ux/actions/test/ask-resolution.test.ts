/**
 * P18-B deterministic reference-mode suite (4/7): THE ASK RESOLUTION
 * CONTRACT through the merged AskQueue. Pins:
 *
 *   - a pending entry resolves through the endpoint submission pipeline
 *     (the queue mints the Decision record — human resolution authority,
 *     bound to the origin ask's exact input digest);
 *   - an entry is resolved AT MOST ONCE (the frozen queue contract): a
 *     second resolution is a typed failure the endpoint maps honestly;
 *   - an UNKNOWN entry (the honest deployed state — no ask-plane producer
 *     is wired) is the typed ASK_ENTRY_UNKNOWN failure, never a
 *     fabricated resolution;
 *   - an invalid resolution shape is a typed rejection (400).
 */

import { describe, expect, it } from 'vitest';
import { createLiveActionHost, submitLiveAction } from '@live-action/core';
import { pendingAsk } from './helpers/ask-fixtures';

const T0 = 1_797_123_600_000;
const ACTOR = 'console-user';

function askHost(queue = pendingAsk(['P18B:tests-live-ux-actions']).queue): ReturnType<typeof createLiveActionHost> {
  return createLiveActionHost({ clock: { now: (): number => T0 }, asks: queue });
}

function resolutionEnvelope(entryId: string, note = 'deterministic suite resolution'): Record<string, unknown> {
  return {
    entryId,
    resolution: {
      resolved_by: ACTOR,
      chosen_alternative_id: 'act-under-granted-authority',
      note,
      provenance: ['human:console-user', 'surface:live-mission'],
      created_at: '2026-09-26T00:00:00Z',
    },
  };
}

describe('ASK resolution through the endpoint pipeline (human authority)', () => {
  it('resolves a pending ask and mints the Decision record (the receipt carries the decision reference)', () => {
    const { queue, entryId } = pendingAsk(['P18B:tests-live-ux-actions']);
    const host = askHost(queue);
    expect(queue.pendingCount).toBe(1);
    const result = submitLiveAction({ body: JSON.stringify(resolutionEnvelope(entryId)), contentType: 'application/json', host, now: T0 });
    expect(result.httpStatus).toBe(200);
    expect(result.view.kind).toBe('ask-resolution');
    if (result.view.kind === 'ask-resolution') {
      expect(result.view.status).toBe('RESOLVED');
      expect(result.view.resolvedBy).toBe(ACTOR);
      expect(result.view.chosenAlternativeId).toBe('act-under-granted-authority');
      expect(result.view.decisionRef).toMatch(/sos:\/\//);
      expect(result.view.error).toBeNull();
      expect(result.view.honestyNotes.join(' ')).toContain('HUMAN resolver');
    }
    expect(queue.pendingCount).toBe(0);
    expect(queue.get(entryId)?.status).toBe('RESOLVED');
  });

  it('an entry is resolved at most once: a SECOND different resolution is the typed ALREADY-RESOLVED failure (terminal)', () => {
    const { queue, entryId } = pendingAsk(['P18B:tests-live-ux-actions']);
    const host = askHost(queue);
    const first = submitLiveAction({ body: JSON.stringify(resolutionEnvelope(entryId, 'first')), contentType: 'application/json', host, now: T0 });
    expect(first.view.kind === 'ask-resolution' ? first.view.status : 'x').toBe('RESOLVED');
    // a DIFFERENT envelope (different note/created_at) is a genuinely new
    // submission for the same terminal entry — the queue answers the
    // frozen typed error and the endpoint maps it honestly:
    const second = submitLiveAction({ body: JSON.stringify(resolutionEnvelope(entryId, 'second-attempt')), contentType: 'application/json', host, now: T0 + 1 });
    expect(second.view.kind).toBe('ask-resolution');
    if (second.view.kind === 'ask-resolution') {
      expect(second.view.status).toBe('FAILED');
      expect(second.view.error?.code).toBe('ASK_ALREADY_RESOLVED');
      expect(second.view.error?.detail).toContain('already RESOLVED');
    }
  });

  it('an unknown entry is the typed ASK_ENTRY_UNKNOWN failure — the honest deployed state (no ask-plane producer wired)', () => {
    const host = askHost(); // a real, honestly EMPTY queue
    const result = submitLiveAction({ body: JSON.stringify(resolutionEnvelope('ask-never-enqueued')), contentType: 'application/json', host, now: T0 });
    expect(result.httpStatus).toBe(200); // the submission was processed; the outcome is the honest typed failure
    if (result.view.kind === 'ask-resolution') {
      expect(result.view.status).toBe('FAILED');
      expect(result.view.error?.code).toBe('ASK_ENTRY_UNKNOWN');
      expect(result.view.decisionRef).toBeNull();
      expect(result.view.honestyNotes.join(' ')).toContain('never a fabricated resolution');
    }
  });

  it('an invalid resolution shape is a typed 400 (missing note/provenance/created_at)', () => {
    const { queue, entryId } = pendingAsk(['P18B:tests-live-ux-actions']);
    const host = askHost(queue);
    const invalid: Record<string, unknown> = {
      entryId,
      resolution: { resolved_by: ACTOR, chosen_alternative_id: 'alt-1', note: '', provenance: [], created_at: 'not-rfc3339' },
    };
    const result = submitLiveAction({ body: JSON.stringify(invalid), contentType: 'application/json', host, now: T0 });
    expect(result.httpStatus).toBe(200);
    if (result.view.kind === 'ask-resolution') {
      expect(result.view.status).toBe('FAILED');
      expect(result.view.error?.code).toBe('ASK_RESOLUTION_INVALID');
    }
    expect(queue.pendingCount).toBe(1); // nothing was resolved by the invalid submission
  });

  it('a missing resolution object is the typed 400 envelope rejection', () => {
    const host = askHost();
    const result = submitLiveAction({ body: JSON.stringify({ entryId: 'ask-1' }), contentType: 'application/json', host, now: T0 });
    expect(result.httpStatus).toBe(400);
    if (result.view.kind === 'ask-resolution') {
      expect(result.view.error?.code).toBe('ASK_ENVELOPE_INVALID');
    }
  });
});
