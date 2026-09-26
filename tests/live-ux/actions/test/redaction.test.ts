/**
 * P18-B deterministic reference-mode acceptance suite (8/8):
 * REDACTION — secrets discipline (env NAMES only, never values).
 *
 * Two scans (the P18-A secrets-audit precedent):
 *   1. RUNTIME: submit actions with secret-SHAPED credential values in
 *      the (injected) environment and scripted provider ports — every
 *      receipt, transcript, execution record and rendered receipt must
 *      carry the env NAMES only, never the values; the smuggled
 *      authority field stays typed-rejected (the gateway carries no
 *      authority surface of its own).
 *   2. SOURCE: scan the committed files of the lane's owned paths for
 *      secret-shaped strings (patterns only — the scan never echoes a
 *      real value).
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLiveActionHost } from '@live-mission/host';
import { renderActionReceiptHtml } from '@live-mission/receipt-html';
import { summonBodyEnvelope } from '@live-mission/envelopes';
import { vercelRecordsFetch } from './helpers/scripted-vercel';

const T0 = 1_797_123_600_000;
const ACTOR = 'console-user';

/** Deterministic secret-SHAPED values (never real credentials — the pattern shapes only). */
const SECRET_SHAPED = {
  bodyApiKey: ['sk-or-v1-', 'deterministic00000000000000000000000000000000000000000000000000000000'].join(''),
  vercelToken: ['deterministic-vercel-', 'token-shaped-0000000000000000000000000000000000000'].join(''),
  githubPat: ['gh' + 'p_', 'deterministic0000000000000000000000000000000'].join(''),
  neonKey: ['nap' + 'i_', 'deterministic000000000000000'].join(''),
};

/** The secret-shaped PATTERNS scanned over every committed owned file (pattern ids only — never matched text). */
const SOURCE_SECRET_PATTERNS: ReadonlyArray<{ readonly id: string; readonly pattern: RegExp }> = [
  { id: 'github-classic-pat', pattern: /ghp_[A-Za-z0-9]{36,}/ },
  { id: 'github-fine-grained-pat', pattern: /github_pat_[A-Za-z0-9_]{22,}/ },
  { id: 'openrouter-key', pattern: /sk-or-v1-[A-Za-z0-9]{32,}/ },
  { id: 'vercel-token', pattern: /vcp_[A-Za-z0-9]{40,}/ },
  { id: 'neon-api-key', pattern: /napi_[A-Za-z0-9]{24,}/ },
  { id: 'aws-style-secret', pattern: /AKIA[0-9A-Z]{16}/ },
];

describe('runtime redaction (env NAMES only — never values)', () => {
  it('the receipts, transcripts, execution records and rendered receipts never carry the credential VALUES', async () => {
    const host = createLiveActionHost({
      env: () => ({
        LIVE_MISSION_GRANTS: 'body-lifecycle:*,promotion:production',
        BODY_PROVIDER_API_KEY: SECRET_SHAPED.bodyApiKey,
        VERCEL_TOKEN: SECRET_SHAPED.vercelToken,
        VERCEL_PROJECT_ID: 'prj_deterministic_scripted',
      }),
      now: () => T0,
      modelPort: {
        complete: () =>
          Promise.resolve({
            ok: true,
            response: { id: 'resp-redaction-0001', model: 'qwen/qwen3-coder-flash', content: 'ready', finish_reason: 'stop', usage: null },
          }),
      },
      vercelFetch: vercelRecordsFetch(),
    });

    const body = await host.submitAction(summonBodyEnvelope({ actorId: ACTOR, bodyId: 'redaction-body-1', baseSha: '3717b6ccac8e0741e8a0eef7fd3b0aa92502f6ea', actionId: 'redaction-1', idempotencyKey: 'redaction-key-1', requestedAt: T0 }));
    const promotion = await host.submitAction({
      family: 'promotion',
      actionId: 'redaction-2',
      idempotencyKey: 'redaction-key-2',
      actor: { kind: 'human', id: ACTOR },
      requestedAt: T0,
      targetRevision: { kind: 'source', sha: '3717b6ccac8e0741e8a0eef7fd3b0aa92502f6ea' },
      payload: { family: 'promotion', promotion: { fromEnvironment: 'staging', toEnvironment: 'production', sourceSha: '3717b6ccac8e0741e8a0eef7fd3b0aa92502f6ea' } },
    });

    const serialized = JSON.stringify([body, promotion]);
    for (const [label, value] of Object.entries(SECRET_SHAPED)) {
      expect(serialized, `the ${label} VALUE must never appear in the outcomes`).not.toContain(value);
    }
    // the env NAMES appear (the honest credential references)
    expect(serialized).toContain('BODY_PROVIDER_API_KEY');
    expect(serialized).toContain('VERCEL_TOKEN / VERCEL_PROJECT_ID');
    // the rendered receipt is clean too
    const html = renderActionReceiptHtml(body);
    for (const value of Object.values(SECRET_SHAPED)) {
      expect(html).not.toContain(value);
    }
  });

  it('a smuggled authority field is typed-rejected (the endpoint never accepts credentials in envelopes)', async () => {
    const host = createLiveActionHost({ env: () => ({}), now: () => T0 });
    const outcome = await host.submitAction({
      family: 'body-lifecycle',
      actionId: 'redaction-3',
      idempotencyKey: 'redaction-key-3',
      actor: { kind: 'human', id: ACTOR },
      requestedAt: T0,
      targetRevision: { kind: 'source', sha: '3717b6ccac8e0741e8a0eef7fd3b0aa92502f6ea' },
      payload: { family: 'body-lifecycle', bodyLifecycle: { bodyId: 'redaction-body-2', operation: 'start' } },
      token: SECRET_SHAPED.githubPat, // the smuggle attempt
    });
    expect(outcome.kind).toBe('rejected');
    if (outcome.kind === 'rejected') {
      expect(outcome.rejection.code).toBe('AUTHORITY_FIELD_SMUGGLED');
      expect(outcome.rejection.field).toBe('token');
      expect(outcome.rejection.detail).not.toContain(SECRET_SHAPED.githubPat);
    }
  });
});

describe('source scan (the lane\u2019s owned files carry no secret-shaped strings)', () => {
  const REPO_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));
  const OWNED_ROOTS = [
    'apps/web/app/live-mission',
    'apps/web/app/mission',
    'apps/web/app/api/live-mission',
    'tests/live-ux/actions',
    'docs/evidence/production-connectivity/live-ux/actions-mission',
  ];

  function* walk(dir: string): Generator<string> {
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      return; // an owned root may not exist yet (evidence lands with the real run)
    }
    for (const entry of entries) {
      if (entry === 'node_modules' || entry === '.tsbuildinfo' || entry.startsWith('.vitest')) {
        continue;
      }
      const full = join(dir, entry);
      const stats = statSync(full);
      if (stats.isDirectory()) {
        yield* walk(full);
      } else if (/\.(ts|tsx|json|md|mjs)$/.test(entry)) {
        yield full;
      }
    }
  }

  it('no secret-shaped pattern matches any committed owned file (pattern ids only — never matched text)', () => {
    const findings: string[] = [];
    for (const root of OWNED_ROOTS) {
      for (const file of walk(join(REPO_ROOT, root))) {
        const text = readFileSync(file, 'utf8');
        for (const { id, pattern } of SOURCE_SECRET_PATTERNS) {
          if (pattern.test(text)) {
            findings.push(`${id}:${file.replace(REPO_ROOT, '')}`);
          }
        }
      }
    }
    expect(findings, `secret-shaped findings (pattern id + file only): ${findings.join(', ')}`).toEqual([]);
  });

  it('the credential env NAMES the console consumes are the P3 registry names (documented, never values)', async () => {
    const { BODY_PROVIDER_API_KEY_ENV, BODY_PROVIDER_MODEL_ENV } = await import('@live-mission/openrouter-probe');
    const { VERCEL_TOKEN_ENV, VERCEL_PROJECT_ID_ENV, VERCEL_ORG_ID_ENV } = await import('@live-mission/vercel-records');
    const { LIVE_MISSION_GRANTS_ENV } = await import('@live-mission/console-authority');
    expect(BODY_PROVIDER_API_KEY_ENV).toBe('BODY_PROVIDER_API_KEY');
    expect(BODY_PROVIDER_MODEL_ENV).toBe('BODY_PROVIDER_MODEL');
    expect(VERCEL_TOKEN_ENV).toBe('VERCEL_TOKEN');
    expect(VERCEL_PROJECT_ID_ENV).toBe('VERCEL_PROJECT_ID');
    expect(VERCEL_ORG_ID_ENV).toBe('VERCEL_ORG_ID');
    expect(LIVE_MISSION_GRANTS_ENV).toBe('LIVE_MISSION_GRANTS');
  });
});
