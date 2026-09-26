/**
 * P18-B deterministic reference-mode suite (1/7): THE LIVE ACTION ENDPOINT
 * CORE — parsing, dispatch, envelope completion and typed validation.
 *
 * Everything here is offline and run-to-run identical (fixed seed; the
 * hosts are composed with the reference wiring). The suite pins:
 *
 *   - form-encoded and JSON submissions both reach the pipeline;
 *   - the mounted forms' PARTIAL envelopes (family/actor/targetRevision/
 *     payload, no ids) are completed with DETERMINISTIC content-addressed
 *     actionId + idempotencyKey (same form -> same key, always);
 *   - FULL envelopes (the P17-C builders' output) are honored as carried;
 *   - a smuggled authority field is the gateway's typed
 *     AUTHORITY_FIELD_SMUGGLED rejection (the gateway carries no
 *     authority of its own);
 *   - malformed bodies / unknown shapes are typed honest rejections.
 */

import { describe, expect, it } from 'vitest';
import { InMemoryAuthority } from '@sos-2/action-gateway';
import { completeActionEnvelope, createLiveActionHost, dispatchSubmission, parseLiveActionBody, submitLiveAction } from '@live-action/core';
import { summonBodyEnvelope } from '@live-mission/envelopes';

const T0 = 1_797_123_600_000;
const ACTOR = 'console-user';

/** The EXACT envelope shape the mounted ActionPanel form POSTs (no ids — the server-rendered surface carries no volatile state). */
const SUMMON_FORM: Record<string, unknown> = {
  family: 'body-lifecycle',
  actor: { kind: 'human', id: ACTOR },
  targetRevision: { kind: 'source', sha: 'seed-workspace-base' },
  payload: { family: 'body-lifecycle', bodyLifecycle: { bodyId: 'cloud-sandbox-1', operation: 'start' } },
};

function formBody(envelope: Record<string, unknown>): string {
  return new URLSearchParams({ action: JSON.stringify(envelope) }).toString();
}

function hostWithGrant(): ReturnType<typeof createLiveActionHost> {
  const host = createLiveActionHost({ clock: { now: (): number => T0 } });
  (host.reference!.authority as InMemoryAuthority).grant(ACTOR, 'body-lifecycle', 'cloud-sandbox-1');
  return host;
}

describe('parsing: form-encoded and JSON submissions', () => {
  it('parses the mounted form POST (urlencoded `action` field)', () => {
    const parsed = parseLiveActionBody({ contentType: 'application/x-www-form-urlencoded', text: formBody(SUMMON_FORM) });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.parsed.envelope).toEqual(SUMMON_FORM);
    }
  });

  it('parses a JSON submission body (programmatic submissions)', () => {
    const parsed = parseLiveActionBody({ contentType: 'application/json', text: JSON.stringify(SUMMON_FORM) });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.parsed.envelope).toEqual(SUMMON_FORM);
    }
  });

  it('rejects an empty body and a body without the action field (typed detail, never a crash)', () => {
    expect(parseLiveActionBody({ contentType: 'application/x-www-form-urlencoded', text: '' })).toMatchObject({ ok: false });
    expect(parseLiveActionBody({ contentType: 'application/x-www-form-urlencoded', text: 'other=x' })).toMatchObject({ ok: false });
    expect(parseLiveActionBody({ contentType: 'application/json', text: 'not json' })).toMatchObject({ ok: false });
  });
});

describe('dispatch: action envelopes vs ASK resolution envelopes', () => {
  it('dispatches a family envelope to the action gateway path', () => {
    expect(dispatchSubmission(SUMMON_FORM)).toEqual({ kind: 'gateway-action' });
  });

  it('dispatches an entryId+resolution envelope to the ASK path', () => {
    const ask: Record<string, unknown> = {
      entryId: 'ask-1',
      resolution: { resolved_by: ACTOR, chosen_alternative_id: 'alt-1', note: 'go', provenance: ['human:console-user'], created_at: '2026-09-26T00:00:00Z' },
    };
    expect(dispatchSubmission(ask)).toEqual({ kind: 'ask-resolution' });
  });

  it('neither shape is a typed malformed rejection (never a guess)', () => {
    expect(dispatchSubmission({ nope: true })).toMatchObject({ error: expect.stringContaining('neither') });
    expect(dispatchSubmission('string')).toMatchObject({ error: expect.any(String) });
  });
});

describe('deterministic completion of the mounted forms\' partial envelopes', () => {
  it('derives actionId + idempotencyKey as stable content addresses of the envelope content (not the instant)', () => {
    const first = completeActionEnvelope(SUMMON_FORM, T0);
    const second = completeActionEnvelope(SUMMON_FORM, T0 + 60_000);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(first.completed.actionId).toBe(second.completed.actionId);
      expect(first.completed.idempotencyKey).toBe(second.completed.idempotencyKey);
      expect(first.completed.derivation).toBe('form-derived');
      expect(first.completed.envelope['actionId']).toBe(first.completed.actionId);
      expect(first.completed.envelope['requestedAt']).toBe(T0);
    }
  });

  it('different envelope content derives a different key (no accidental replay across actions)', () => {
    const other = completeActionEnvelope({ ...SUMMON_FORM, payload: { family: 'body-lifecycle', bodyLifecycle: { bodyId: 'cloud-sandbox-2', operation: 'start' } } }, T0);
    const base = completeActionEnvelope(SUMMON_FORM, T0);
    expect(other.ok).toBe(true);
    expect(base.ok).toBe(true);
    if (other.ok && base.ok) {
      expect(other.completed.idempotencyKey).not.toBe(base.completed.idempotencyKey);
    }
  });

  it('honors a full envelope (the P17-C builders\' output) as carried', () => {
    const full = summonBodyEnvelope({ actorId: ACTOR, bodyId: 'cloud-sandbox-1', baseSha: 'seed-workspace-base', actionId: 'live-action-1', idempotencyKey: 'idem-1', requestedAt: T0 });
    const completed = completeActionEnvelope(full as unknown as Record<string, unknown>, T0 + 5_000);
    expect(completed.ok).toBe(true);
    if (completed.ok) {
      expect(completed.completed.derivation).toBe('envelope-carried');
      expect(completed.completed.actionId).toBe('live-action-1');
      expect(completed.completed.idempotencyKey).toBe('idem-1');
      expect(completed.completed.envelope['requestedAt']).toBe(T0); // carried, not overwritten
    }
  });

  it('rejects a partially-identified envelope (both ids or neither)', () => {
    expect(completeActionEnvelope({ ...SUMMON_FORM, actionId: 'only-action-id' }, T0)).toMatchObject({ ok: false });
  });
});

describe('typed validation through the real gateway', () => {
  it('a smuggled authority field is the typed AUTHORITY_FIELD_SMUGGLED rejection (400)', () => {
    const host = hostWithGrant();
    const smuggled: Record<string, unknown> = { ...SUMMON_FORM, grant: 'grant-1' };
    const result = submitLiveAction({ body: formBody(smuggled), contentType: 'application/x-www-form-urlencoded', host, now: T0 });
    expect(result.httpStatus).toBe(400);
    expect(result.view.kind).toBe('gateway-action');
    if (result.view.kind === 'gateway-action') {
      expect(result.view.outcome).toBe('rejected');
      expect(result.view.rejection?.code).toBe('AUTHORITY_FIELD_SMUGGLED');
      expect(result.view.rejection?.field).toBe('grant');
    }
  });

  it('a malformed envelope field is the typed ENVELOPE_MALFORMED rejection', () => {
    const host = hostWithGrant();
    const malformed: Record<string, unknown> = { ...SUMMON_FORM, targetRevision: { kind: 'source' } };
    const result = submitLiveAction({ body: JSON.stringify(malformed), contentType: 'application/json', host, now: T0 });
    expect(result.httpStatus).toBe(400);
    if (result.view.kind === 'gateway-action') {
      expect(result.view.rejection?.code).toBe('ENVELOPE_MALFORMED');
      expect(result.view.rejection?.field).toBe('targetRevision');
    }
  });

  it('an unknown family is rejected before any authority consultation (fail-closed ordering)', () => {
    const host = hostWithGrant();
    const result = submitLiveAction({ body: JSON.stringify({ ...SUMMON_FORM, family: 'compose-package' }), contentType: 'application/json', host, now: T0 });
    expect(result.httpStatus).toBe(400);
    if (result.view.kind === 'gateway-action') {
      expect(result.view.rejection?.code).toBe('ENVELOPE_MALFORMED');
    }
  });

  it('malformed submissions answer the honest malformed view (nothing executed)', () => {
    const host = hostWithGrant();
    const result = submitLiveAction({ body: 'action=%7B%22family%22%3A%20%22body-lifecycle%22%7D&x=1', contentType: 'application/x-www-form-urlencoded', host, now: T0 });
    // envelope is {"family": "body-lifecycle"} -> dispatch says gateway-action, then gateway validation rejects
    expect(result.httpStatus).toBe(400);
    const unknown = submitLiveAction({ body: JSON.stringify({ what: 'is this' }), contentType: 'application/json', host, now: T0 });
    expect(unknown.view.kind).toBe('malformed');
    expect(unknown.httpStatus).toBe(400);
  });
});
