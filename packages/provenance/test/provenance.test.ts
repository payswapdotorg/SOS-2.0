import { describe, expect, it } from 'vitest';
import {
  ProvenanceChainBuilder,
  ProvenanceStore,
  createProvenanceRecord,
  isNonAuthoritativeProvenance,
  isLlmOutput,
  provenanceRecordId,
  assertValidProvenanceRecord,
  registerProvenanceArtifactKind,
  verifyProvenanceChain,
  isTimeWindow,
} from '../src/index.js';
import type { ProvenanceRecord } from '../src/index.js';
import { isRegisteredArtifactKind } from '@sos-2/semantic-spine';
import {
  BASE_SHA,
  IMPLEMENTATION_MODEL_ANCHOR_ID,
  W0,
  sampleChain,
  sampleLlmProducer,
  sampleProducer,
} from './helpers.js';

describe('provenance records (positive)', () => {
  it('registers the ProvenanceRecord extension kind in the spine kind registry (idempotently)', () => {
    expect(isRegisteredArtifactKind('ProvenanceRecord')).toBe(true);
    expect(() => registerProvenanceArtifactKind()).not.toThrow();
  });

  it('creates a record with exact revisions, window, context, chain and preserved source availability', () => {
    const record = createProvenanceRecord({
      producer: sampleProducer(),
      source_revision: BASE_SHA,
      deployment_revision: 'deploy-2025-01-01-001',
      window: W0,
      context: { environment: 'production', region: 'eu-west-1' },
      chain: new ProvenanceChainBuilder()
        .artifact(IMPLEMENTATION_MODEL_ANCHOR_ID, 'exact implementation model')
        .externalRevision(`git:${BASE_SHA}`, 'exact base')
        .build(),
      source_availability: 'SUCCESS',
    });
    expect(record.id).toMatch(/^sos:\/\/ProvenanceRecord\/[0-9a-f]{32}$/);
    expect(record.source_revision).toBe(BASE_SHA);
    expect(record.deployment_revision).toBe('deploy-2025-01-01-001');
    expect(record.window).toEqual(W0);
    expect(record.context).toEqual({ environment: 'production', region: 'eu-west-1' });
    expect(record.chain).toHaveLength(2);
    expect(record.source_availability).toBe('SUCCESS');
    expect(record.llm_output).toBe(false);
    expect(isLlmOutput(record)).toBe(false);
    expect(isNonAuthoritativeProvenance(record)).toBe(false);
  });

  it('preserves FAILURE / UNKNOWN / UNAVAILABLE source availability distinctly (never dropped, never coerced)', () => {
    for (const state of ['FAILURE', 'UNKNOWN', 'UNAVAILABLE', 'UNSUPPORTED', 'PARTIAL'] as const) {
      const record = createProvenanceRecord({ producer: sampleProducer(), source_availability: state });
      expect(record.source_availability).toBe(state);
      assertValidProvenanceRecord(record);
    }
  });

  it('derives deterministic ids: identical creation input reproduces the identical id', () => {
    const input = {
      producer: sampleProducer(),
      source_revision: BASE_SHA,
      window: W0,
      chain: [] as { ref: string; ref_kind: 'ARTIFACT'; note: null }[],
      source_availability: 'PARTIAL' as const,
    };
    const a = createProvenanceRecord(input);
    const b = createProvenanceRecord(structuredClone(input));
    expect(a.id).toBe(b.id);
    expect(provenanceRecordId(input)).toBe(a.id);
  });

  it('null revisions are preserved as null (unknown is not defaulted)', () => {
    const record = createProvenanceRecord({ producer: sampleProducer(), source_availability: 'UNKNOWN' });
    expect(record.source_revision).toBeNull();
    expect(record.deployment_revision).toBeNull();
    expect(record.window).toBeNull();
    expect(record.context).toBeNull();
    expect(record.chain).toEqual([]);
  });

  it('LLM-produced records carry the model id and are marked non-authoritative (§18)', () => {
    const record = createProvenanceRecord({
      producer: sampleLlmProducer(),
      source_availability: 'SUCCESS',
    });
    expect(record.producer.model).toBe('glm-4.6');
    expect(record.llm_output).toBe(true);
    expect(isLlmOutput(record)).toBe(true);
    expect(isNonAuthoritativeProvenance(record)).toBe(true);
    assertValidProvenanceRecord(record);
  });
});

describe('provenance chains (positive)', () => {
  it('builds a validated chain of artifact and external-revision hops', () => {
    const chain = new ProvenanceChainBuilder()
      .artifact(IMPLEMENTATION_MODEL_ANCHOR_ID, 'implementation model')
      .externalRevision(`git:${BASE_SHA}`)
      .externalRevision('observation:sha256:deadbeef', 'raw observation content')
      .build();
    expect(chain).toEqual([
      { ref: IMPLEMENTATION_MODEL_ANCHOR_ID, ref_kind: 'ARTIFACT', note: 'implementation model' },
      { ref: `git:${BASE_SHA}`, ref_kind: 'EXTERNAL_REVISION', note: null },
      { ref: 'observation:sha256:deadbeef', ref_kind: 'EXTERNAL_REVISION', note: 'raw observation content' },
    ]);
  });

  it('structurally verifies a well-formed chain without a resolver', () => {
    const record = createProvenanceRecord({
      producer: sampleProducer(),
      chain: new ProvenanceChainBuilder().artifact(IMPLEMENTATION_MODEL_ANCHOR_ID).externalRevision(`git:${BASE_SHA}`).build(),
      source_availability: 'SUCCESS',
    });
    const verification = verifyProvenanceChain(record);
    expect(verification.status).toBe('VERIFIED');
    expect(verification.hops).toBe(2);
    expect(verification.unresolved).toEqual([]);
  });

  it('fully verifies a chain when every hop resolves', () => {
    const record = createProvenanceRecord({
      producer: sampleProducer(),
      chain: new ProvenanceChainBuilder().artifact(IMPLEMENTATION_MODEL_ANCHOR_ID).externalRevision(`git:${BASE_SHA}`).build(),
      source_availability: 'SUCCESS',
    });
    const verification = verifyProvenanceChain(record, () => true);
    expect(verification.status).toBe('VERIFIED');
    expect(verification.reason).toContain('resolved');
  });

  it('reports a broken chain as UNKNOWN with ALL unresolved hops (never truncated)', () => {
    const record = createProvenanceRecord({
      producer: sampleProducer(),
      chain: new ProvenanceChainBuilder()
        .artifact(IMPLEMENTATION_MODEL_ANCHOR_ID)
        .externalRevision('git:1111111111111111111111111111111111111111')
        .externalRevision('oci:frontend@sha256:aaaa')
        .build(),
      source_availability: 'SUCCESS',
    });
    const verification = verifyProvenanceChain(
      record,
      (ref) => ref === IMPLEMENTATION_MODEL_ANCHOR_ID || ref === 'oci:frontend@sha256:aaaa',
    );
    expect(verification.status).toBe('UNKNOWN');
    expect(verification.hops).toBe(3);
    expect(verification.unresolved).toEqual([
      { index: 1, ref: 'git:1111111111111111111111111111111111111111', ref_kind: 'EXTERNAL_REVISION' },
    ]);
    expect(verification.reason).toContain('reported, not truncated');
  });

  it('reports MULTIPLE unresolved hops (all of them, not just the first)', () => {
    const record = createProvenanceRecord({
      producer: sampleProducer(),
      chain: new ProvenanceChainBuilder().externalRevision('a').externalRevision('b').externalRevision('c').build(),
      source_availability: 'SUCCESS',
    });
    const verification = verifyProvenanceChain(record, (ref) => ref === 'b');
    expect(verification.status).toBe('UNKNOWN');
    expect(verification.unresolved.map((hop) => hop.ref)).toEqual(['a', 'c']);
  });
});

describe('ProvenanceStore (positive)', () => {
  it('stores, retrieves and queries deterministically (id-sorted)', () => {
    const store = new ProvenanceStore();
    const r1 = createProvenanceRecord({
      producer: sampleProducer(),
      source_revision: BASE_SHA,
      deployment_revision: 'deploy-001',
      chain: sampleChain(),
      source_availability: 'SUCCESS',
    });
    const r2 = createProvenanceRecord({
      producer: sampleProducer(),
      source_revision: '1111111111111111111111111111111111111111',
      deployment_revision: 'deploy-002',
      source_availability: 'FAILURE',
    });
    store.put(r1);
    store.put(r2);
    expect(store.size).toBe(2);
    expect(store.has(r1.id)).toBe(true);
    expect(store.get(r1.id)).toEqual(r1);
    const listed = store.list();
    expect(listed.map((record) => record.id)).toEqual([...listed.map((record) => record.id)].sort());
    expect(store.bySourceRevision(BASE_SHA).map((record) => record.id)).toEqual([r1.id]);
    expect(store.byDeploymentRevision('deploy-002').map((record) => record.id)).toEqual([r2.id]);
    expect(store.byChainRef(r1.chain[0]!.ref).map((record) => record.id)).toEqual([r1.id]);
    expect(store.byTool('vitest')).toHaveLength(2);
    expect(store.llmProduced()).toHaveLength(0);
  });

  it('put is idempotent for identical content', () => {
    const record = createProvenanceRecord({ producer: sampleProducer(), source_availability: 'UNKNOWN' });
    const store = new ProvenanceStore();
    store.put(record);
    store.put(structuredClone(record));
    expect(store.size).toBe(1);
  });

  it('queries LLM-produced records distinctly', () => {
    const store = new ProvenanceStore();
    store.put(createProvenanceRecord({ producer: sampleProducer(), source_availability: 'SUCCESS' }));
    const llm = createProvenanceRecord({ producer: sampleLlmProducer(), source_availability: 'SUCCESS' });
    store.put(llm);
    expect(store.llmProduced().map((record) => record.id)).toEqual([llm.id]);
  });
});

describe('time windows (positive)', () => {
  it('accepts RFC3339 windows with start <= end (including mixed timezone offsets)', () => {
    expect(isTimeWindow({ start: '2025-01-01T00:00:00Z', end: '2025-01-02T00:00:00+02:00' })).toBe(true);
    expect(isTimeWindow({ start: '2025-01-01T00:00:00.000Z', end: '2025-01-01T00:00:00.000Z' })).toBe(true);
  });
});

describe('canonical round trips (positive)', () => {
  it('every record canonicalizes and round-trips through JSON', () => {
    const record: ProvenanceRecord = createProvenanceRecord({
      producer: sampleProducer(),
      source_revision: BASE_SHA,
      window: W0,
      context: { z: 1, a: 'first', nested: { list: [1, 2, 3] } },
      chain: new ProvenanceChainBuilder().artifact(IMPLEMENTATION_MODEL_ANCHOR_ID).build(),
      source_availability: 'PARTIAL',
    });
    const round = JSON.parse(JSON.stringify(record)) as ProvenanceRecord;
    expect(round).toEqual(record);
    assertValidProvenanceRecord(round);
  });
});
