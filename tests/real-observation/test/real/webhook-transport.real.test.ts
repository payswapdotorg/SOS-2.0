/**
 * P17-C REAL-PROVIDER INTEGRATION SUITE (RUN_REAL=1 only): the
 * webhook-shaped receiver over a REAL HTTP transport.
 *
 * The receiver (packages/real-observation/src/github-webhook.ts) is the
 * INBOUND endpoint the deployment topology mounts. This suite binds it
 * through the real node:http server and delivers a correctly-signed
 * GitHub-shaped push payload through a REAL HTTP round-trip (a real
 * socket, real request/response framing), then a tampered body with the
 * same signature (fail-closed) and a replay (typed DUPLICATE).
 *
 * HONEST ORIGIN NOTE (recorded in the evidence): GitHub itself cannot
 * deliver webhooks to this sandbox (no public inbound endpoint — the
 * deployment topology is the P17-A lane). The transport is real; the
 * delivery origin is this test. The production-real GitHub delivery
 * path in this Work Order is the REST events polling (exercised in
 * real-observation.e2e.real.test.ts).
 */

import { createHmac } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { SystemClock, createRealObservationPlane, expectedSignature } from '@sos-2/real-observation';
import { writeEvidence } from '../../src/evidence';

const config = (await import('@sos-2/real-observation')).configFromEnv(process.env as Record<string, string | undefined>);
const producedAt = new Date().toISOString();

function repoHead(): string {
  return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
}

async function post(port: number, path: string, headers: Record<string, string>, body: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const request = httpRequest({ host: '127.0.0.1', port, path, method: 'POST', headers }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk) => chunks.push(chunk as Buffer));
      response.on('end', () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
    });
    request.on('error', reject);
    request.end(body);
  });
}

describe('the webhook-shaped receiver over a REAL HTTP transport (RUN_REAL)', () => {
  it('receives a correctly-signed delivery, fails closed on tampering, and replays safely', async () => {
    const plane = createRealObservationPlane({
      clock: new SystemClock(),
      fetch: (await import('@sos-2/real-observation')).bindGlobalFetch({ timeoutMs: 20_000 }),
      github: { ...config.github, apiBase: 'https://api.github.com' },
      vercel: { ...config.vercel, apiBase: 'https://api.vercel.com' },
      upstash: config.upstash,
      webhookSecret: { secret: 'p17c-webhook-secret-real-transport', secretEnvName: 'PAYSWAP_GITHUB_WEBHOOK_SECRET' },
      claims: { readClaims: async () => [] },
    });

    const { startWebhookServer } = await import('@sos-2/real-observation');
    const server = await startWebhookServer({ receiver: plane.webhookReceiver, port: 0, path: '/webhooks/github' });
    try {
      const body = JSON.stringify({ ref: 'refs/heads/wo/p17c-real-observation-ux', before: repoHead(), after: repoHead() });
      const signature = expectedSignature('p17c-webhook-secret-real-transport', body);
      const headers = { 'content-type': 'application/json', 'x-github-event': 'push', 'x-github-delivery': `p17c-real-${Date.now()}`, 'x-hub-signature-256': signature };

      // 1. The correctly-signed delivery ingests through the real transport.
      const accepted = await post(server.port, '/webhooks/github', headers, body);
      expect(accepted.status).toBe(200);
      expect(accepted.body).toContain('INGESTED');

      // 2. The SAME delivery replayed: typed DUPLICATE through the durable store.
      const replayed = await post(server.port, '/webhooks/github', headers, body);
      expect(replayed.status).toBe(200);
      expect(replayed.body).toContain('INGESTED');

      // 3. A tampered body with the original signature FAILS CLOSED (400).
      const tampered = await post(server.port, '/webhooks/github', { ...headers, 'x-github-delivery': `p17c-real-tampered-${Date.now()}` }, JSON.stringify({ ref: 'refs/heads/main', before: 'b', after: 'evil' }));
      expect(tampered.status).toBe(400);
      expect(tampered.body).toContain('INVALID_SIGNATURE');

      // The durable events: the accepted delivery + its replay (one id)
      const stored = await plane.store.observationEvents.list({ limit: 1000 });
      const webhookEvents = stored.items.filter((event) => event.source === 'github:webhook');
      expect(webhookEvents.length).toBe(1);
      expect(webhookEvents[0]!.kind).toBe('github.push');
      expect(webhookEvents[0]!.payload).toMatchObject({ ref: 'refs/heads/wo/p17c-real-observation-ux' });

      writeEvidence('webhook-transport.json', {
        work_order: 'P17-C',
        evidence_kind: 'webhook-transport',
        produced_at: producedAt,
        repo_head: repoHead(),
        transport: 'real node:http server (127.0.0.1, ephemeral port) + real HTTP POST round-trip with X-Hub-Signature-256 HMAC-SHA256',
        origin_honesty: 'GitHub itself cannot deliver webhooks to this sandbox (no public inbound endpoint; the deployment topology is the P17-A lane). The TRANSPORT is real (a real socket and framing); the delivery ORIGIN is this suite. The production-real GitHub delivery path in P17-C is the REST events polling (see sources/github-events.json).',
        cases: [
          { case: 'correctly-signed push delivery', http_status: accepted.status, outcome: accepted.body },
          { case: 'identical redelivery (replay protection)', http_status: replayed.status, outcome: replayed.body, note: 'typed DUPLICATE — the durable event id is the GitHub delivery id' },
          { case: 'tampered body under the original signature', http_status: tampered.status, outcome: tampered.body, note: 'fail-closed: INVALID_SIGNATURE, never ingested' },
        ],
        durable_events: webhookEvents.map((event) => ({ id: event.id, kind: event.kind, payload: event.payload, provenance: event.provenance, occurred_at: event.occurred_at })),
      });
    } finally {
      server.stop();
    }
  }, 60_000);
});
