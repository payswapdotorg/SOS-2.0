/**
 * Shared test fixtures for @sos-2/search tests (self-contained, the repo
 * convention): a real registry + retrieval facade fixture (the W6/W7
 * pattern), mission-shaped constraint sets, generated candidates for the
 * lower ladder rungs, and policy helpers.
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
import { PackageRegistry } from '@sos-2/registry';
import { RetrievalFacade } from '@sos-2/retrieval';
import type { SearchCandidate } from '../src/index.js';
import type { CandidateGenerator, HardConstraintSet, HardConstraintView } from '../src/index.js';

export const T0 = '2025-01-01T00:00:00.000Z';
export const T1 = '2025-01-02T00:00:00.000Z';
export const T2 = '2025-01-03T12:30:00.000Z';
export const T3 = '2025-01-04T00:00:00.000Z';
export const W0: TimeWindow = { start: T0, end: T1 };
export const W1: TimeWindow = { start: T1, end: T2 };

export const CALIBRATION = deriveDeterministicArtifactId('Evaluation', {
  note: 'w7 search test calibration',
  producer: 'search-bench-v1',
  brier_score: 0.05,
});

export const REALIZATION_REF = deriveDeterministicArtifactId('ImplementationModel', {
  note: 'w7 search test realization',
  revision: 1,
});

function toolProducer(): Producer {
  return {
    tool: 'otel-collector',
    tool_version: '0.90.0',
    model: null,
    model_version: null,
    command: 'collect --env production',
    environment: 'ci:local',
  };
}

function experimentProducer(): Producer {
  return {
    tool: 'experiment-runner',
    tool_version: '1.2.0',
    model: null,
    model_version: null,
    command: 'run --plan search-ab.yaml',
    environment: 'ci:local',
  };
}

function makeEvidence(subject: string, overrides: Partial<CreateEvidenceInput> = {}): EvidenceRecordW3 {
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

function successEvidence(subject: string, i = 0): EvidenceRecordW3 {
  return makeEvidence(subject, { provenance: [`observation:sha256:${String(i).padStart(64, '0')}`] });
}

function comparativeEvidence(subject: string): EvidenceRecordW3 {
  return makeEvidence(subject, {
    kind: 'benchmark-comparison',
    method: 'benchmark:comparison-result',
    provenance: ['benchmark:sha256:' + 'c'.repeat(64)],
  });
}

function interventionalEvidence(subject: string): EvidenceRecordW3 {
  return makeEvidence(subject, {
    kind: 'fault-injection',
    evidence_class: 'INTERVENTIONAL',
    method: 'experiment:intervention-result',
    provenance: ['experiment:sha256:' + 'i'.repeat(64)],
    producer: experimentProducer(),
  });
}

// ---------------------------------------------------------------------------
// Registry fixture (W6 pattern; see packages/registry/test/helpers.ts)
// ---------------------------------------------------------------------------

interface PackageSpec {
  capability: string;
  family: string;
  dimension: 'COST' | 'LATENCY' | 'RESILIENCE' | 'PRIVACY';
  stance: string;
  contracts?: string[];
  evidence: EvidenceRecordW3[];
  applicability?: ApplicabilityEstimate[];
  context?: Record<string, string>;
  limitations?: string[];
  seed: string;
}

function buildPackage(spec: PackageSpec): PackageArtifact {
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
    failure_refs: [],
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
  return createPackageArtifact({ content, provenance: [`w7:search-test:${spec.seed}`], created_at: T0, status: 'ACTIVE' });
}

const VALIDATION_REALIZATION: PackageRealization = {
  ref: REALIZATION_REF,
  revision: 'git:94a75683dd2870d11abbf12a1e07218bb736440b',
  note: 'the validated realization',
};

function registerAndPromotePackage(
  registry: PackageRegistry,
  spec: PackageSpec,
  target: Extract<PackageMaturity, 'FORMING' | 'VALIDATED'>,
): PackageArtifact {
  const root = buildPackage(spec);
  registry.putPackage(root);
  const stamp = (n: number, note: string) => ({
    provenance: [`w7:search-test:${spec.seed}:v${n}`],
    created_at: [T0, T1, T2, T3][n % 4] ?? T0,
    changes: `${note} (${spec.seed} v${n})`,
  });
  registry.promote({ id: root.envelope.id, target: 'FORMING', evidence: spec.evidence, ...stamp(1, 'forming') });
  let headId = registry.current(root.envelope.id)!.artifact.envelope.id;
  if (target === 'VALIDATED') {
    registry.promote({
      id: headId,
      target: 'VALIDATED',
      evidence: spec.evidence,
      additional_realizations: [VALIDATION_REALIZATION],
      ...stamp(2, 'validated'),
    });
    headId = registry.current(headId)!.artifact.envelope.id;
  }
  return registry.get(headId)!.artifact as PackageArtifact;
}

function calibratedEdgeEstimate(probability: number, sampleSize = 24): ApplicabilityEstimate {
  return {
    kind: 'CALIBRATED',
    probability,
    calibration_ref: CALIBRATION,
    uncertainty_class: 'MODERATE',
    context: { deployment: 'edge' },
    sample_size: sampleSize,
    window: W1,
  };
}

export interface SearchFixture {
  registry: PackageRegistry;
  facade: RetrievalFacade;
  members: PackageArtifact[];
  composition: PackageCompositionArtifact;
  compositionRoot: PackageCompositionArtifact;
  edgeCache: PackageArtifact;
  durableQueue: PackageArtifact;
  privacyLocal: PackageArtifact;
  allEvidence: EvidenceRecordW3[];
}

/**
 * The diverse fixture: a VALIDATED composition (edge-cache family, own
 * evidence, calibrated edge applicability 0.91), a VALIDATED edge-cache
 * package (calibrated 0.88), a VALIDATED durable-queue package (qualitative
 * STRONG, central), a FORMING privacy-local package — capability
 * 'image-resize'.
 */
export function buildSearchFixture(): SearchFixture {
  const registry = new PackageRegistry();
  const subject = deriveDeterministicArtifactId('SystemState', { note: 'w7 search subject', seed: 'image-resize' });

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
    provenance: ['w7:search-test:composition'],
    created_at: T0,
    status: 'ACTIVE',
  });
  registry.putComposition(compositionRoot);

  const compositionEvidence = [
    successEvidence(compositionRoot.envelope.id, 2),
    interventionalEvidence(compositionRoot.envelope.id),
  ];
  registry.promote({
    id: compositionRoot.envelope.id,
    target: 'FORMING',
    evidence: compositionEvidence,
    evidence_refs: compositionEvidence.map((record) => record.id),
    provenance: ['w7:search-test:composition:v2'],
    created_at: T1,
    changes: 'forming with own evidence',
  });
  let compositionHead = registry.current(compositionRoot.envelope.id)!.artifact.envelope.id;
  registry.promote({
    id: compositionHead,
    target: 'VALIDATED',
    evidence: compositionEvidence,
    evidence_refs: compositionEvidence.map((record) => record.id),
    additional_applicability: [calibratedEdgeEstimate(0.91, 24)],
    provenance: ['w7:search-test:composition:v3'],
    created_at: T2,
    changes: 'validated with own evidence',
  });
  compositionHead = registry.current(compositionHead)!.artifact.envelope.id;

  const packageEvidence = [
    successEvidence(subject, 10),
    successEvidence(subject, 11),
    comparativeEvidence(subject),
  ];

  const edgeCache = registerAndPromotePackage(
    registry,
    {
      capability: 'image-resize',
      family: 'edge-cache',
      dimension: 'LATENCY',
      stance: 'single-hop edge resize, lowest latency',
      evidence: packageEvidence,
      applicability: [calibratedEdgeEstimate(0.88, 40)],
      context: { deployment: 'edge' },
      limitations: ['cold starts spike latency'],
      seed: 'edge-a',
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
      seed: 'privacy',
    },
    'FORMING',
  );

  return {
    registry,
    facade: new RetrievalFacade(registry),
    members,
    compositionRoot,
    composition: registry.get(compositionHead)!.artifact as PackageCompositionArtifact,
    edgeCache,
    durableQueue,
    privacyLocal,
    allEvidence: [...memberEvidence, ...compositionEvidence, ...packageEvidence],
  };
}

// ---------------------------------------------------------------------------
// Search-specific builders
// ---------------------------------------------------------------------------

/** A mission-shaped constraint view (the @sos-2/mission MissionConstraint shape). */
export function constraintView(
  id: string,
  axis: string | null,
  direction: 'MAX' | 'MIN' = 'MAX',
  limit = 100,
  hard = true,
): HardConstraintView {
  return {
    id,
    statement: `constraint ${id}`,
    hard,
    bound: axis === null ? null : { axis, direction, limit },
  };
}

/** A hard-constraint set from mission-shaped views. */
export function constraintSet(source: string, constraints: HardConstraintView[]): HardConstraintSet {
  return {
    source,
    constraints,
    machine_checkable: constraints.filter((constraint) => constraint.hard && constraint.bound !== null),
  };
}

/** A generated candidate for a lower ladder rung. */
export function generatedCandidate(input: {
  seed: string;
  altitude: 'ARCHITECTURE_PATTERN' | 'NOVEL_ARCHITECTURE' | 'LOW_LEVEL_SYNTHESIS';
  family: string;
  capability?: string;
  estimates?: Record<string, number>;
  calibratedProbability?: number;
  sampleSize?: number;
}): SearchCandidate {
  return {
    id: deriveDeterministicArtifactId('CandidateState', {
      note: 'w7 search generated candidate',
      seed: input.seed,
      altitude: input.altitude,
    }),
    capability: input.capability ?? 'image-resize',
    altitude: input.altitude,
    origin: input.altitude,
    family: input.family,
    dimensions: [{ dimension: 'COST', stance: 'generated candidate' }],
    estimates: input.estimates ?? {},
    uncertainty: {
      uncertainty_class: 'UNQUANTIFIED',
      sample_size: input.sampleSize ?? 0,
      context_match: 'NO_QUERY_CONTEXT',
      ...(input.calibratedProbability !== undefined
        ? {
            calibrated: {
              probability: input.calibratedProbability,
              sample_size: input.sampleSize ?? 1,
              window: null,
              calibration_ref: CALIBRATION,
            },
          }
        : {}),
    },
  };
}

/** A generator returning fixed candidates (a pluggable reasoning mechanism). */
export function fixedGenerator(candidates: SearchCandidate[]): CandidateGenerator {
  return () => candidates.map((candidate) => structuredClone(candidate));
}
