import { describe, expect, it } from 'vitest';
import {
  assertValidEvidenceRecord,
  createCalibratedConfidence,
  createEvidence,
  createQualitativeConfidence,
  evaluateFreshness,
  flagsToEvidenceClass,
  summarizeAvailability,
  validateConfidence,
  validateEvidenceRecord,
} from '../src/index.js';
import type { CreateEvidenceInput, EvidenceRecordW3 } from '../src/index.js';
import {
  CALIBRATION,
  SYSTEM_STATE_R1,
  calibratedConfidence,
  llmProducer,
  sampleEvidenceInput,
  toolProducer,
} from './helpers.js';

const T_NOW = '2025-01-01T12:00:00.000Z';

describe('evidence creation input validation (negative)', () => {
  it('rejects non-object inputs', () => {
    expect(() => createEvidence(null as never)).toThrow(/must be an object/);
    expect(() => createEvidence('x' as never)).toThrow(/must be an object/);
  });

  it('rejects empty kind, method and provenance-less records', () => {
    expect(() => createEvidence({ ...sampleEvidenceInput(), kind: '' })).toThrow(/kind/);
    expect(() => createEvidence({ ...sampleEvidenceInput(), method: '' })).toThrow(/method/);
    expect(() => createEvidence({ ...sampleEvidenceInput(), provenance: [] })).toThrow(/provenance/);
    expect(() => createEvidence({ ...sampleEvidenceInput(), provenance: ['ok', ''] })).toThrow(/provenance/);
    expect(() => createEvidence({ ...sampleEvidenceInput(), provenance: 'x' as never })).toThrow(/provenance/);
  });

  it('rejects subject_refs that are not spine artifact ids (semantic mapping is mandatory)', () => {
    expect(() => createEvidence({ ...sampleEvidenceInput(), subject_ref: 'otel:service:checkout' })).toThrow(
      /subject_ref must be a well-formed spine artifact id/,
    );
    expect(() => createEvidence({ ...sampleEvidenceInput(), subject_ref: '' })).toThrow(/subject_ref/);
    expect(() => createEvidence({ ...sampleEvidenceInput(), subject_ref: 'not-a-sos-id' })).toThrow(/subject_ref/);
  });

  it('rejects truth states outside the frozen 6', () => {
    expect(() => createEvidence({ ...sampleEvidenceInput(), availability: 'MAYBE' as never })).toThrow(
      /6 distinct evidence truth states/,
    );
    expect(() => createEvidence({ ...sampleEvidenceInput(), availability: 'OK' as never })).toThrow(
      /6 distinct evidence truth states/,
    );
    expect(() => createEvidence({ ...sampleEvidenceInput(), availability: 'unavailable' as never })).toThrow(
      /6 distinct evidence truth states/,
    );
  });

  it('rejects invalid revisions and windows', () => {
    expect(() => createEvidence({ ...sampleEvidenceInput(), source_revision: '' })).toThrow(/source_revision/);
    expect(() => createEvidence({ ...sampleEvidenceInput(), deployment_revision: '' })).toThrow(/deployment_revision/);
    expect(() => createEvidence({ ...sampleEvidenceInput(), subject_revision: '' })).toThrow(/subject_revision/);
    expect(() =>
      createEvidence({ ...sampleEvidenceInput(), window: { start: '2025-01-02T00:00:00.000Z', end: '2025-01-01T00:00:00.000Z' } }),
    ).toThrow(/window is invalid/);
    expect(() => createEvidence({ ...sampleEvidenceInput(), window: { start: 'nope', end: '2025-01-01T00:00:00.000Z' } as never })).toThrow(
      /window is invalid/,
    );
  });

  it('rejects invalid producers', () => {
    expect(() => createEvidence({ ...sampleEvidenceInput(), producer: { ...toolProducer(), tool: '' } })).toThrow(
      /producer is invalid/,
    );
    expect(() => createEvidence({ ...sampleEvidenceInput(), producer: { ...toolProducer(), model_version: '9' } })).toThrow(
      /producer is invalid/,
    );
  });

  it('rejects invalid evidence classes', () => {
    expect(() => createEvidence({ ...sampleEvidenceInput(), evidence_class: 'BOTH' as never })).toThrow(
      /OBSERVATIONAL or INTERVENTIONAL/,
    );
  });
});

describe('observation/intervention conflation (negative)', () => {
  it('flagsToEvidenceClass rejects both-true and neither-true', () => {
    expect(() => flagsToEvidenceClass(true, true)).toThrow(/conflation/);
    expect(() => flagsToEvidenceClass(false, false)).toThrow(/undeclared/);
  });

  it('record validation rejects hand-crafted conflation and inconsistent flags', () => {
    const record = createEvidence(sampleEvidenceInput());
    // Both true:
    expect(() =>
      assertValidEvidenceRecord({ ...record, intervention: true }),
    ).toThrow(/conflation|exactly one/i);
    // Neither true:
    expect(() =>
      assertValidEvidenceRecord({ ...record, observational: false }),
    ).toThrow(/undeclared|exactly one/i);
    // Flags disagreeing with the declared class:
    expect(() =>
      assertValidEvidenceRecord({ ...record, evidence_class: 'INTERVENTIONAL' }),
    ).toThrow(/inconsistent with the flags/);
  });
});

describe('confidence discipline (negative)', () => {
  it('rejects calibrated confidence without a well-formed calibration artifact ref', () => {
    expect(() => createCalibratedConfidence(0.9, 'calibration:v1')).toThrow(/calibration artifact id/);
    expect(() => createCalibratedConfidence(0.9, '')).toThrow(/calibration artifact id/);
    expect(() => createCalibratedConfidence(0.9, SYSTEM_STATE_R1)).not.toThrow();
  });

  it('rejects calibrated confidence values outside [0, 1] and non-finite values', () => {
    expect(() => createCalibratedConfidence(1.5, CALIBRATION)).toThrow(/\[0, 1\]/);
    expect(() => createCalibratedConfidence(-0.1, CALIBRATION)).toThrow(/\[0, 1\]/);
    expect(() => createCalibratedConfidence(Number.NaN, CALIBRATION)).toThrow(/\[0, 1\]/);
    expect(() => createCalibratedConfidence(Number.POSITIVE_INFINITY, CALIBRATION)).toThrow(/\[0, 1\]/);
  });

  it('rejects invalid qualitative marks', () => {
    expect(() => createQualitativeConfidence('PRETTY_SURE' as never)).toThrow(/uncertainty class/);
    expect(validateConfidence({ kind: 'QUALITATIVE' })).toBe(false);
    expect(validateConfidence({ kind: 'CALIBRATED', value: 0.5 })).toBe(false);
    expect(validateConfidence({ kind: 'CALIBRATED', value: 0.5, calibration_ref: 'nope' })).toBe(false);
    expect(validateConfidence(null)).toBe(false);
  });

  it('rejects LLM-produced evidence carrying calibrated confidence (LLM self-report is never calibrated truth)', () => {
    expect(() =>
      createEvidence({ ...sampleEvidenceInput(), producer: llmProducer(), confidence: calibratedConfidence() }),
    ).toThrow(/never calibrated truth/);
    // Qualitative confidence for LLM output is fine:
    expect(() =>
      createEvidence({ ...sampleEvidenceInput(), producer: llmProducer() }),
    ).not.toThrow();
  });

  it('record validation rejects calibrated confidence on llm_output records', () => {
    const llmRecord = createEvidence({ ...sampleEvidenceInput(), producer: llmProducer() });
    const forged: EvidenceRecordW3 = {
      ...llmRecord,
      confidence: { kind: 'CALIBRATED', value: 0.99, calibration_ref: CALIBRATION },
    };
    expect(() => assertValidEvidenceRecord(forged)).toThrow(/never calibrated truth/);
  });
});

describe('record validation (negative)', () => {
  it('rejects wrong field sets and non-object values', () => {
    expect(() => assertValidEvidenceRecord(null)).toThrow(/must be an object/);
    expect(() => assertValidEvidenceRecord([])).toThrow(/must be an object/);
    const record = createEvidence(sampleEvidenceInput());
    expect(() => assertValidEvidenceRecord({ ...record, extra: 1 })).toThrow(/exact W3 field set/);
    const { method, ...withoutMethod } = record;
    expect(method).toBeDefined();
    expect(() => assertValidEvidenceRecord(withoutMethod)).toThrow(/exact W3 field set/);
  });

  it('rejects ids that are not Evidence-kind spine ids', () => {
    const record = createEvidence(sampleEvidenceInput());
    expect(() => assertValidEvidenceRecord({ ...record, id: 'sos://Mission/' + 'a'.repeat(32) })).toThrow(
      /declares kind Mission, expected Evidence/,
    );
    expect(() => assertValidEvidenceRecord({ ...record, id: 'not-an-id' })).toThrow(/well-formed artifact id/);
  });

  it('rejects normative-contract violations (contracts layer runs first)', () => {
    const record = createEvidence(sampleEvidenceInput());
    expect(() => assertValidEvidenceRecord({ ...record, provenance: [1, 2] as never })).toThrow(
      /normative EvidenceRecord contract/,
    );
    expect(() => assertValidEvidenceRecord({ ...record, availability: 'MAYBE' as never })).toThrow(
      /normative EvidenceRecord contract/,
    );
  });

  it('rejects llm_output inconsistencies (LLM involvement can never be hidden or claimed falsely)', () => {
    const record = createEvidence(sampleEvidenceInput());
    expect(() => assertValidEvidenceRecord({ ...record, llm_output: true })).toThrow(/inconsistent with the producer/);
    const llmRecord = createEvidence({ ...sampleEvidenceInput(), producer: llmProducer() });
    expect(() => assertValidEvidenceRecord({ ...llmRecord, llm_output: false })).toThrow(/inconsistent with the producer/);
  });

  it('predicate form returns false instead of throwing', () => {
    expect(validateEvidenceRecord({})).toBe(false);
    expect(validateEvidenceRecord(null)).toBe(false);
  });

  it('summarizeAvailability rejects non-arrays and invalid records', () => {
    expect(() => summarizeAvailability(null as never)).toThrow(/requires an array/);
    expect(() => summarizeAvailability([{} as never])).toThrow();
  });
});

describe('freshness input validation (negative)', () => {
  it('rejects non-RFC3339 now instants and invalid system state revisions', () => {
    const record = createEvidence(sampleEvidenceInput());
    expect(() => evaluateFreshness(record, { now: 'nope' })).toThrow(/RFC3339/);
    expect(() => evaluateFreshness(record, { now: T_NOW, systemStateRevision: '' })).toThrow(/systemStateRevision/);
    expect(() => evaluateFreshness(record, null as never)).toThrow(/must be an object/);
  });

  it('rejects invalid records loudly (garbage in, loud failure out)', () => {
    expect(() => evaluateFreshness({} as never, { now: T_NOW })).toThrow();
  });
});

describe('inputs are never mutated (negative)', () => {
  it('createEvidence does not mutate its input', () => {
    const input: CreateEvidenceInput = sampleEvidenceInput();
    const snapshot = JSON.parse(JSON.stringify(input)) as CreateEvidenceInput;
    createEvidence(input);
    expect(input).toEqual(snapshot);
  });
});
