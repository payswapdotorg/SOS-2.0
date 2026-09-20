import { describe, expect, it } from 'vitest';
import { isArtifactId, parseArtifactId } from '@sos-2/semantic-spine';
import {
  assertClaimSupportedByEvidence,
  assertValidCausalHypothesis,
  causalHypothesisArtifactId,
  causalHypothesisCreationAddress,
  createCausalHypothesis,
  hypothesisEvidenceSupport,
  isLlmHypothesis,
  isNonAuthoritativeHypothesis,
  validateCausalHypothesis,
} from '../src/index.js';
import {
  CONSTITUTION_ANCHOR_ID,
  PROVENANCE,
  T0,
  T1,
  calibratedConfidence,
  llmProducer,
  sampleHypothesisContent,
} from './helpers.js';

describe('causal hypothesis creation', () => {
  it('mints a spine-valid CausalHypothesis artifact with a deterministic id', () => {
    const artifact = createCausalHypothesis({
      content: sampleHypothesisContent(),
      provenance: PROVENANCE,
      created_at: T0,
      authority_ref: CONSTITUTION_ANCHOR_ID,
    });
    expect(validateCausalHypothesis(artifact)).toBe(true);
    expect(artifact.envelope.kind).toBe('CausalHypothesis');
    expect(isArtifactId(artifact.envelope.id)).toBe(true);
    expect(parseArtifactId(artifact.envelope.id).kind).toBe('CausalHypothesis');
    expect(artifact.envelope.status).toBe('DRAFT');
    expect(artifact.envelope.version).toBe(1);
    expect(artifact.envelope.provenance).toEqual(PROVENANCE);
  });

  it('identical creation input reproduces the identical id (determinism)', () => {
    const input = {
      content: sampleHypothesisContent(),
      provenance: PROVENANCE,
      created_at: T0,
    };
    const a = createCausalHypothesis(input);
    const b = createCausalHypothesis(JSON.parse(JSON.stringify(input)) as typeof input);
    expect(a).toEqual(b);
    expect(causalHypothesisArtifactId(input)).toBe(a.envelope.id);
    expect(causalHypothesisCreationAddress(input).content).toEqual(a.content);
  });

  it('different content produces different ids (no silent collision)', () => {
    const base = { provenance: PROVENANCE, created_at: T0 };
    const a = createCausalHypothesis({ ...base, content: sampleHypothesisContent() });
    const b = createCausalHypothesis({
      ...base,
      content: sampleHypothesisContent({ observational: 2 }),
    });
    expect(a.envelope.id).not.toBe(b.envelope.id);
  });

  it('creation address round-trips through canonical serialization', () => {
    const input = { content: sampleHypothesisContent(), provenance: PROVENANCE, created_at: T0 };
    const address = causalHypothesisCreationAddress(input);
    const roundTripped = JSON.parse(JSON.stringify(address));
    expect(roundTripped).toEqual(address);
  });
});

describe('the claim gate (spec/architecture.md §18)', () => {
  it('a CAUSAL claim with interventional SUCCESS evidence is supported', () => {
    const content = sampleHypothesisContent({ claimStrength: 'CAUSAL' });
    const support = hypothesisEvidenceSupport(content);
    expect(support.supported).toBe(true);
    expect(support.interventionalSupport).toBe(1);
    expect(support.observationalRecords).toBe(1);
    expect(() => assertClaimSupportedByEvidence('CAUSAL', content.observational_evidence, content.interventional_evidence)).not.toThrow();
  });

  it('a CORRELATIONAL claim is permitted with observational evidence only', () => {
    const artifact = createCausalHypothesis({
      content: sampleHypothesisContent({ claimStrength: 'CORRELATIONAL', interventionalSuccess: 0 }),
      provenance: PROVENANCE,
      created_at: T0,
    });
    expect(artifact.content.claim_strength).toBe('CORRELATIONAL');
    expect(hypothesisEvidenceSupport(artifact.content).supported).toBe(false);
  });

  it('a CORRELATIONAL claim is also permitted WITH interventional evidence (claiming less is safe)', () => {
    const artifact = createCausalHypothesis({
      content: sampleHypothesisContent({ claimStrength: 'CORRELATIONAL' }),
      provenance: PROVENANCE,
      created_at: T0,
    });
    expect(hypothesisEvidenceSupport(artifact.content).supported).toBe(true);
  });

  it('interventional non-SUCCESS evidence does not support a causal claim', () => {
    const content = sampleHypothesisContent({
      claimStrength: 'CORRELATIONAL',
      interventionalSuccess: 0,
      interventionalOther: 3,
    });
    const support = hypothesisEvidenceSupport(content);
    expect(support.supported).toBe(false);
    expect(support.interventionalSupport).toBe(0);
  });
});

describe('hypothesis validation and marks', () => {
  it('assertValidCausalHypothesis re-checks the claim gate on hand-crafted artifacts', () => {
    const artifact = createCausalHypothesis({
      content: sampleHypothesisContent(),
      provenance: PROVENANCE,
      created_at: T0,
    });
    expect(() => assertValidCausalHypothesis(artifact)).not.toThrow();
    const forged = {
      envelope: artifact.envelope,
      content: { ...artifact.content, claim_strength: 'CAUSAL' as const, interventional_evidence: [], observational_evidence: [...artifact.content.observational_evidence, ...artifact.content.interventional_evidence.map((ref) => ({ ...ref, evidence_class: 'OBSERVATIONAL' as const }))] },
    };
    expect(() => assertValidCausalHypothesis(forged)).toThrow(/causal claim rejected/);
  });

  it('LLM-drafted hypotheses are marked and non-authoritative', () => {
    const artifact = createCausalHypothesis({
      content: sampleHypothesisContent({ producer: llmProducer() }),
      provenance: PROVENANCE,
      created_at: T0,
    });
    expect(isLlmHypothesis(artifact)).toBe(true);
    expect(isNonAuthoritativeHypothesis(artifact)).toBe(true);
  });

  it('tool-drafted hypotheses are not LLM-marked', () => {
    const artifact = createCausalHypothesis({
      content: sampleHypothesisContent(),
      provenance: PROVENANCE,
      created_at: T0,
    });
    expect(isLlmHypothesis(artifact)).toBe(false);
    expect(isNonAuthoritativeHypothesis(artifact)).toBe(false);
  });

  it('calibrated uncertainty is permitted for tool producers with a calibration ref', () => {
    const artifact = createCausalHypothesis({
      content: sampleHypothesisContent({ uncertainty: calibratedConfidence(0.75) }),
      provenance: PROVENANCE,
      created_at: T1,
    });
    expect(artifact.content.uncertainty).toEqual(calibratedConfidence(0.75));
    expect(() => assertValidCausalHypothesis(artifact)).not.toThrow();
  });

  it('validation survives a JSON round trip bit-exactly', () => {
    const artifact = createCausalHypothesis({
      content: sampleHypothesisContent(),
      provenance: PROVENANCE,
      created_at: T0,
    });
    const roundTripped = JSON.parse(JSON.stringify(artifact));
    expect(validateCausalHypothesis(roundTripped)).toBe(true);
    expect(roundTripped).toEqual(artifact);
  });
});
