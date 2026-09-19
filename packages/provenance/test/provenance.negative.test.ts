import { describe, expect, it } from 'vitest';
import {
  ProvenanceChainBuilder,
  ProvenanceStore,
  assertValidProducer,
  assertValidProvenanceRecord,
  assertValidTimeWindow,
  createProvenanceRecord,
  validateProvenanceRecord,
  verifyProvenanceChain,
} from '../src/index.js';
import {
  BASE_SHA,
  IMPLEMENTATION_MODEL_ANCHOR_ID,
  sampleProducer,
  sampleLlmProducer,
} from './helpers.js';

describe('provenance validation (negative)', () => {
  it('rejects malformed producers', () => {
    const bad = sampleProducer() as Record<string, unknown>;
    expect(() => assertValidProducer(null)).toThrow(/producer must be an object/);
    expect(() => assertValidProducer({ ...bad, tool: '' })).toThrow(/producer\.tool must be a non-empty string/);
    expect(() => assertValidProducer({ ...bad, tool_version: '' })).toThrow(/producer\.tool_version/);
    expect(() => assertValidProducer({ ...bad, environment: '' })).toThrow(/producer\.environment/);
    expect(() => assertValidProducer({ ...bad, extra: 'field' })).toThrow(/exact fields/);
    expect(() => assertValidProducer({ ...sampleLlmProducer(), model_version: null, model: null })).not.toThrow();
  });

  it('rejects a model version without a model id (loud, not silent)', () => {
    expect(() => assertValidProducer({ ...sampleProducer(), model_version: '1.0' })).toThrow(
      /model_version is set but producer\.model is null/,
    );
  });

  it('rejects invalid source/deployment revisions (empty strings are not "unknown")', () => {
    expect(() => createProvenanceRecord({ producer: sampleProducer(), source_revision: '', source_availability: 'SUCCESS' })).toThrow(
      /source_revision must be null or a non-empty string/,
    );
    expect(() =>
      createProvenanceRecord({ producer: sampleProducer(), deployment_revision: '', source_availability: 'SUCCESS' }),
    ).toThrow(/deployment_revision must be null or a non-empty string/);
  });

  it('rejects invalid truth states on source availability (the 6 states are frozen)', () => {
    expect(() =>
      createProvenanceRecord({ producer: sampleProducer(), source_availability: 'MAYBE' as never }),
    ).toThrow(/6 distinct evidence truth states/);
    expect(() =>
      createProvenanceRecord({ producer: sampleProducer(), source_availability: 'OK' as never }),
    ).toThrow(/6 distinct evidence truth states/);
  });

  it('rejects invalid time windows', () => {
    expect(() => assertValidTimeWindow({ start: '2025-01-02T00:00:00.000Z', end: '2025-01-01T00:00:00.000Z' })).toThrow(
      /start must not be after end/,
    );
    expect(() => assertValidTimeWindow({ start: 'not-a-date', end: '2025-01-01T00:00:00.000Z' })).toThrow(/RFC3339/);
    expect(() => assertValidTimeWindow({ start: '2025-01-01' })).toThrow(/exact fields/);
  });

  it('rejects non-JSON context values', () => {
    expect(() =>
      createProvenanceRecord({
        producer: sampleProducer(),
        context: { bad: undefined } as never,
        source_availability: 'SUCCESS',
      }),
    ).toThrow(/canonical serialization failed/);
  });

  it('rejects malformed chain hops (ref_kind inconsistent with ref form)', () => {
    expect(() =>
      createProvenanceRecord({
        producer: sampleProducer(),
        chain: [{ ref: BASE_SHA, ref_kind: 'ARTIFACT' as never, note: null }],
        source_availability: 'SUCCESS',
      }),
    ).toThrow(/ref_kind ARTIFACT is inconsistent with ref form/);
    expect(() =>
      createProvenanceRecord({
        producer: sampleProducer(),
        chain: [{ ref: IMPLEMENTATION_MODEL_ANCHOR_ID, ref_kind: 'EXTERNAL_REVISION' as never, note: null }],
        source_availability: 'SUCCESS',
      }),
    ).toThrow(/ref_kind EXTERNAL_REVISION is inconsistent/);
    expect(() =>
      createProvenanceRecord({
        producer: sampleProducer(),
        chain: [{ ref: '', ref_kind: 'EXTERNAL_REVISION' as never, note: null }],
        source_availability: 'SUCCESS',
      }),
    ).toThrow(/ref must be a non-empty string/);
    expect(() =>
      createProvenanceRecord({
        producer: sampleProducer(),
        chain: [{ ref: 'x', ref_kind: 'EXTERNAL_REVISION' as never, note: '' }],
        source_availability: 'SUCCESS',
      }),
    ).toThrow(/note must be null or a non-empty string/);
  });

  it('rejects builder misuse: sos:// id passed as external revision and vice versa', () => {
    expect(() => new ProvenanceChainBuilder().externalRevision(IMPLEMENTATION_MODEL_ANCHOR_ID)).toThrow(
      /use \.artifact\(\) for sos:\/\/ ids/,
    );
    expect(() => new ProvenanceChainBuilder().artifact(BASE_SHA)).toThrow(/well-formed artifact id/);
  });

  it('rejects records whose llm_output mark is inconsistent with the producer (LLM involvement cannot be hidden or faked)', () => {
    const honest = createProvenanceRecord({ producer: sampleLlmProducer(), source_availability: 'SUCCESS' });
    const hidden = { ...structuredClone(honest), llm_output: false };
    expect(() => assertValidProvenanceRecord(hidden)).toThrow(/llm_output \(false\) is inconsistent/);
    const faked = createProvenanceRecord({ producer: sampleProducer(), source_availability: 'SUCCESS' });
    const lied = { ...structuredClone(faked), llm_output: true };
    expect(() => assertValidProvenanceRecord(lied)).toThrow(/llm_output \(true\) is inconsistent/);
    expect(validateProvenanceRecord(hidden)).toBe(false);
    expect(validateProvenanceRecord(lied)).toBe(false);
  });

  it('rejects records with the wrong id kind segment or extra/missing fields', () => {
    const record = createProvenanceRecord({ producer: sampleProducer(), source_availability: 'SUCCESS' });
    expect(() => assertValidProvenanceRecord({ ...structuredClone(record), id: 'sos://Evidence/00000000000000000000000000000000' })).toThrow(
      /declares kind Evidence, expected ProvenanceRecord/,
    );
    expect(() => assertValidProvenanceRecord({ ...structuredClone(record), extra: 1 })).toThrow(/exact field set/);
    const { id, ...withoutId } = structuredClone(record);
    expect(() => assertValidProvenanceRecord(withoutId)).toThrow(/exact field set/);
    expect(id).toBeDefined();
  });

  it('store rejects different content under the same deterministic id (collision)', () => {
    const record = createProvenanceRecord({
      producer: sampleProducer(),
      source_revision: BASE_SHA,
      source_availability: 'SUCCESS',
    });
    const store = new ProvenanceStore();
    store.put(record);
    const mutated = { ...structuredClone(record), source_availability: 'FAILURE' as const };
    expect(() => store.put(mutated)).toThrow(/collision/);
  });

  it('verifyProvenanceChain reports malformed hops as UNKNOWN (not VERIFIED, not truncated)', () => {
    const verification = verifyProvenanceChain({
      chain: [{ ref: 'ok-token', ref_kind: 'EXTERNAL_REVISION', note: null }, { nope: true } as never],
    });
    expect(verification.status).toBe('UNKNOWN');
    expect(verification.hops).toBe(2);
    expect(verification.unresolved).toHaveLength(1);
    expect(verification.unresolved[0]!.index).toBe(1);
  });
});
