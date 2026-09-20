/**
 * Shared test fixtures for @sos-2/ecology tests.
 *
 * All spine identities are minted deterministically through the sanctioned
 * minters (never invented by hand); evidence records are minted through the
 * merged @sos-2/evidence authority.
 */

import { createEvidence } from '@sos-2/evidence';
import type { EvidenceRecordW3 } from '@sos-2/evidence';
import type { CreateEvidenceInput } from '@sos-2/evidence';
import type { Producer, TimeWindow } from '@sos-2/provenance';
import { deriveDeterministicArtifactId } from '@sos-2/semantic-spine';

export const T0 = '2025-01-01T00:00:00.000Z';
export const T1 = '2025-01-02T00:00:00.000Z';
export const T2 = '2025-01-03T12:30:00.000Z';
export const T3 = '2025-01-04T00:00:00.000Z';
export const W0: TimeWindow = { start: T0, end: T1 };

/** Deterministic package ids for the graph population (never invented by hand). */
export function packageId(seed: string): string {
  return deriveDeterministicArtifactId('Package', { note: 'w13 ecology test package', seed });
}

/** Deterministic composition ids for interaction records. */
export function compositionId(seed: string): string {
  return deriveDeterministicArtifactId('PackageComposition', { note: 'w13 ecology test composition', seed });
}

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

function baseEvidenceInput(subject: string, index: number): CreateEvidenceInput {
  return {
    kind: 'telemetry',
    subject_ref: subject,
    availability: 'SUCCESS',
    evidence_class: 'OBSERVATIONAL',
    method: 'telemetry:capture-availability',
    provenance: [`observation:sha256:${String(index).padStart(64, '0')}`],
    source_revision: 'git:94a75683dd2870d11abbf12a1e07218bb736440b',
    deployment_revision: null,
    window: W0,
    subject_revision: null,
    confidence: { kind: 'QUALITATIVE', uncertainty_class: 'UNQUANTIFIED' },
    producer: toolProducer(),
  };
}

/** An evidence record about `subject` with deterministic content per (subject, index). */
export function makeEvidence(subject: string, index = 0): EvidenceRecordW3 {
  return createEvidence(baseEvidenceInput(subject, index));
}

/** A FAILURE evidence record about `subject`. */
export function failureEvidence(subject: string, index = 1): EvidenceRecordW3 {
  return createEvidence({
    ...baseEvidenceInput(subject, index),
    kind: 'incident-report',
    availability: 'FAILURE',
    method: 'incident:postmortem-classification',
  });
}

/** Deterministic evidence-only ids (for signals / graph refs, no record needed). */
export function evidenceRefId(seed: string): string {
  return deriveDeterministicArtifactId('Evidence', { note: 'w13 ecology test evidence ref', seed });
}
