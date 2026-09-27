/**
 * P18-INT deterministic integrated suite (3/3): THE CROSS-CUTTING
 * INVARIANTS of the integrated product — the properties that must hold on
 * EVERY consequential path, pinned end-to-end:
 *
 *   - envelope -> authority-at-action-time -> receipt -> evidence links
 *     (the receipt always carries its evidence ids + the /evidence and
 *     /rationale deep links);
 *   - IDEMPOTENCY: a double-submit answers the SAME recorded receipt
 *     (replayed), with exactly ONE world transition and one event;
 *   - AUTHORITY-AT-ACTION-TIME: a grant held at submission time but
 *     revoked before a NEW envelope's execution fails CLOSED — the
 *     executor is never invoked (the counting proof);
 *   - FAIL-CLOSED: a never-held grant DENIES with the executor never
 *     invoked; a smuggled authority field is typed-rejected at the REAL
 *     mounted route handler (never executes);
 *   - THE MOUNTED ROUTE HANDLER contract (the real POST adapter, driven
 *     over real Request/Response objects with a sanitized environment —
 *     the process host binds once, so this file clears every provider/
 *     grant variable before the first submission): typed JSON outcomes,
 *     the honest DENIED receipt without grants, malformed typed 400s, the
 *     honest ASK_ENTRY_UNKNOWN for the deployed empty queue, the 303 PRG
 *     hop for browser form POSTs, and the endpoint-level idempotency of a
 *     denied receipt;
 *   - HONEST DEGRADED STATES: the endpoint's receipts and honesty notes
 *     never claim durable confirmation (the in-process scope is stated),
 *     and the ASK plane answers its honest typed failure — never a
 *     fabricated resolution.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode; [key: string]: unknown }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

// The mounted route handler binds its process host from the AMBIENT env at
// first use. This suite sanitizes the boundary variables BEFORE any
// submission so the bound host is deterministic: no grants (authority
// fails closed), no provider credentials (no bridge — offline).
const PROVIDER_ENV_NAMES = [
  'SOS_LIVE_MISSION_GRANTS',
  'BODY_PROVIDER_API_KEY',
  'SOS_LIVE_MISSION_VERCEL_TOKEN',
  'VERCEL_TOKEN',
  'SOS_LIVE_MISSION_VERCEL_PROJECT_ID',
  'VERCEL_PROJECT_ID',
  'GITHUB_ACCESS_TOKEN',
] as const;
for (const name of PROVIDER_ENV_NAMES) {
  delete process.env[name];
}

import { InMemoryAuthority } from '@sos-2/action-gateway';
import { summonBodyEnvelope } from '@live-mission/envelopes';
import { ActionReceiptView } from '@live-mission/receipt-view';
import type { LiveActionReceiptView } from '@integration/live-action-core';
import { POST } from '@integration/action-endpoint';
import {
  ACTOR,
  AS_OF,
  OBSERVED_HEAD,
  h,
  pipelineHost,
  render,
  submit,
} from './helpers/fixtures';

/** Submit one envelope to the REAL mounted route handler (the exact form-encoding the mounted forms use). */
async function postEnvelope(envelope: Record<string, unknown>, accept = 'application/json'): Promise<{ status: number; body: unknown; location: string | null }> {
  const response = await POST(
    new Request('http://localhost/api/live-mission/actions', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept },
      body: new URLSearchParams({ action: JSON.stringify(envelope) }).toString(),
    }),
  );
  const location = response.headers.get('location');
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { status: response.status, body, location };
}

/** Render a receipt view to static markup (the receipt surface for the evidence-links contract). */
function receiptHtml(view: LiveActionReceiptView): string {
  return render(h(ActionReceiptView, { view, asOf: AS_OF }));
}

function summonBody(idempotencyKey: string, bodyId = 'invariant-body-1'): Record<string, unknown> {
  return summonBodyEnvelope({
    actorId: ACTOR, bodyId, baseSha: OBSERVED_HEAD, actionId: `invariant-${idempotencyKey}`, idempotencyKey, requestedAt: 1_797_123_600_000,
  }) as unknown as Record<string, unknown>;
}

beforeEach(() => {
  // the sanitized boundary holds for the whole file (the process host
  // binds once; these pins make an accidentally-set developer env visible
  // instead of silently changing the outcomes)
  expect(process.env['SOS_LIVE_MISSION_GRANTS']).toBeUndefined();
});

describe('INVARIANT: envelope -> authority-at-action-time -> receipt -> evidence links (every executed receipt)', () => {
  it('a SUCCEEDED receipt carries non-empty evidence ids and the receipt surface renders the /evidence and /rationale deep links', () => {
    const authority = new InMemoryAuthority();
    authority.grant(ACTOR, 'body-lifecycle', 'evidence-body-1');
    const host = pipelineHost(authority);
    const outcome = submit(host, summonBody('inv-ev-1', 'evidence-body-1'));
    if (outcome.view.kind === 'gateway-action') {
      expect(outcome.view.receipt?.status).toBe('SUCCEEDED');
      expect((outcome.view.receipt?.evidenceIds ?? []).length).toBeGreaterThan(0);
      expect(outcome.view.honestyNotes.join(' ')).toContain('re-evaluated AT ACTION TIME');
    }
    const html = receiptHtml(outcome.view);
    expect(html).toContain('href="/evidence"');
    expect(html).toContain('href="/rationale"');
  });
});

describe('INVARIANT: idempotency (double-submit answers the SAME recorded receipt; one world transition)', () => {
  it('the same idempotency key replays the recorded original receipt with exactly one world transition', () => {
    const authority = new InMemoryAuthority();
    authority.grant(ACTOR, 'body-lifecycle', 'idem-body-1');
    const host = pipelineHost(authority);
    const world = host.reference?.world;
    const first = submit(host, summonBody('inv-idem-1', 'idem-body-1'));
    const second = submit(host, summonBody('inv-idem-1', 'idem-body-1'));
    if (first.view.kind === 'gateway-action' && second.view.kind === 'gateway-action') {
      expect(first.view.outcome).toBe('executed');
      expect(second.view.outcome).toBe('replayed');
      expect(second.view.receipt?.actionId).toBe(first.view.receipt?.actionId);
      expect(second.view.receipt?.idempotencyKey).toBe(first.view.receipt?.idempotencyKey);
      expect(second.view.receipt?.executedAt).toBe(first.view.receipt?.executedAt);
      expect(second.view.replayed).toBe(true);
    }
    expect(world?.bodies.get('idem-body-1')).toBe('RUNNING'); // exactly one transition
    expect((host.reference?.events.entries() ?? []).filter((event) => event.type === 'action.succeeded').length).toBe(1);
  });
});

describe('INVARIANT: authority-at-action-time (revocation between submissions fails the NEW action closed)', () => {
  it('a grant used successfully, then revoked, DENIES the next NEW envelope — the executor is never invoked for it', () => {
    const authority = new InMemoryAuthority();
    const grantId = authority.grant(ACTOR, 'body-lifecycle', 'revoked-body-1');
    const host = pipelineHost(authority);
    const world = host.reference?.world;
    const before = submit(host, summonBody('inv-rev-1', 'revoked-body-1'));
    if (before.view.kind === 'gateway-action') {
      expect(before.view.receipt?.status).toBe('SUCCEEDED');
    }
    expect(world?.bodies.get('revoked-body-1')).toBe('RUNNING');
    // the authority is re-evaluated at ACTION time — revocation is immediate:
    authority.revoke(grantId);
    const after = submit(host, summonBody('inv-rev-2', 'revoked-body-1'));
    if (after.view.kind === 'gateway-action' && after.view.receipt !== null && after.view.receipt.denial !== null && after.view.receipt.denial.authority !== null) {
      expect(after.view.outcome).toBe('executed');
      expect(after.view.receipt.status).toBe('DENIED');
      expect(after.view.receipt.denial.reason).toBe('ACTION_AUTHORITY_DENIED');
      expect(after.view.receipt.denial.authority.reason).toBe('GRANT_REVOKED');
    } else {
      throw new Error('expected a denied gateway-action receipt with an authority snapshot');
    }
    // the executor was NEVER invoked for the denied action: the body state
    // is unchanged and no additional success event exists
    expect(world?.bodies.get('revoked-body-1')).toBe('RUNNING');
    expect((host.reference?.events.entries() ?? []).filter((event) => event.type === 'action.succeeded').length).toBe(1);
  });
});

describe('INVARIANT: fail-closed (never-held grants deny; smuggled authority typed-rejected)', () => {
  it('a never-held grant DENIES with the executor never invoked (the safe-failure receipt)', () => {
    const host = pipelineHost(new InMemoryAuthority());
    const world = host.reference?.world;
    const outcome = submit(host, summonBody('inv-fc-1', 'failclosed-body-1'));
    if (outcome.view.kind === 'gateway-action' && outcome.view.receipt !== null && outcome.view.receipt.denial !== null && outcome.view.receipt.denial.authority !== null) {
      expect(outcome.view.receipt.status).toBe('DENIED');
      expect(outcome.view.receipt.denial.authority.reason).toBe('GRANT_NEVER_HELD');
    } else {
      throw new Error('expected a denied gateway-action receipt with an authority snapshot');
    }
    expect(world?.bodies.get('failclosed-body-1')).toBeUndefined(); // never invoked
    const html = receiptHtml(outcome.view);
    expect(html).toContain('Denied — safe failure (nothing executed)');
  });

  it('a smuggled authority field is typed-rejected by the REAL mounted route handler (never executes)', async () => {
    const smuggled = { ...summonBody('inv-smug-1'), grant: 'smuggled-grant-id' };
    const { status, body } = await postEnvelope(smuggled);
    expect(status).toBeLessThan(500); // typed rejection, never a silent 5xx
    const serialized = JSON.stringify(body);
    expect(serialized).toContain('AUTHORITY_FIELD_SMUGGLED');
    expect(serialized).not.toContain('"status":"SUCCEEDED"');
  });
});

describe('the REAL mounted route handler (form-encoded submissions over real Request/Response)', () => {
  it('answers a well-formed envelope with a typed JSON outcome (the programmatic contract) — DENIED without grants, never a silent 5xx', async () => {
    const { status, body } = await postEnvelope(summonBody('inv-route-1'));
    expect(status).toBeLessThan(500);
    const receipt = (body as { receipt?: { kind?: string; receipt?: { status?: string; denial?: { reason?: string } } } }).receipt;
    expect(receipt?.kind).toBe('gateway-action');
    expect(receipt?.receipt?.status).toBe('DENIED');
    expect(receipt?.receipt?.denial?.reason).toBe('ACTION_AUTHORITY_DENIED');
  });

  it('the denied receipt replays idempotently (the same envelope answers the recorded outcome)', async () => {
    const envelope = summonBody('inv-route-2');
    const first = await postEnvelope(envelope);
    const second = await postEnvelope(envelope);
    expect(second.status).toBe(first.status);
    const firstReceipt = (first.body as { receipt?: { receipt?: { actionId?: string } } }).receipt?.receipt;
    const secondReceipt = (second.body as { receipt?: { receipt?: { actionId?: string } } }).receipt?.receipt;
    expect(secondReceipt?.actionId).toBe(firstReceipt?.actionId);
    const secondView = (second.body as { receipt?: { replayed?: boolean } }).receipt;
    expect(secondView?.replayed).toBe(true);
  });

  it('a malformed submission answers the typed 400 (no `action` field)', async () => {
    const response = await POST(
      new Request('http://localhost/api/live-mission/actions', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
        body: new URLSearchParams({ notaction: 'x' }).toString(),
      }),
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { receipt?: { kind?: string; detail?: string } };
    expect(body.receipt?.kind).toBe('malformed');
  });

  it('an ASK resolution for an unknown entry answers the honest ASK_ENTRY_UNKNOWN (the deployed queue is honestly empty)', async () => {
    const askEnvelope = {
      entryId: 'ask-never-enqueued',
      resolution: {
        resolved_by: ACTOR,
        chosen_alternative_id: 'act-under-granted-authority',
        note: 'route-level ask resolution attempt',
        provenance: ['human:console-user', 'surface:live-mission'],
        created_at: '2026-09-26T00:00:00Z',
      },
    };
    const { status, body } = await postEnvelope(askEnvelope);
    expect(status).toBe(200);
    const receipt = (body as { receipt?: { kind?: string; status?: string; error?: { code?: string } } }).receipt;
    expect(receipt?.kind).toBe('ask-resolution');
    expect(receipt?.status).toBe('FAILED');
    expect(receipt?.error?.code).toBe('ASK_ENTRY_UNKNOWN');
  });

  it('a browser form POST (Accept: text/html) answers the 303 PRG hop to the receipt page', async () => {
    const { status, location } = await postEnvelope(summonBody('inv-route-prg'), 'text/html');
    expect(status).toBe(303);
    expect(location).toContain('/mission/receipt?key=');
  });
});

describe('INVARIANT: honest degraded states (no fabricated confirmation anywhere)', () => {
  it('every endpoint receipt states the in-process idempotency scope (no durable confirmation claimed)', async () => {
    const { body } = await postEnvelope(summonBody('inv-hon-1'));
    const view = (body as { receipt?: { idempotencyScope?: string; honestyNotes?: readonly string[] } }).receipt;
    expect(view?.idempotencyScope).toBe('in-process');
    expect((view?.honestyNotes ?? []).join(' ')).toContain('in-process');
  });

  it('the receipt surface renders the denial\u2019s safe-failure UX (the designed behavior, not an outage)', async () => {
    const { body } = await postEnvelope(summonBody('inv-hon-2'));
    const view = (body as { receipt?: LiveActionReceiptView }).receipt ?? (body as unknown as LiveActionReceiptView);
    const html = receiptHtml(view);
    expect(html).toContain('What happened?');
    expect(html).toContain('What evidence supports it?');
    expect(html).toContain('What uncertainty remains?');
    expect(html).toContain('What authority is required?');
    expect(html).toContain('What can happen next?');
    expect(html).not.toContain('"status":"SUCCEEDED"');
  });
});
