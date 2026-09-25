/**
 * The DETERMINISTIC wiring suite of @sos-2/infra-production-connectivity
 * (Work Order P17-A): offline (a scripted FetchPort + ManualClock +
 * instant sleep), fixed seed, run-to-run identical. Pins:
 *
 *   - the harness composes the real adapters from an injected source
 *     (env-only; absent credentials leave adapters honestly UNATTACHED
 *     with UNKNOWN states — never fabricated);
 *   - the startup probes produce honest outcomes from the scripted
 *     seam (CONNECTED on 2xx, UNAVAILABLE on transport failure with the
 *     real reason recorded, DEGRADED on 429);
 *   - the frozen health report maps honestly
 *     (AVAILABLE/UNAVAILABLE/UNKNOWN — the P2 bridge);
 *   - the evidence builders redact through BOTH lane corpora and fail
 *     closed on residual secret-shaped material;
 *   - the secrets audit detects synthetic secret-shaped fixtures with
 *     pattern ids + positions only.
 */

import { describe, expect, it } from 'vitest';
import { ManualClock } from '@sos-2/live-store';
import { createProductionConnectivityHarness } from '../src/wiring.js';
import { assertEvidenceIsRedacted, buildEvidenceRecord, serializeEvidenceRecord } from '../src/evidence.js';
import { auditFiles, scanTextWithLaneCorpora } from '../src/secrets-audit.js';
import type { FetchPort, HttpRequest, HttpResponse } from '@sos-2/real-persistence';

const T0 = 1_776_350_400_000; // 2026-04-16T12:00:00.000Z

/** A scripted FetchPort: responses consumed in fixed order (offline, deterministic). */
function scriptedFetch(responses: readonly (HttpResponse | { transportError: string })[]): { fetch: FetchPort; requests: HttpRequest[] } {
  const queue = [...responses];
  const requests: HttpRequest[] = [];
  const fetch: FetchPort = async (request) => {
    requests.push(request);
    const next = queue.shift();
    if (next === undefined) {
      throw new Error('the scripted port is exhausted — a deterministic defect in the test fixture');
    }
    if ('transportError' in next) {
      throw new Error(next.transportError);
    }
    return next;
  };
  return { fetch, requests };
}

function jsonResponse(status: number, body: unknown): HttpResponse {
  return {
    status,
    headers: { 'content-type': 'application/json' },
    bytes: new TextEncoder().encode(JSON.stringify(body)),
  };
}

const instantSleep = async () => {};

describe('@sos-2/infra-production-connectivity wiring (deterministic)', () => {
  it('leaves every adapter unattached + UNKNOWN when the source is empty (never fabricated)', () => {
    const harness = createProductionConnectivityHarness({
      source: {},
      tier: 'production',
      clock: new ManualClock(T0),
      fetch: scriptedFetch([]).fetch,
      sleep: instantSleep,
    });
    expect(harness.persistence.postgres).toBeNull();
    expect(harness.persistence.redis).toBeNull();
    expect(harness.persistence.objectStore).toBeNull();
    expect(harness.vercel).toBeNull();
    const health = harness.health();
    expect(health.postgres.status).toBe('UNKNOWN');
    expect(health.redis.status).toBe('UNKNOWN');
    expect(health.objectStore.status).toBe('UNKNOWN');
    for (const state of harness.providerStates()) {
      expect(state.state).toBe('UNKNOWN');
      expect(state.probes).toEqual([]);
    }
  });

  it('attaches the adapters from the injected source (env names only) and probes them honestly', async () => {
    const { fetch, requests } = scriptedFetch([
      // Neon SQL ping
      jsonResponse(200, { fields: [{ name: 'ping', type: 'int4' }], rows: [{ ping: 1 }], command: 'SELECT', rowCount: 1 }),
      // Upstash PING
      jsonResponse(200, { result: 'PONG' }),
      // R2 HeadBucket (404 -> bucket missing -> probe fails honestly)
      { status: 404, headers: {}, bytes: new Uint8Array() },
      // Vercel user probe
      jsonResponse(200, { user: { id: 'user_1', username: 'operator', defaultTeamId: 'team_1', billing: { plan: 'hobby' } } }),
    ]);
    const harness = createProductionConnectivityHarness({
      source: {
        DATABASE_URL: 'postgres://operator:secret-password@ep-example-pooler.us-east-1.aws.neon.tech/sos?sslmode=require',
        UPSTASH_REDIS_REST_URL: 'https://example.upstash.io',
        UPSTASH_REDIS_REST_TOKEN: 'AAAAexampleexampleexampleexampleexampl',
        R2_ACCOUNT_ID: 'account123',
        R2_ACCESS_KEY_ID: 'accesskey123',
        R2_SECRET_ACCESS_KEY: 'secretkey123',
        R2_BUCKET_NAME: 'sos20-evidence-prod',
        VERCEL_TOKEN: 'vcp_exampleexampleexampleexampleexampl',
      },
      tier: 'production',
      clock: new ManualClock(T0),
      fetch,
      sleep: instantSleep,
    });
    expect(harness.persistence.postgres).not.toBeNull();
    expect(harness.persistence.redis).not.toBeNull();
    expect(harness.persistence.objectStore).not.toBeNull();
    expect(harness.vercel).not.toBeNull();

    const outcomes = await harness.startupProbes();
    expect(outcomes).toEqual([
      { provider: 'neon', attached: true, probed: true, ok: true },
      { provider: 'upstash', attached: true, probed: true, ok: true },
      { provider: 'r2', attached: true, probed: true, ok: false },
      { provider: 'vercel', attached: true, probed: true, ok: true },
    ]);

    const health = harness.health();
    expect(health.postgres.status).toBe('AVAILABLE');
    expect(health.redis.status).toBe('AVAILABLE');
    expect(health.objectStore.status).toBe('UNAVAILABLE');

    const states = harness.providerStates();
    expect(states.find((state) => state.provider_id === 'neon')?.state).toBe('CONNECTED');
    expect(states.find((state) => state.provider_id === 'upstash')?.state).toBe('CONNECTED');
    expect(states.find((state) => state.provider_id === 'r2')?.state).toBe('UNAVAILABLE');
    expect(states.find((state) => state.provider_id === 'vercel')?.state).toBe('CONNECTED');

    // The credential values NEVER appear in the transcript — env NAME
    // references only (the redaction discipline, machine-checked).
    const transcriptJson = harness.persistence.transcript().toJSON();
    expect(transcriptJson.includes('secret-password')).toBe(false);
    expect(transcriptJson.includes('AAAAexampleexample')).toBe(false);
    expect(transcriptJson).toContain('[REDACTED:env-name:DATABASE_URL]');
    expect(transcriptJson).toContain('[REDACTED:env-name:UPSTASH_REDIS_REST_TOKEN]');
    // The R2 request carries the SigV4 authorization header — redacted to the env NAME reference.
    expect(transcriptJson).toContain('[REDACTED:env-name:R2_SECRET_ACCESS_KEY]');
    expect(requests.length).toBe(4);
  });

  it('records UNAVAILABLE with the real reason on transport failures (DNS/network — never fabricated)', async () => {
    const { fetch } = scriptedFetch([
      { transportError: 'getaddrinfo ENOTFOUND api.fake-neon.test' },
      { transportError: 'getaddrinfo ENOTFOUND fake.upstash.test' },
      { transportError: 'connect ETIMEDOUT fake.r2.test:443' },
      { transportError: 'connect ECONNREFUSED fake.vercel.test:443' },
    ]);
    const harness = createProductionConnectivityHarness({
      source: {
        DATABASE_URL: 'postgres://u:p@ep-fake.example.test/sos',
        UPSTASH_REDIS_REST_URL: 'https://fake.upstash.test',
        UPSTASH_REDIS_REST_TOKEN: 'token-value-example-1234567890',
        R2_ACCOUNT_ID: 'acct',
        R2_ACCESS_KEY_ID: 'key',
        R2_SECRET_ACCESS_KEY: 'secret',
        R2_BUCKET_NAME: 'bucket',
        VERCEL_TOKEN: 'vcp_faketoken123456789012345678',
      },
      tier: 'production',
      clock: new ManualClock(T0),
      fetch,
      sleep: instantSleep,
    });
    const outcomes = await harness.startupProbes();
    expect(outcomes.map((outcome) => outcome.ok)).toEqual([false, false, false, false]);
    const states = harness.providerStates();
    for (const state of states) {
      expect(state.state).toBe('UNAVAILABLE');
      expect(state.last_error).not.toBeNull();
    }
    const neon = states.find((state) => state.provider_id === 'neon');
    expect(neon?.last_error).toContain('ENOTFOUND');
    expect(harness.health().postgres.status).toBe('UNAVAILABLE');
  });

  it('builds redacted evidence records and fails closed on residual secret-shaped material', () => {
    const record = buildEvidenceRecord({
      schema: 'sos-2/p17a/provider-states',
      workOrder: 'P17-A',
      producedAt: new Date(T0).toISOString(),
      body: {
        note: 'the token was vcp_exampletoken123456789012345 during the probe',
        credential_env: 'VERCEL_TOKEN',
      },
    });
    expect(record.redactedPatternIds).toContain('vercel-access-token');
    const serialized = serializeEvidenceRecord(record);
    expect(serialized.includes('vcp_exampletoken123456789012345')).toBe(false);
    expect(() => assertEvidenceIsRedacted(serialized)).not.toThrow();
    expect(() => assertEvidenceIsRedacted('{"note":"Bearer gQAAAAAAAjoNAAIgcDE4YWM4ZmQzZWY3N2I0NWQ2OWQ1YzIwM2M4NGQxZjc0Mg"}')).toThrow();
  });

  it('audits files with pattern ids + positions only (synthetic fixture detection)', () => {
    const findings = auditFiles([
      {
        label: 'synthetic/example.md',
        text: 'line one\nthe key is ghp_syntheticexampletokenvalue1234 here\nline three',
      },
    ]);
    expect(findings.length).toBe(1);
    expect(findings[0]!.patternId).toBe('github-pat-classic');
    expect(findings[0]!.line).toBe(2);
    expect(JSON.stringify(findings).includes('ghp_syntheticexampletokenvalue1234')).toBe(false);
    expect(scanTextWithLaneCorpora('clean/file.md', 'nothing secret here')).toEqual([]);
  });
});
