import { describe, expect, it } from 'vitest';
import {
  assertValidEvidenceRecord,
  canonicalEvidenceText,
  createCalibratedConfidence,
  createEvidence,
  createQualitativeConfidence,
  evidenceClassFlags,
  evidenceRecordId,
  flagsToEvidenceClass,
  isNonAuthoritativeEvidence,
  isObservationalEvidence,
  isInterventionalEvidence,
  summarizeAvailability,
  supportsStrongCausalClaim,
  validateEvidenceRecord,
} from '../src/index.js';
import type { EvidenceRecordW3 } from '../src/index.js';
import { isEvidenceRecord, assertTruthStateIs } from '@sos-2/semantic-spine';
import {
  CALIBRATION,
  GOLDEN_EVIDENCE,
  SYSTEM_STATE_R1,
  calibratedConfidence,
  llmProducer,
  sampleEvidenceInput,
  testRunnerProducer,
  toolProducer,
  W0,
  W1,
} from './helpers.js';

describe('evidence creation (positive)', () => {
  it('mints records that satisfy the NORMATIVE EvidenceRecord contract (contracts layer)', () => {
    const record = createEvidence(sampleEvidenceInput());
    expect(isEvidenceRecord(record)).toBe(true);
    expect(validateEvidenceRecord(record)).toBe(true);
  });

  it('mints well-formed deterministic spine ids (sos://Evidence/<32 hex>)', () => {
    const record = createEvidence(sampleEvidenceInput());
    expect(record.id).toMatch(/^sos:\/\/Evidence\/[0-9a-f]{32}$/);
    expect(record.id).toBe(evidenceRecordId(sampleEvidenceInput()));
    expect(createEvidence(sampleEvidenceInput()).id).toBe(record.id);
    const other = createEvidence({ ...sampleEvidenceInput(), availability: 'FAILURE' });
    expect(other.id).not.toBe(record.id);
  });

  it('reproduces the golden fixture bit-exactly (content addressing)', () => {
    const record = createEvidence(sampleEvidenceInput());
    expect(record).toEqual(GOLDEN_EVIDENCE);
    expect(record.id).toBe('sos://Evidence/e7f3c74939a13049bbcf014d8e1b7ab2');
  });

  it('preserves exact source and deployment revisions (null preserved, never defaulted)', () => {
    const record = createEvidence({ ...sampleEvidenceInput(), source_revision: null, deployment_revision: null });
    expect(record.source_revision).toBeNull();
    expect(record.deployment_revision).toBeNull();
    const exact = createEvidence(sampleEvidenceInput());
    expect(exact.source_revision).toBe('git:219cb9c8e329b0435f2deea37ec2d5003b264931');
    expect(exact.deployment_revision).toBe('oci:sha256:' + 'b'.repeat(64));
  });

  it('carries the exact time window and subject revision', () => {
    const record = createEvidence(sampleEvidenceInput());
    expect(record.window).toEqual(W0);
    expect(record.subject_revision).toBe('r1');
  });

  it('records the explicit truth-state assignment method provenance', () => {
    const record = createEvidence({ ...sampleEvidenceInput(), method: 'test-run:exit-code' });
    expect(record.method).toBe('test-run:exit-code');
    expect(record.provenance).toEqual(['observation:sha256:' + 'a'.repeat(64)]);
  });
});

describe('observation/intervention distinction (positive)', () => {
  it('derives the normative flags from the declared class — exactly one is true', () => {
    const observational = createEvidence(sampleEvidenceInput());
    expect(observational.observational).toBe(true);
    expect(observational.intervention).toBe(false);
    expect(isObservationalEvidence(observational)).toBe(true);
    expect(isInterventionalEvidence(observational)).toBe(false);

    const interventional = createEvidence({
      ...sampleEvidenceInput(),
      evidence_class: 'INTERVENTIONAL',
      kind: 'experiment',
      method: 'experiment:ab-test-result',
    });
    expect(interventional.observational).toBe(false);
    expect(interventional.intervention).toBe(true);
    expect(isInterventionalEvidence(interventional)).toBe(true);
  });

  it('evidenceClassFlags and flagsToEvidenceClass round-trip', () => {
    expect(evidenceClassFlags('OBSERVATIONAL')).toEqual({ observational: true, intervention: false });
    expect(evidenceClassFlags('INTERVENTIONAL')).toEqual({ observational: false, intervention: true });
    expect(flagsToEvidenceClass(true, false)).toBe('OBSERVATIONAL');
    expect(flagsToEvidenceClass(false, true)).toBe('INTERVENTIONAL');
  });

  it('strong causal claims require intervention evidence (§18)', () => {
    const observational = createEvidence(sampleEvidenceInput());
    // Any number of observational records: correlation only.
    const onlyObservational = supportsStrongCausalClaim([observational, observational, observational]);
    expect(onlyObservational.supported).toBe(false);
    expect(onlyObservational.reason).toMatch(/intervention/);

    const interventionalSuccess = createEvidence({
      ...sampleEvidenceInput(),
      evidence_class: 'INTERVENTIONAL',
      kind: 'experiment',
      method: 'experiment:ab-test-result',
    });
    expect(supportsStrongCausalClaim([observational, interventionalSuccess]).supported).toBe(true);

    // Interventional evidence in a non-SUCCESS state does not support the claim.
    const interventionalFailure = createEvidence({
      ...sampleEvidenceInput(),
      evidence_class: 'INTERVENTIONAL',
      kind: 'experiment',
      method: 'experiment:ab-test-result',
      availability: 'FAILURE',
    });
    expect(supportsStrongCausalClaim([interventionalFailure]).supported).toBe(false);
    expect(supportsStrongCausalClaim([]).supported).toBe(false);
  });
});

describe('confidence and calibration discipline (positive)', () => {
  it('defaults to qualitative UNQUANTIFIED confidence', () => {
    const record = createEvidence({ ...sampleEvidenceInput(), confidence: undefined });
    expect(record.confidence).toEqual({ kind: 'QUALITATIVE', uncertainty_class: 'UNQUANTIFIED' });
  });

  it('accepts calibrated numeric confidence ONLY with a calibration artifact ref', () => {
    const record = createEvidence({ ...sampleEvidenceInput(), confidence: calibratedConfidence(0.82) });
    expect(record.confidence).toEqual({ kind: 'CALIBRATED', value: 0.82, calibration_ref: CALIBRATION });
    expect(createCalibratedConfidence(0, CALIBRATION).value).toBe(0);
    expect(createCalibratedConfidence(1, CALIBRATION).value).toBe(1);
    expect(createQualitativeConfidence('STRONG')).toEqual({ kind: 'QUALITATIVE', uncertainty_class: 'STRONG' });
  });

  it('marks LLM-produced evidence as non-authoritative (§18) with qualitative confidence', () => {
    const record = createEvidence({ ...sampleEvidenceInput(), producer: llmProducer() });
    expect(record.llm_output).toBe(true);
    expect(isNonAuthoritativeEvidence(record)).toBe(true);
    expect(record.confidence.kind).toBe('QUALITATIVE');
    expect(record.producer.model).toBe('glm-4.5');

    const toolRecord = createEvidence({ ...sampleEvidenceInput(), producer: toolProducer() });
    expect(toolRecord.llm_output).toBe(false);
    expect(isNonAuthoritativeEvidence(toolRecord)).toBe(false);
  });
});

describe('validation and serialization (positive)', () => {
  it('validateEvidenceRecord accepts canonical round-tripped records', () => {
    const record = createEvidence(sampleEvidenceInput());
    const round = JSON.parse(canonicalEvidenceText(record)) as EvidenceRecordW3;
    expect(validateEvidenceRecord(round)).toBe(true);
    expect(assertValidEvidenceRecord(round)).toBeUndefined();
  });

  it('the golden fixture validates (durable contract fixture discipline)', () => {
    expect(validateEvidenceRecord(GOLDEN_EVIDENCE)).toBe(true);
  });
});

describe('availability summary (positive — the 6 states stay distinct)', () => {
  it('counts all 6 truth states, zero-filled, and never folds UNAVAILABLE', () => {
    const states = ['SUCCESS', 'FAILURE', 'UNKNOWN', 'UNAVAILABLE', 'UNSUPPORTED', 'PARTIAL'] as const;
    const records = states.map((availability) =>
      createEvidence({ ...sampleEvidenceInput(), availability }),
    );
    const summary = summarizeAvailability(records);
    expect(summary).toEqual({
      SUCCESS: 1,
      FAILURE: 1,
      UNKNOWN: 1,
      UNAVAILABLE: 1,
      UNSUPPORTED: 1,
      PARTIAL: 1,
    });
    // The locked invariant, in words: the UNAVAILABLE record is counted in the
    // UNAVAILABLE bucket — never folded into SUCCESS or FAILURE (both of which
    // hold exactly their own single record above). Distinctness of the STATES
    // themselves is pinned per record with the spine's own assert helper:
    for (const [index, state] of states.entries()) {
      assertTruthStateIs(state, records[index]!.availability);
    }
  });

  it('summarizeAvailability is total over the empty set', () => {
    expect(summarizeAvailability([])).toEqual({
      SUCCESS: 0,
      FAILURE: 0,
      UNKNOWN: 0,
      UNAVAILABLE: 0,
      UNSUPPORTED: 0,
      PARTIAL: 0,
    });
  });
});

describe('method and producer provenance (positive)', () => {
  it('carries the producing tool, command and environment', () => {
    const record = createEvidence({ ...sampleEvidenceInput(), producer: testRunnerProducer() });
    expect(record.producer.tool).toBe('vitest');
    expect(record.producer.command).toBe('pnpm -r test');
    expect(record.producer.environment).toBe('ci:local');
  });

  it('window and subject_revision may both be null (unbound — freshness says so)', () => {
    const record = createEvidence({ ...sampleEvidenceInput(), window: null, subject_revision: null });
    expect(record.window).toBeNull();
    expect(record.subject_revision).toBeNull();
    expect(validateEvidenceRecord(record)).toBe(true);
  });
});
