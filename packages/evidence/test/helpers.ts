/**
 * Shared test fixtures for @sos-2/evidence tests.
 *
 * Subject ids are minted deterministically through the spine's exported
 * minters (never invented by hand): SYSTEM_STATE_R1/R2 stand for two
 * revisions of a System State subject; CALIBRATION stands for a calibration
 * Evaluation artifact referenced by calibrated confidence.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { deriveDeterministicArtifactId } from '@sos-2/semantic-spine';
import type { Producer, TimeWindow } from '@sos-2/provenance';
import type { RawObservation } from '@sos-2/telemetry';
import type { Confidence, CreateEvidenceInput, EvidenceRecordW3 } from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));

function readFixture<T>(name: string): T {
  return JSON.parse(readFileSync(join(here, '../fixtures', name), 'utf8')) as T;
}

export const GOLDEN_EVIDENCE: EvidenceRecordW3 = readFixture<EvidenceRecordW3>('evidence.json');

export const T0 = '2025-01-01T00:00:00.000Z';
export const T1 = '2025-01-02T00:00:00.000Z';
export const T2 = '2025-01-03T12:30:00.000Z';
export const T3 = '2025-01-04T00:00:00.000Z';
export const W0: TimeWindow = { start: T0, end: T1 };
export const W1: TimeWindow = { start: T1, end: T2 };

/** Deterministic System State subject ids (two revisions of the same system). */
export const SYSTEM_STATE_R1 = deriveDeterministicArtifactId('SystemState', {
  note: 'w3 evidence test subject',
  revision: 'r1',
});
export const SYSTEM_STATE_R2 = deriveDeterministicArtifactId('SystemState', {
  note: 'w3 evidence test subject',
  revision: 'r2',
});

/** Deterministic calibration Evaluation artifact id. */
export const CALIBRATION = deriveDeterministicArtifactId('Evaluation', {
  note: 'w3 evidence test calibration',
  producer: 'historical-bench-v1',
  brier_score: 0.09,
});

export function toolProducer(): Producer {
  return {
    tool: 'otel-collector',
    tool_version: '0.90.0',
    model: null,
    model_version: null,
    command: 'collect --env production',
    environment: 'ci:local',
  };
}

export function testRunnerProducer(): Producer {
  return {
    tool: 'vitest',
    tool_version: '3.2.7',
    model: null,
    model_version: null,
    command: 'pnpm -r test',
    environment: 'ci:local',
  };
}

export function llmProducer(): Producer {
  return {
    tool: 'analysis-assistant',
    tool_version: null,
    model: 'glm-4.5',
    model_version: '2025.1',
    command: null,
    environment: null,
  };
}

export function qualitativeConfidence(): Confidence {
  return { kind: 'QUALITATIVE', uncertainty_class: 'UNQUANTIFIED' };
}

export function calibratedConfidence(value = 0.82): Confidence {
  return { kind: 'CALIBRATED', value, calibration_ref: CALIBRATION };
}

/** A minimal valid evidence creation input (unique subject per call). */
export function sampleEvidenceInput(subject: string = SYSTEM_STATE_R1): CreateEvidenceInput {
  return {
    kind: 'telemetry',
    subject_ref: subject,
    availability: 'SUCCESS',
    evidence_class: 'OBSERVATIONAL',
    method: 'telemetry:capture-availability',
    provenance: ['observation:sha256:' + 'a'.repeat(64)],
    source_revision: 'git:219cb9c8e329b0435f2deea37ec2d5003b264931',
    deployment_revision: 'oci:sha256:' + 'b'.repeat(64),
    window: W0,
    subject_revision: 'r1',
    confidence: qualitativeConfidence(),
    producer: toolProducer(),
  };
}

/** A minimal valid raw telemetry observation (telemetry is INPUT). */
export function sampleRawObservation(
  subject: string,
  availability: RawObservation['availability'] = 'SUCCESS',
): RawObservation {
  return {
    subject_ref: subject,
    availability,
    window: W0,
    observed: { note: 'sample' },
    attributes: { 'source.kind': 'synthetic' },
    producer: toolProducer(),
  };
}
