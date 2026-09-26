/**
 * P18-B deterministic reference-mode suite (3/7): IDEMPOTENCY — typed
 * action submissions are idempotent (same envelope -> same outcome +
 * receipt, no double-execution). Pins:
 *
 *   - resubmitting the SAME form envelope (the partial UI shape) maps to
 *     the SAME derived idempotency key and returns the RECORDED original
 *     receipt (outcome: replayed; the executor transitions exactly ONCE);
 *   - a full envelope replaying its carried idempotency key behaves
 *     identically;
 *   - a DIFFERENT envelope (different body/sha) derives a different key
 *     and executes;
 *   - ASK resolution envelopes replay their recorded outcome through the
 *     endpoint-level idempotency layer (the queue itself is terminal);
 *   - every executed submission lands in the in-process receipt ledger
 *     keyed by its idempotency key (the receipt page's source), and the
 *     receipt URL is derived from that key.
 */

import { describe, expect, it } from 'vitest';
import { InMemoryAuthority } from '@sos-2/action-gateway';
import { createLiveActionHost, receiptUrlFor, submitLiveAction } from '@live-action/core';
import { summonBodyEnvelope } from '@live-mission/envelopes';

const T0 = 1_797_123_600_000;
const ACTOR = 'console-user';

const SUMMON_FORM: Record<string, unknown> = {
  family: 'body-lifecycle',
  actor: { kind: 'human', id: ACTOR },
  targetRevision: { kind: 'source', sha: 'seed-workspace-base' },
  payload: { family: 'body-lifecycle', bodyLifecycle: { bodyId: 'cloud-sandbox-1', operation: 'start' } },
};

function grantedHost(): ReturnType<typeof createLiveActionHost> {
  const host = createLiveActionHost({ clock: { now: (): number => T0 } });
  (host.reference!.authority as InMemoryAuthority).grant(ACTOR, 'body-lifecycle', 'cloud-sandbox-1');
  return host;
}

describe('gateway-action idempotency (the forms path)', () => {
  it('double-submitting the same form returns the recorded original receipt and executes ONCE', () => {
    const host = grantedHost();
    const first = submitLiveAction({ body: JSON.stringify(SUMMON_FORM), contentType: 'application/json', host, now: T0 });
    const second = submitLiveAction({ body: JSON.stringify(SUMMON_FORM), contentType: 'application/json', host, now: T0 + 30_000 });
    expect(first.view.kind).toBe('gateway-action');
    expect(second.view.kind).toBe('gateway-action');
    if (first.view.kind === 'gateway-action' && second.view.kind === 'gateway-action') {
      expect(first.view.outcome).toBe('executed');
      expect(second.view.outcome).toBe('replayed');
      expect(second.view.replayed).toBe(true);
      expect(second.view.receipt).toEqual(first.view.receipt);
      expect(second.view.idempotencyKey).toBe(first.view.idempotencyKey);
    }
    // exactly ONE world transition
    expect(host.reference!.world.bodies.get('cloud-sandbox-1')).toBe('RUNNING');
    expect(host.reference!.evidence.all().filter((record) => record.evidenceType === 'action.outcome')).toHaveLength(1);
    // exactly one action.succeeded event (the replay appends action.replayed, never a second success)
    const types = host.reference!.events.entries().map((event) => event.type);
    expect(types.filter((type) => type === 'action.succeeded')).toHaveLength(1);
    expect(types).toContain('action.replayed');
  });

  it('the replay honesty note states the no-double-execution guarantee', () => {
    const host = grantedHost();
    submitLiveAction({ body: JSON.stringify(SUMMON_FORM), contentType: 'application/json', host, now: T0 });
    const second = submitLiveAction({ body: JSON.stringify(SUMMON_FORM), contentType: 'application/json', host, now: T0 });
    if (second.view.kind === 'gateway-action') {
      expect(second.view.honestyNotes.join(' ')).toContain('executor was NOT invoked again');
    }
  });

  it('a full envelope (P17-C builder output) replays by its CARRIED idempotency key', () => {
    const host = grantedHost();
    const envelope = summonBodyEnvelope({ actorId: ACTOR, bodyId: 'cloud-sandbox-1', baseSha: 'seed-workspace-base', actionId: 'live-action-1', idempotencyKey: 'carried-key-1', requestedAt: T0 });
    const first = submitLiveAction({ body: JSON.stringify(envelope), contentType: 'application/json', host, now: T0 });
    const second = submitLiveAction({ body: JSON.stringify(envelope), contentType: 'application/json', host, now: T0 + 1_000 });
    if (first.view.kind === 'gateway-action' && second.view.kind === 'gateway-action') {
      expect(first.view.derivation).toBe('envelope-carried');
      expect(first.view.idempotencyKey).toBe('carried-key-1');
      expect(second.view.outcome).toBe('replayed');
      expect(second.view.receipt).toEqual(first.view.receipt);
    }
    expect(host.reference!.world.bodies.get('cloud-sandbox-1')).toBe('RUNNING');
  });

  it('a different envelope (different body id) executes as a separate action', () => {
    const host = grantedHost();
    (host.reference!.authority as InMemoryAuthority).grant(ACTOR, 'body-lifecycle', 'cloud-sandbox-2');
    const other: Record<string, unknown> = {
      ...SUMMON_FORM,
      payload: { family: 'body-lifecycle', bodyLifecycle: { bodyId: 'cloud-sandbox-2', operation: 'start' } },
    };
    const first = submitLiveAction({ body: JSON.stringify(SUMMON_FORM), contentType: 'application/json', host, now: T0 });
    const second = submitLiveAction({ body: JSON.stringify(other), contentType: 'application/json', host, now: T0 });
    expect(first.view.kind).toBe('gateway-action');
    if (second.view.kind === 'gateway-action') {
      expect(second.view.outcome).toBe('executed');
      expect(second.view.idempotencyKey).not.toBe(first.view.kind === 'gateway-action' ? first.view.idempotencyKey : null);
    }
    expect(host.reference!.world.bodies.get('cloud-sandbox-2')).toBe('RUNNING');
  });

  it('a denied action records its receipt idempotently too (the denial is the recorded outcome)', () => {
    const host = createLiveActionHost({ clock: { now: (): number => T0 } }); // no grant
    const first = submitLiveAction({ body: JSON.stringify(SUMMON_FORM), contentType: 'application/json', host, now: T0 });
    const second = submitLiveAction({ body: JSON.stringify(SUMMON_FORM), contentType: 'application/json', host, now: T0 });
    if (first.view.kind === 'gateway-action' && second.view.kind === 'gateway-action') {
      expect(first.view.receipt?.status).toBe('DENIED');
      expect(second.view.outcome).toBe('replayed');
      expect(second.view.receipt).toEqual(first.view.receipt);
    }
  });
});

describe('the in-process receipt ledger + the receipt page URL', () => {
  it('records every receipt-bearing outcome keyed by idempotency key', () => {
    const host = grantedHost();
    const result = submitLiveAction({ body: JSON.stringify(SUMMON_FORM), contentType: 'application/json', host, now: T0 });
    const key = result.view.kind === 'gateway-action' ? result.view.idempotencyKey : null;
    expect(key).not.toBeNull();
    expect(host.receiptLedger.get(key!)).toEqual(result.view);
  });

  it('derives the POST-redirect-GET receipt page URL from the key', () => {
    const host = grantedHost();
    const result = submitLiveAction({ body: JSON.stringify(SUMMON_FORM), contentType: 'application/json', host, now: T0 });
    const url = receiptUrlFor(result.view);
    expect(url).toContain('/mission/receipt?key=');
    expect(url!.length).toBeGreaterThan('/mission/receipt?key='.length);
    expect(receiptUrlFor({ kind: 'malformed', detail: 'x' })).toBeNull();
  });
});

describe('ASK resolution idempotency (the endpoint-level layer)', () => {
  it('replays the recorded ask outcome for the same envelope (no second resolution attempt)', async () => {
    const { pendingAsk } = await import('./helpers/ask-fixtures');
    const { queue, entryId } = pendingAsk(['P18B:tests-live-ux-actions']);
    const host = createLiveActionHost({ clock: { now: (): number => T0 }, asks: queue });
    const envelope = {
      entryId,
      resolution: {
        resolved_by: ACTOR,
        chosen_alternative_id: 'act-under-granted-authority',
        note: 'deterministic suite resolution',
        provenance: ['human:console-user', 'surface:live-mission'],
        created_at: '2026-09-26T00:00:00Z',
      },
    };
    const first = submitLiveAction({ body: JSON.stringify(envelope), contentType: 'application/json', host, now: T0 });
    const second = submitLiveAction({ body: JSON.stringify(envelope), contentType: 'application/json', host, now: T0 });
    expect(first.view.kind).toBe('ask-resolution');
    expect(second.view.kind).toBe('ask-resolution');
    if (first.view.kind === 'ask-resolution' && second.view.kind === 'ask-resolution') {
      expect(first.view.status).toBe('RESOLVED');
      expect(first.view.decisionRef).not.toBeNull();
      expect(second.view.replayed).toBe(true);
      expect(second.view.decisionRef).toBe(first.view.decisionRef);
      expect(second.view.honestyNotes.join(' ')).toContain('recorded original outcome');
    }
    expect(queue.pendingCount).toBe(0);
  });
});
