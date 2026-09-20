/**
 * Shared test fixtures for @sos-2/greenfield tests (the repo convention —
 * self-contained, deterministic, mirroring the W6/W7 registry fixture
 * pattern): a package ecology with VALIDATED members + a VALIDATED
 * composition (own evidence) + a durable-queue package with RETAINED
 * failure memory + a FORMING privacy-local package; the golden mission
 * input, risk profile, realization plan, observations and run context; and
 * a parameterized world builder for the property tests.
 */

import { createGrant } from '@sos-2/authority';
import type { AuthorityGrantArtifact } from '@sos-2/authority';
import { createEvidence } from '@sos-2/evidence';
import type { CreateEvidenceInput, EvidenceRecordW3 } from '@sos-2/evidence';
import { createPackageArtifact } from '@sos-2/packages';
import type { ApplicabilityEstimate, PackageArtifact, PackageContent, PackageRealization } from '@sos-2/packages';
import { createPackageComposition } from '@sos-2/composition';
import type { PackageCompositionArtifact } from '@sos-2/composition';
import { PackageRegistry } from '@sos-2/registry';
import type { EvidenceResolver } from '@sos-2/registry';
import { deriveDeterministicArtifactId } from '@sos-2/semantic-spine';
import type { Producer, TimeWindow } from '@sos-2/provenance';
import type { RawObservation } from '@sos-2/telemetry';
import type {
  GreenfieldAskDecider,
  GreenfieldMissionInput,
  GreenfieldRealizationPlan,
  GreenfieldRiskProfile,
  GreenfieldRunContext,
  GreenfieldWorld,
} from '../src/index.js';

// ---------------------------------------------------------------------------
// Fixed instants (ecology timestamps T0..T3; run instants R0..R5)
// ---------------------------------------------------------------------------

export const T0 = '2025-06-01T00:00:00.000Z';
export const T1 = '2025-06-01T06:00:00.000Z';
export const T2 = '2025-06-01T12:00:00.000Z';
export const T3 = '2025-06-01T18:00:00.000Z';

export const RUN_PROVENANCE = ['W14:greenfield-test'];

export function buildRunContext(): GreenfieldRunContext {
  return {
    provenance: [...RUN_PROVENANCE],
    t_mission: '2025-06-02T00:00:00.000Z',
    t_candidate: '2025-06-02T00:01:00.000Z',
    t_decision: '2025-06-02T00:02:00.000Z',
    t_ask: '2025-06-02T00:03:00.000Z',
    t_realization: '2025-06-02T00:04:00.000Z',
    t_reconciliation: '2025-06-02T00:05:00.000Z',
    t_evidence: '2025-06-02T00:06:00.000Z',
  };
}

const ECOLOGY_WINDOW: TimeWindow = { start: T0, end: T3 };
const OBSERVATION_WINDOW: TimeWindow = { start: '2025-06-02T00:00:00.000Z', end: '2025-06-02T01:00:00.000Z' };

export const CALIBRATION = deriveDeterministicArtifactId('Evaluation', {
  note: 'w14 greenfield test calibration',
  producer: 'greenfield-bench-v1',
  brier_score: 0.06,
});

export const REALIZATION_REF = deriveDeterministicArtifactId('ImplementationModel', {
  note: 'w14 greenfield test member realization',
  revision: 1,
});

// ---------------------------------------------------------------------------
// Producers + evidence
// ---------------------------------------------------------------------------

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
    command: 'run --plan greenfield-ab.yaml',
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
    window: ECOLOGY_WINDOW,
    subject_revision: null,
    producer: toolProducer(),
    ...overrides,
  });
}

function successEvidence(subject: string, i: number): EvidenceRecordW3 {
  return makeEvidence(subject, {
    provenance: [`observation:sha256:${String(i).padStart(64, '0')}`],
  });
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

function failureEvidence(subject: string): EvidenceRecordW3 {
  return makeEvidence(subject, {
    availability: 'FAILURE',
    kind: 'incident-report',
    method: 'incident:postmortem',
    provenance: ['incident:sha256:' + 'f'.repeat(64)],
  });
}

// ---------------------------------------------------------------------------
// The package ecology (parameterized by capability for the property tests)
// ---------------------------------------------------------------------------

export interface EcologyFixture {
  registry: PackageRegistry;
  evidenceResolver: EvidenceResolver;
  allEvidence: EvidenceRecordW3[];
  members: PackageArtifact[];
  composition: PackageCompositionArtifact;
  edgePackage: PackageArtifact;
  durablePackage: PackageArtifact;
  privacyPackage: PackageArtifact;
}

interface PackageSpec {
  capability: string;
  family: string;
  dimension: 'COST' | 'LATENCY' | 'RESILIENCE' | 'PRIVACY';
  stance: string;
  contracts: string[];
  evidence: EvidenceRecordW3[];
  failureRefs?: string[];
  applicability?: ApplicabilityEstimate[];
  context?: Record<string, string>;
  limitations?: string[];
  seed: string;
}

function buildPackage(spec: PackageSpec): PackageArtifact {
  const content: PackageContent = {
    semantic_capability: spec.capability,
    contracts: [...spec.contracts],
    preconditions: ['the reuse context is compatible'],
    postconditions: ['the capability is delivered as contracted'],
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
    failure_refs: [...(spec.failureRefs ?? [])],
    compatibility_refs: [],
    composition_refs: [],
    assurance_obligations: [{ kind: 'TEST', obligation: 'the package tests pass in the reuse context' }],
    context: spec.context ?? { deployment: 'central' },
    learned_limitations: [...(spec.limitations ?? [])],
    diversity_profile: {
      family: spec.family,
      dimensions: [{ dimension: spec.dimension, stance: spec.stance }],
    },
    maturity: 'DISCOVERED',
    changes: `initial discovery (${spec.seed})`,
    superseded_by: null,
  };
  return createPackageArtifact({
    content,
    provenance: [`W14:greenfield-test:${spec.seed}`],
    created_at: T0,
    status: 'ACTIVE',
  });
}

const VALIDATION_REALIZATION: PackageRealization = {
  ref: REALIZATION_REF,
  revision: 'git:94a75683dd2870d11abbf12a1e07218bb736440b',
  note: 'the validated realization',
};

function registerAndPromotePackage(
  registry: PackageRegistry,
  spec: PackageSpec,
  target: 'FORMING' | 'VALIDATED',
): PackageArtifact {
  const root = buildPackage(spec);
  registry.putPackage(root);
  const stamp = (n: number, note: string) => ({
    provenance: [`W14:greenfield-test:${spec.seed}:v${String(n)}`],
    created_at: [T0, T1, T2, T3][n % 4] ?? T0,
    changes: `${note} (${spec.seed} v${String(n)})`,
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

/**
 * The diverse ecology: two VALIDATED member packages (storage + transform,
 * edge-cache family), one VALIDATED composition of them (own evidence +
 * calibrated edge applicability), one VALIDATED durable-queue package with
 * RETAINED failure memory, one FORMING privacy-local package — capability
 * `${capability}`.
 */
export function buildEcology(capability: string): EcologyFixture {
  const registry = new PackageRegistry();
  const packageSubject = deriveDeterministicArtifactId('SystemState', {
    note: 'w14 greenfield test package subject',
    capability,
  });
  const storageContract = `contract:${capability}/storage/v1`;
  const transformContract = `contract:${capability}/transform/v1`;
  const compositionContract = `contract:${capability}/v1`;

  const memberEvidence = [
    successEvidence(REALIZATION_REF, 0),
    successEvidence(REALIZATION_REF, 1),
    comparativeEvidence(REALIZATION_REF),
  ];
  const members = [
    registerAndPromotePackage(
      registry,
      {
        capability: `${capability}-storage`,
        family: 'edge-cache',
        dimension: 'LATENCY',
        stance: 'sub-10ms p99 at the edge',
        contracts: [storageContract],
        evidence: memberEvidence,
        seed: `member-storage-${capability}`,
      },
      'VALIDATED',
    ),
    registerAndPromotePackage(
      registry,
      {
        capability: `${capability}-transform`,
        family: 'edge-cache',
        dimension: 'LATENCY',
        stance: 'hardware-accelerated transform',
        contracts: [transformContract],
        evidence: memberEvidence,
        seed: `member-transform-${capability}`,
      },
      'VALIDATED',
    ),
  ];

  const compositionRoot = createPackageComposition({
    content: {
      semantic_capability: capability,
      contracts: [compositionContract],
      members: [
        { package_id: members[0]!.envelope.id, role: 'storage', bound_contracts: [storageContract] },
        { package_id: members[1]!.envelope.id, role: 'transform', bound_contracts: [transformContract] },
      ],
      bindings: [
        {
          kind: 'DATA_FLOW',
          source_role: 'transform',
          target_role: 'storage',
          contract: compositionContract,
          wiring: { path: `${capability}-output` },
        },
      ],
      preconditions: ['edge nodes are warm'],
      postconditions: [`${capability} delivered at the edge`],
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
      assurance_obligations: [{ kind: 'REPLAY', obligation: `the composed ${capability} replays from the edge log` }],
      context: { deployment: 'edge' },
      learned_limitations: [],
      diversity_profile: {
        family: 'edge-cache',
        dimensions: [{ dimension: 'LATENCY', stance: `sub-50ms composed p99 for ${capability}` }],
      },
      maturity: 'DISCOVERED',
      independence: [],
      changes: 'initial composition hypothesis',
      superseded_by: null,
    },
    provenance: [`W14:greenfield-test:composition-${capability}`],
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
    provenance: [`W14:greenfield-test:composition-${capability}:v2`],
    created_at: T1,
    changes: 'forming with own evidence',
  });
  let compositionHead = registry.current(compositionRoot.envelope.id)!.artifact.envelope.id;
  registry.promote({
    id: compositionHead,
    target: 'VALIDATED',
    evidence: compositionEvidence,
    evidence_refs: compositionEvidence.map((record) => record.id),
    additional_applicability: [
      {
        kind: 'CALIBRATED',
        probability: 0.91,
        calibration_ref: CALIBRATION,
        uncertainty_class: 'MODERATE',
        context: { deployment: 'edge' },
        sample_size: 24,
        window: ECOLOGY_WINDOW,
      },
    ],
    provenance: [`W14:greenfield-test:composition-${capability}:v3`],
    created_at: T2,
    changes: 'validated with own evidence',
  });
  compositionHead = registry.current(compositionHead)!.artifact.envelope.id;
  const composition = registry.get(compositionHead)!.artifact as PackageCompositionArtifact;

  const packageEvidence = [
    successEvidence(packageSubject, 10),
    successEvidence(packageSubject, 11),
    comparativeEvidence(packageSubject),
  ];

  const edgePackage = registerAndPromotePackage(
    registry,
    {
      capability,
      family: 'edge-cache',
      dimension: 'LATENCY',
      stance: 'single-hop edge delivery, lowest latency',
      contracts: [compositionContract],
      evidence: packageEvidence,
      applicability: [
        {
          kind: 'CALIBRATED',
          probability: 0.88,
          calibration_ref: CALIBRATION,
          uncertainty_class: 'MODERATE',
          context: { deployment: 'edge' },
          sample_size: 40,
          window: ECOLOGY_WINDOW,
        },
      ],
      context: { deployment: 'edge' },
      limitations: ['cold starts spike latency'],
      seed: `edge-${capability}`,
    },
    'VALIDATED',
  );

  const durableFailure = failureEvidence(packageSubject);
  const durablePackage = registerAndPromotePackage(
    registry,
    {
      capability,
      family: 'durable-queue',
      dimension: 'RESILIENCE',
      stance: 'queue-backed delivery, survives node loss',
      contracts: [compositionContract],
      evidence: packageEvidence,
      failureRefs: [durableFailure.id],
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
      seed: `durable-${capability}`,
    },
    'VALIDATED',
  );
  const allEvidence = [
    ...memberEvidence,
    ...compositionEvidence,
    ...packageEvidence,
    durableFailure,
  ];
  const byId = new Map(allEvidence.map((record) => [record.id, record]));
  const evidenceResolver: EvidenceResolver = (id) => byId.get(id);

  const privacyPackage = registerAndPromotePackage(
    registry,
    {
      capability,
      family: 'privacy-local',
      dimension: 'PRIVACY',
      stance: 'on-premises delivery, data never leaves the region',
      contracts: [compositionContract],
      evidence: packageEvidence,
      context: { deployment: 'on-prem' },
      limitations: ['regional capacity limits'],
      seed: `privacy-${capability}`,
    },
    'FORMING',
  );

  return {
    registry,
    evidenceResolver,
    allEvidence,
    members,
    composition,
    edgePackage,
    durablePackage,
    privacyPackage,
  };
}

// ---------------------------------------------------------------------------
// The golden world + inputs
// ---------------------------------------------------------------------------

export const GOLDEN_CAPABILITY = 'image-resize';

export function validGrant(): AuthorityGrantArtifact {
  return createGrant({
    grantee: 'w14-greenfield-actor',
    scope: { kind: 'KIND', artifact_kind: 'PackageComposition' },
    permissions: ['READ', 'REVISE', 'PROMOTE'],
    expiry: { kind: 'TIME', at: '2025-12-31T00:00:00.000Z' },
    provenance: [...RUN_PROVENANCE, 'authority:realization-grant'],
    created_at: T0,
    status: 'ACTIVE',
  });
}

export function buildWorld(options: { grants?: AuthorityGrantArtifact[]; ecology?: EcologyFixture } = {}): GreenfieldWorld {
  const ecology = options.ecology ?? buildEcology(GOLDEN_CAPABILITY);
  return {
    registry: ecology.registry,
    evidenceResolver: ecology.evidenceResolver,
    grants: options.grants ?? [validGrant()],
  };
}

export function buildMissionInput(capability: string = GOLDEN_CAPABILITY): GreenfieldMissionInput {
  return {
    purpose: `Deliver fast, resilient ${capability} for a global catalogue.`,
    capability,
    contracts: [`contract:${capability}/v1`],
    goals: [
      {
        id: 'goal-latency',
        statement: `Keep ${capability} p99 latency under 100ms`,
        measures: ['measure-p99'],
      },
      {
        id: 'goal-cost',
        statement: 'Keep monthly infrastructure cost within budget',
        measures: ['measure-cost'],
      },
      {
        id: 'goal-trust',
        statement: 'Earn stakeholder trust through auditable delivery',
        measures: [],
      },
    ],
    measures: [
      { id: 'measure-p99', description: `${capability} p99 latency`, target: '<100ms', unit: 'ms' },
      { id: 'measure-cost', description: 'Monthly infrastructure cost', target: '<=600', unit: 'euros' },
    ],
    outcomes: [
      { id: 'outcome-fast-delivery', description: 'Users experience fast delivery', goal_refs: ['goal-latency'] },
    ],
    stakeholders: [
      { id: 'stakeholder-users', name: 'End users', interest: 'fast results' },
      { id: 'stakeholder-finance', name: 'Finance', interest: 'predictable cost' },
    ],
    assumptions: [{ id: 'assumption-growth', statement: 'Traffic grows at most 2x year over year' }],
    ambiguities: [
      { id: 'ambiguity-regions', statement: 'Which regions matter first?', resolution: 'Resolved: EU first' },
    ],
    constraints: [
      {
        id: 'constraint-cost',
        statement: 'Monthly infrastructure cost stays within budget',
        hard: true,
        bound: { axis: 'monthly-cost', direction: 'MAX', limit: 600 },
      },
      {
        id: 'constraint-latency',
        statement: 'p99 latency stays within the declared budget',
        hard: true,
        bound: { axis: 'p99-latency', direction: 'MAX', limit: 100 },
      },
      {
        id: 'constraint-privacy',
        statement: 'Prefer privacy-local deployments',
        hard: false,
        bound: null,
      },
    ],
  };
}

export function buildRiskProfile(): GreenfieldRiskProfile {
  return {
    blast_radius: 'SERVICE',
    impact: 'MODERATE',
    risk: 'MODERATE',
    reversibility: 'REVERSIBLE',
    causal_claim: false,
    uncertainty_class: 'MODERATE',
    uncertainty_basis:
      'the composed candidate reuses validated members, but composition-level behavior in the mission context is not yet observed',
  };
}

/** The exact W14 base revision (the exact-revision discipline). */
export const W14_BASE_REVISION = 'fba1a657e08603ca9da2b26b27964716dc654c75';

export function buildRealizationPlan(): GreenfieldRealizationPlan {
  return {
    revision: W14_BASE_REVISION,
    environment: 'production',
    configuration: [{ config_id: 'greenfield-config', revision: { kind: 'config-version', value: 'v1' } }],
    deployment: [
      {
        deployment_id: 'deploy:greenfield-prod-2025-06',
        environment: 'production',
        revision: { kind: 'deployment-id', value: 'dpl_w14_greenfield_01' },
      },
    ],
    policy: [{ policy_id: 'deployment-policy', version: 1 }],
    environment_relationships: [{ source: 'staging', target: 'production', kind: 'promotes-to' }],
  };
}

export function buildObservations(): RawObservation[] {
  const run = buildRunContext();
  const window: TimeWindow = { start: run.t_evidence, end: '2025-06-02T01:00:00.000Z' };
  const producer = toolProducer();
  return [
    {
      subject_ref: 'otel:service:greenfield',
      availability: 'SUCCESS',
      window,
      observed: { p99_ms: 62, monthly_cost: 431 },
      attributes: { region: 'eu-west-1' },
      producer,
    },
    {
      subject_ref: 'otel:service:greenfield',
      availability: 'SUCCESS',
      window,
      observed: { requests: 1048576, errors: 0 },
      attributes: { region: 'eu-west-1' },
      producer,
    },
    {
      // A truthful gap: the cold-start probe was not captured — UNAVAILABLE,
      // never folded into success or zero.
      subject_ref: 'otel:probe:cold-start',
      availability: 'UNAVAILABLE',
      window,
      observed: null,
      attributes: { probe: 'cold-start' },
      producer,
    },
  ];
}

/** The golden pipeline input assembly (the package-level golden scenario). */
export function buildPipelineInput(options: {
  grants?: AuthorityGrantArtifact[];
  decider?: GreenfieldAskDecider | null;
  missionCapability?: string;
} = {}) {
  const capability = options.missionCapability ?? GOLDEN_CAPABILITY;
  const ecology = buildEcology(capability);
  return {
    mission_input: buildMissionInput(capability),
    world: buildWorld({ ecology, grants: options.grants ?? [validGrant()] }),
    risk: buildRiskProfile(),
    realization: buildRealizationPlan(),
    observations: buildObservations(),
    decider: options.decider ?? null,
    search_policy: { kind: 'GREEDY' } as const,
    run: buildRunContext(),
  };
}
