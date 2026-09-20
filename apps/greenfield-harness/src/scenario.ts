/**
 * The golden demo scenario of the W14 greenfield harness — FIXED inputs,
 * FIXED seed, no network, no time dependence (every instant is a literal).
 *
 * The package ecology (built through the merged packages' own APIs — the
 * harness contains ZERO domain logic of its own):
 *
 *   - two VALIDATED member packages (edge storage + edge transform);
 *   - one VALIDATED composition of them for the mission capability, with
 *     its OWN evidence (one observational SUCCESS + one INTERVENTIONAL
 *     record) and a calibrated edge-context applicability estimate;
 *   - one VALIDATED durable-queue package with RETAINED failure memory
 *     (a FAILURE evidence record — negative evidence is never dropped);
 *   - one FORMING privacy-local package (adaptation altitude — retrievable
 *     but below the validated rungs the greenfield search stops at).
 *
 * The authority: one covering grant (KIND-scoped to PackageComposition,
 * PROMOTE permission, valid across the whole run) — the golden run decides
 * ACT; the harness's ask-path test exercises the escalated alternative.
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
  GreenfieldMissionInput,
  GreenfieldPipelineInput,
  GreenfieldRealizationPlan,
  GreenfieldRiskProfile,
  GreenfieldRunContext,
  GreenfieldWorld,
} from '@sos-2/greenfield';

// ---------------------------------------------------------------------------
// Fixed instants (ecology T0..T3; run R0..R5) — no hidden clocks anywhere
// ---------------------------------------------------------------------------

export const ECOLOGY_T0 = '2025-05-01T00:00:00.000Z';
export const ECOLOGY_T1 = '2025-05-02T00:00:00.000Z';
export const ECOLOGY_T2 = '2025-05-03T00:00:00.000Z';
export const ECOLOGY_T3 = '2025-05-04T00:00:00.000Z';

export const RUN_PROVENANCE = ['W14:greenfield-harness:golden-run'];

export const RUN_CONTEXT: GreenfieldRunContext = {
  provenance: [...RUN_PROVENANCE],
  t_mission: '2025-06-02T00:00:00.000Z',
  t_candidate: '2025-06-02T00:01:00.000Z',
  t_decision: '2025-06-02T00:02:00.000Z',
  t_ask: '2025-06-02T00:03:00.000Z',
  t_realization: '2025-06-02T00:04:00.000Z',
  t_reconciliation: '2025-06-02T00:05:00.000Z',
  t_evidence: '2025-06-02T00:06:00.000Z',
};

const ECOLOGY_WINDOW: TimeWindow = { start: ECOLOGY_T0, end: ECOLOGY_T3 };
const OBSERVATION_WINDOW: TimeWindow = { start: '2025-06-02T00:00:00.000Z', end: '2025-06-02T01:00:00.000Z' };

export const CAPABILITY = 'image-resize';
export const MISSION_CONTRACT = `contract:${CAPABILITY}/v1`;
export const STORAGE_CONTRACT = `contract:${CAPABILITY}/storage/v1`;
export const TRANSFORM_CONTRACT = `contract:${CAPABILITY}/transform/v1`;

/** The exact W14 base revision the harness realization is built from. */
export const REALIZED_REVISION = 'fba1a657e08603ca9da2b26b27964716dc654c75';

const CALIBRATION = deriveDeterministicArtifactId('Evaluation', {
  note: 'w14 greenfield harness calibration',
  producer: 'greenfield-bench-v1',
  brier_score: 0.06,
});

const MEMBER_REALIZATION_REF = deriveDeterministicArtifactId('ImplementationModel', {
  note: 'w14 greenfield harness member realization',
  revision: 1,
});

// ---------------------------------------------------------------------------
// Producers + evidence (all records minted through @sos-2/evidence)
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

function failureEvidence(subject: string): EvidenceRecordW3 {
  return makeEvidence(subject, {
    availability: 'FAILURE',
    kind: 'incident-report',
    method: 'incident:postmortem',
    provenance: ['incident:sha256:' + 'f'.repeat(64)],
  });
}

// ---------------------------------------------------------------------------
// The package ecology
// ---------------------------------------------------------------------------

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
    provenance: [`W14:greenfield-harness:${spec.seed}`],
    created_at: ECOLOGY_T0,
    status: 'ACTIVE',
  });
}

const VALIDATION_REALIZATION: PackageRealization = {
  ref: MEMBER_REALIZATION_REF,
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
    provenance: [`W14:greenfield-harness:${spec.seed}:v${String(n)}`],
    created_at: [ECOLOGY_T0, ECOLOGY_T1, ECOLOGY_T2, ECOLOGY_T3][n % 4] ?? ECOLOGY_T0,
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

export interface GoldenEcology {
  registry: PackageRegistry;
  evidenceResolver: EvidenceResolver;
  members: PackageArtifact[];
  composition: PackageCompositionArtifact;
  durablePackage: PackageArtifact;
  privacyPackage: PackageArtifact;
}

/** The golden package ecology (deterministic; byte-identical across builds). */
export function buildGoldenEcology(): GoldenEcology {
  const registry = new PackageRegistry();
  const packageSubject = deriveDeterministicArtifactId('SystemState', {
    note: 'w14 greenfield harness package subject',
    capability: CAPABILITY,
  });

  const memberEvidence = [
    successEvidence(MEMBER_REALIZATION_REF, 0),
    successEvidence(MEMBER_REALIZATION_REF, 1),
    comparativeEvidence(MEMBER_REALIZATION_REF),
  ];
  const members = [
    registerAndPromotePackage(
      registry,
      {
        capability: `${CAPABILITY}-storage`,
        family: 'edge-cache',
        dimension: 'LATENCY',
        stance: 'sub-10ms p99 at the edge',
        contracts: [STORAGE_CONTRACT],
        evidence: memberEvidence,
        seed: 'member-storage',
      },
      'VALIDATED',
    ),
    registerAndPromotePackage(
      registry,
      {
        capability: `${CAPABILITY}-transform`,
        family: 'edge-cache',
        dimension: 'LATENCY',
        stance: 'hardware-accelerated transform',
        contracts: [TRANSFORM_CONTRACT],
        evidence: memberEvidence,
        seed: 'member-transform',
      },
      'VALIDATED',
    ),
  ];

  const compositionRoot = createPackageComposition({
    content: {
      semantic_capability: CAPABILITY,
      contracts: [MISSION_CONTRACT],
      members: [
        { package_id: members[0]!.envelope.id, role: 'storage', bound_contracts: [STORAGE_CONTRACT] },
        { package_id: members[1]!.envelope.id, role: 'transform', bound_contracts: [TRANSFORM_CONTRACT] },
      ],
      bindings: [
        {
          kind: 'DATA_FLOW',
          source_role: 'transform',
          target_role: 'storage',
          contract: MISSION_CONTRACT,
          wiring: { path: 'resized-images' },
        },
      ],
      preconditions: ['edge nodes are warm'],
      postconditions: [`${CAPABILITY} delivered at the edge`],
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
      assurance_obligations: [{ kind: 'REPLAY', obligation: `the composed ${CAPABILITY} replays from the edge log` }],
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
    provenance: ['W14:greenfield-harness:composition'],
    created_at: ECOLOGY_T0,
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
    provenance: ['W14:greenfield-harness:composition:v2'],
    created_at: ECOLOGY_T1,
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
    provenance: ['W14:greenfield-harness:composition:v3'],
    created_at: ECOLOGY_T2,
    changes: 'validated with own evidence',
  });
  compositionHead = registry.current(compositionHead)!.artifact.envelope.id;
  const composition = registry.get(compositionHead)!.artifact as PackageCompositionArtifact;

  const packageEvidence = [
    successEvidence(packageSubject, 10),
    successEvidence(packageSubject, 11),
    comparativeEvidence(packageSubject),
  ];

  const durableFailure = failureEvidence(packageSubject);
  const durablePackage = registerAndPromotePackage(
    registry,
    {
      capability: CAPABILITY,
      family: 'durable-queue',
      dimension: 'RESILIENCE',
      stance: 'queue-backed delivery, survives node loss',
      contracts: [MISSION_CONTRACT],
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
      seed: 'durable',
    },
    'VALIDATED',
  );

  const privacyPackage = registerAndPromotePackage(
    registry,
    {
      capability: CAPABILITY,
      family: 'privacy-local',
      dimension: 'PRIVACY',
      stance: 'on-premises delivery, data never leaves the region',
      contracts: [MISSION_CONTRACT],
      evidence: packageEvidence,
      context: { deployment: 'on-prem' },
      limitations: ['regional capacity limits'],
      seed: 'privacy',
    },
    'FORMING',
  );

  const allEvidence = [...memberEvidence, ...compositionEvidence, ...packageEvidence, durableFailure];
  const byId = new Map(allEvidence.map((record) => [record.id, record]));
  const evidenceResolver: EvidenceResolver = (id) => byId.get(id);

  return { registry, evidenceResolver, members, composition, durablePackage, privacyPackage };
}

// ---------------------------------------------------------------------------
// The golden mission + plan + observations + authority
// ---------------------------------------------------------------------------

export const GOLDEN_MISSION: GreenfieldMissionInput = {
  purpose: `Deliver fast, resilient ${CAPABILITY} for a global catalogue.`,
  capability: CAPABILITY,
  contracts: [MISSION_CONTRACT],
  goals: [
    { id: 'goal-latency', statement: `Keep ${CAPABILITY} p99 latency under 100ms`, measures: ['measure-p99'] },
    { id: 'goal-cost', statement: 'Keep monthly infrastructure cost within budget', measures: ['measure-cost'] },
    { id: 'goal-trust', statement: 'Earn stakeholder trust through auditable delivery', measures: [] },
  ],
  measures: [
    { id: 'measure-p99', description: `${CAPABILITY} p99 latency`, target: '<100ms', unit: 'ms' },
    { id: 'measure-cost', description: 'Monthly infrastructure cost', target: '<=600', unit: 'euros' },
  ],
  outcomes: [{ id: 'outcome-fast-delivery', description: 'Users experience fast delivery', goal_refs: ['goal-latency'] }],
  stakeholders: [
    { id: 'stakeholder-users', name: 'End users', interest: 'fast results' },
    { id: 'stakeholder-finance', name: 'Finance', interest: 'predictable cost' },
  ],
  assumptions: [{ id: 'assumption-growth', statement: 'Traffic grows at most 2x year over year' }],
  ambiguities: [{ id: 'ambiguity-regions', statement: 'Which regions matter first?', resolution: 'Resolved: EU first' }],
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
    { id: 'constraint-privacy', statement: 'Prefer privacy-local deployments', hard: false, bound: null },
  ],
};

export const GOLDEN_RISK: GreenfieldRiskProfile = {
  blast_radius: 'SERVICE',
  impact: 'MODERATE',
  risk: 'MODERATE',
  reversibility: 'REVERSIBLE',
  causal_claim: false,
  uncertainty_class: 'MODERATE',
  uncertainty_basis:
    'the composed candidate reuses validated members, but composition-level behavior in the mission context is not yet observed',
};

export const GOLDEN_REALIZATION_PLAN: GreenfieldRealizationPlan = {
  revision: REALIZED_REVISION,
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

export const GOLDEN_OBSERVATIONS: readonly RawObservation[] = [
  {
    subject_ref: 'otel:service:greenfield',
    availability: 'SUCCESS',
    window: OBSERVATION_WINDOW,
    observed: { p99_ms: 62, monthly_cost: 431 },
    attributes: { region: 'eu-west-1' },
    producer: toolProducer(),
  },
  {
    subject_ref: 'otel:service:greenfield',
    availability: 'SUCCESS',
    window: OBSERVATION_WINDOW,
    observed: { requests: 1048576, errors: 0 },
    attributes: { region: 'eu-west-1' },
    producer: toolProducer(),
  },
  {
    // A truthful gap: the cold-start probe was not captured — UNAVAILABLE,
    // never folded into success or zero.
    subject_ref: 'otel:probe:cold-start',
    availability: 'UNAVAILABLE',
    window: OBSERVATION_WINDOW,
    observed: null,
    attributes: { probe: 'cold-start' },
    producer: toolProducer(),
  },
];

/** The covering grant presented to the golden run's decision flow. */
export function goldenGrant(): AuthorityGrantArtifact {
  return createGrant({
    grantee: 'w14-greenfield-harness',
    scope: { kind: 'KIND', artifact_kind: 'PackageComposition' },
    permissions: ['READ', 'REVISE', 'PROMOTE'],
    expiry: { kind: 'TIME', at: '2025-12-31T00:00:00.000Z' },
    provenance: [...RUN_PROVENANCE, 'authority:realization-grant'],
    created_at: ECOLOGY_T0,
    status: 'ACTIVE',
  });
}

/** The golden pipeline input (deterministic assembly of all fixed parts). */
export function buildGoldenScenarioInput(options: { grants?: AuthorityGrantArtifact[] } = {}): GreenfieldPipelineInput {
  const ecology = buildGoldenEcology();
  const world: GreenfieldWorld = {
    registry: ecology.registry,
    evidenceResolver: ecology.evidenceResolver,
    grants: options.grants ?? [goldenGrant()],
  };
  return {
    mission_input: GOLDEN_MISSION,
    world,
    risk: GOLDEN_RISK,
    realization: GOLDEN_REALIZATION_PLAN,
    observations: GOLDEN_OBSERVATIONS,
    decider: null,
    search_policy: { kind: 'GREEDY' },
    run: RUN_CONTEXT,
  };
}
