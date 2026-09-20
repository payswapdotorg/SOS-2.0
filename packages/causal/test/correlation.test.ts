import { describe, expect, it } from 'vitest';
import { isArtifactId, parseArtifactId } from '@sos-2/semantic-spine';
import {
  assertValidCorrelationRecord,
  correlationRecordArtifactId,
  createCorrelationRecord,
  hypothesisFromCorrelation,
  isCorrelationRecordRef,
  isLlmCorrelation,
  validateCorrelationRecord,
  validateCorrelationRecordContent,
} from '../src/index.js';
import {
  PROVENANCE,
  T0,
  T1,
  llmProducer,
  sampleCorrelationContent,
  sampleHypothesisContent,
} from './helpers.js';

describe('correlation record creation', () => {
  it('mints a spine-valid CorrelationRecord artifact (registered extension kind)', () => {
    const record = createCorrelationRecord({
      content: sampleCorrelationContent(),
      provenance: PROVENANCE,
      created_at: T0,
    });
    expect(validateCorrelationRecord(record)).toBe(true);
    expect(record.envelope.kind).toBe('CorrelationRecord');
    expect(isArtifactId(record.envelope.id)).toBe(true);
    expect(parseArtifactId(record.envelope.id).kind).toBe('CorrelationRecord');
    expect(isCorrelationRecordRef(record.envelope.id)).toBe(true);
  });

  it('identical input reproduces the identical id (determinism)', () => {
    const input = { content: sampleCorrelationContent(), provenance: PROVENANCE, created_at: T0 };
    const a = createCorrelationRecord(input);
    const b = createCorrelationRecord(JSON.parse(JSON.stringify(input)) as typeof input);
    expect(a).toEqual(b);
    expect(correlationRecordArtifactId(input)).toBe(a.envelope.id);
  });

  it('correlation content survives a JSON round trip bit-exactly', () => {
    const content = sampleCorrelationContent();
    const roundTripped = JSON.parse(JSON.stringify(content));
    expect(validateCorrelationRecordContent(roundTripped)).toBe(true);
    expect(roundTripped).toEqual(content);
  });

  it('LLM-produced correlation records are marked', () => {
    const record = createCorrelationRecord({
      content: { ...sampleCorrelationContent(), producer: llmProducer() },
      provenance: PROVENANCE,
      created_at: T0,
    });
    expect(isLlmCorrelation(record)).toBe(true);
  });

  it('the correlation record content structurally cannot express a causal claim', () => {
    const content = sampleCorrelationContent();
    const keys = Object.keys(content);
    expect(keys).not.toContain('claim_strength');
    expect(keys).not.toContain('mechanism');
    expect(keys).not.toContain('graph');
  });
});

describe('the explicit, evidence-gated promotion (never silent)', () => {
  it('promotes a correlation to a CAUSAL hypothesis when interventional SUCCESS evidence is supplied', () => {
    const record = createCorrelationRecord({
      content: sampleCorrelationContent(),
      provenance: PROVENANCE,
      created_at: T0,
    });
    const { hypothesis, derivation_link } = hypothesisFromCorrelation(record, {
      content: sampleHypothesisContent({ claimStrength: 'CAUSAL' }),
      provenance: PROVENANCE,
      created_at: T1,
    });
    expect(hypothesis.content.claim_strength).toBe('CAUSAL');
    expect(hypothesis.content.correlation_origin).toBe(record.envelope.id);
    expect(derivation_link.type).toBe('DERIVED_FROM');
    expect(derivation_link.source).toBe(hypothesis.envelope.id);
    expect(derivation_link.target).toBe(record.envelope.id);
    expect(() => assertValidCorrelationRecord(record)).not.toThrow();
  });

  it('rejects promotion without interventional SUCCESS evidence (correlation is never silently promoted)', () => {
    const record = createCorrelationRecord({
      content: sampleCorrelationContent(),
      provenance: PROVENANCE,
      created_at: T0,
    });
    expect(() =>
      hypothesisFromCorrelation(record, {
        content: sampleHypothesisContent({ claimStrength: 'CAUSAL', interventionalSuccess: 0, observational: 5 }),
        provenance: PROVENANCE,
        created_at: T1,
      }),
    ).toThrow(/causal claim rejected/);
  });

  it('promotion to a CORRELATIONAL hypothesis is allowed with observational evidence only', () => {
    const record = createCorrelationRecord({
      content: sampleCorrelationContent(),
      provenance: PROVENANCE,
      created_at: T0,
    });
    const { hypothesis } = hypothesisFromCorrelation(record, {
      content: sampleHypothesisContent({ claimStrength: 'CORRELATIONAL', interventionalSuccess: 0 }),
      provenance: PROVENANCE,
      created_at: T1,
    });
    expect(hypothesis.content.claim_strength).toBe('CORRELATIONAL');
    expect(hypothesis.content.correlation_origin).toBe(record.envelope.id);
  });
});
