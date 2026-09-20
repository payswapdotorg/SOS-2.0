/**
 * Shared test fixtures for @sos-2/registry tests.
 *
 * The retrieval/diversity fixture set models ONE capability
 * ('image-resize') with three MATERIALLY DIFFERENT solution families
 * (edge-cache: latency; durable-queue: resilience; privacy-local: privacy)
 * — exactly the spec/architecture.md §11 diversity dimensions — plus a
 * validated composition over two member packages.
 */

import { createEvidence } from '@sos-2/evidence';
import type { CreateEvidenceInput, EvidenceRecordW3 } from '@sos-2/evidence';
import type { Producer, TimeWindow } from '@sos-2/provenance';
import { deriveDeterministicArtifactId } from '@sos-2/semantic-spine';
import type { PackageMaturity } from '@sos-2/semantic-spine';
import { createPackageArtifact } from '@sos-2/packages';
import type { ApplicabilityEstimate, PackageArtifact, PackageContent, PackageRealization } from '@sos-2/packages';
import { createPackageComposition } from '@sos-2/composition';
import type { PackageCompositionArtifact } from '@sos-2/composition';
import { PackageRegistry } from '../src/index.js';

export const T0 = '2025-01-01T00:00:00.000Z';
export const T1 = '2025-01-02T00:00:00.000Z';
export const T2 = '2025-01-03T12:30:00.000Z';
export const T3 = '2025-01-04T00:00:00.000Z';
export const W0: TimeWindow = { start: T0, end: T1 };
export const W1: TimeWindow = { start: T1, end: T2 };

/** Deterministic calibration Evaluation artifact id. */
export const CALIBRATION = deriveDeterministicArtifactId('Evaluation', {
  note: 'w6 registry test calibration',
  producer: 'retrieval-bench-v1',
  brier_score: 0.07,
});

/** A deterministic realization ref. */
export const REALIZATION_REF = deriveDeterministicArtifactId('ImplementationModel', {
  note: 'w6 registry test realization',
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
    command: 'run --plan retrieval-ab.yaml',
    environment: 'ci:local',
  };
}

/** Evidence about any well-formed subject id. */
export function makeEvidence(subject: string, overrides: Partial<CreateEvidenceInput> = {}): EvidenceRecordW3 {
  return createEvidence({
    kind: 'telemetry',
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

export function successEvidence(subject: string, i = 0): EvidenceRecordW3 {
  return makeEvidence(subject, { provenance: [`observation:sha256:${String(i).padStart(64, '0')}`] });
}

export function failureEvidence(subject: string): EvidenceRecordW3 {
  return makeEvidence(subject, {
    kind: 'incident-report',
    availability: 'FAILURE',
    method: 'incident:postmortem-classification',
    provenance: ['incident:sha256:' + 'f'.repeat(64)],
  });
}

export function comparativeEvidence(subject: string): EvidenceRecordW3 {
  return makeEvidence(subject, {
    kind: 'benchmark-comparison',
    method: 'benchmark:comparison-result',
    provenance: ['benchmark:sha256:' + 'c'.repeat(64)],
  });
}

export function interventionalEvidence(subject: string): EvidenceRecordW3 {
  return makeEvidence(subject, {
    kind: 'fault-injection',
    evidence_class: 'INTERVENTIONAL',
    method: 'experiment:intervention-result',
    provenance: ['experiment:sha256:' + 'i'.repeat(64)],
    producer: experimentProducer(),
  });
}

// ---------------------------------------------------------------------------
// Package/composition builders
// ---------------------------------------------------------------------------

export interface PackageSpec {
  capability: string;
  family: string;
  dimension: 'COST' | 'LATENCY' | 'RESILIENCE' | 'PRIVACY' | 'RESOURCE_FOOTPRINT' | 'TOPOLOGY' | 'OPERATIONAL_COMPLEXITY' | 'CUSTOMIZATION' | 'HUMAN_COMPREHENSIBILITY';
  stance: string;
  contracts?: string[];
  evidence: EvidenceRecordW3[];
  failures?: EvidenceRecordW3[];
  applicability?: ApplicabilityEstimate[];
  context?: Record<string, string>;
  limitations?: string[];
  seed: string;
}

/** A DISCOVERED, ACTIVE package with its evidence refs already cited. */
export function buildPackage(spec: PackageSpec): PackageArtifact {
  const content: PackageContent = {
    semantic_capability: spec.capability,
    contracts: spec.contracts ?? ['contract:samples/v1'],
    preconditions: ['precondition'],
    postconditions: ['postcondition'],
    realizations: [],
    applicability:
      spec.applicability ??
      [
        {
          kind: 'QUALITATIVE',
          uncertainty_class: 'UNQUANTIFIED',
          context: spec.context ?? { deployment: 'central' },
          sample_size: spec.evidence.length,
          window: null,
        },
      ],
    evidence_refs: spec.evidence.map((record) => record.id),
    failure_refs: (spec.failures ?? []).map((record) => record.id),
    compatibility_refs: [],
    composition_refs: [],
    assurance_obligations: [{ kind: 'TEST', obligation: 'package tests pass' }],
    context: spec.context ?? { deployment: 'central' },
    learned_limitations: spec.limitations ?? [],
    diversity_profile: {
      family: spec.family,
      dimensions: [{ dimension: spec.dimension, stance: spec.stance }],
    },
    maturity: 'DISCOVERED',
    changes: `initial discovery (${spec.seed})`,
    superseded_by: null,
  };
  return createPackageArtifact({ content, provenance: [`w6:registry-test:${spec.seed}`], created_at: T0, status: 'ACTIVE' });
}

const VALIDATION_REALIZATION: PackageRealization = {
  ref: REALIZATION_REF,
  revision: 'git:94a75683dd2870d11abbf12a1e07218bb736440b',
  note: 'the validated realization',
};

/**
 * Register a package at DISCOVERED and promote it to the target live
 * maturity through the evidence-gated path (the ONLY maturity-changing
 * path). Returns the final head artifact.
 */
export function registerAndPromotePackage(
  registry: PackageRegistry,
  spec: PackageSpec,
  target: Extract<PackageMaturity, 'FORMING' | 'VALIDATED' | 'MATURE' | 'CONTEXTUALIZED'>,
): PackageArtifact {
  const root = buildPackage(spec);
  registry.putPackage(root);
  const stamp = (n: number, note: string) => ({
    provenance: [`w6:registry-test:${spec.seed}:v${n}`],
    created_at: [T0, T1, T2, T3][n % 4] ?? T0,
    changes: `${note} (${spec.seed} v${n})`,
  });
  registry.promote({ id: root.envelope.id, target: 'FORMING', evidence: spec.evidence, ...stamp(1, 'forming') });
  let headId = registry.current(root.envelope.id)!.artifact.envelope.id;
  if (target === 'VALIDATED' || target === 'MATURE' || target === 'CONTEXTUALIZED') {
    registry.promote({
      id: headId,
      target: 'VALIDATED',
      evidence: spec.evidence,
      additional_realizations: [VALIDATION_REALIZATION],
      ...stamp(2, 'validated'),
    });
    headId = registry.current(headId)!.artifact.envelope.id;
  }
  if (target === 'MATURE' || target === 'CONTEXTUALIZED') {
    const extra = failureEvidence(REALIZATION_REF);
    registry.promote({
      id: headId,
      target: 'MATURE',
      evidence: [...spec.evidence, extra],
      additional_failure_refs: [extra.id],
      ...stamp(3, 'mature'),
    });
    headId = registry.current(headId)!.artifact.envelope.id;
  }
  if (target === 'CONTEXTUALIZED') {
    registry.promote({
      id: headId,
      target: 'CONTEXTUALIZED',
      evidence: spec.evidence,
      additional_applicability: [calibratedEdgeEstimate()],
      ...stamp(3, 'contextualized'),
    });
    headId = registry.current(headId)!.artifact.envelope.id;
  }
  return registry.get(headId)!.artifact as PackageArtifact;
}

/** A calibrated estimate for the edge context (probability with all companions). */
export function calibratedEdgeEstimate(probability = 0.9): ApplicabilityEstimate {
  return {
    kind: 'CALIBRATED',
    probability,
    calibration_ref: CALIBRATION,
    uncertainty_class: 'MODERATE',
    context: { deployment: 'edge' },
    sample_size: 24,
    window: W1,
  };
}

// ---------------------------------------------------------------------------
// The image-resize diverse fixture set (three materially different families)
// ---------------------------------------------------------------------------

export interface ResizeFixture {
  registry: PackageRegistry;
  members: PackageArtifact[];
  edgeCacheA: PackageArtifact;
  edgeCacheB: PackageArtifact;
  durableQueue: PackageArtifact;
  privacyLocal: PackageArtifact;
  composition: PackageCompositionArtifact;
  compositionEvidence: EvidenceRecordW3[];
  packageEvidence: EvidenceRecordW3[];
}

function edgeSubject(seed: string): string {
  return deriveDeterministicArtifactId('SystemState', { note: 'w6 registry edge subject', seed });
}

/**
 * Build the full diverse fixture set in a fresh registry:
 *   - two member packages (edge-cache family) + a VALIDATED composition over
 *     them (edge-cache family, own evidence, calibrated edge applicability);
 *   - a VALIDATED durable-queue package (resilience family);
 *   - a FORMING privacy-local package (privacy family).
 */
export function buildResizeFixture(): ResizeFixture {
  const registry = new PackageRegistry();
  const subject = edgeSubject('image-resize');

  const memberEvidence = [
    successEvidence(REALIZATION_REF, 0),
    successEvidence(REALIZATION_REF, 1),
    comparativeEvidence(REALIZATION_REF),
  ];
  const members = [
    registerAndPromotePackage(
      registry,
      {
        capability: 'image-storage',
        family: 'edge-cache',
        dimension: 'LATENCY',
        stance: 'sub-10ms p99 at the edge',
        contracts: ['contract:edge-storage/v1'],
        evidence: memberEvidence,
        seed: 'member-a',
      },
      'VALIDATED',
    ),
    registerAndPromotePackage(
      registry,
      {
        capability: 'image-transform',
        family: 'edge-cache',
        dimension: 'LATENCY',
        stance: 'hardware-accelerated resize',
        contracts: ['contract:edge-transform/v1'],
        evidence: memberEvidence,
        seed: 'member-b',
      },
      'VALIDATED',
    ),
  ];

  // The composition: created at DISCOVERED (own evidence arrives via promote).
  const compositionRoot = createPackageComposition({
    content: {
      semantic_capability: 'image-resize',
      contracts: ['contract:image-resize/v1'],
      members: [
        { package_id: members[0]!.envelope.id, role: 'storage', bound_contracts: ['contract:edge-storage/v1'] },
        { package_id: members[1]!.envelope.id, role: 'transform', bound_contracts: ['contract:edge-transform/v1'] },
      ],
      bindings: [
        {
          kind: 'DATA_FLOW',
          source_role: 'transform',
          target_role: 'storage',
          contract: 'contract:image-resize/v1',
          wiring: { path: 'resized-images' },
        },
      ],
      preconditions: ['edge nodes are warm'],
      postconditions: ['images resized and stored at the edge'],
      applicability: [
        {
          kind: 'QUALITATIVE',
          uncertainty_class: 'UNQUANTIFIED',
          context: { deployment: 'edge' },
          sample_size: 0,
          window: null,
        },
      ],
      evidence_refs: [],
      failure_refs: [],
      compatibility_refs: [],
      assurance_obligations: [{ kind: 'REPLAY', obligation: 'composed resize replays from the edge log' }],
      context: { deployment: 'edge' },
      learned_limitations: [],
      diversity_profile: {
        family: 'edge-cache',
        dimensions: [{ dimension: 'LATENCY', stance: 'sub-50ms composed p99' }],
      },
      maturity: 'DISCOVERED',
      independence: [],
      changes: 'initial composition hypothesis',
      superseded_by: null,
    },
    provenance: ['w6:registry-test:resize-composition'],
    created_at: T0,
    status: 'ACTIVE',
  });
  registry.putComposition(compositionRoot);

  // Own evidence about the composition's chain (subject = its v1 id).
  const compositionEvidence = [
    successEvidence(compositionRoot.envelope.id, 2),
    interventionalEvidence(compositionRoot.envelope.id),
  ];
  registry.promote({
    id: compositionRoot.envelope.id,
    target: 'FORMING',
    evidence: compositionEvidence,
    evidence_refs: compositionEvidence.map((record) => record.id),
    provenance: ['w6:registry-test:resize-composition:v2'],
    created_at: T1,
    changes: 'forming with own evidence',
  });
  let compositionHead = registry.current(compositionRoot.envelope.id)!.artifact.envelope.id;
  registry.promote({
    id: compositionHead,
    target: 'VALIDATED',
    evidence: compositionEvidence,
    evidence_refs: compositionEvidence.map((record) => record.id),
    additional_applicability: [calibratedEdgeEstimate(0.91)],
    provenance: ['w6:registry-test:resize-composition:v3'],
    created_at: T2,
    changes: 'validated with own evidence',
  });
  compositionHead = registry.current(compositionHead)!.artifact.envelope.id;

  const packageEvidence = [
    successEvidence(subject, 10),
    successEvidence(subject, 11),
    comparativeEvidence(subject),
  ];

  const edgeCacheA = registerAndPromotePackage(
    registry,
    {
      capability: 'image-resize',
      family: 'edge-cache',
      dimension: 'LATENCY',
      stance: 'single-hop edge resize, lowest latency',
      evidence: packageEvidence,
      applicability: [calibratedEdgeEstimate(0.88)],
      context: { deployment: 'edge' },
      limitations: ['cold starts spike latency'],
      seed: 'edge-a',
    },
    'VALIDATED',
  );

  const edgeCacheB = registerAndPromotePackage(
    registry,
    {
      capability: 'image-resize',
      family: 'edge-cache',
      dimension: 'LATENCY',
      stance: 'batched edge resize',
      evidence: packageEvidence,
      applicability: [calibratedEdgeEstimate(0.8)],
      context: { deployment: 'edge' },
      seed: 'edge-b',
    },
    'VALIDATED',
  );

  const durableQueue = registerAndPromotePackage(
    registry,
    {
      capability: 'image-resize',
      family: 'durable-queue',
      dimension: 'RESILIENCE',
      stance: 'queue-backed resize, survives node loss',
      evidence: packageEvidence,
      applicability: [
        {
          kind: 'QUALITATIVE',
          uncertainty_class: 'STRONG',
          context: { deployment: 'central' },
          sample_size: 3,
          window: null,
        },
      ],
      context: { deployment: 'central' },
      limitations: ['higher end-to-end latency under load'],
      seed: 'durable',
    },
    'VALIDATED',
  );

  const privacyLocal = registerAndPromotePackage(
    registry,
    {
      capability: 'image-resize',
      family: 'privacy-local',
      dimension: 'PRIVACY',
      stance: 'on-device resize, pixels never leave the client',
      evidence: packageEvidence.slice(0, 2),
      context: { deployment: 'client' },
      limitations: ['no server-side batching'],
      seed: 'privacy',
    },
    'FORMING',
  );

  return {
    registry,
    members,
    edgeCacheA,
    edgeCacheB,
    durableQueue,
    privacyLocal,
    composition: registry.get(compositionHead)!.artifact as PackageCompositionArtifact,
    compositionEvidence,
    packageEvidence,
  };
}
