/**
 * Shared test fixtures for @sos-2/transfer tests.
 *
 * All spine identities are minted deterministically through the sanctioned
 * minters; evidence records are minted through the merged @sos-2/evidence
 * authority; base packages through the merged @sos-2/packages authority.
 */

import { createEvidence } from '@sos-2/evidence';
import type { EvidenceRecordW3 } from '@sos-2/evidence';
import type { CreateEvidenceInput } from '@sos-2/evidence';
import type { Producer, TimeWindow } from '@sos-2/provenance';
import { deriveDeterministicArtifactId, isArtifactId } from '@sos-2/semantic-spine';
import { createPackageArtifact } from '@sos-2/packages';
import type { PackageArtifact, PackageContent } from '@sos-2/packages';

export const T0 = '2025-01-01T00:00:00.000Z';
export const T1 = '2025-01-02T00:00:00.000Z';
export const T2 = '2025-01-03T12:30:00.000Z';
export const W0: TimeWindow = { start: T0, end: T1 };

/** Deterministic package ids (never invented by hand). */
export function packageId(seed: string): string {
  return deriveDeterministicArtifactId('Package', { note: 'w13 transfer test package', seed });
}

/** Deterministic composition ids. */
export function compositionId(seed: string): string {
  return deriveDeterministicArtifactId('PackageComposition', { note: 'w13 transfer test composition', seed });
}

export function toolProducer(): Producer {
  return {
    tool: 'experiment-runner',
    tool_version: '1.2.0',
    model: null,
    model_version: null,
    command: 'run --plan transfer.yaml',
    environment: 'ci:local',
  };
}

function baseEvidenceInput(subject: string, index: number): CreateEvidenceInput {
  return {
    kind: 'transfer-study',
    subject_ref: subject,
    availability: 'SUCCESS',
    evidence_class: 'OBSERVATIONAL',
    method: 'transfer:context-migration-result',
    provenance: [`transfer:sha256:${String(index).padStart(64, '0')}`],
    source_revision: 'git:94a75683dd2870d11abbf12a1e07218bb736440b',
    deployment_revision: null,
    window: W0,
    subject_revision: null,
    confidence: { kind: 'QUALITATIVE', uncertainty_class: 'UNQUANTIFIED' },
    producer: toolProducer(),
  };
}

/** An OBSERVATIONAL transfer-study evidence record (deterministic per (subject, index)). */
export function observationalEvidence(subject: string, index = 0): EvidenceRecordW3 {
  return createEvidence(baseEvidenceInput(subject, index));
}

/** An INTERVENTIONAL transfer-study evidence record (the strong-claim class). */
export function interventionalEvidence(subject: string, index = 100): EvidenceRecordW3 {
  return createEvidence({
    ...baseEvidenceInput(subject, index),
    kind: 'transfer-experiment',
    availability: 'SUCCESS',
    evidence_class: 'INTERVENTIONAL',
    method: 'experiment:intervention-result',
  });
}

/** A FAILURE evidence record (negative evidence). */
export function failureEvidence(subject: string, index = 200): EvidenceRecordW3 {
  return createEvidence({
    ...baseEvidenceInput(subject, index),
    kind: 'transfer-study',
    availability: 'FAILURE',
    method: 'transfer:context-migration-result',
  });
}

/** Deterministic calibration Evaluation id for calibrated estimates. */
export const CALIBRATION = deriveDeterministicArtifactId('Evaluation', {
  note: 'w13 transfer test calibration',
  producer: 'historical-bench-v2',
  brier_score: 0.07,
});

/** Deterministic realization ref for package contents. */
export const REALIZATION_REF = deriveDeterministicArtifactId('ImplementationModel', {
  note: 'w13 transfer test realization',
  revision: 1,
});

/** A minimal valid base package content builder (the W6 authority owns the shape). */
export function basePackageContent(overrides: Partial<PackageContent> = {}): PackageContent {
  const evidence = observationalEvidence(packageId('base-package'), 0);
  if (!isArtifactId(evidence.id)) {
    throw new Error('test helper: evidence id must be a well-formed spine id');
  }
  const content: PackageContent = {
    semantic_capability: 'durable message storage',
    contracts: ['contract:durable-store/v1'],
    preconditions: ['storage class available'],
    postconditions: ['messages persisted'],
    realizations: [{ ref: REALIZATION_REF, revision: 'r1', note: 'reference realization' }],
    applicability: [
      {
        kind: 'QUALITATIVE',
        uncertainty_class: 'MODERATE',
        context: { region: 'eu', tier: 'prod' },
        sample_size: 4,
        window: null,
      },
    ],
    evidence_refs: [evidence.id],
    failure_refs: [],
    compatibility_refs: [],
    composition_refs: [],
    assurance_obligations: [{ kind: 'TEST', obligation: 'durability tests pass' }],
    context: { region: 'eu', tier: 'prod' },
    learned_limitations: ['throughput ceiling under 10k msg/s'],
    diversity_profile: {
      family: 'durable-queue',
      dimensions: [{ dimension: 'RESILIENCE', stance: 'survives broker loss' }],
    },
    maturity: 'DISCOVERED',
    changes: 'initial discovery',
    superseded_by: null,
    ...overrides,
  };
  return content;
}

/** A minimal valid base package artifact. */
export function basePackageArtifact(overrides: Partial<PackageContent> = {}): PackageArtifact {
  return createPackageArtifact({
    content: basePackageContent(overrides),
    provenance: ['w13:transfer-test'],
    created_at: T0,
  });
}
