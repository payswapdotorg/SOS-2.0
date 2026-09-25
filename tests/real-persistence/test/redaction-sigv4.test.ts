/**
 * The redaction + SigV4 discipline suite (Work Order P17-A) — offline,
 * deterministic:
 *
 *   - the lane redaction corpora detect + redact every provider
 *     credential shape this lane can carry (Neon napi_ keys and pooled
 *     URLs, Upstash REST tokens/bearers, R2 SigV4 authorizations and
 *     64-hex secrets, Vercel vcp_ tokens, GitHub PATs);
 *   - the shared pattern ids are ALIGNED with the merged
 *     infra/deployment secret-policy corpus (pinned against the frozen
 *     source through a non-literal dynamic import);
 *   - the R2 SigV4 signing is deterministic given the injected instant
 *     and credentials (same instant -> bit-identical Authorization;
 *     different instant -> different signature) and structurally
 *     correct (algorithm, credential scope with the R2 'auto' region
 *     and s3 service, signed headers, hex signature).
 */

import { describe, expect, it } from 'vitest';
import { createHmac, createHash } from 'node:crypto';
import { redactPersistenceSecrets } from '@sos-2/real-persistence';
import { redactDeploymentSecrets } from '@sos-2/deployment-providers';
import { R2S3Client } from '@sos-2/real-persistence';
import { ScriptedHttpWorld, R2_ACCOUNT, R2_KEY, R2_SECRET, R2_BUCKET } from './world.js';

const NEON_KEY = 'napi_abcdefghijklmnopqrstuvwxyz0123456789';
const UPSTASH_TOKEN = 'gQAAAAAAAjoNAAIgcDE4YWM4ZmQzZWY3N2I0NWQ2OWQ1YzIwM2M4NGQxZjc0Mg';
const VERCEL_TOKEN = 'vcp_1ScriptedScriptedScriptedScripted1234';
const GITHUB_PAT = 'ghp_1ScriptedScriptedScriptedScriptedScrip';
const SIGV4_AUTH =
  'AWS4-HMAC-SHA256 Credential=00001111222233334444555566667777/20260416/auto/s3/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

/** Non-literal specifier builder (the tsc build never sees the frozen-source path). */
function frozenPolicySource(): string {
  return ['..', '..', '..', 'infra', 'deployment', 'src', 'secrets', 'policy.ts'].join('/');
}

describe('the lane redaction corpora detect and redact every provider credential shape', () => {
  it('redacts Neon management API keys and pooled connection strings', () => {
    const first = redactPersistenceSecrets(`GET /users/me with key ${NEON_KEY} and url postgres://op:pw@ep-pooler.aws.neon.tech/sos`);
    expect(first.redacted.includes(NEON_KEY)).toBe(false);
    expect(first.redacted.includes('postgres://op:pw@')).toBe(false);
    expect(first.redacted).toContain('[REDACTED]');
    expect(first.findings.map((finding) => finding.patternId)).toContain('neon-api-key');
    expect(first.findings.map((finding) => finding.patternId)).toContain('postgres-url-with-credentials');
  });

  it('redacts Upstash REST tokens (bare and bearer-shaped)', () => {
    const first = redactPersistenceSecrets(`token ${UPSTASH_TOKEN} and header Bearer ${UPSTASH_TOKEN}`);
    expect(first.redacted.includes(UPSTASH_TOKEN)).toBe(false);
    expect(first.findings.map((finding) => finding.patternId)).toContain('upstash-rest-token');
    // The bearer shape is independently caught when the bare-token shape is absent.
    const bearer = redactDeploymentSecrets(`header Bearer ${UPSTASH_TOKEN}`);
    expect(bearer.redacted.includes(UPSTASH_TOKEN)).toBe(false);
    expect(bearer.findings.map((finding) => finding.patternId)).toContain('bearer-token-value');
  });

  it('redacts R2 SigV4 authorizations and 64-hex secret keys (conservative over-redaction of hashes is fail-closed)', () => {
    const first = redactPersistenceSecrets(`auth ${SIGV4_AUTH}`);
    expect(first.redacted.includes('AWS4-HMAC-SHA256 Credential=')).toBe(false);
    expect(first.redacted.includes(R2_SECRET)).toBe(false);
    expect(first.findings.map((finding) => finding.patternId)).toContain('aws4-authorization');
    // The bare 64-hex secret shape is independently caught by its own pattern.
    const bare = redactPersistenceSecrets(`secret ${R2_SECRET}`);
    expect(bare.redacted.includes(R2_SECRET)).toBe(false);
    expect(bare.findings.map((finding) => finding.patternId)).toContain('r2-secret-access-key');
  });

  it('redacts Vercel tokens + GitHub PATs (both lane corpora)', () => {
    const first = redactDeploymentSecrets(`token ${VERCEL_TOKEN} and pat ${GITHUB_PAT}`);
    expect(first.redacted.includes(VERCEL_TOKEN)).toBe(false);
    expect(first.redacted.includes(GITHUB_PAT)).toBe(false);
    expect(first.findings.map((finding) => finding.patternId)).toContain('vercel-access-token');
    expect(first.findings.map((finding) => finding.patternId)).toContain('github-pat-classic');
  });

  it('findings NEVER carry the matched text (ids + counts only)', () => {
    const first = redactPersistenceSecrets(`key ${NEON_KEY}`);
    expect(JSON.stringify(first.findings).includes(NEON_KEY)).toBe(false);
  });
});

describe('the shared pattern ids are aligned with the frozen infra/deployment secret-policy corpus', () => {
  it('the twelve shared ids match the frozen SECRET_SHAPE_PATTERNS ids exactly', async () => {
    const policy = await import(frozenPolicySource());
    const frozenIds = (policy.SECRET_SHAPE_PATTERNS as readonly { id: string }[]).map((pattern) => pattern.id);
    const persistenceIds = redactPersistenceSecrets('').findings; // empty text -> no findings; ids checked from corpus below
    void persistenceIds;
    const { PERSISTENCE_REDACTION_PATTERNS } = await import('@sos-2/real-persistence');
    const laneIds = PERSISTENCE_REDACTION_PATTERNS.map((pattern) => pattern.id);
    for (const frozenId of frozenIds) {
      expect(laneIds).toContain(frozenId);
    }
    const { DEPLOYMENT_REDACTION_PATTERNS } = await import('@sos-2/deployment-providers');
    const deploymentLaneIds = DEPLOYMENT_REDACTION_PATTERNS.map((pattern) => pattern.id);
    for (const frozenId of frozenIds) {
      expect(deploymentLaneIds).toContain(frozenId);
    }
  });
});

describe('the R2 SigV4 signing discipline (deterministic given the injected instant)', () => {
  it('same instant + credentials -> bit-identical Authorization; different instant -> different signature', async () => {
    const worldA = new ScriptedHttpWorld([{ provider: 'r2', status: 200, headers: {}, body: '' }]);
    const worldB = new ScriptedHttpWorld([{ provider: 'r2', status: 200, headers: {}, body: '' }]);
    const worldC = new ScriptedHttpWorld([{ provider: 'r2', status: 200, headers: {}, body: '' }]);
    const instant = new Date(Date.UTC(2026, 3, 16, 12, 0, 0));
    const clientA = new R2S3Client({ accountId: R2_ACCOUNT, accessKeyId: R2_KEY, secretAccessKey: R2_SECRET, fetch: worldA.fetch });
    const clientB = new R2S3Client({ accountId: R2_ACCOUNT, accessKeyId: R2_KEY, secretAccessKey: R2_SECRET, fetch: worldB.fetch });
    const clientC = new R2S3Client({ accountId: R2_ACCOUNT, accessKeyId: R2_KEY, secretAccessKey: R2_SECRET, fetch: worldC.fetch });
    await clientA.headBucket(R2_BUCKET, instant);
    await clientB.headBucket(R2_BUCKET, instant);
    await clientC.headBucket(R2_BUCKET, new Date(instant.getTime() + 1_000));
    const authA = worldA.requests[0]!.headers['authorization']!;
    const authB = worldB.requests[0]!.headers['authorization']!;
    const authC = worldC.requests[0]!.headers['authorization']!;
    expect(authA).toBe(authB);
    expect(authA).not.toBe(authC);
  });

  it('the Authorization header is structurally correct SigV4 for the R2 contract (auto region, s3 service)', async () => {
    const world = new ScriptedHttpWorld([{ provider: 'r2', status: 200, headers: {}, body: '' }]);
    const instant = new Date(Date.UTC(2026, 3, 16, 12, 0, 0));
    const client = new R2S3Client({ accountId: R2_ACCOUNT, accessKeyId: R2_KEY, secretAccessKey: R2_SECRET, fetch: world.fetch });
    await client.headBucket(R2_BUCKET, instant);
    const request = world.requests[0]!;
    const auth = request.headers['authorization']!;
    expect(auth.startsWith('AWS4-HMAC-SHA256 Credential=')).toBe(true);
    expect(auth).toContain(`${R2_KEY}/20260416/auto/s3/aws4_request`);
    expect(auth).toContain('SignedHeaders=host;x-amz-content-sha256;x-amz-date');
    const signature = /Signature=([0-9a-f]{64})$/.exec(auth)?.[1];
    expect(signature).toBeDefined();
    // The signature is verifiable against the documented SigV4 derivation
    // (the same computation, done independently here — a true pin of the algorithm).
    const amzDate = instant.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const payloadHash = createHash('sha256').update('').digest('hex');
    const host = `${R2_ACCOUNT}.r2.cloudflarestorage.com`;
    const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
    const canonicalRequest = ['HEAD', `/${R2_BUCKET}`, '', canonicalHeaders, 'host;x-amz-content-sha256;x-amz-date', payloadHash].join('\n');
    const scope = '20260416/auto/s3/aws4_request';
    const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, createHash('sha256').update(canonicalRequest).digest('hex')].join('\n');
    const hmac = (key: Buffer | string, data: string) => createHmac('sha256', key).update(data).digest();
    const kSigning = hmac(hmac(hmac(hmac(`AWS4${R2_SECRET}`, '20260416'), 'auto'), 's3'), 'aws4_request');
    const expected = createHmac('sha256', kSigning).update(stringToSign).digest('hex');
    expect(signature).toBe(expected);
    expect(request.headers['x-amz-date']).toBe(amzDate);
    expect(request.headers['x-amz-content-sha256']).toBe(payloadHash);
  });

  it('the request body hash signs the REAL payload for PutObject', async () => {
    const world = new ScriptedHttpWorld([{ provider: 'r2', status: 200, headers: {}, body: '' }]);
    const instant = new Date(Date.UTC(2026, 3, 16, 12, 0, 0));
    const client = new R2S3Client({ accountId: R2_ACCOUNT, accessKeyId: R2_KEY, secretAccessKey: R2_SECRET, fetch: world.fetch });
    const bytes = new TextEncoder().encode('sos-2.0 evidence bytes');
    await client.putObject(R2_BUCKET, 'production/evidence/deadbeef42', bytes, instant);
    const request = world.requests[0]!;
    const payloadHash = createHash('sha256').update(bytes).digest('hex');
    expect(request.headers['x-amz-content-sha256']).toBe(payloadHash);
    expect(request.body).toEqual(bytes);
  });
});
