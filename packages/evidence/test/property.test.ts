import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  createEvidence,
  evaluateFreshness,
  ingestObservation,
  isEvidenceClass,
  summarizeAvailability,
  validateEvidenceRecord,
} from '../src/index.js';
import type { CreateEvidenceInput, EvidenceRecordW3 } from '../src/index.js';
import { isEvidenceRecord, isEvidenceTruthState } from '@sos-2/semantic-spine';
import type { EvidenceTruthState } from '@sos-2/semantic-spine';
import type { RawObservation } from '@sos-2/telemetry';
import { SYSTEM_STATE_R1, T0, T1, T2, T3, toolProducer } from './helpers.js';

const TRUTH_STATES = ['SUCCESS', 'FAILURE', 'UNKNOWN', 'UNAVAILABLE', 'UNSUPPORTED', 'PARTIAL'] as const;
const NOW_INSTANTS = [T0, T1, T2, T3] as const;

const fcAvailability = fc.constantFrom(...TRUTH_STATES);
const fcEvidenceClass = fc.constantFrom<'OBSERVATIONAL' | 'INTERVENTIONAL'>('OBSERVATIONAL', 'INTERVENTIONAL');
const fcWindow = fc.constantFrom(
  { start: T0, end: T1 },
  { start: T1, end: T2 },
  { start: T2, end: T3 },
  { start: T0, end: T3 },
);
const fcOptionalString = fc.option(fc.stringMatching(/^[a-z][a-z0-9:.-]{2,40}$/), { nil: null });
const fcProducer = fc.constantFrom(toolProducer(), { ...toolProducer(), model: 'glm-4.5', model_version: '2025.1' });
const fcProvenance = fc.array(fc.stringMatching(/^[a-z]+:[a-z0-9]{4,64}$/), { minLength: 1, maxLength: 5 });
const fcKind = fc.constantFrom('telemetry', 'test-run', 'incident-report', 'experiment');
const fcMethod = fc.constantFrom('telemetry:capture-availability', 'test-run:exit-code', 'experiment:ab-test-result');

const fcCreateInput: fc.Arbitrary<CreateEvidenceInput> = fc
  .record({
    kind: fcKind,
    availability: fcAvailability,
    evidence_class: fcEvidenceClass,
    method: fcMethod,
    provenance: fcProvenance,
    source_revision: fcOptionalString,
    deployment_revision: fcOptionalString,
    subject_revision: fc.option(fc.stringMatching(/^r[0-9]+$/), { nil: null }),
    window: fc.option(fcWindow, { nil: null }),
    confidence: fc.constantFrom(
      { kind: 'QUALITATIVE', uncertainty_class: 'UNQUANTIFIED' } as const,
      { kind: 'QUALITATIVE', uncertainty_class: 'STRONG' } as const,
      { kind: 'QUALITATIVE', uncertainty_class: 'WEAK' } as const,
    ),
    producer: fcProducer,
  })
  .map((partial) => ({
    ...partial,
    subject_ref: SYSTEM_STATE_R1,
    // LLM producers and calibrated confidence would be rejected — the generator
    // only produces qualitative confidence, so this input is always valid.
  }) as CreateEvidenceInput);

describe('createEvidence properties (deterministic, contract-conformant)', () => {
  it('always mints valid, normative-conformant records with spine Evidence ids', () => {
    fc.assert(
      fc.property(fcCreateInput, (input) => {
        const record = createEvidence(input);
        expect(validateEvidenceRecord(record)).toBe(true);
        expect(isEvidenceRecord(record)).toBe(true);
        expect(record.id).toMatch(/^sos:\/\/Evidence\/[0-9a-f]{32}$/);
        expect(isEvidenceClass(record.evidence_class)).toBe(true);
        expect(isEvidenceTruthState(record.availability)).toBe(true);
        return true;
      }),
    );
  });

  it('is deterministic: identical inputs yield identical records and ids', () => {
    fc.assert(
      fc.property(fcCreateInput, (input) => {
        const a = createEvidence(input);
        const b = createEvidence(JSON.parse(JSON.stringify(input)) as CreateEvidenceInput);
        expect(a).toEqual(b);
        expect(a.id).toBe(b.id);
        return true;
      }),
    );
  });

  it('content sensitivity: differing availability yields differing ids', () => {
    fc.assert(
      fc.property(fcCreateInput, fcAvailability, (input, availability) => {
        const record = createEvidence(input);
        const other = createEvidence({ ...input, availability });
        expect(record.id === other.id).toBe(availability === input.availability);
        return true;
      }),
    );
  });

  it('the observation/intervention XOR always holds (exactly one flag true)', () => {
    fc.assert(
      fc.property(fcCreateInput, (input) => {
        const record = createEvidence(input);
        expect(record.observational !== record.intervention).toBe(true);
        expect(record.evidence_class === 'OBSERVATIONAL').toBe(record.observational);
        return true;
      }),
    );
  });

  it('canonical round trips preserve validity (JSON parse -> validate)', () => {
    fc.assert(
      fc.property(fcCreateInput, (input) => {
        const record = createEvidence(input);
        const round = JSON.parse(JSON.stringify(record)) as EvidenceRecordW3;
        expect(validateEvidenceRecord(round)).toBe(true);
        expect(round).toEqual(record);
        return true;
      }),
    );
  });

  it('summarizeAvailability always totals the record count with all 6 keys', () => {
    fc.assert(
      fc.property(fc.array(fcCreateInput, { minLength: 0, maxLength: 12 }), (inputs) => {
        const records = inputs.map((input) => createEvidence(input));
        const summary = summarizeAvailability(records);
        const total =
          summary.SUCCESS + summary.FAILURE + summary.UNKNOWN + summary.UNAVAILABLE + summary.UNSUPPORTED + summary.PARTIAL;
        expect(total).toBe(records.length);
        expect(Object.keys(summary).sort()).toEqual([...TRUTH_STATES].sort());
        return true;
      }),
    );
  });
});

describe('evaluateFreshness properties (total, deterministic, distinct statuses)', () => {
  it('never throws for valid records and inputs; status is always one of the 4 distinct statuses', () => {
    fc.assert(
      fc.property(
        fcCreateInput,
        fc.constantFrom(...NOW_INSTANTS),
        fc.option(fc.stringMatching(/^r[0-9]+$/), { nil: null }),
        (input, now, systemStateRevision) => {
          const record = createEvidence(input);
          const evaluation = evaluateFreshness(record, { now, systemStateRevision });
          expect(['FRESH', 'EXPIRED_TIME_WINDOW', 'SUPERSEDED_SUBJECT_REVISION', 'UNKNOWN_PROVENANCE']).toContain(
            evaluation.status,
          );
          expect(evaluation.reason.length).toBeGreaterThan(0);
          return true;
        },
      ),
    );
  });

  it('is deterministic: identical (record, input) pairs yield identical evaluations', () => {
    fc.assert(
      fc.property(
        fcCreateInput,
        fc.constantFrom(...NOW_INSTANTS),
        fc.option(fc.stringMatching(/^r[0-9]+$/), { nil: null }),
        (input, now, systemStateRevision) => {
          const record = createEvidence(input);
          expect(evaluateFreshness(record, { now, systemStateRevision })).toEqual(
            evaluateFreshness(record, { now, systemStateRevision }),
          );
          return true;
        },
      ),
    );
  });
});

describe('ingestObservation properties (verbatim truth-state assignment)', () => {
  const fcRawObservation: fc.Arbitrary<RawObservation> = fc
    .record({
      subject_ref: fc.stringMatching(/^[a-z][a-z0-9:.-]{3,40}$/),
      availability: fcAvailability,
      window: fcWindow,
      observed: fc.option(fc.jsonValue(), { nil: null }),
      attributes: fc.dictionary(fc.stringMatching(/^[a-z][a-z0-9.]{2,20}$/), fc.jsonValue(), { maxKeys: 4 }),
      producer: fcProducer,
    })
    .map((partial) => partial as RawObservation);

  it('the ingested truth state is ALWAYS EXACTLY the observation\'s capture-level availability', () => {
    fc.assert(
      fc.property(fcRawObservation, (observation) => {
        const evidence = ingestObservation({ observation, subject: SYSTEM_STATE_R1 });
        expect(evidence.availability).toBe(observation.availability);
        expect(evidence.evidence_class).toBe('OBSERVATIONAL');
        expect(validateEvidenceRecord(evidence)).toBe(true);
        return true;
      }),
    );
  });

  it('ingestion is deterministic and references the exact observation by hash', () => {
    fc.assert(
      fc.property(fcRawObservation, (observation) => {
        const a = ingestObservation({ observation, subject: SYSTEM_STATE_R1 });
        const b = ingestObservation({
          observation: JSON.parse(JSON.stringify(observation)) as RawObservation,
          subject: SYSTEM_STATE_R1,
        });
        expect(a).toEqual(b);
        expect(a.provenance[0]).toMatch(/^observation:sha256:[0-9a-f]{64}$/);
        return true;
      }),
    );
  });

  it('UNAVAILABLE observations NEVER become SUCCESS or FAILURE evidence (locked invariant)', () => {
    fc.assert(
      fc.property(fcRawObservation.filter((observation) => observation.availability === 'UNAVAILABLE'), (observation) => {
        const evidence = ingestObservation({ observation, subject: SYSTEM_STATE_R1 });
        const state: EvidenceTruthState = evidence.availability;
        expect(state).toBe('UNAVAILABLE');
        expect(state).not.toBe('SUCCESS');
        expect(state).not.toBe('FAILURE');
        const summary = summarizeAvailability([evidence]);
        expect(summary.UNAVAILABLE).toBe(1);
        expect(summary.SUCCESS + summary.FAILURE).toBe(0);
        return true;
      }),
    );
  });
});
