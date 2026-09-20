/**
 * Shared test fixtures for @sos-2/composition tests.
 *
 * The golden composition (FORMING, deterministic id) composes the W6 golden
 * package (the W0.5 golden package record realized) and the W6 durable-store
 * companion fixture. Own evidence about a composition references the
 * composition's chain ids; tests build it through the W3 evidence creator
 * with subject = the composition id.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createEvidence } from '@sos-2/evidence';
import type { CreateEvidenceInput, EvidenceRecordW3 } from '@sos-2/evidence';
import type { Producer, TimeWindow } from '@sos-2/provenance';
import { deriveDeterministicArtifactId } from '@sos-2/semantic-spine';
import type { PackageArtifact } from '@sos-2/packages';
import { createPackageArtifact } from '@sos-2/packages';
import type { PackageCompositionArtifact, PackageCompositionContent } from '../src/index.js';
import { createPackageComposition } from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));

function readFixture<T>(relative: string): T {
  return JSON.parse(readFileSync(join(here, relative), 'utf8')) as T;
}

export const GOLDEN_COMPOSITION: PackageCompositionArtifact = readFixture<PackageCompositionArtifact>(
  '../fixtures/package-composition.json',
);
export const GOLDEN_PACKAGE: PackageArtifact = readFixture<PackageArtifact>(
  '../../packages/fixtures/package-artifact.json',
);
export const DURABLE_STORE_PACKAGE: PackageArtifact = readFixture<PackageArtifact>(
  '../../packages/fixtures/durable-store-package.json',
);

export const T0 = '2025-01-01T00:00:00.000Z';
export const T1 = '2025-01-02T00:00:00.000Z';
export const T2 = '2025-01-03T12:30:00.000Z';
export const W0: TimeWindow = { start: T0, end: T1 };
export const W1: TimeWindow = { start: T1, end: T2 };

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
    command: 'run --plan composition-ab.yaml',
    environment: 'ci:local',
  };
}

/** Evidence about a subject (the composition's own id by default). */
export function makeEvidence(
  subject: string,
  overrides: Partial<CreateEvidenceInput> = {},
): EvidenceRecordW3 {
  return createEvidence({
    kind: 'composition-run',
    subject_ref: subject,
    availability: 'SUCCESS',
    evidence_class: 'OBSERVATIONAL',
    method: 'telemetry:capture-availability',
    provenance: ['observation:sha256:' + 'a'.repeat(64)],
    window: W0,
    subject_revision: null,
    producer: toolProducer(),
    ...overrides,
  });
}

export function ownSuccessEvidence(compositionId: string, i = 0): EvidenceRecordW3 {
  return makeEvidence(compositionId, {
    provenance: [`observation:sha256:${String(i).padStart(64, '0')}`],
  });
}

export function ownFailureEvidence(compositionId: string): EvidenceRecordW3 {
  return makeEvidence(compositionId, {
    kind: 'incident-report',
    availability: 'FAILURE',
    method: 'incident:postmortem-classification',
    provenance: ['incident:sha256:' + 'f'.repeat(64)],
  });
}

export function ownComparativeEvidence(compositionId: string): EvidenceRecordW3 {
  return makeEvidence(compositionId, {
    kind: 'benchmark-comparison',
    method: 'benchmark:comparison-result',
    provenance: ['benchmark:sha256:' + 'c'.repeat(64)],
  });
}

export function ownInterventionalEvidence(compositionId: string): EvidenceRecordW3 {
  return makeEvidence(compositionId, {
    kind: 'fault-injection',
    evidence_class: 'INTERVENTIONAL',
    method: 'experiment:intervention-result',
    provenance: ['experiment:sha256:' + 'i'.repeat(64)],
    producer: experimentProducer(),
  });
}

/** Evidence about a MEMBER package (the independence test fixture). */
export function memberEvidence(memberPackageId: string): EvidenceRecordW3 {
  return makeEvidence(memberPackageId, {
    kind: 'telemetry',
    provenance: ['observation:sha256:' + 'm'.repeat(64)],
  });
}

/** The golden composition creation input (reproduces the fixture bit-exactly). */
export function goldenCompositionInput(): { content: PackageCompositionContent; provenance: string[]; created_at: string } {
  return {
    content: GOLDEN_COMPOSITION.content,
    provenance: [...GOLDEN_COMPOSITION.envelope.provenance],
    created_at: GOLDEN_COMPOSITION.envelope.created_at,
  };
}

/** A minimal valid FORMING composition content builder over the fixture packages. */
export function sampleCompositionContent(
  overrides: Partial<PackageCompositionContent> = {},
): PackageCompositionContent {
  return {
    semantic_capability: 'sample-composed-capability',
    contracts: ['contract:sample-composed/v1'],
    members: [
      {
        package_id: GOLDEN_PACKAGE.envelope.id,
        role: 'spine',
        bound_contracts: ['sos://schema/trace-link'],
      },
      {
        package_id: DURABLE_STORE_PACKAGE.envelope.id,
        role: 'store',
        bound_contracts: ['contract:durable-store/v1'],
      },
    ],
    bindings: [
      {
        kind: 'PROVIDES_TO',
        source_role: 'spine',
        target_role: 'store',
        contract: 'contract:sample-composed/v1',
        wiring: { channel: 'write-through' },
      },
    ],
    preconditions: ['members are registered'],
    postconditions: ['the composed capability is realized'],
    applicability: [
      {
        kind: 'QUALITATIVE',
        uncertainty_class: 'UNQUANTIFIED',
        context: { environment: 'test' },
        sample_size: 0,
        window: null,
      },
    ],
    evidence_refs: [],
    failure_refs: [],
    compatibility_refs: [],
    assurance_obligations: [{ kind: 'REPLAY', obligation: 'the composed chain replays after restart' }],
    context: { environment: 'test' },
    learned_limitations: [],
    diversity_profile: {
      family: 'write-through-store',
      dimensions: [{ dimension: 'RESILIENCE', stance: 'strong durability' }],
    },
    maturity: 'FORMING',
    independence: [],
    changes: 'initial composition hypothesis',
    superseded_by: null,
    ...overrides,
  };
}

export function sampleCompositionArtifact(
  overrides: Partial<Parameters<typeof createPackageComposition>[0]> = {},
): PackageCompositionArtifact {
  return createPackageComposition({
    content: sampleCompositionContent(),
    provenance: ['w6:test'],
    created_at: T0,
    ...overrides,
  });
}

/** The packages the sample/golden compositions depend on (registry-ready). */
export function fixturePackages(): PackageArtifact[] {
  return [
    createPackageArtifact({
      content: GOLDEN_PACKAGE.content,
      provenance: GOLDEN_PACKAGE.envelope.provenance,
      created_at: GOLDEN_PACKAGE.envelope.created_at,
      id: GOLDEN_PACKAGE.envelope.id,
    }),
    createPackageArtifact({
      content: DURABLE_STORE_PACKAGE.content,
      provenance: DURABLE_STORE_PACKAGE.envelope.provenance,
      created_at: DURABLE_STORE_PACKAGE.envelope.created_at,
    }),
  ];
}

/** A deterministic auxiliary package id (for member-shape tests). */
export const AUX_PACKAGE_ID = deriveDeterministicArtifactId('Package', {
  note: 'w6 composition test aux member',
});
