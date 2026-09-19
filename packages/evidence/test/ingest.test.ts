import { describe, expect, it } from 'vitest';
import {
  TELEMETRY_INGEST_METHOD,
  ingestObservation,
  observationProvenanceToken,
  summarizeAvailability,
  validateEvidenceRecord,
} from '../src/index.js';
import { assertTruthStateIs, isEvidenceRecord } from '@sos-2/semantic-spine';
import { rawObservationHash } from '@sos-2/telemetry';
import type { RawObservation } from '@sos-2/telemetry';
import {
  SYSTEM_STATE_R1,
  W0,
  calibratedConfidence,
  llmProducer,
  sampleRawObservation,
  toolProducer,
} from './helpers.js';

describe('telemetry ingestion — truth-state assignment (positive)', () => {
  it('assigns the truth state VERBATIM under the explicit method provenance', () => {
    const observation = sampleRawObservation('otel:service:checkout');
    const evidence = ingestObservation({ observation, subject: SYSTEM_STATE_R1, subjectRevision: 'r1' });
    expect(evidence.availability).toBe('SUCCESS');
    expect(evidence.method).toBe(TELEMETRY_INGEST_METHOD);
    expect(evidence.kind).toBe('telemetry');
    expect(evidence.subject_ref).toBe(SYSTEM_STATE_R1);
    expect(evidence.subject_revision).toBe('r1');
    expect(evidence.window).toEqual(W0);
    expect(evidence.producer).toEqual(toolProducer());
    expect(validateEvidenceRecord(evidence)).toBe(true);
    expect(isEvidenceRecord(evidence)).toBe(true); // normative contract layer
  });

  it('VERBATIM for ALL 6 distinct truth states — no state is ever coerced into another', () => {
    const states = ['SUCCESS', 'FAILURE', 'UNKNOWN', 'UNAVAILABLE', 'UNSUPPORTED', 'PARTIAL'] as const;
    for (const availability of states) {
      const observation = sampleRawObservation('otel:service:checkout', availability);
      const evidence = ingestObservation({ observation, subject: SYSTEM_STATE_R1 });
      // Exact-state pinning with the spine's own assertion helper:
      assertTruthStateIs(availability, evidence.availability);
    }
  });

  it('records the bit-exact observation hash and the subject mapping in provenance', () => {
    const observation = sampleRawObservation('otel:service:checkout');
    const evidence = ingestObservation({ observation, subject: SYSTEM_STATE_R1 });
    expect(evidence.provenance).toContain(`observation:sha256:${rawObservationHash(observation)}`);
    expect(evidence.provenance).toContain(`method:${TELEMETRY_INGEST_METHOD}`);
    expect(evidence.provenance).toContain('telemetry:subject:otel:service:checkout');
    expect(observationProvenanceToken(observation)).toBe(`observation:sha256:${rawObservationHash(observation)}`);
  });

  it('is deterministic: the same observation about the same subject yields the same evidence id', () => {
    const observation = sampleRawObservation('otel:service:checkout');
    const a = ingestObservation({ observation, subject: SYSTEM_STATE_R1, subjectRevision: 'r1' });
    const b = ingestObservation({ observation, subject: SYSTEM_STATE_R1, subjectRevision: 'r1' });
    expect(a).toEqual(b);
    const otherSubjectRevision = ingestObservation({ observation, subject: SYSTEM_STATE_R1, subjectRevision: 'r2' });
    expect(otherSubjectRevision.id).not.toBe(a.id);
  });

  it('plumbs exact source and deployment revisions', () => {
    const observation = sampleRawObservation('otel:service:checkout');
    const evidence = ingestObservation({
      observation,
      subject: SYSTEM_STATE_R1,
      sourceRevision: 'git:219cb9c8e329b0435f2deea37ec2d5003b264931',
      deploymentRevision: 'oci:sha256:' + 'b'.repeat(64),
    });
    expect(evidence.source_revision).toBe('git:219cb9c8e329b0435f2deea37ec2d5003b264931');
    expect(evidence.deployment_revision).toBe('oci:sha256:' + 'b'.repeat(64));
  });
});

describe('telemetry ingestion — the locked invariant (UNAVAILABLE is NEVER zero)', () => {
  it('an UNAVAILABLE (gap) observation becomes UNAVAILABLE evidence — never SUCCESS, never FAILURE, never "zero failures"', () => {
    // A gap: no data exists for the subject/window (telemetry records gaps explicitly).
    const gap: RawObservation = {
      subject_ref: 'otel:service:checkout',
      availability: 'UNAVAILABLE',
      window: W0,
      observed: null,
      attributes: { 'gap.reason': 'collector restart' },
      producer: toolProducer(),
    };
    const evidence = ingestObservation({ observation: gap, subject: SYSTEM_STATE_R1 });
    assertTruthStateIs('UNAVAILABLE', evidence.availability);
    expect(evidence.availability).not.toBe('SUCCESS');
    expect(evidence.availability).not.toBe('FAILURE');
    expect(evidence.availability).not.toBe('UNKNOWN');

    // The honest availability summary keeps the gap visible as UNAVAILABLE:
    const summary = summarizeAvailability([evidence]);
    expect(summary.UNAVAILABLE).toBe(1);
    expect(summary.SUCCESS).toBe(0); // a gap is never counted as success/zero-failure evidence
    expect(summary.FAILURE).toBe(0); // ...and never inflated into a failure count either
  });

  it('UNAVAILABLE and UNKNOWN stay distinct through ingestion', () => {
    const unavailable = ingestObservation({
      observation: sampleRawObservation('s', 'UNAVAILABLE'),
      subject: SYSTEM_STATE_R1,
    });
    const unknown = ingestObservation({
      observation: sampleRawObservation('s', 'UNKNOWN'),
      subject: SYSTEM_STATE_R1,
    });
    expect(unavailable.availability).toBe('UNAVAILABLE');
    expect(unknown.availability).toBe('UNKNOWN');
    expect(unavailable.availability).not.toBe(unknown.availability);
  });

  it('UNSUPPORTED stays distinct from UNAVAILABLE through ingestion', () => {
    const unsupported = ingestObservation({
      observation: sampleRawObservation('s', 'UNSUPPORTED'),
      subject: SYSTEM_STATE_R1,
    });
    assertTruthStateIs('UNSUPPORTED', unsupported.availability);
    expect(unsupported.availability).not.toBe('UNAVAILABLE');
  });

  it('a FAILURE signal stays FAILURE (an observed failure is a failure, not a gap)', () => {
    const failure = ingestObservation({
      observation: sampleRawObservation('s', 'FAILURE'),
      subject: SYSTEM_STATE_R1,
    });
    assertTruthStateIs('FAILURE', failure.availability);
    expect(failure.availability).not.toBe('UNAVAILABLE');
  });
});

describe('telemetry ingestion — class and LLM discipline (positive)', () => {
  it('ingested evidence is ALWAYS OBSERVATIONAL (telemetry watched; it did not intervene)', () => {
    const evidence = ingestObservation({
      observation: sampleRawObservation('otel:service:checkout'),
      subject: SYSTEM_STATE_R1,
    });
    expect(evidence.evidence_class).toBe('OBSERVATIONAL');
    expect(evidence.observational).toBe(true);
    expect(evidence.intervention).toBe(false);
    // There is no ingest input that can produce interventional evidence — the
    // class is not an ingest parameter at all, and a stray property is ignored
    // (the mapping is fixed: ingestion is observational by construction).
    const stray = ingestObservation({
      observation: sampleRawObservation('s'),
      subject: SYSTEM_STATE_R1,
      ...({ evidence_class: 'INTERVENTIONAL' } as Record<string, unknown>),
    });
    expect(stray.evidence_class).toBe('OBSERVATIONAL');
    expect(stray.intervention).toBe(false);
  });

  it('LLM-produced observations yield non-authoritative evidence with qualitative confidence', () => {
    const llmObservation: RawObservation = {
      ...sampleRawObservation('analysis:report'),
      producer: llmProducer(),
    };
    const evidence = ingestObservation({ observation: llmObservation, subject: SYSTEM_STATE_R1 });
    expect(evidence.llm_output).toBe(true);
    expect(evidence.producer.model).toBe('glm-4.5');
    expect(evidence.confidence.kind).toBe('QUALITATIVE');
    expect(evidence.confidence).toEqual({ kind: 'QUALITATIVE', uncertainty_class: 'UNQUANTIFIED' });
  });

  it('non-LLM observations may carry calibrated confidence with a calibration ref', () => {
    const evidence = ingestObservation({
      observation: sampleRawObservation('otel:service:checkout'),
      subject: SYSTEM_STATE_R1,
      confidence: calibratedConfidence(0.9),
    });
    expect(evidence.confidence.kind).toBe('CALIBRATED');
  });
});

describe('telemetry ingestion (negative)', () => {
  it('rejects non-object inputs and invalid observations loudly', () => {
    expect(() => ingestObservation(null as never)).toThrow(/must be an object/);
    expect(() =>
      ingestObservation({ observation: { ...sampleRawObservation('s'), availability: 'MAYBE' as never }, subject: SYSTEM_STATE_R1 }),
    ).toThrow(/observation is invalid/);
  });

  it('rejects subjects that are not spine artifact ids (the semantic mapping is mandatory)', () => {
    expect(() =>
      ingestObservation({ observation: sampleRawObservation('otel:service:checkout'), subject: 'otel:service:checkout' }),
    ).toThrow(/well-formed spine artifact id/);
    expect(() => ingestObservation({ observation: sampleRawObservation('s'), subject: '' })).toThrow(
      /well-formed spine artifact id/,
    );
  });

  it('rejects invalid revisions', () => {
    expect(() =>
      ingestObservation({ observation: sampleRawObservation('s'), subject: SYSTEM_STATE_R1, subjectRevision: '' }),
    ).toThrow(/subjectRevision/);
    expect(() =>
      ingestObservation({ observation: sampleRawObservation('s'), subject: SYSTEM_STATE_R1, sourceRevision: '' }),
    ).toThrow(/sourceRevision/);
    expect(() =>
      ingestObservation({ observation: sampleRawObservation('s'), subject: SYSTEM_STATE_R1, deploymentRevision: '' }),
    ).toThrow(/deploymentRevision/);
  });

  it('rejects calibrated confidence on LLM-produced observations (self-report is never calibrated truth)', () => {
    const llmObservation: RawObservation = {
      ...sampleRawObservation('analysis:report'),
      producer: llmProducer(),
    };
    expect(() =>
      ingestObservation({ observation: llmObservation, subject: SYSTEM_STATE_R1, confidence: calibratedConfidence() }),
    ).toThrow(/never calibrated truth/);
  });

  it('rejects invalid confidence marks', () => {
    expect(() =>
      ingestObservation({
        observation: sampleRawObservation('s'),
        subject: SYSTEM_STATE_R1,
        confidence: { kind: 'CALIBRATED', value: 2, calibration_ref: SYSTEM_STATE_R1 } as never,
      }),
    ).toThrow(/confidence is invalid/);
  });
});
