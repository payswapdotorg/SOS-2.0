/**
 * The REAL R2 journey (Work Order P17-A) — env-gated (RUN_REAL=1),
 * default OFF. The journey through the real Cloudflare R2 S3 API
 * (SigV4 on node:crypto — zero external dependencies):
 *
 *   1. startup probe (HeadBucket against the tier-named evidence
 *      bucket);
 *   2. bucket provisioning when absent (CreateBucket — the single
 *      free-tier bucket; tier isolation via key prefixes per the P3
 *      r2 contract);
 *   3. the write-once object journey through the frozen
 *      ObjectStoreAdapter port: a 1-byte probe object + a real
 *      evidence-bundle object, byte-exact read-back, idempotent
 *      re-put (identical bytes -> the identical ref, never a
 *      duplicate), hasObject existence, and the DOCUMENTED
 *      retention-path delete (the full lifecycle, smallest footprint);
 *   4. a real failure path (HeadObject of a random content hash ->
 *      honest null / 404 — never fabricated existence);
 *   5. honest provider states throughout.
 */

import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import {
  ambientSource,
  composeR2Adapter,
  globalFetch,
  journeyTelemetry,
  Journey,
  RUN_REAL,
  writeEvidence,
} from './real-world.js';

const suite = RUN_REAL ? describe : describe.skip;

suite('REAL R2 integration (RUN_REAL=1): the write-once object journey through the frozen ObjectStoreAdapter', () => {
  const journey = new Journey();
  const source = ambientSource();
  const fetch = globalFetch();
  const { transcript, ledger } = journeyTelemetry();
  const clock = { nowEpochMs: () => Date.now() };
  const objectStore = composeR2Adapter(source, transcript, ledger, fetch, clock);

  it('probes the REAL R2 endpoint (HeadBucket — the startup probe) and provisions the bucket when absent', async () => {
    if (objectStore === null) {
      journey.record('head-bucket-probe', false, {
        attempted: false,
        reason: 'no R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET_NAME configured in the environment (names only)',
      });
      return;
    }
    const probed = await objectStore.probe();
    if (!probed) {
      // The bucket may be missing (first run) — provision it.
      const ensured = await objectStore.ensureBucket();
      journey.record('head-bucket-probe', false, {
        first_probe: 'bucket absent (404 — the honest outcome recorded)',
        provisioning: ensured,
        bucket: source['R2_BUCKET_NAME'],
      });
      const reprobed = await objectStore.probe();
      expect(reprobed).toBe(true);
      journey.record('head-bucket-reprobe', true, { state: objectStore.providerState().state });
    } else {
      journey.record('head-bucket-probe', true, {
        state: objectStore.providerState().state,
        bucket: source['R2_BUCKET_NAME'],
        api_revision: objectStore.providerState().api_revision,
      });
    }
    expect(objectStore.providerState().state).toBe('CONNECTED');
  });

  it('runs the write-once object journey: 1-byte + evidence-bundle objects, byte-exact read-back, idempotent re-put', async () => {
    if (objectStore === null) {
      return;
    }
    expect(objectStore.providerState().state).toBe('CONNECTED');
    // The 1-byte probe object.
    const oneByte = new Uint8Array([0x2a]);
    const ref1 = await objectStore.putObject(oneByte);
    expect(ref1.size_bytes).toBe(1);
    expect(ref1.content_hash).toBe(createHash('sha256').update(oneByte).digest('hex'));
    expect(ref1.object_ref).toBe(`r2://${ref1.content_hash}`);
    const read1 = await objectStore.getObject(ref1.content_hash);
    expect(new Uint8Array(read1!)).toEqual(oneByte);
    const rePut = await objectStore.putObject(oneByte);
    expect(rePut.content_hash).toBe(ref1.content_hash); // identical bytes -> identical ref, never a duplicate
    expect(await objectStore.hasObject(ref1.content_hash)).toBe(true);
    journey.record('one-byte-object', true, {
      content_hash: ref1.content_hash,
      object_ref: ref1.object_ref,
      size_bytes: ref1.size_bytes,
      byte_exact_read_back: true,
      idempotent_re_put: true,
      key: objectStore.objectKeyFor(ref1.content_hash),
    });
    // The evidence-bundle object (a real multi-byte bundle).
    const bundle = new TextEncoder().encode(
      JSON.stringify(
        {
          work_order: 'P17-A',
          lane: 'persistence-deployment',
          written_at: new Date().toISOString(),
          note: 'SOS 2.0 P17-A real R2 write-once evidence bundle through the frozen ObjectStoreAdapter port',
        },
        null,
        2,
      ),
    );
    const refB = await objectStore.putObject(bundle);
    expect(refB.size_bytes).toBe(bundle.byteLength);
    const readB = await objectStore.getObject(refB.content_hash);
    expect(new Uint8Array(readB!)).toEqual(bundle);
    journey.record('evidence-bundle-object', true, {
      content_hash: refB.content_hash,
      object_ref: refB.object_ref,
      size_bytes: refB.size_bytes,
      byte_exact_read_back: true,
      key: objectStore.objectKeyFor(refB.content_hash),
    });
  });

  it('exercises a real failure path: HeadObject/GetObject of an absent content hash -> honest null (never fabricated existence)', async () => {
    if (objectStore === null) {
      return;
    }
    const absentHash = 'f'.repeat(64);
    expect(await objectStore.hasObject(absentHash)).toBe(false);
    expect(await objectStore.getObject(absentHash)).toBeNull();
    journey.record('absent-object-failure-path', true, {
      content_hash: absentHash,
      has_object: false,
      get_object: null,
      note: 'a REAL 404 round-trip — absence is an honest null, never fabricated existence',
    });
  });

  it('deletes the 1-byte probe object through the DOCUMENTED retention path (smallest real footprint; the evidence bundle is retained as durable write-once evidence)', async () => {
    if (objectStore === null) {
      return;
    }
    const oneByte = new Uint8Array([0x2a]);
    const hash1 = createHash('sha256').update(oneByte).digest('hex');
    await objectStore.deleteObjectThroughRetentionPath(hash1);
    expect(await objectStore.hasObject(hash1)).toBe(false);
    journey.record('retention-path-delete', true, {
      deleted: [hash1],
      retained: 'the evidence-bundle object (write-once durable evidence in the tier prefix)',
      note: 'deletion happened ONLY through the documented retention path (outside the frozen port — the P3 immutability contract)',
    });
  });

  it('writes the machine-readable evidence (honest — including failures; credentials redacted)', () => {
    const state = ledger.reportFor('r2', 'R2_SECRET_ACCESS_KEY');
    const path = writeEvidence('r2-integration.json', {
      evidence_kind: 'provider-connectivity',
      provider: 'r2',
      provider_states: [state],
      credential_envs: ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_S3_ENDPOINT', 'R2_BUCKET_NAME'],
      s3_endpoint: source['R2_S3_ENDPOINT'] ?? `https://${source['R2_ACCOUNT_ID'] ?? '<account>'}.r2.cloudflarestorage.com`,
      signing: 'AWS SigV4 (node:crypto; region auto; UNSIGNED payload hash replaced by the real body hash)',
      bucket: source['R2_BUCKET_NAME'] ?? null,
      key_layout: 'production/evidence/<sha256-hex> (the P3 tier prefix + purpose + content anchor)',
      adapter_attached: objectStore !== null,
      transcript: transcript.byProvider('r2'),
      request_log: objectStore?.recordedS3Requests() ?? [],
      steps: journey.steps,
      honest_notes: [
        'Objects are write-once immutable: identical bytes produce the identical content-addressed ref (idempotent re-puts, never duplicates).',
        'Deletion happens only through the documented retention path — deliberately OUTSIDE the frozen ObjectStoreAdapter port (the P3 immutability contract).',
        'A failing provider probe is VALID evidence: the honest state machine records the real outcome verbatim.',
      ],
    });
    expect(path.endsWith('r2-integration.json')).toBe(true);
  });
});
