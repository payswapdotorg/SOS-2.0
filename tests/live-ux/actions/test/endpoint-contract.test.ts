/**
 * P18-B deterministic reference-mode acceptance suite (1/8):
 * THE LIVE ACTION ENDPOINT CONTRACT.
 *
 * The mounted endpoint (apps/web/app/api/live-mission/actions/route.ts —
 * imported through the test-time alias, exactly the module the deployed
 * app serves) answers every typed submission with a typed outcome and
 * NEVER a silent 5xx. This suite pins the P18-C route-level contract
 * (the integration contract MOUNTING.md documents) plus the endpoint's
 * own parsing rules:
 *
 *   - form-encoded `action` submissions (the frozen P17-C forms' exact
 *     protocol) — including the identity-INCOMPLETE envelopes the frozen
 *     forms post (the endpoint derives the identity deterministically);
 *   - JSON body submissions;
 *   - the ASK resolution submissions (the `ask` JSON field and the
 *     discrete form fields);
 *   - typed rejections: smuggled authority fields, malformed envelopes,
 *     empty submissions;
 *   - the GET contract (honest discovery);
 *   - the HTML receipt mode (Accept: text/html).
 *
 * Deterministic: the suite runs with NO grants declared (the ambient env
 * in the vitest worker carries no LIVE_MISSION_GRANTS), so every gateway
 * action answers the honest fail-closed DENIED — GRANT_NEVER_HELD; the
 * ask queue's seeded reference ask is deterministic (fixed literals).
 */

import { describe, expect, it } from 'vitest';
import { POST, GET } from '@web-app/action-endpoint';
import { summonBodyEnvelope } from '@live-mission/envelopes';
import { CONSOLE_ASK_CREATED_AT } from '@live-mission/console-ask-queue';

const ENDPOINT_URL = 'http://localhost/api/live-mission/actions';
const T0 = 1_797_123_600_000;

/** Post form fields exactly the way the mounted forms do. */
async function postForm(fields: Record<string, string>, accept?: string): Promise<{ status: number; body: unknown; text: string }> {
  const response = await POST(
    new Request(ENDPOINT_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', ...(accept !== undefined ? { accept } : {}) },
      body: new URLSearchParams(fields).toString(),
    }),
  );
  const text = await response.text();
  return { status: response.status, body: safeJson(text), text };
}

/** Post a JSON body (the programmatic submission protocol). */
async function postJson(payload: unknown, accept?: string): Promise<{ status: number; body: unknown; text: string }> {
  const response = await POST(
    new Request(ENDPOINT_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(accept !== undefined ? { accept } : {}) },
      body: JSON.stringify(payload),
    }),
  );
  const text = await response.text();
  return { status: response.status, body: safeJson(text), text };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/** The exact envelope the frozen P17-C summon-body form posts (identity-INCOMPLETE by design). */
function frozenFormEnvelope(bodyId: string): string {
  return JSON.stringify({
    family: 'body-lifecycle',
    actor: { kind: 'human', id: 'console-user' },
    targetRevision: { kind: 'source', sha: '3717b6ccac8e0741e8a0eef7fd3b0aa92502f6ea' },
    payload: { family: 'body-lifecycle', bodyLifecycle: { bodyId, operation: 'start' } },
  });
}

describe('the mounted action endpoint answers typed submissions (never a silent 5xx)', () => {
  it('answers the frozen form protocol (form-encoded action field) with the honest fail-closed denial and DERIVED identity', async () => {
    const { status, body } = await postForm({ action: frozenFormEnvelope('endpoint-contract-body-1') });
    expect(status).toBeLessThan(500);
    expect(body).toMatchObject({
      kind: 'executed',
      replayed: false,
      receipt: {
        status: 'DENIED',
        denial: { reason: 'ACTION_AUTHORITY_DENIED', authority: { reason: 'GRANT_NEVER_HELD' } },
      },
    });
    const receipt = (body as { receipt: { actionId: string; idempotencyKey: string } }).receipt;
    // the identity was DERIVED deterministically from the envelope content
    expect(receipt.actionId).toMatch(/^live-action:body-lifecycle:/);
    expect(receipt.idempotencyKey).toMatch(/^live-action-idem:/);
    // the denial is evidence-bound
    expect(JSON.stringify(body)).toMatch(/action-evidence:/);
  });

  it('uses a CALLER-SUPPLIED identity as-is (the P17-C builders full output)', async () => {
    const envelope = summonBodyEnvelope({
      actorId: 'console-user',
      bodyId: 'endpoint-contract-body-2',
      baseSha: '3717b6ccac8e0741e8a0eef7fd3b0aa92502f6ea',
      actionId: 'endpoint-contract-action-2',
      idempotencyKey: 'endpoint-contract-idem-2',
      requestedAt: T0,
    });
    const { status, body } = await postForm({ action: JSON.stringify(envelope) });
    expect(status).toBe(200);
    expect(body).toMatchObject({
      kind: 'executed',
      receipt: { actionId: 'endpoint-contract-action-2', idempotencyKey: 'endpoint-contract-idem-2', status: 'DENIED' },
    });
  });

  it('accepts the JSON body protocol {"action": …} identically', async () => {
    const { status, body } = await postJson({ action: JSON.parse(frozenFormEnvelope('endpoint-contract-body-3')) });
    expect(status).toBeLessThan(500);
    expect((body as { kind?: string })?.kind).toBe('executed');
  });

  it('is idempotent over the wire: the same identity-incomplete envelope replays the recorded receipt', async () => {
    const first = await postForm({ action: frozenFormEnvelope('endpoint-contract-body-4') });
    const second = await postForm({ action: frozenFormEnvelope('endpoint-contract-body-4') });
    expect((first.body as { kind?: string })?.kind).toBe('executed');
    expect((second.body as { kind?: string })?.kind).toBe('replayed');
    expect((second.body as { replayed?: boolean })?.replayed).toBe(true);
    if (first.body !== null && second.body !== null) {
      expect((second.body as { receipt: unknown }).receipt).toEqual((first.body as { receipt: unknown }).receipt);
    }
  });

  it('typed-rejects a smuggled authority field (AUTHORITY_FIELD_SMUGGLED, 400, never executed)', async () => {
    const envelope = {
      ...summonBodyEnvelope({
        actorId: 'console-user',
        bodyId: 'endpoint-contract-body-5',
        baseSha: 'sha-5',
        actionId: 'endpoint-contract-action-5',
        idempotencyKey: 'endpoint-contract-idem-5',
        requestedAt: T0,
      }),
      grant: 'smuggled-grant-id',
    };
    const { status, body } = await postForm({ action: JSON.stringify(envelope) });
    expect(status).toBe(400);
    expect(body).toMatchObject({ kind: 'rejected', rejection: { code: 'AUTHORITY_FIELD_SMUGGLED', field: 'grant' } });
    expect(JSON.stringify(body)).not.toContain('"status":"SUCCEEDED"');
  });

  it('typed-rejects a malformed envelope (ENVELOPE_MALFORMED, 400)', async () => {
    const { status, body } = await postForm({ action: JSON.stringify({ family: 'body-lifecycle' }) });
    expect(status).toBe(400);
    expect(body).toMatchObject({ kind: 'rejected', rejection: { code: 'ENVELOPE_MALFORMED' } });
  });

  it('typed-rejects an unparseable action field (SUBMISSION_MALFORMED, 400)', async () => {
    const { status, body } = await postForm({ action: 'this is not json' });
    expect(status).toBe(400);
    expect(body).toMatchObject({ kind: 'endpoint-error', error: { code: 'SUBMISSION_MALFORMED' } });
  });

  it('typed-rejects an empty submission (no envelope at all, 400)', async () => {
    const { status, body } = await postForm({});
    expect(status).toBe(400);
    expect(body).toMatchObject({ kind: 'endpoint-error', error: { code: 'SUBMISSION_MALFORMED' } });
    expect((body as { error: { message: string } }).error.message).toContain('no action envelope');
  });

  it('answers HTML when the browser asks (Accept: text/html — the receipt document)', async () => {
    const response = await POST(
      new Request(ENDPOINT_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'text/html,application/xhtml+xml' },
        body: new URLSearchParams({ action: frozenFormEnvelope('endpoint-contract-body-6') }).toString(),
      }),
    );
    expect(response.headers.get('content-type')).toContain('text/html');
    const html = await response.text();
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('data-action-receipt="true"'); // the machine-checkable data island
    expect(html).toContain('Nothing was changed'); // the denied-action safe-failure UX
  });
});

describe('the mounted endpoint resolves ASK submissions through the merged queue', () => {
  it('resolves the console seeded ask over the discrete form fields and mints the Decision record', async () => {
    // The seeded reference ask is deterministic: same literals -> same entry id.
    const seeded = await seedEntryId();
    const { status, body } = await postForm({
      askEntryId: seeded,
      askAlternative: 'act-under-granted-authority',
      askNote: 'endpoint-contract: resolving the seeded ask through the discrete form fields',
      askResolvedBy: 'console-user',
    });
    expect(status).toBe(200);
    expect(body).toMatchObject({
      kind: 'ask-resolved',
      resolution: { entryId: seeded, action: 'ACT', resolvedBy: 'console-user', chosenAlternativeId: 'act-under-granted-authority' },
    });
    const resolution = (body as { resolution: { decisionRef: string; queue: { pending: number } } }).resolution;
    expect(resolution.decisionRef).toMatch(/^sos:\/\/Decision\//);
    expect(resolution.queue.pending).toBe(0);
  });

  it('typed-fails a SECOND resolution of the same entry (terminal — an entry is resolved at most once)', async () => {
    const seeded = await seedEntryId();
    // Note: the previous test already resolved the seeded ask on THIS queue instance;
    // re-resolving it here pins the terminal rule through the endpoint.
    const { status, body } = await postJson({
      ask: { entryId: seeded, resolution: { resolved_by: 'console-user', chosen_alternative_id: 'reject', note: 'second' } },
    });
    expect(status).toBe(400);
    expect(body).toMatchObject({ kind: 'ask-failed', error: { code: 'ASK_RESOLUTION_REJECTED' } });
    expect((body as { error: { message: string } }).error.message).toContain('already RESOLVED');
  });

  it('typed-fails an unknown entry id (never a fabricated resolution)', async () => {
    const { status, body } = await postJson({
      ask: {
        entryId: 'sos://AskRequest/does-not-exist-0000000000000000000000000000',
        resolution: { resolved_by: 'console-user', chosen_alternative_id: 'reject', note: 'n' },
      },
    });
    expect(status).toBe(400);
    expect(body).toMatchObject({ kind: 'ask-failed', error: { code: 'ASK_RESOLUTION_REJECTED' } });
    expect((body as { error: { message: string } }).error.message).toContain('unknown ask queue entry');
  });

  it('typed-fails a malformed ask submission (missing the mandatory resolution fields)', async () => {
    const { status, body } = await postForm({ askEntryId: 'sos://AskRequest/x', askAlternative: '', askNote: '', askResolvedBy: '' });
    expect(status).toBe(400);
    expect(body).toMatchObject({ kind: 'ask-failed', error: { code: 'ASK_SUBMISSION_MALFORMED' } });
  });
});

describe('the endpoint GET answers the typed contract (honest discovery)', () => {
  it('describes the endpoint, its authority model and its honest scope', async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    const body = (await response.json()) as { endpoint: string; authority: { operatorDeclaration: string }; honestScope: string[] };
    expect(body.endpoint).toBe('/api/live-mission/actions');
    expect(body.authority.operatorDeclaration).toBe('LIVE_MISSION_GRANTS');
    expect(body.honestScope.join(' ')).toContain('process-local');
  });
});

// ---------------------------------------------------------------------------
// The seeded ask id (deterministic; computed once through the real machinery)
// ---------------------------------------------------------------------------

let cachedSeedId: string | null = null;
async function seedEntryId(): Promise<string> {
  if (cachedSeedId === null) {
    const { getConsoleAskQueue } = await import('@live-mission/console-ask-queue');
    cachedSeedId = getConsoleAskQueue().seed.id;
  }
  return cachedSeedId;
}

/** The seeded ask's fixed creation instant stays honest (no hidden clocks). */
describe('the console ask seed is deterministic', () => {
  it('carries the fixed creation instant (the documented constant)', async () => {
    expect(CONSOLE_ASK_CREATED_AT).toBe('2026-09-26T00:00:00.000Z');
  });
});
