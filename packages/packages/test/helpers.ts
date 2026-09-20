/**
 * Shared test fixtures for @sos-2/packages tests.
 *
 * All spine identities are minted deterministically through the sanctioned
 * minters (never invented by hand); golden fixtures are read from
 * ../fixtures and cross-referenced with the W0.5 golden fixtures of
 * @sos-2/semantic-spine (../../semantic-spine/fixtures).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createEvidence } from '@sos-2/evidence';
import type { EvidenceRecordW3 } from '@sos-2/evidence';
import type { CreateEvidenceInput } from '@sos-2/evidence';
import type { Producer, TimeWindow } from '@sos-2/provenance';
import { deriveDeterministicArtifactId, isArtifactId } from '@sos-2/semantic-spine';
import type { PackageArtifact, PackageContent } from '../src/index.js';
import { createPackageArtifact } from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));

function readFixture<T>(relative: string): T {
  return JSON.parse(readFileSync(join(here, relative), 'utf8')) as T;
}

export const GOLDEN_PACKAGE: PackageArtifact = readFixture<PackageArtifact>('../fixtures/package-artifact.json');
export const DURABLE_STORE_PACKAGE: PackageArtifact = readFixture<PackageArtifact>(
  '../fixtures/durable-store-package.json',
);
/** The W0.5 golden package record (projection target, bit-exact). */
export const W05_GOLDEN_PACKAGE_RECORD = readFixture<Record<string, unknown>>(
  '../../semantic-spine/fixtures/package-record.json',
);

export const T0 = '2025-01-01T00:00:00.000Z';
export const T1 = '2025-01-02T00:00:00.000Z';
export const T2 = '2025-01-03T12:30:00.000Z';
export const T3 = '2025-01-04T00:00:00.000Z';
export const W0: TimeWindow = { start: T0, end: T1 };
export const W1: TimeWindow = { start: T1, end: T2 };

/** Deterministic subject ids for evidence (SystemState subjects, W3 style). */
export const SUBJECT_R1 = deriveDeterministicArtifactId('SystemState', {
  note: 'w6 packages test subject',
  revision: 'r1',
});
export const SUBJECT_R2 = deriveDeterministicArtifactId('SystemState', {
  note: 'w6 packages test subject',
  revision: 'r2',
});

/** Deterministic calibration Evaluation artifact id. */
export const CALIBRATION = deriveDeterministicArtifactId('Evaluation', {
  note: 'w6 packages test calibration',
  producer: 'historical-bench-v2',
  brier_score: 0.08,
});

/** A deterministic realization ref (ImplementationModel-shaped). */
export const REALIZATION_REF = deriveDeterministicArtifactId('ImplementationModel', {
  note: 'w6 packages test realization',
  revision: 1,
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

export function experimentProducer(): Producer {
  return {
    tool: 'experiment-runner',
    tool_version: '1.2.0',
    model: null,
    model_version: null,
    command: 'run --plan ab.yaml',
    environment: 'ci:local',
  };
}

function baseEvidenceInput(): CreateEvidenceInput {
  return {
    kind: 'telemetry',
    subject_ref: SUBJECT_R1,
    availability: 'SUCCESS',
    evidence_class: 'OBSERVATIONAL',
    method: 'telemetry:capture-availability',
    provenance: ['observation:sha256:' + 'a'.repeat(64)],
    source_revision: 'git:94a75683dd2870d11abbf12a1e07218bb736440b',
    deployment_revision: null,
    window: W0,
    subject_revision: 'r1',
    confidence: { kind: 'QUALITATIVE', uncertainty_class: 'UNQUANTIFIED' },
    producer: toolProducer(),
  };
}

/** A generic evidence record builder with deterministic ids per content. */
export function makeEvidence(overrides: Partial<CreateEvidenceInput> = {}): EvidenceRecordW3 {
  return createEvidence({ ...baseEvidenceInput(), ...overrides });
}

export function successEvidence(subject: string = SUBJECT_R1, i = 0): EvidenceRecordW3 {
  return makeEvidence({
    kind: 'telemetry',
    subject_ref: subject,
    availability: 'SUCCESS',
    evidence_class: 'OBSERVATIONAL',
    provenance: [`observation:sha256:${String(i).padStart(64, '0')}`],
  });
}

export function failureEvidence(subject: string = SUBJECT_R1): EvidenceRecordW3 {
  return makeEvidence({
    kind: 'incident-report',
    subject_ref: subject,
    availability: 'FAILURE',
    evidence_class: 'OBSERVATIONAL',
    method: 'incident:postmortem-classification',
    provenance: ['incident:sha256:' + 'f'.repeat(64)],
  });
}

export function comparativeEvidence(subject: string = SUBJECT_R1): EvidenceRecordW3 {
  return makeEvidence({
    kind: 'benchmark-comparison',
    subject_ref: subject,
    availability: 'SUCCESS',
    evidence_class: 'OBSERVATIONAL',
    method: 'benchmark:comparison-result',
    provenance: ['benchmark:sha256:' + 'c'.repeat(64)],
  });
}

export function interventionalEvidence(subject: string = SUBJECT_R1): EvidenceRecordW3 {
  return makeEvidence({
    kind: 'fault-injection',
    subject_ref: subject,
    availability: 'SUCCESS',
    evidence_class: 'INTERVENTIONAL',
    method: 'experiment:intervention-result',
    provenance: ['experiment:sha256:' + 'i'.repeat(64)],
    producer: experimentProducer(),
  });
}

export function transferEvidence(subject: string = SUBJECT_R1): EvidenceRecordW3 {
  return makeEvidence({
    kind: 'transfer-study',
    subject_ref: subject,
    availability: 'SUCCESS',
    evidence_class: 'OBSERVATIONAL',
    method: 'transfer:context-migration-result',
    provenance: ['transfer:sha256:' + 't'.repeat(64)],
  });
}

export function unclassifiedEvidence(subject: string = SUBJECT_R1): EvidenceRecordW3 {
  return makeEvidence({
    kind: 'telemetry',
    subject_ref: subject,
    availability: 'UNKNOWN',
    evidence_class: 'OBSERVATIONAL',
  });
}

/** A minimal valid DISCOVERED package content builder. */
export function samplePackageContent(overrides: Partial<PackageContent> = {}): PackageContent {
  const evidence = makeEvidence();
  if (!isArtifactId(evidence.id)) {
    throw new Error('test helper: evidence id must be a well-formed spine id');
  }
  const content: PackageContent = {
    semantic_capability: 'sample-capability',
    contracts: ['contract:sample/v1'],
    preconditions: ['precondition-a'],
    postconditions: ['postcondition-a'],
    realizations: [],
    applicability: [
      {
        kind: 'QUALITATIVE',
        uncertainty_class: 'UNQUANTIFIED',
        context: { environment: 'test' },
        sample_size: 1,
        window: null,
      },
    ],
    evidence_refs: [evidence.id],
    failure_refs: [],
    compatibility_refs: [],
    composition_refs: [],
    assurance_obligations: [{ kind: 'TEST', obligation: 'sample tests pass' }],
    context: { environment: 'test' },
    learned_limitations: [],
    diversity_profile: {
      family: 'sample-family',
      dimensions: [{ dimension: 'COST', stance: 'low cost' }],
    },
    maturity: 'DISCOVERED',
    changes: 'initial discovery',
    superseded_by: null,
    ...overrides,
  };
  return content;
}

/** The golden package creation input (reproduces the fixture bit-exactly). */
export function goldenPackageInput(): { content: PackageContent; provenance: string[]; created_at: string } {
  return {
    content: GOLDEN_PACKAGE.content,
    provenance: [...GOLDEN_PACKAGE.envelope.provenance],
    created_at: GOLDEN_PACKAGE.envelope.created_at,
  };
}

export function samplePackageArtifact(overrides: Partial<Parameters<typeof createPackageArtifact>[0]> = {}): PackageArtifact {
  return createPackageArtifact({
    content: samplePackageContent(),
    provenance: ['w6:test'],
    created_at: T0,
    ...overrides,
  });
}
