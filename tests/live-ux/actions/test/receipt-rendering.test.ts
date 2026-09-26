/**
 * P18-B deterministic reference-mode acceptance suite (5/8):
 * RECEIPT RENDERING — evidence/rationale links, safe failure and
 * denied-action UX, the machine-checkable data island, HTML escaping.
 *
 * The receipt document (renderActionReceiptHtml — the exact renderer the
 * endpoint's HTML path uses) is the browser-facing receipt: the typed
 * receipt verbatim, the six product review questions, the DENIED
 * safe-failure UX ("nothing was changed" + the exact authority reason),
 * the FAILED typed failure, the real-execution provider facts, the honest
 * scope limitations, and a JSON data island carrying the EXACT typed
 * outcome (parse it back and it equals the submitted outcome).
 */

import { describe, expect, it } from 'vitest';
import { renderActionReceiptHtml } from '@live-mission/receipt-html';
import { createLiveActionHost } from '@live-mission/host';
import { summonBodyEnvelope, promotionEnvelope, rollbackEnvelope } from '@live-mission/envelopes';
import type { LiveActionEndpointResponse } from '@live-mission/submission';
import { vercelRecordsFetch } from './helpers/scripted-vercel';

const T0 = 1_797_123_600_000;
const ACTOR = 'console-user';
const BASE_SHA = '3717b6ccac8e0741e8a0eef7fd3b0aa92502f6ea';
const OLD_SHA = 'b5938ea4654144df287ce3e907389fc1f911ccf6';

/** Extract + parse the JSON data island from a rendered receipt. */
function dataIsland(html: string): LiveActionEndpointResponse {
  const match = html.match(/<script type="application\/json" id="action-receipt"[^>]*>([\s\S]*?)<\/script>/);
  expect(match, 'the receipt must carry the machine-checkable data island').not.toBeNull();
  return JSON.parse(match![1]!) as LiveActionEndpointResponse;
}

async function deniedOutcome(): Promise<LiveActionEndpointResponse> {
  const host = createLiveActionHost({ env: () => ({}), now: () => T0 });
  return host.submitAction(summonBodyEnvelope({ actorId: ACTOR, bodyId: 'receipt-body-1', baseSha: BASE_SHA, actionId: 'receipt-action-1', idempotencyKey: 'receipt-key-1', requestedAt: T0 }));
}

async function succeededOutcome(): Promise<LiveActionEndpointResponse> {
  const host = createLiveActionHost({
    env: () => ({ LIVE_MISSION_GRANTS: 'body-lifecycle:*', BODY_PROVIDER_API_KEY: 'sk-or-v1-deterministic-scripted-not-a-real-credential' }),
    now: () => T0,
    modelPort: {
      complete: () =>
        Promise.resolve({
          ok: true,
          response: { id: 'resp-receipt-0001', model: 'qwen/qwen3-coder-flash', content: 'ready', finish_reason: 'stop', usage: { prompt_tokens: 12, completion_tokens: 1, total_tokens: 13 } },
        }),
    },
  });
  return host.submitAction(summonBodyEnvelope({ actorId: ACTOR, bodyId: 'receipt-body-2', baseSha: BASE_SHA, actionId: 'receipt-action-2', idempotencyKey: 'receipt-key-2', requestedAt: T0 }));
}

async function failedOutcome(): Promise<LiveActionEndpointResponse> {
  const host = createLiveActionHost({
    env: () => ({ LIVE_MISSION_GRANTS: 'promotion:production', VERCEL_TOKEN: 'deterministic-scripted', VERCEL_PROJECT_ID: 'prj_deterministic_scripted' }),
    now: () => T0,
    vercelFetch: vercelRecordsFetch(),
  });
  return host.submitAction(promotionEnvelope({ actorId: ACTOR, fromEnvironment: 'staging', toEnvironment: 'production', sourceSha: 'never-deployed-sha-0000000000000000000000000000000000000000', actionId: 'receipt-action-3', idempotencyKey: 'receipt-key-3', requestedAt: T0 }));
}

async function replayedOutcome(): Promise<LiveActionEndpointResponse> {
  const host = createLiveActionHost({
    env: () => ({ LIVE_MISSION_GRANTS: 'body-lifecycle:*', BODY_PROVIDER_API_KEY: 'sk-or-v1-deterministic-scripted-not-a-real-credential' }),
    now: () => T0,
    modelPort: {
      complete: () =>
        Promise.resolve({
          ok: true,
          response: { id: 'resp-receipt-0002', model: 'qwen/qwen3-coder-flash', content: 'ready', finish_reason: 'stop', usage: { prompt_tokens: 12, completion_tokens: 1, total_tokens: 13 } },
        }),
    },
  });
  const envelope = summonBodyEnvelope({ actorId: ACTOR, bodyId: 'receipt-body-3', baseSha: BASE_SHA, actionId: 'receipt-action-4', idempotencyKey: 'receipt-key-4', requestedAt: T0 });
  await host.submitAction(envelope);
  return host.submitAction(envelope);
}

async function rollbackOutcome(): Promise<LiveActionEndpointResponse> {
  const host = createLiveActionHost({
    env: () => ({ LIVE_MISSION_GRANTS: 'rollback:*,promotion:production', VERCEL_TOKEN: 'deterministic-scripted', VERCEL_PROJECT_ID: 'prj_deterministic_scripted' }),
    now: () => T0,
    vercelFetch: vercelRecordsFetch(),
  });
  return host.submitAction(
    rollbackEnvelope({ actorId: ACTOR, deploymentId: 'dpl_deterministic_head_0001', fromSourceSha: BASE_SHA, toSourceSha: OLD_SHA, reasonCode: 'INCIDENT', reasonDetail: 'receipt suite rollback', actionId: 'receipt-action-5', idempotencyKey: 'receipt-key-5', requestedAt: T0 }),
  );
}

describe('receipt rendering (the endpoint HTML path, exactly as served)', () => {
  it('renders the DENIED receipt with the safe-failure UX and the exact authority reason', async () => {
    const outcome = await deniedOutcome();
    const html = renderActionReceiptHtml(outcome);
    expect(outcome.kind).toBe('executed');
    expect(html).toContain('DENIED — authority failed closed, nothing was changed');
    expect(html).toContain('Nothing was changed');
    expect(html).toContain('GRANT_NEVER_HELD');
    expect(html).toContain('data-receipt-denied="true"');
    // the six product review questions
    for (const question of ['What happened?', 'Why does SOS believe this?', 'What evidence supports it?', 'What uncertainty remains?', 'What authority was required?', 'What can happen next?']) {
      expect(html).toContain(question);
    }
    // the evidence/rationale deep-links
    expect(html).toContain('href="/evidence"');
    expect(html).toContain('href="/rationale"');
    // the machine-checkable data island equals the submitted outcome
    expect(dataIsland(html)).toEqual(outcome);
  });

  it('renders the SUCCEEDED receipt with the evidence ids, the real execution facts and the provider states', async () => {
    const outcome = await succeededOutcome();
    expect(outcome.kind).toBe('executed');
    const html = renderActionReceiptHtml(outcome);
    expect(html).toContain('SUCCEEDED — executed through the action gateway');
    expect(html).toContain('action-evidence:');
    expect(html).toContain('REAL providers');
    expect(html).toContain('openrouter (the body\u2019s hosted model provider)');
    expect(html).toContain('resp-receipt-0001');
    expect(html).toContain('CONNECTED');
    // the honest scope block
    expect(html).toContain('data-receipt-scope="true"');
    expect(html).toContain('process-local');
    expect(dataIsland(html)).toEqual(outcome);
  });

  it('renders the FAILED receipt with the typed failure (retryability stated)', async () => {
    const outcome = await failedOutcome();
    expect(outcome.kind).toBe('executed');
    const html = renderActionReceiptHtml(outcome);
    expect(html).toContain('A typed failure, honestly recorded.');
    expect(html).toContain('NO_REAL_DEPLOYMENT_FOR_SHA');
    expect(html).toContain('data-receipt-failed="true"');
    expect(dataIsland(html)).toEqual(outcome);
  });

  it('renders the REPLAYED receipt with the idempotent-replay note', async () => {
    const outcome = await replayedOutcome();
    expect(outcome.kind).toBe('replayed');
    const html = renderActionReceiptHtml(outcome);
    expect(html).toContain('This exact action was already recorded');
    expect(html).toContain('idempotent replay');
    expect(dataIsland(html)).toEqual(outcome);
  });

  it('renders the ROLLBACK receipt with the rollback verification verdict', async () => {
    const outcome = await rollbackOutcome();
    expect(outcome.kind).toBe('executed');
    const html = renderActionReceiptHtml(outcome);
    expect(html).toContain('Rollback verification');
    expect(html).toContain('VERIFIED');
    // the real records' transcript is visible (method + path + status)
    expect(html).toMatch(/GET \/v6\/deployments/);
    expect(dataIsland(html)).toEqual(outcome);
  });

  it('renders the typed REJECTION receipt (never executed)', () => {
    const outcome: LiveActionEndpointResponse = {
      kind: 'rejected',
      rejection: { code: 'AUTHORITY_FIELD_SMUGGLED', field: 'grant', detail: 'the action gateway carries no authority fields of its own' },
    };
    const html = renderActionReceiptHtml(outcome);
    expect(html).toContain('The action envelope was rejected before execution');
    expect(html).toContain('AUTHORITY_FIELD_SMUGGLED');
    expect(html).toContain('No evidence ids on this outcome');
    expect(dataIsland(html)).toEqual(outcome);
  });

  it('renders the ASK resolution receipt with the minted Decision record', async () => {
    const { AskQueue } = await import('@sos-2/ask');
    const { seedConsoleAsk } = await import('@live-mission/console-ask-queue');
    const queue = new AskQueue();
    const seed = seedConsoleAsk(queue);
    const host = createLiveActionHost({ env: () => ({}), now: () => T0, askQueue: queue });
    const outcome = await host.submitAskResolution({ entryId: seed.id, resolvedBy: ACTOR, chosenAlternativeId: 'act-under-granted-authority', note: 'receipt rendering ask note' });
    expect(outcome.kind).toBe('ask-resolved');
    const html = renderActionReceiptHtml(outcome);
    expect(html).toContain('The ask resolution receipt');
    expect(html).toContain('sos://Decision/');
    expect(html).toContain('act-under-granted-authority');
    expect(html).toContain('receipt rendering ask note');
    expect(html).toContain('process-local'); // the honest queue scope
    expect(dataIsland(html)).toEqual(outcome);
  });

  it('HTML-escapes hostile user input everywhere (a note that tries to break out is rendered inert)', async () => {
    const { AskQueue } = await import('@sos-2/ask');
    const { seedConsoleAsk } = await import('@live-mission/console-ask-queue');
    const queue = new AskQueue();
    const seed = seedConsoleAsk(queue);
    const host = createLiveActionHost({ env: () => ({}), now: () => T0, askQueue: queue });
    const hostile = '<script>alert("xss")</script> "onmouseover="evil()';
    const outcome = await host.submitAskResolution({ entryId: seed.id, resolvedBy: ACTOR, chosenAlternativeId: 'reject', note: hostile });
    expect(outcome.kind).toBe('ask-resolved');
    const html = renderActionReceiptHtml(outcome);
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;'); // escaped
    // the data island escapes < > & (no </script> breakout)
    const island = html.match(/<script type="application\/json" id="action-receipt"[^>]*>([\s\S]*?)<\/script>/)![1]!;
    expect(island).not.toContain('<script>alert');
    JSON.parse(island); // still valid JSON
  });

  it('carries the a11y anchors (skip link, landmarks, receipt navigation) and the back link', async () => {
    const outcome = await deniedOutcome();
    const html = renderActionReceiptHtml(outcome);
    expect(html).toContain('Skip to the receipt');
    expect(html).toContain('<main id="main-content"');
    expect(html).toContain('aria-label="Receipt navigation"');
    expect(html).toContain('href="/mission"');
    expect(html).toContain('<html lang="en">');
  });
});
