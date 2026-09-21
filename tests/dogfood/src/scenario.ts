/**
 * The W17 INTEGRATED DOGFOOD SCENARIO — one connected end-to-end journey
 * through the merged SOS 2.0 system, driven EXCLUSIVELY through the public
 * exports of the three harness apps' underlying packages
 * (@sos-2/greenfield W14, @sos-2/brownfield W15, @sos-2/meta-evolution W16
 * — plus every merged authority they orchestrate):
 *
 *   1. MISSION FORMALIZATION + GREENFIELD REALIZATION (W14 stages):
 *      mission -> candidate composition at the highest validated altitude
 *      -> human decision flow (the ASK instance: no grants presented, the
 *      engine escalates, a human resolves through the ask queue) ->
 *      realization (System State revision + declared ArchitectureGraph
 *      hypothesis + ImplementationModel) -> reconciliation -> evidence
 *      ingestion (one truthful UNAVAILABLE gap).
 *      A second decision point runs the same journey with a covering grant
 *      (the engine ACTs directly) — both paths are pinned.
 *
 *   2. BROWNFIELD OPTIMIZATION LOOP (W15 stages) OVER THE REALIZED SYSTEM:
 *      the existing-system snapshot is DERIVED from the greenfield
 *      realization (same exact revision; modules/interfaces/dependencies
 *      projected from the realized ImplementationModel; the declared
 *      architecture IS the realized ArchitectureGraph) — so the object of
 *      the brownfield loop is literally the system greenfield produced.
 *      The loop runs BOTH worlds: nominal (healthy experiment) and
 *      degraded (guardrail breach -> ROLLBACK with bounded recovery).
 *
 *   3. SELF-EVOLUTION META LOOP (W16 stages) OVER THE SAME OBJECT SYSTEM:
 *      the meta scenario's object lane is the greenfield-derived brownfield
 *      fixture; four meta-changes exercise every W16 stage outcome —
 *      governance-weakening (guard REJECT), regressive (measure -> ROLLBACK
 *      + exact restore + retained failure), org-wide (first-class ASK) and
 *      healthy (ACT promotion -> new process revision).
 *
 *   4. THE CONNECTIVE TISSUE: typed handoff trace links (brownfield
 *      ImplementationModel DERIVED_FROM the realized SystemState; the
 *      brownfield declared architecture DERIVED_FROM the greenfield
 *      ArchitectureGraph), explicit mission evolution (R3), a subordinated
 *      Value Model (R4) with a surfaced CONFLICTS_WITH variant, a Context
 *      artifact (R5/R17), and causal grounding (R10: correlation ->
 *      CORRELATIONAL hypothesis through the only sanctioned path).
 *
 * Everything is PURE and DETERMINISTIC: fixed instants, fixed seeds,
 * spine-minted content-addressed identities, zero I/O, zero hidden clocks —
 * identical calls produce byte-identical canonical serializations (pinned
 * by the determinism test).
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
import { createTraceLink, deriveDeterministicArtifactId } from '@sos-2/semantic-spine';
import type { TraceLink } from '@sos-2/semantic-spine';
import type { Producer, TimeWindow } from '@sos-2/provenance';
import type { OtelBatch, RawObservation } from '@sos-2/telemetry';
import { runGreenfieldPipeline } from '@sos-2/greenfield';
import type {
  GreenfieldAskDecider,
  GreenfieldMissionInput,
  GreenfieldPipelineInput,
  GreenfieldPipelineResult,
  GreenfieldRealizationPlan,
  GreenfieldRiskProfile,
  GreenfieldRunContext,
  GreenfieldWorld,
} from '@sos-2/greenfield';
import { buildBrownfieldLoopInput, runBrownfieldLoop } from '@sos-2/brownfield';
import type { BrownfieldFixtureJson, BrownfieldLoopResult, BrownfieldModule, BrownfieldSnapshot } from '@sos-2/brownfield';
import { buildMetaEvolutionInput, runMetaEvolutionLoop } from '@sos-2/meta-evolution';
import type { MetaEvolutionLoopResult, MetaScenarioJson } from '@sos-2/meta-evolution';
import { MissionStore, createMission, reviseMission } from '@sos-2/mission';
import type { MissionArtifact } from '@sos-2/mission';
import { createValueModel } from '@sos-2/value';
import type { CreateValueModelResult } from '@sos-2/value';
import { createContext } from '@sos-2/context';
import type { ContextArtifact } from '@sos-2/context';
import { CausalKnowledgeStore, createCorrelationRecord, observationalEvidenceRef } from '@sos-2/causal';
import type { CorrelationRecordArtifact, CausalHypothesisArtifact } from '@sos-2/causal';

// ---------------------------------------------------------------------------
// Fixed instants + identities (no hidden clocks anywhere)
// ---------------------------------------------------------------------------

/** Ecology build instants (the package population's history). */
export const ECOLOGY_T0 = '2025-08-01T00:00:00.000Z';
export const ECOLOGY_T1 = '2025-08-02T00:00:00.000Z';
export const ECOLOGY_T2 = '2025-08-03T00:00:00.000Z';
export const ECOLOGY_T3 = '2025-08-04T00:00:00.000Z';

/** The greenfield pipeline run instants (one per stage boundary). */
export const RUN_CONTEXT: GreenfieldRunContext = {
  provenance: ['W17:dogfood:greenfield-run'],
  t_mission: '2025-09-01T00:00:00.000Z',
  t_candidate: '2025-09-01T00:01:00.000Z',
  t_decision: '2025-09-01T00:02:00.000Z',
  t_ask: '2025-09-01T00:03:00.000Z',
  t_realization: '2025-09-01T00:04:00.000Z',
  t_reconciliation: '2025-09-01T00:05:00.000Z',
  t_evidence: '2025-09-01T00:06:00.000Z',
};

/** The brownfield loop instants (capture + single loop `now`). */
export const BROWNFIELD_CAPTURED_AT = '2025-09-14T00:00:00.000Z';
export const BROWNFIELD_NOW = '2025-09-15T00:00:00.000Z';

/** The meta loop instant. */
export const META_NOW = '2025-10-01T00:00:00.000Z';

/** The exact source revision the greenfield realization is built from (40-hex git sha). */
export const REALIZED_REVISION = '31f2a9c07d9e5b864a2c0f7d3e8b1a6c95d4f0e2';

/** The deterministic governance anchor of the W17 integrated scenario. */
export const W17_AUTHORITY_ANCHOR = deriveDeterministicArtifactId('Constitution', {
  note: 'w17 integrated dogfood governance anchor',
  scenario: 'w17-integrated-dogfood',
});

const ECOLOGY_WINDOW: TimeWindow = { start: ECOLOGY_T0, end: ECOLOGY_T3 };
const OBSERVATION_WINDOW: TimeWindow = { start: '2025-09-01T00:00:00.000Z', end: '2025-09-01T01:00:00.000Z' };

export const CAPABILITY = 'image-resize';
export const MISSION_CONTRACT = `contract:${CAPABILITY}/v1`;
export const STORAGE_CONTRACT = `contract:${CAPABILITY}/storage/v1`;
export const TRANSFORM_CONTRACT = `contract:${CAPABILITY}/transform/v1`;
/** The brownfield optimization goal's capability (the storage member's capability). */
export const STORAGE_CAPABILITY = `${CAPABILITY}-storage`;
/**
 * The realized storage component's node id. The greenfield realization derives
 * component ids from the composed member roles (= the member packages'
 * capabilities), so the storage member realizes
 * `component:${STORAGE_CAPABILITY}`.
 */
export const STORAGE_COMPONENT_ID = `component:${STORAGE_CAPABILITY}`;
/** The bounded replacement component id of the brownfield optimization goal. */
export const STORAGE_REPLACEMENT_ID = `${STORAGE_COMPONENT_ID}-optimized`;

const CALIBRATION = deriveDeterministicArtifactId('Evaluation', {
  note: 'w17 dogfood calibration',
  producer: 'w17-dogfood-bench-v1',
  brier_score: 0.07,
});

const MEMBER_REALIZATION_REF = deriveDeterministicArtifactId('ImplementationModel', {
  note: 'w17 dogfood member realization',
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
    tool_version: '1.3.0',
    model: null,
    model_version: null,
    command: 'run --plan w17-dogfood.yaml',
    environment: 'ci:local',
  };
}

function dogfoodProducer(): Producer {
  return {
    tool: 'w17-dogfood-harness',
    tool_version: '1.0.0',
    model: null,
    model_version: null,
    command: 'vitest run tests/dogfood',
    environment: 'ci:local',
  };
}

// ---------------------------------------------------------------------------
// The greenfield package ecology (built through the merged packages' APIs)
// ---------------------------------------------------------------------------

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
    provenance: [`W17:dogfood:ecology:${spec.seed}`],
    created_at: ECOLOGY_T0,
    status: 'ACTIVE',
  });
}

const VALIDATION_REALIZATION: PackageRealization = {
  ref: MEMBER_REALIZATION_REF,
  revision: `git:${REALIZED_REVISION}`,
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
    provenance: [`W17:dogfood:ecology:${spec.seed}:v${String(n)}`],
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

export interface DogfoodEcology {
  registry: PackageRegistry;
  evidenceResolver: EvidenceResolver;
  members: PackageArtifact[];
  composition: PackageCompositionArtifact;
  durablePackage: PackageArtifact;
  privacyPackage: PackageArtifact;
  durableFailure: EvidenceRecordW3;
}

/** The package ecology (deterministic; byte-identical on every call). */
export function buildDogfoodEcology(): DogfoodEcology {
  const registry = new PackageRegistry();
  const packageSubject = deriveDeterministicArtifactId('SystemState', {
    note: 'w17 dogfood package subject',
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
        capability: STORAGE_CAPABILITY,
        family: 'edge-cache',
        dimension: 'LATENCY',
        stance: 'sub-10ms p99 at the edge',
        contracts: [STORAGE_CONTRACT],
        evidence: memberEvidence,
        context: { deployment: 'edge' },
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
        context: { deployment: 'edge' },
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
      changes: 'initial composition hypothesis (W17 dogfood)',
      superseded_by: null,
    },
    provenance: ['W17:dogfood:ecology:composition'],
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
    provenance: ['W17:dogfood:ecology:composition:v2'],
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
        probability: 0.92,
        calibration_ref: CALIBRATION,
        uncertainty_class: 'MODERATE',
        context: { deployment: 'edge' },
        sample_size: 24,
        window: ECOLOGY_WINDOW,
      },
    ],
    provenance: ['W17:dogfood:ecology:composition:v3'],
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

  return { registry, evidenceResolver, members, composition, durablePackage, privacyPackage, durableFailure };
}

// ---------------------------------------------------------------------------
// The greenfield mission + plan + observations + authority (stage 1 inputs)
// ---------------------------------------------------------------------------

export const DOGFOOD_MISSION: GreenfieldMissionInput = {
  purpose: `Deliver fast, resilient ${CAPABILITY} for a global catalogue (W17 integrated dogfood).`,
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

export const DOGFOOD_RISK: GreenfieldRiskProfile = {
  blast_radius: 'SERVICE',
  impact: 'MODERATE',
  risk: 'MODERATE',
  reversibility: 'REVERSIBLE',
  causal_claim: false,
  uncertainty_class: 'MODERATE',
  uncertainty_basis:
    'the composed candidate reuses validated members, but composition-level behavior in the mission context is not yet observed',
};

export const DOGFOOD_REALIZATION_PLAN: GreenfieldRealizationPlan = {
  revision: REALIZED_REVISION,
  environment: 'production',
  configuration: [{ config_id: 'w17-dogfood-config', revision: { kind: 'config-version', value: 'v1' } }],
  deployment: [
    {
      deployment_id: 'deploy:w17-dogfood-prod-2025-09',
      environment: 'production',
      revision: { kind: 'deployment-id', value: 'dpl_w17_dogfood_01' },
    },
  ],
  policy: [{ policy_id: 'deployment-policy', version: 1 }],
  environment_relationships: [{ source: 'staging', target: 'production', kind: 'promotes-to' }],
};

export const DOGFOOD_OBSERVATIONS: readonly RawObservation[] = [
  {
    subject_ref: 'otel:service:w17-greenfield',
    availability: 'SUCCESS',
    window: OBSERVATION_WINDOW,
    observed: { p99_ms: 62, monthly_cost: 431 },
    attributes: { region: 'eu-west-1' },
    producer: toolProducer(),
  },
  {
    subject_ref: 'otel:service:w17-greenfield',
    availability: 'SUCCESS',
    window: OBSERVATION_WINDOW,
    observed: { requests: 1048576, errors: 0 },
    attributes: { region: 'eu-west-1' },
    producer: toolProducer(),
  },
  {
    // A truthful gap: the cold-start probe was not captured — UNAVAILABLE,
    // never folded into success or zero (R21).
    subject_ref: 'otel:probe:cold-start',
    availability: 'UNAVAILABLE',
    window: OBSERVATION_WINDOW,
    observed: null,
    attributes: { probe: 'cold-start' },
    producer: toolProducer(),
  },
];

/** The covering grant presented to the ACT-path decision flow. */
export function dogfoodGrant(): AuthorityGrantArtifact {
  return createGrant({
    grantee: 'w17-dogfood-runner',
    scope: { kind: 'KIND', artifact_kind: 'PackageComposition' },
    permissions: ['READ', 'REVISE', 'PROMOTE'],
    expiry: { kind: 'TIME', at: '2025-12-31T00:00:00.000Z' },
    provenance: ['W17:dogfood:authority:realization-grant'],
    created_at: ECOLOGY_T0,
    status: 'ACTIVE',
  });
}

/** The human decider who resolves the escalated ASK (R16). */
export const DOGFOOD_DECIDER: GreenfieldAskDecider = {
  resolved_by: 'human:w17-mission-owner',
  chosen_alternative_id: null,
  note: 'Approved: the composition reuses validated members and the mission constraints are satisfied.',
};

/** The greenfield pipeline input for one decision variant (over one ecology). */
export function buildGreenfieldInput(
  ecology: DogfoodEcology,
  options: { grants: AuthorityGrantArtifact[]; decider?: GreenfieldAskDecider | null },
): GreenfieldPipelineInput {
  const world: GreenfieldWorld = {
    registry: ecology.registry,
    evidenceResolver: ecology.evidenceResolver,
    grants: options.grants,
  };
  return {
    mission_input: DOGFOOD_MISSION,
    world,
    risk: DOGFOOD_RISK,
    realization: DOGFOOD_REALIZATION_PLAN,
    observations: DOGFOOD_OBSERVATIONS,
    decider: options.decider ?? null,
    search_policy: { kind: 'GREEDY' },
    estimates_by_id: {
      [ecology.composition.envelope.id]: { 'monthly-cost': 431, 'p99-latency': 62 },
    },
    run: RUN_CONTEXT,
  };
}

// ---------------------------------------------------------------------------
// The brownfield fixture DERIVED from the greenfield realization
// ---------------------------------------------------------------------------

/**
 * Derive the existing-system snapshot from the greenfield realization: the
 * realized ImplementationModel's components/interfaces/dependencies become
 * the observed modules/interfaces/dependency graph at the SAME exact
 * revision; the declared architecture IS the realized ArchitectureGraph.
 *
 * Engineered honest drift (retained, classified — never hidden):
 *   - no observed module realizes the declared `deploy:production` node
 *     (the deployment node lost its realizer) -> DRIFT;
 *   - `store:resized-objects` (an observed backing datastore, kind
 *     'datastore' -> recovery kind ambiguity DataStore/Component) and
 *     `component:hotpath-cache` (an undeclared edge cache, PARTIALLY
 *     observed) are undeclared -> IMPLEMENTATION_DETAIL findings.
 */
export function deriveBrownfieldFixture(greenfield: GreenfieldPipelineResult): BrownfieldFixtureJson {
  const realization = greenfield.stages.realization;
  const model = realization.implementation_model;
  const arch = realization.architecture_graph;
  const missionId = greenfield.stages.mission.mission.envelope.id;

  // The declared node that no observed module realizes any more (drift).
  const unRealizedDeclaredNode = 'deploy:production';

  const modules: BrownfieldModule[] = [];
  const runtimeEdgesByModule = new Map<string, Array<{ target: string; kind: string }>>();
  for (const component of model.components) {
    const realizes = component.realizes.filter((id) => id !== unRealizedDeclaredNode);
    modules.push({
      id: component.id,
      kind: component.kind,
      path: component.realized_by[0] ?? `src/${component.id}/index.ts`,
      revision: REALIZED_REVISION,
      realizes,
      realized_by: component.realized_by.slice(1),
    });
    runtimeEdgesByModule.set(component.id, []);
  }
  // The realized system grew a backing datastore (undeclared).
  modules.push({
    id: 'store:resized-objects',
    kind: 'datastore',
    path: 'packages/resized-objects/src/index.ts',
    revision: REALIZED_REVISION,
    realizes: [],
    realized_by: [],
  });
  // ... and an undeclared hot-path cache, only PARTIALLY observed. The cache
  // realizes exactly ONE declared node (the capability it helps deliver) —
  // the grouped-realization ambiguity that makes recovery retain BOTH the
  // DIRECT and the MERGED_REALIZATIONS readings.
  modules.push({
    id: 'component:hotpath-cache',
    kind: 'library',
    path: 'packages/hotpath-cache/src/index.ts',
    revision: REALIZED_REVISION,
    realizes: ['capability:image-resize'],
    realized_by: [],
  });

  // The realized storage member's component id (defensively checked — the
  // greenfield realization names it after the member's capability).
  const storageComponent = model.components.find((component) => component.id === STORAGE_COMPONENT_ID);
  if (storageComponent === undefined) {
    throw new Error(
      `W17 dogfood fixture derivation: the realized implementation model carries no "${STORAGE_COMPONENT_ID}" component ` +
        `(found: ${model.components.map((component) => component.id).join(', ')})`,
    );
  }

  const dependencies = model.dependencies.map((dependency) => ({
    source: dependency.source,
    target: dependency.target,
    kind: dependency.kind,
  }));
  // The storage component owns the backing datastore (exactly one owner).
  dependencies.push({ source: STORAGE_COMPONENT_ID, target: 'store:resized-objects', kind: 'Owns' });

  for (const dependency of dependencies) {
    const edges = runtimeEdgesByModule.get(dependency.source);
    if (edges !== undefined) {
      edges.push({ target: dependency.target, kind: dependency.kind });
    }
  }

  const runtimeObservations: RawObservation[] = modules.map((module) => ({
    subject_ref: module.id,
    availability: module.id === 'component:hotpath-cache' ? 'PARTIAL' : 'SUCCESS',
    window: { start: BROWNFIELD_CAPTURED_AT, end: BROWNFIELD_NOW },
    observed: null,
    attributes: {
      'runtime.node_kind': module.id === 'store:resized-objects' ? 'DataStore' : 'Component',
      'runtime.edges': runtimeEdgesByModule.get(module.id) ?? [],
    },
    producer: dogfoodProducer(),
  }));

  const snapshot: BrownfieldSnapshot = {
    system_name: 'greenfield-realized-image-resize',
    revision: REALIZED_REVISION,
    created_at: BROWNFIELD_CAPTURED_AT,
    modules,
    interfaces: model.interfaces.map((iface) => ({ ...iface, consumers: [...iface.consumers] })),
    dependencies,
    runtime_observations: runtimeObservations,
    telemetry_traces: {
      spans: [
        {
          traceId: 'd4cda95b652f4a1592b4f4d2ba58d0a1',
          spanId: '6e0c63257de34b01',
          parentSpanId: null,
          name: 'POST /resize',
          kind: 'SERVER',
          startTimeUnixNano: '1757894400000000000',
          endTimeUnixNano: '1757894400012300000',
          status: { code: 'OK', message: null },
          attributes: { 'http.status_code': 200 },
          resource: {
            attributes: {
              'service.name': 'component-storage',
              'telemetry.sdk.version': '1.28.0',
              'deployment.environment.name': 'production',
            },
          },
        },
        {
          traceId: 'd4cda95b652f4a1592b4f4d2ba58d0a2',
          spanId: '6e0c63257de34b02',
          parentSpanId: '6e0c63257de34b01',
          name: 'GET /internal/transform',
          kind: 'CLIENT',
          startTimeUnixNano: '1757894400001000000',
          endTimeUnixNano: '1757894400009000000',
          status: { code: 'OK', message: null },
          attributes: { 'peer.service': 'component-transform' },
          resource: {
            attributes: {
              'service.name': 'component-transform',
              'telemetry.sdk.version': '1.28.0',
              'deployment.environment.name': 'production',
            },
          },
        },
      ],
      metrics: [
        {
          metricName: 'storage.p99_latency_ms',
          metricKind: 'GAUGE',
          timeUnixNano: '1757894400012300000',
          value: 62.5,
          attributes: { region: 'eu-1' },
          resource: {
            attributes: {
              'service.name': 'component-storage',
              'telemetry.sdk.version': '1.28.0',
              'deployment.environment.name': 'production',
            },
          },
        },
      ],
      logs: [
        {
          timeUnixNano: '1757894400012400000',
          severityNumber: 9,
          severityText: 'INFO',
          body: 'resize completed',
          attributes: {},
          resource: {
            attributes: {
              'service.name': 'component-storage',
              'telemetry.sdk.version': '1.28.0',
              'deployment.environment.name': 'production',
            },
          },
        },
      ],
    } satisfies OtelBatch,
  };

  return {
    snapshot,
    declared: {
      nodes: arch.content.nodes.map((node) => ({
        id: node.id,
        kind: node.kind,
        criticality: node.criticality,
        attributes: { ...node.attributes },
      })),
      edges: arch.content.edges.map((edge) => ({
        source: edge.source,
        target: edge.target,
        kind: edge.kind,
        criticality: edge.criticality,
        attributes: { ...edge.attributes },
      })),
      provenance: ['W17:dogfood:brownfield:declared-architecture-of-greenfield-realization'],
      created_at: BROWNFIELD_CAPTURED_AT,
    },
    invariants: [
      { kind: 'FORBIDDEN_DEPENDENCY', fromKind: 'Component', toKind: 'DataStore' },
      { kind: 'DATA_OWNERSHIP' },
    ],
    packages: [
      {
        key: 'realized-incumbent',
        content: {
          semantic_capability: STORAGE_CAPABILITY,
          contracts: [`contract:${STORAGE_CAPABILITY}/edge/v1`],
          preconditions: ['edge POPs with local memory'],
          postconditions: ['objects stored at the edge'],
          applicability: [
            {
              kind: 'QUALITATIVE',
              uncertainty_class: 'MODERATE',
              context: { environment: 'production', deployment: 'edge' },
              sample_size: 12,
              window: null,
            },
          ],
          assurance_obligations: [{ kind: 'TEST', obligation: 'realized incumbent regression suite passes' }],
          context: { environment: 'production', deployment: 'edge' },
          learned_limitations: ['edge-local only; no durability'],
          diversity_profile: {
            family: 'edge-cache',
            dimensions: [
              { dimension: 'LATENCY', stance: 'very low — edge-local hits' },
              { dimension: 'RESILIENCE', stance: 'moderate — eventual consistency' },
            ],
          },
          changes: 'initial discovery of the realized incumbent storage implementation',
        },
        evidence: [
          {
            kind: 'package-evaluation',
            availability: 'SUCCESS',
            evidence_class: 'OBSERVATIONAL',
            method: 'evaluation:production-observation',
            provenance: ['W17:dogfood:brownfield:incumbent-evidence-1'],
          },
          {
            kind: 'package-evaluation',
            availability: 'SUCCESS',
            evidence_class: 'OBSERVATIONAL',
            method: 'evaluation:production-observation',
            provenance: ['W17:dogfood:brownfield:incumbent-evidence-2'],
          },
        ],
        target_maturity: 'DISCOVERED',
      },
      {
        key: 'durable-object-store',
        content: {
          semantic_capability: STORAGE_CAPABILITY,
          contracts: [`contract:${STORAGE_CAPABILITY}/durable/v2`],
          preconditions: ['a message broker with at-least-once delivery'],
          postconditions: ['object writes durably queued', 'reads served from the rebuilt store'],
          applicability: [
            {
              kind: 'QUALITATIVE',
              uncertainty_class: 'STRONG',
              context: { environment: 'production', deployment: 'central' },
              sample_size: 9,
              window: null,
            },
          ],
          assurance_obligations: [
            { kind: 'TEST', obligation: 'durable object store integration tests pass' },
            { kind: 'FAULT_INJECTION', obligation: 'broker restart does not lose queued writes' },
          ],
          context: { environment: 'production', deployment: 'central' },
          learned_limitations: ['adds broker operational dependency'],
          diversity_profile: {
            family: 'durable-queue',
            dimensions: [
              { dimension: 'RESILIENCE', stance: 'high — durable queue survives node loss' },
              { dimension: 'COST', stance: 'moderate — broker infrastructure' },
            ],
          },
          changes: 'initial discovery of the durable-queue object-store family',
        },
        evidence: [
          {
            kind: 'package-evaluation',
            availability: 'SUCCESS',
            evidence_class: 'OBSERVATIONAL',
            method: 'evaluation:reference-benchmark',
            provenance: ['W17:dogfood:brownfield:durable-evidence-1'],
          },
          {
            kind: 'package-evaluation',
            availability: 'SUCCESS',
            evidence_class: 'OBSERVATIONAL',
            method: 'evaluation:reference-benchmark',
            provenance: ['W17:dogfood:brownfield:durable-evidence-2'],
          },
          {
            kind: 'package-evaluation',
            availability: 'SUCCESS',
            evidence_class: 'INTERVENTIONAL',
            method: 'evaluation:controlled-rollout',
            provenance: ['W17:dogfood:brownfield:durable-evidence-3'],
          },
        ],
        target_maturity: 'VALIDATED',
      },
      {
        key: 'regional-mirror-store',
        content: {
          semantic_capability: STORAGE_CAPABILITY,
          contracts: [`contract:${STORAGE_CAPABILITY}/mirror/v1`],
          preconditions: ['regional mirror capacity'],
          postconditions: ['objects mirrored across regional POPs'],
          applicability: [
            {
              kind: 'QUALITATIVE',
              uncertainty_class: 'STRONG',
              context: { environment: 'production', deployment: 'edge' },
              sample_size: 8,
              window: null,
            },
          ],
          assurance_obligations: [
            { kind: 'TEST', obligation: 'regional mirror integration tests pass' },
            { kind: 'SHADOW', obligation: 'mirror serves consistent results in shadow' },
          ],
          context: { environment: 'production', deployment: 'edge' },
          learned_limitations: ['cross-region reconciliation lag'],
          diversity_profile: {
            family: 'regional-mirror',
            dimensions: [
              { dimension: 'RESILIENCE', stance: 'high — multi-region redundancy' },
              { dimension: 'LATENCY', stance: 'low — regional POPs' },
            ],
          },
          changes: 'initial discovery of the regional-mirror object-store family',
        },
        evidence: [
          {
            kind: 'package-evaluation',
            availability: 'SUCCESS',
            evidence_class: 'OBSERVATIONAL',
            method: 'evaluation:reference-benchmark',
            provenance: ['W17:dogfood:brownfield:mirror-evidence-1'],
          },
          {
            kind: 'package-evaluation',
            availability: 'SUCCESS',
            evidence_class: 'OBSERVATIONAL',
            method: 'evaluation:reference-benchmark',
            provenance: ['W17:dogfood:brownfield:mirror-evidence-2'],
          },
          {
            kind: 'package-evaluation',
            availability: 'SUCCESS',
            evidence_class: 'INTERVENTIONAL',
            method: 'evaluation:controlled-rollout',
            provenance: ['W17:dogfood:brownfield:mirror-evidence-3'],
          },
        ],
        target_maturity: 'VALIDATED',
      },
      {
        key: 'premium-mirror-store',
        content: {
          semantic_capability: STORAGE_CAPABILITY,
          contracts: [`contract:${STORAGE_CAPABILITY}/premium/v1`],
          preconditions: ['premium support contract'],
          postconditions: ['objects stored with premium guarantees'],
          applicability: [
            {
              kind: 'QUALITATIVE',
              uncertainty_class: 'WEAK',
              context: { environment: 'production', deployment: 'edge' },
              sample_size: 3,
              window: null,
            },
          ],
          assurance_obligations: [{ kind: 'TEST', obligation: 'premium mirror tests pass' }],
          context: { environment: 'production', deployment: 'edge' },
          learned_limitations: ['dominated by the regional mirror on every axis'],
          diversity_profile: {
            family: 'premium-mirror',
            dimensions: [
              { dimension: 'COST', stance: 'high — premium contract' },
              { dimension: 'RESILIENCE', stance: 'moderate' },
            ],
          },
          changes: 'initial discovery of the premium-mirror family (the dominated control)',
        },
        evidence: [
          {
            kind: 'package-evaluation',
            availability: 'SUCCESS',
            evidence_class: 'OBSERVATIONAL',
            method: 'evaluation:reference-benchmark',
            provenance: ['W17:dogfood:brownfield:premium-evidence-1'],
          },
          {
            kind: 'package-evaluation',
            availability: 'SUCCESS',
            evidence_class: 'OBSERVATIONAL',
            method: 'evaluation:reference-benchmark',
            provenance: ['W17:dogfood:brownfield:premium-evidence-2'],
          },
          {
            kind: 'package-evaluation',
            availability: 'SUCCESS',
            evidence_class: 'INTERVENTIONAL',
            method: 'evaluation:controlled-rollout',
            provenance: ['W17:dogfood:brownfield:premium-evidence-3'],
          },
        ],
        target_maturity: 'VALIDATED',
      },
    ],
    goal: {
      capability: STORAGE_CAPABILITY,
      query_context: { environment: 'production', deployment: 'edge' },
      constraints: [
        {
          id: 'cost-cap',
          statement: 'The replacement must not exceed the mission monthly infrastructure budget envelope.',
          hard: true,
          bound: { axis: 'monthly-cost', direction: 'MAX', limit: 600 },
        },
        {
          id: 'latency-goal',
          statement: 'Storage p99 latency should stay under 120ms (soft mission goal, not machine-checked).',
          hard: false,
          bound: null,
        },
      ],
      mission_ref: missionId,
      objective_axes: [
        { axis: 'COST', direction: 'MINIMIZE' },
        { axis: 'LATENCY', direction: 'MINIMIZE' },
        { axis: 'RESILIENCE', direction: 'MAXIMIZE' },
      ],
      predicted_estimates_by_key: {
        // The realized incumbent is the BASELINE, not a candidate (no
        // predicted objective vector — excluded from the Pareto set).
        'durable-object-store': { COST: 300, LATENCY: 120, RESILIENCE: 85, 'monthly-cost': 300 },
        'regional-mirror-store': { COST: 210, LATENCY: 95, RESILIENCE: 70, 'monthly-cost': 210 },
        'premium-mirror-store': { COST: 260, LATENCY: 110, RESILIENCE: 68, 'monthly-cost': 260 },
      },
      repertoire_edges: {
        COST: [150, 250],
        LATENCY: [80, 110],
      },
      fitness_axis: { axis: 'LATENCY', direction: 'MINIMIZE' },
      target_component: STORAGE_COMPONENT_ID,
      replacement_id: STORAGE_REPLACEMENT_ID,
      replacement_kind: 'Component',
      hypothesis_statement:
        'Replacing the realized greenfield storage component with a reusable object-storage package from a validated family reduces storage latency while preserving the declared architecture invariants.',
      predicted_effects: [
        'storage p99 latency falls below 120ms',
        'storage error rate stays below the 5% guardrail threshold',
        'the resized-objects store remains durably owned by exactly one component',
      ],
    },
    experiment: {
      population_description: 'Object-storage traffic in the production region of the realized greenfield system.',
      unit: 'REQUEST',
      canary_ladder: [1, 5, 25, 50],
      canary_exposure_percent: 5,
      metrics: [
        {
          id: 'storage-p99-latency-ms',
          role: 'PRIMARY',
          description: 'Storage p99 latency in milliseconds (lower is better).',
          direction: 'DECREASE',
        },
        {
          id: 'storage-error-rate',
          role: 'GUARDRAIL',
          description: 'Storage error rate (fraction of failed requests).',
          direction: 'DECREASE',
          guardrail_threshold: 0.05,
        },
        {
          id: 'storage-throughput-qps',
          role: 'SECONDARY',
          description: 'Storage throughput in operations per second (higher is better).',
          direction: 'INCREASE',
        },
      ],
      stopping_criteria: [{ kind: 'MAX_SAMPLES', max_samples: 2000 }],
      rollback_criteria: [
        {
          id: 'rollback-error-rate',
          guardrail_metric_ids: ['storage-error-rate'],
          description: 'Roll back when the storage error-rate guardrail is breached or cannot be established (fail-closed).',
        },
      ],
      seed: 20250915,
      samples_per_arm: 500,
      nominal_effects: [
        { arm_id: 'control', metric_id: 'storage-p99-latency-ms', true_mean: 58, noise_std: 6 },
        { arm_id: 'treatment', metric_id: 'storage-p99-latency-ms', true_mean: 41, noise_std: 5 },
        { arm_id: 'control', metric_id: 'storage-error-rate', true_mean: 0.02, noise_std: 0.004 },
        { arm_id: 'treatment', metric_id: 'storage-error-rate', true_mean: 0.011, noise_std: 0.003 },
        { arm_id: 'control', metric_id: 'storage-throughput-qps', true_mean: 900, noise_std: 40 },
        { arm_id: 'treatment', metric_id: 'storage-throughput-qps', true_mean: 1240, noise_std: 55 },
      ],
      degraded_effects: [
        { arm_id: 'control', metric_id: 'storage-p99-latency-ms', true_mean: 58, noise_std: 6 },
        { arm_id: 'treatment', metric_id: 'storage-p99-latency-ms', true_mean: 49, noise_std: 7 },
        { arm_id: 'control', metric_id: 'storage-error-rate', true_mean: 0.02, noise_std: 0.004 },
        { arm_id: 'treatment', metric_id: 'storage-error-rate', true_mean: 0.089, noise_std: 0.006 },
        { arm_id: 'control', metric_id: 'storage-throughput-qps', true_mean: 900, noise_std: 40 },
        { arm_id: 'treatment', metric_id: 'storage-throughput-qps', true_mean: 1050, noise_std: 60 },
      ],
    },
    authority: {
      grantee: 'agent:w17-dogfood-brownfield-loop',
      permissions: ['READ', 'PROMOTE'],
      expires_at: '2025-11-01T00:00:00.000Z',
    },
    learning: {
      transfer_target_context: { environment: 'production', system: 'greenfield-realized-image-resize' },
      decay_signals: [
        {
          package_key: 'realized-incumbent',
          kind: 'USAGE_DECAY',
          note: 'A validated replacement family advanced through the loop; review the realized incumbent edge-cache storage usage.',
        },
      ],
      nominal_rule:
        'For storage modernization of the realized greenfield system, validated object-storage families satisfied the declared invariants and the simulated guardrails; promotion still requires current intervention evidence before the live change.',
      rollback_rule:
        'For bounded storage replacements in this system, wire the error-rate guardrail before any exposure: the degraded world breached it and the loop rolled back within the declared recovery bound.',
    },
    now: BROWNFIELD_NOW,
    producer: dogfoodProducer(),
    provenance: ['W17:dogfood:brownfield-fixture'],
    authority_ref: W17_AUTHORITY_ANCHOR,
  };
}

// ---------------------------------------------------------------------------
// The meta-evolution scenario over the SAME derived object fixture
// ---------------------------------------------------------------------------

/**
 * The W17 meta scenario: the object lane is the greenfield-derived brownfield
 * fixture; four meta-changes exercise every W16 stage outcome (weakening ->
 * guard REJECT; regressive -> ROLLBACK + exact restore + retained failure;
 * org-wide -> first-class ASK; healthy -> ACT promotion).
 */
export function buildDogfoodMetaScenario(objectFixture: BrownfieldFixtureJson): MetaScenarioJson {
  return {
    now: META_NOW,
    producer: dogfoodProducer(),
    provenance: ['W17:dogfood:meta-scenario'],
    authority_ref: W17_AUTHORITY_ANCHOR,

    mission: {
      content: {
        purpose:
          'SOS continuously improves its own evolutionary process — strategy, retrieval and candidate generation — while preserving governance: authority gates, traceability, first-class ASK and decision records are never weakened by meta-adaptation (W17 integrated dogfood).',
        goals: [
          {
            id: 'goal-self-improvement',
            statement: 'Improve the SOS process objective profile on the frozen section-11 axes without governance regression.',
            status: 'MEASURABLE',
            measures: ['measure-axis-profile'],
          },
        ],
        outcomes: [
          {
            id: 'outcome-governance-preserving-adaptation',
            description: 'Applied meta-changes improve measured process objectives with the governance guard intact.',
            goal_refs: ['goal-self-improvement'],
          },
        ],
        stakeholders: [
          { id: 'stakeholder-architect', name: 'SOS Architect', interest: 'Governance is preserved while the process adapts.' },
        ],
        measures: [
          {
            id: 'measure-axis-profile',
            description: 'Before/after objective values on the frozen section-11 axes.',
            target: 'improvement without guardrail breach',
            unit: 'axis-value',
          },
        ],
        assumptions: [
          {
            id: 'assumption-simulator-representative',
            statement:
              'The fixed-seed simulator produces representative relative outcomes for meta-change measurement (marked simulated — never intervention evidence).',
          },
        ],
        ambiguities: [
          {
            id: 'ambiguity-objective-tradeoffs',
            statement: 'Section-11 axes trade off against each other; the Pareto front, not a single score, is authoritative.',
            resolution: 'Retained as ambiguity: quality-diversity ranking keeps multiple families.',
          },
        ],
        constraints: [
          {
            id: 'constraint-governance-frozen',
            statement:
              'Meta-adaptation cannot disable the mechanism that judges meta-adaptation (authority gates, traceability, ASK, decision records, the guard).',
            hard: true,
            bound: null,
          },
        ],
      },
    },

    process: {
      parameters: {
        strategy: {
          search_policy: 'GREEDY',
          exploration_rate: 0.2,
          max_candidates_per_family: 3,
        },
        retrieval_weights: {
          VALIDATED_COMPOSITION: 1.0,
          VALIDATED_PACKAGE: 1.0,
          PACKAGE_ADAPTATION: 0.6,
          ARCHITECTURE_PATTERN: 0.4,
          NOVEL_ARCHITECTURE: 0.3,
          LOW_LEVEL_SYNTHESIS: 0.2,
        },
      },
      notes: 'initial W17 dogfood SOS process revision (W15-aligned search policy and section-10 retrieval weights)',
    },

    object: { variant: 'nominal' },

    meta_context: { domain: 'sos-meta', deployment: 'internal' },

    packages: [
      {
        key: 'validated-tuning',
        content: {
          semantic_capability: 'sos-process-strategy',
          contracts: ['contract:meta-process-tuning/v1'],
          preconditions: ['a measured baseline of the process objectives on the section-11 axes'],
          postconditions: ['process parameters tuned within the evolvable surface', 'governance invariants preserved'],
          applicability: [
            {
              kind: 'QUALITATIVE',
              uncertainty_class: 'STRONG',
              context: { domain: 'sos-meta', deployment: 'internal' },
              sample_size: 11,
              window: null,
            },
          ],
          assurance_obligations: [
            { kind: 'TEST', obligation: 'meta-process tuning regression suite passes' },
            { kind: 'PROPERTY_CHECK', obligation: 'governance guard soundness under accumulated changes' },
          ],
          context: { domain: 'sos-meta', family: 'validated-tuning' },
          learned_limitations: ['tuning gains are context-conditioned; re-measure after object-loop changes'],
          diversity_profile: {
            family: 'validated-tuning',
            dimensions: [
              { dimension: 'HUMAN_COMPREHENSIBILITY', stance: 'high — small, explainable parameter steps' },
              { dimension: 'RESILIENCE', stance: 'high — validated altitude floors preserved' },
            ],
          },
          changes: 'initial discovery of the validated-tuning meta-strategy family',
        },
        evidence: [
          { kind: 'package-evaluation', availability: 'SUCCESS', evidence_class: 'OBSERVATIONAL', method: 'evaluation:meta-process-observation', provenance: ['W17:dogfood:meta:validated-tuning-evidence-1'] },
          { kind: 'package-evaluation', availability: 'SUCCESS', evidence_class: 'OBSERVATIONAL', method: 'evaluation:meta-process-observation', provenance: ['W17:dogfood:meta:validated-tuning-evidence-2'] },
          { kind: 'package-evaluation', availability: 'SUCCESS', evidence_class: 'INTERVENTIONAL', method: 'evaluation:meta-process-controlled-rollout', provenance: ['W17:dogfood:meta:validated-tuning-evidence-3'] },
        ],
        target_maturity: 'VALIDATED',
      },
      {
        key: 'aggressive-pruning',
        content: {
          semantic_capability: 'sos-process-strategy',
          contracts: ['contract:meta-process-pruning/v1'],
          preconditions: ['a large candidate repertoire with many families'],
          postconditions: ['repertoire pruned toward cheap low-altitude synthesis'],
          applicability: [
            {
              kind: 'QUALITATIVE',
              uncertainty_class: 'MODERATE',
              context: { domain: 'sos-meta', deployment: 'internal' },
              sample_size: 7,
              window: null,
            },
          ],
          assurance_obligations: [
            { kind: 'TEST', obligation: 'pruning keeps at least one candidate per family (diversity floor)' },
            { kind: 'SIMULATION', obligation: 'pruned process passes the resilience guardrail in simulation' },
          ],
          context: { domain: 'sos-meta', family: 'aggressive-pruning' },
          learned_limitations: ['pruning trades resilience for cost; guardrail-prone'],
          diversity_profile: {
            family: 'aggressive-pruning',
            dimensions: [
              { dimension: 'COST', stance: 'very low — fewer candidates evaluated' },
              { dimension: 'RESILIENCE', stance: 'low — narrow repertoire loses failover families' },
            ],
          },
          changes: 'initial discovery of the aggressive-pruning meta-strategy family',
        },
        evidence: [
          { kind: 'package-evaluation', availability: 'SUCCESS', evidence_class: 'OBSERVATIONAL', method: 'evaluation:meta-process-observation', provenance: ['W17:dogfood:meta:aggressive-pruning-evidence-1'] },
          { kind: 'package-evaluation', availability: 'SUCCESS', evidence_class: 'OBSERVATIONAL', method: 'evaluation:meta-process-observation', provenance: ['W17:dogfood:meta:aggressive-pruning-evidence-2'] },
          { kind: 'package-evaluation', availability: 'SUCCESS', evidence_class: 'INTERVENTIONAL', method: 'evaluation:meta-process-controlled-rollout', provenance: ['W17:dogfood:meta:aggressive-pruning-evidence-3'] },
        ],
        target_maturity: 'VALIDATED',
      },
      {
        key: 'org-rollout',
        content: {
          semantic_capability: 'sos-process-strategy',
          contracts: ['contract:meta-process-org-rollout/v1'],
          preconditions: ['organization-wide agreement on process policy changes'],
          postconditions: ['process policy rolled out across every SOS deployment'],
          applicability: [
            {
              kind: 'QUALITATIVE',
              uncertainty_class: 'MODERATE',
              context: { domain: 'sos-meta', deployment: 'internal' },
              sample_size: 5,
              window: null,
            },
          ],
          assurance_obligations: [
            { kind: 'TEST', obligation: 'org rollout dry-run passes on the reference deployment' },
            { kind: 'SHADOW', obligation: 'org-wide policy shadowed for one full meta cycle' },
          ],
          context: { domain: 'sos-meta', family: 'org-rollout' },
          learned_limitations: ['organization-blast-radius changes require supervised authority'],
          diversity_profile: {
            family: 'org-rollout',
            dimensions: [
              { dimension: 'OPERATIONAL_COMPLEXITY', stance: 'high — every deployment must adopt the policy' },
              { dimension: 'CUSTOMIZATION', stance: 'low — one policy for all deployments' },
            ],
          },
          changes: 'initial discovery of the org-rollout meta-strategy family',
        },
        evidence: [
          { kind: 'package-evaluation', availability: 'SUCCESS', evidence_class: 'OBSERVATIONAL', method: 'evaluation:meta-process-observation', provenance: ['W17:dogfood:meta:org-rollout-evidence-1'] },
          { kind: 'package-evaluation', availability: 'SUCCESS', evidence_class: 'OBSERVATIONAL', method: 'evaluation:meta-process-observation', provenance: ['W17:dogfood:meta:org-rollout-evidence-2'] },
          { kind: 'package-evaluation', availability: 'SUCCESS', evidence_class: 'INTERVENTIONAL', method: 'evaluation:meta-process-controlled-rollout', provenance: ['W17:dogfood:meta:org-rollout-evidence-3'] },
        ],
        target_maturity: 'VALIDATED',
      },
      {
        key: 'fast-lane',
        content: {
          semantic_capability: 'sos-process-strategy',
          contracts: ['contract:meta-process-fast-lane/v1'],
          preconditions: ['a functioning meta-evolution loop'],
          postconditions: ['unreviewed meta-changes apply without gates'],
          applicability: [
            {
              kind: 'QUALITATIVE',
              uncertainty_class: 'WEAK',
              context: { domain: 'sos-meta', deployment: 'internal' },
              sample_size: 2,
              window: null,
            },
          ],
          assurance_obligations: [
            { kind: 'TEST', obligation: 'fast-lane proposals are rejected by the governance guard' },
          ],
          context: { domain: 'sos-meta', family: 'fast-lane' },
          learned_limitations: ['governance-weakening proposals are structurally unappliable'],
          diversity_profile: {
            family: 'fast-lane',
            dimensions: [
              { dimension: 'LATENCY', stance: 'very low — no gates, no records' },
              { dimension: 'RESILIENCE', stance: 'very low — governance removed' },
            ],
          },
          changes: 'initial discovery of the fast-lane meta-strategy family (the adversarial control)',
        },
        evidence: [
          { kind: 'package-evaluation', availability: 'SUCCESS', evidence_class: 'OBSERVATIONAL', method: 'evaluation:meta-process-observation', provenance: ['W17:dogfood:meta:fast-lane-evidence-1'] },
          { kind: 'package-evaluation', availability: 'SUCCESS', evidence_class: 'OBSERVATIONAL', method: 'evaluation:meta-process-observation', provenance: ['W17:dogfood:meta:fast-lane-evidence-2'] },
        ],
        target_maturity: 'FORMING',
      },
    ],

    changes: [
      {
        key: 'weakening-fast-lane',
        package_key: 'fast-lane',
        patch: {
          governance: { authority_gates: false, decision_records: false },
          traceability: { trace_links: 'optional' },
          ask_policy: { escalation: 'disabled' },
          guard: { enabled: false },
        },
        intent: 'Remove the governance gates, traceability obligations, ASK escalation and the guard itself so unreviewed meta-changes apply without friction.',
        predicted_effects: ['meta-change cycle latency falls dramatically (governance removed)'],
        hypothesis_statement: 'Removing governance from the meta loop makes self-evolution faster.',
        blast_radius: 'SERVICE',
        impact: 'HIGH',
        risk: 'HIGH',
        reversibility: 'REVERSIBLE',
        uncertainty: { uncertainty_class: 'LOW', basis: 'the guard rejects this structurally — the effect is never observed' },
        predicted_estimates: { COST: 70, LATENCY: 60, RESILIENCE: 30, HUMAN_COMPREHENSIBILITY: 40 },
        behavior: { RESILIENCE: 30, HUMAN_COMPREHENSIBILITY: 40 },
        fitness: 0.5,
        decision_evidence: [],
        promotion_evidence: [],
        effects: [],
      },
      {
        key: 'regressive-pruning',
        package_key: 'aggressive-pruning',
        patch: {
          strategy: { max_candidates_per_family: 1, exploration_rate: 0.05 },
          retrieval_weights: { PACKAGE_ADAPTATION: 0.9, ARCHITECTURE_PATTERN: 0.7, NOVEL_ARCHITECTURE: 0.5, LOW_LEVEL_SYNTHESIS: 0.4 },
        },
        intent: 'Aggressively prune the candidate repertoire and bias retrieval toward cheap low-altitude synthesis to cut evaluation cost.',
        predicted_effects: [
          'process evaluation cost falls',
          'the narrow repertoire degrades the process resilience profile below the guardrail floor',
        ],
        hypothesis_statement: 'Pruning the repertoire and biasing retrieval toward low altitudes reduces process cost without harming resilience.',
        blast_radius: 'SERVICE',
        impact: 'MODERATE',
        risk: 'MODERATE',
        reversibility: 'REVERSIBLE',
        uncertainty: { uncertainty_class: 'MODERATE', basis: 'prior rollouts showed resilience sensitivity to repertoire narrowing' },
        predicted_estimates: { COST: 96, LATENCY: 78, RESILIENCE: 28, HUMAN_COMPREHENSIBILITY: 58 },
        behavior: { RESILIENCE: 28, HUMAN_COMPREHENSIBILITY: 58 },
        fitness: 0.7,
        decision_evidence: [],
        promotion_evidence: [],
        effects: [
          { arm_id: 'control', metric_id: 'COST', true_mean: 100, noise_std: 4 },
          { arm_id: 'treatment', metric_id: 'COST', true_mean: 96, noise_std: 4 },
          { arm_id: 'control', metric_id: 'LATENCY', true_mean: 80, noise_std: 3 },
          { arm_id: 'treatment', metric_id: 'LATENCY', true_mean: 78, noise_std: 3 },
          { arm_id: 'control', metric_id: 'RESILIENCE', true_mean: 50, noise_std: 2 },
          { arm_id: 'treatment', metric_id: 'RESILIENCE', true_mean: 28, noise_std: 2 },
          { arm_id: 'control', metric_id: 'HUMAN_COMPREHENSIBILITY', true_mean: 60, noise_std: 2 },
          { arm_id: 'treatment', metric_id: 'HUMAN_COMPREHENSIBILITY', true_mean: 58, noise_std: 2 },
        ],
      },
      {
        key: 'org-wide-rollout',
        package_key: 'org-rollout',
        patch: {
          strategy: { search_policy: 'EXPLORATORY', exploration_rate: 0.4 },
          retrieval_weights: { VALIDATED_PACKAGE: 1.2 },
        },
        intent: 'Roll out an exploratory process policy across every SOS deployment (organization-wide blast radius).',
        predicted_effects: [
          'process exploration improves the diversity of retrieved candidates',
          'organization-wide adoption requires supervised authority',
        ],
        hypothesis_statement: 'An exploratory process policy improves candidate diversity across all deployments.',
        blast_radius: 'ORGANIZATION',
        impact: 'HIGH',
        risk: 'MODERATE',
        reversibility: 'PARTIALLY_REVERSIBLE',
        uncertainty: { uncertainty_class: 'MODERATE', basis: 'org-wide effects are observed only after adoption' },
        predicted_estimates: { COST: 92, LATENCY: 74, RESILIENCE: 52, HUMAN_COMPREHENSIBILITY: 61 },
        behavior: { RESILIENCE: 52, HUMAN_COMPREHENSIBILITY: 61 },
        fitness: 0.6,
        decision_evidence: [],
        promotion_evidence: [],
        effects: [
          { arm_id: 'control', metric_id: 'COST', true_mean: 100, noise_std: 4 },
          { arm_id: 'treatment', metric_id: 'COST', true_mean: 92, noise_std: 4 },
          { arm_id: 'control', metric_id: 'LATENCY', true_mean: 80, noise_std: 3 },
          { arm_id: 'treatment', metric_id: 'LATENCY', true_mean: 74, noise_std: 3 },
          { arm_id: 'control', metric_id: 'RESILIENCE', true_mean: 50, noise_std: 2 },
          { arm_id: 'treatment', metric_id: 'RESILIENCE', true_mean: 52, noise_std: 2 },
          { arm_id: 'control', metric_id: 'HUMAN_COMPREHENSIBILITY', true_mean: 60, noise_std: 2 },
          { arm_id: 'treatment', metric_id: 'HUMAN_COMPREHENSIBILITY', true_mean: 61, noise_std: 2 },
        ],
      },
      {
        key: 'healthy-tuning',
        package_key: 'validated-tuning',
        patch: {
          strategy: { search_policy: 'BALANCED', exploration_rate: 0.3, max_candidates_per_family: 4 },
          retrieval_weights: { VALIDATED_COMPOSITION: 1.2, VALIDATED_PACKAGE: 1.1 },
        },
        intent: 'Tune the process toward a balanced search policy with slightly stronger validated-altitude retrieval weights and a wider per-family candidate budget.',
        predicted_effects: [
          'process cost and latency improve on the section-11 axes',
          'the resilience guardrail stays satisfied',
          'human comprehensibility improves (small explainable steps)',
        ],
        hypothesis_statement: 'Balanced search with stronger validated-altitude weights improves the process objective profile without governance change.',
        blast_radius: 'SERVICE',
        impact: 'MODERATE',
        risk: 'LOW',
        reversibility: 'REVERSIBLE',
        uncertainty: { uncertainty_class: 'LOW', basis: 'the family carries prior interventional rollouts with current SUCCESS evidence' },
        predicted_estimates: { COST: 88, LATENCY: 70, RESILIENCE: 54, HUMAN_COMPREHENSIBILITY: 63 },
        behavior: { RESILIENCE: 54, HUMAN_COMPREHENSIBILITY: 63 },
        fitness: 0.9,
        decision_evidence: [
          { kind: 'meta-process-evaluation', availability: 'SUCCESS', evidence_class: 'OBSERVATIONAL', method: 'evaluation:meta-process-observation', provenance: ['W17:dogfood:meta:healthy-decision-evidence-1'] },
          { kind: 'meta-process-evaluation', availability: 'SUCCESS', evidence_class: 'INTERVENTIONAL', method: 'evaluation:meta-process-controlled-rollout', provenance: ['W17:dogfood:meta:healthy-decision-evidence-2'] },
        ],
        promotion_evidence: [
          { kind: 'meta-process-evaluation', availability: 'SUCCESS', evidence_class: 'OBSERVATIONAL', method: 'evaluation:meta-process-observation', provenance: ['W17:dogfood:meta:healthy-promotion-evidence-1'] },
          { kind: 'meta-process-evaluation', availability: 'SUCCESS', evidence_class: 'INTERVENTIONAL', method: 'evaluation:meta-process-controlled-rollout', provenance: ['W17:dogfood:meta:healthy-promotion-evidence-2'] },
        ],
        effects: [
          { arm_id: 'control', metric_id: 'COST', true_mean: 100, noise_std: 4 },
          { arm_id: 'treatment', metric_id: 'COST', true_mean: 88, noise_std: 4 },
          { arm_id: 'control', metric_id: 'LATENCY', true_mean: 80, noise_std: 3 },
          { arm_id: 'treatment', metric_id: 'LATENCY', true_mean: 70, noise_std: 3 },
          { arm_id: 'control', metric_id: 'RESILIENCE', true_mean: 50, noise_std: 2 },
          { arm_id: 'treatment', metric_id: 'RESILIENCE', true_mean: 54, noise_std: 2 },
          { arm_id: 'control', metric_id: 'HUMAN_COMPREHENSIBILITY', true_mean: 60, noise_std: 2 },
          { arm_id: 'treatment', metric_id: 'HUMAN_COMPREHENSIBILITY', true_mean: 63, noise_std: 2 },
        ],
      },
    ],

    effectiveness: {
      population_description: 'The SOS evolutionary process operating over the W17 dogfood object system (the greenfield-realized image-resize stack).',
      unit: 'REQUEST',
      canary_ladder: [1, 5, 25, 50],
      canary_exposure_percent: 5,
      metrics: [
        { id: 'COST', role: 'PRIMARY', description: 'Process evaluation cost on the COST axis (lower is better).', direction: 'DECREASE' },
        { id: 'LATENCY', role: 'PRIMARY', description: 'Process cycle latency on the LATENCY axis (lower is better).', direction: 'DECREASE' },
        { id: 'RESILIENCE', role: 'GUARDRAIL', description: 'Process resilience profile on the RESILIENCE axis (higher is better; floor wired to rollback).', direction: 'INCREASE', guardrail_threshold: 40 },
        { id: 'HUMAN_COMPREHENSIBILITY', role: 'SECONDARY', description: 'Human comprehensibility of the process policy (higher is better).', direction: 'INCREASE' },
      ],
      stopping_criteria: [{ kind: 'MAX_SAMPLES', max_samples: 2000 }],
      rollback_criteria: [
        {
          id: 'rollback-resilience-floor',
          guardrail_metric_ids: ['RESILIENCE'],
          description: 'Roll back when the RESILIENCE guardrail is breached or cannot be established (fail-closed).',
        },
      ],
      seed: 20251001,
      samples_per_arm: 400,
      objective_axes: [
        { axis: 'COST', direction: 'MINIMIZE' },
        { axis: 'LATENCY', direction: 'MINIMIZE' },
        { axis: 'RESILIENCE', direction: 'MAXIMIZE' },
        { axis: 'HUMAN_COMPREHENSIBILITY', direction: 'MAXIMIZE' },
      ],
      repertoire_edges: {
        RESILIENCE: [30, 50, 60],
        HUMAN_COMPREHENSIBILITY: [50, 65, 80],
      },
    },

    authority: {
      decision: { grantee: 'agent:w17-dogfood-meta-loop', permissions: ['REVISE'], expires_at: '2025-12-01T00:00:00.000Z' },
      promotion: { grantee: 'agent:w17-dogfood-meta-loop', permissions: ['PROMOTE'], expires_at: '2025-12-01T00:00:00.000Z' },
    },

    learning: {
      transfer_target_context: { domain: 'sos-meta', deployment: 'internal' },
      decay_signal: {
        kind: 'FAILURE_RATE_GROWTH',
        note: 'The aggressive-pruning family produced a failed self-change (resilience guardrail breach); its maturity review is queued.',
      },
      failure_rule:
        'For SOS self-evolution, meta-strategy packages with recorded transfer failures carry reduced proposal probability (weight = fitness / (1 + failures)); re-validate a family through interventional evidence before restoring its weight.',
      rollback_rule:
        'For process-parameter changes, wire the RESILIENCE guardrail before any exposure: the regressive world breached it and the loop rolled back with an exact parameter restore within the declared recovery bound.',
    },
  };
}

// ---------------------------------------------------------------------------
// The integrated result
// ---------------------------------------------------------------------------

/** The complete W17 integrated dogfood result (pure JSON, deterministic). */
export interface DogfoodResult {
  /** The package ecology the greenfield runs reuse (read-only during runs). */
  ecology: DogfoodEcology;
  /** The PRIMARY chain: no grants -> ASK -> human resolution -> realization. */
  askRun: GreenfieldPipelineResult;
  /** The decision-point variant: covering grant -> direct ACT. */
  actRun: GreenfieldPipelineResult;
  /** The brownfield loop over the greenfield-derived snapshot (healthy world). */
  brownfieldNominal: BrownfieldLoopResult;
  /** The brownfield loop's degraded world: guardrail breach -> ROLLBACK. */
  brownfieldDegraded: BrownfieldLoopResult;
  /** The meta loop over the SAME derived object fixture. */
  metaLoop: MetaEvolutionLoopResult;
  /** The explicitly revised mission (v2, authority-controlled — R3). */
  missionRevision: { previous: MissionArtifact; revised: MissionArtifact };
  /** The subordinated value model (R4) + its surfaced conflict variant. */
  valueModel: CreateValueModelResult;
  conflictingValueModel: CreateValueModelResult;
  /** The context artifact conditioning the realization (R5/R17). */
  context: ContextArtifact;
  /** The causal grounding: correlation -> CORRELATIONAL hypothesis (R10). */
  correlation: CorrelationRecordArtifact;
  causalHypothesis: CausalHypothesisArtifact;
  /** The typed handoff links connecting the three loops. */
  handoffLinks: TraceLink[];
  /** The COMPLETE integrated trace (greenfield + handoffs + brownfield + meta + governance artifacts). */
  trace: TraceLink[];
  /** Every consequential artifact id of the integrated subgraph. */
  artifacts: string[];
}

/** Run the complete integrated dogfood scenario (deterministic, pure). */
export function runIntegratedDogfood(): DogfoodResult {
  // --- 1. Greenfield: the ASK path (primary chain) + the ACT path ----------
  // One shared ecology serves both runs (the pipeline only READS the world's
  // registry; every identity is content-addressed and deterministic).
  const ecology = buildDogfoodEcology();
  const askRun = runGreenfieldPipeline(buildGreenfieldInput(ecology, { grants: [], decider: DOGFOOD_DECIDER }));
  const actRun = runGreenfieldPipeline(buildGreenfieldInput(ecology, { grants: [dogfoodGrant()] }));

  // --- 2. Brownfield over the realized system (both worlds) ---------------
  const fixture = deriveBrownfieldFixture(askRun);
  const brownfieldNominal = runBrownfieldLoop(buildBrownfieldLoopInput(fixture, 'nominal').input);
  const brownfieldDegraded = runBrownfieldLoop(buildBrownfieldLoopInput(fixture, 'degraded').input);

  // --- 3. The self-evolution meta loop over the SAME object fixture -------
  const metaScenario = buildDogfoodMetaScenario(fixture);
  const metaLoop = runMetaEvolutionLoop(buildMetaEvolutionInput(metaScenario, fixture).input);

  // --- 4. Explicit mission evolution (R3: authority-controlled) -----------
  const mission = askRun.stages.mission.mission;
  const missionGrant = createGrant({
    grantee: 'human:w17-mission-owner',
    scope: { kind: 'KIND', artifact_kind: 'Mission' },
    permissions: ['READ', 'REVISE'],
    expiry: { kind: 'TIME', at: '2025-12-31T00:00:00.000Z' },
    provenance: ['W17:dogfood:authority:mission-revision-grant'],
    created_at: RUN_CONTEXT.t_evidence,
    status: 'ACTIVE',
  });
  const missionStore = new MissionStore();
  missionStore.put(mission);
  const missionRevision = reviseMission(mission, {
    content: {
      ...mission.content,
      purpose: `${mission.content.purpose} [revised 2025-09: the EU-first rollout proved out; the mission now commits to the global rollout.]`,
      constraints: [
        ...mission.content.constraints,
        {
          id: 'constraint-durability',
          statement: 'Object storage survives the loss of a single edge node',
          hard: true,
          bound: null,
        },
      ],
    },
    authority_grant: missionGrant.envelope.id,
    provenance: ['W17:dogfood:mission-evolution', `authority-grant:${missionGrant.envelope.id}`],
    created_at: RUN_CONTEXT.t_evidence,
  });

  // --- 5. The Value Model (R4: separate, subordinated) --------------------
  const missionView = {
    artifact_id: mission.envelope.id,
    constraints: DOGFOOD_MISSION.constraints.map((constraint) => ({
      id: constraint.id,
      statement: constraint.statement,
      hard: constraint.hard,
      bound: constraint.bound,
    })),
  };
  const valueModel = createValueModel({
    content: {
      objectives: [
        { id: 'reliable-delivery', statement: 'Deliver image-resize reliably at the edge', direction: 'MAXIMIZE', metric: 'delivery-success-rate' },
        { id: 'predictable-cost', statement: 'Keep infrastructure cost predictable', direction: 'MINIMIZE', metric: 'monthly-cost' },
      ],
      budgets: [
        { id: 'platform-budget', resource: 'monthly-cost', limit: 550, unit: 'euros' },
        { id: 'latency-budget', resource: 'p99-latency', limit: 90, unit: 'ms' },
      ],
      incentives: [{ id: 'edge-first-incentive', statement: 'Reward edge-local delivery', aligns_with: ['reliable-delivery'] }],
      opportunities: [{ id: 'regional-expansion', statement: 'Expand to new regions cheaply', expected_value: 12000 }],
      constraints: [
        { id: 'value-cost-ceiling', type: 'BUDGET_LIMIT', statement: 'Monthly infrastructure cost stays within budget', bound: { axis: 'monthly-cost', direction: 'MAX', limit: 550 } },
        { id: 'value-latency-ceiling', type: 'SERVICE_LEVEL', statement: 'p99 latency stays within budget', bound: { axis: 'p99-latency', direction: 'MAX', limit: 90 } },
      ],
      approved: true,
    },
    provenance: ['W17:dogfood:value-model'],
    created_at: RUN_CONTEXT.t_evidence,
    mission: missionView,
    policy: 'REJECT',
  });
  // The conflicting variant: the budget EXCEEDS the mission's hard bound —
  // surfaced as a CONFLICTS_WITH link, never silently accepted (R4).
  const conflictingValueModel = createValueModel({
    content: {
      objectives: [
        { id: 'aggressive-growth', statement: 'Grow delivery capacity aggressively', direction: 'MAXIMIZE', metric: 'delivered-ops' },
      ],
      budgets: [{ id: 'oversized-budget', resource: 'monthly-cost', limit: 700, unit: 'euros' }],
      incentives: [],
      opportunities: [],
      constraints: [
        { id: 'oversized-cost-ceiling', type: 'BUDGET_LIMIT', statement: 'Oversized monthly infrastructure envelope', bound: { axis: 'monthly-cost', direction: 'MAX', limit: 700 } },
      ],
      approved: false,
    },
    provenance: ['W17:dogfood:value-model:conflicting-variant'],
    created_at: RUN_CONTEXT.t_evidence,
    mission: missionView,
    policy: 'FLAG',
  });

  // --- 6. The Context artifact (R5/R17) -----------------------------------
  const context = createContext({
    dimensions: {
      environment: 'production',
      platform: 'edge-runtime',
      user_cohort: 'beta-testers',
      geography: 'eu-west-1',
      regulatory: ['GDPR'],
    },
    provenance: ['W17:dogfood:context'],
    created_at: RUN_CONTEXT.t_evidence,
  });

  // --- 7. Causal grounding (R10: correlation -> CORRELATIONAL hypothesis) -
  const greenfieldEvidence = askRun.stages.evidence.records;
  const correlation = createCorrelationRecord({
    content: {
      statement: 'Higher edge cache hit ratios correlate with lower realized p99 latency in the greenfield system.',
      variables: [
        { id: 'cache-hit-ratio', description: 'Fraction of storage requests served from the edge cache' },
        { id: 'p99-latency', description: 'Realized p99 latency of the composed image-resize capability' },
      ],
      direction: 'NEGATIVE',
      context: { environment: 'production', system: 'greenfield-realized-image-resize' },
      observational_evidence: greenfieldEvidence
        .filter((record) => record.availability === 'SUCCESS')
        .map((record) => observationalEvidenceRef(record)),
      interventional_evidence: [],
      uncertainty: { kind: 'QUALITATIVE', uncertainty_class: 'MODERATE' },
      producer: dogfoodProducer(),
    },
    provenance: ['W17:dogfood:causal-grounding'],
    created_at: RUN_CONTEXT.t_evidence,
  });
  const causalStore = new CausalKnowledgeStore();
  causalStore.putCorrelation(correlation);
  const { hypothesis: causalHypothesis } = causalStore.hypothesize(correlation.envelope.id, {
    content: {
      statement: 'Higher edge cache hit ratios are associated with lower realized p99 latency in the greenfield system.',
      claim_strength: 'CORRELATIONAL',
      intervention: {
        description: 'No intervention yet: the association is observational (a strong causal claim requires interventional evidence).',
        target_ref: askRun.stages.realization.system_state.envelope.id,
      },
      mechanism: 'Cache hits bypass the storage round-trip, so hit-heavy traffic observes lower end-to-end latency.',
      predicted_outcomes: [
        { id: 'latency-association', description: 'p99 latency falls as cache hit ratio rises', metric: 'p99-latency', direction: 'DECREASE' },
      ],
      assumptions: [
        { id: 'traffic-comparable', statement: 'Traffic mix is comparable across the observed windows' },
      ],
      context: { environment: 'production', system: 'greenfield-realized-image-resize' },
      alternatives: [
        { id: 'traffic-shift', explanation: 'A traffic-volume shift could lower latency independently of cache behavior' },
      ],
      refutations: [
        { id: 'latency-flat-under-hits', description: 'p99 latency stays flat while the hit ratio rises' },
      ],
      graph: {
        factors: [
          { id: 'cache-hit-ratio', description: 'Edge cache hit ratio' },
          { id: 'p99-latency', description: 'Realized p99 latency' },
        ],
        edges: [{ type: 'CONTRIBUTES_TO', cause: 'cache-hit-ratio', effect: 'p99-latency' }],
      },
      observational_evidence: greenfieldEvidence
        .filter((record) => record.availability === 'SUCCESS')
        .map((record) => observationalEvidenceRef(record)),
      interventional_evidence: [],
      uncertainty: { kind: 'QUALITATIVE', uncertainty_class: 'MODERATE' },
      producer: dogfoodProducer(),
    },
    provenance: ['W17:dogfood:causal-grounding:hypothesis'],
    created_at: RUN_CONTEXT.t_evidence,
  });

  // --- 8. The typed handoff links (W17 connective tissue) ------------------
  const systemStateId = askRun.stages.realization.system_state.envelope.id;
  const architectureGraphId = askRun.stages.realization.architecture_graph.envelope.id;
  const implementationModelId = askRun.stages.realization.implementation_model.id;
  const handoffProvenance = ['W17:dogfood:handoff:greenfield-to-brownfield'];
  const handoffLinks: TraceLink[] = [
    createTraceLink({
      source: brownfieldNominal.artifacts.implementation_model.id,
      target: systemStateId,
      type: 'DERIVED_FROM',
      provenance: [...handoffProvenance, 'the brownfield system IS the greenfield-realized system at the same exact revision'],
    }),
    createTraceLink({
      source: brownfieldNominal.artifacts.declared_architecture.envelope.id,
      target: architectureGraphId,
      type: 'DERIVED_FROM',
      provenance: [...handoffProvenance, 'the brownfield declared architecture is the realized greenfield ArchitectureGraph'],
    }),
    createTraceLink({
      source: brownfieldNominal.artifacts.implementation_model.id,
      target: implementationModelId,
      type: 'DERIVED_FROM',
      provenance: [...handoffProvenance, 'the brownfield snapshot is projected from the realized ImplementationModel'],
    }),
    // (The learned transfer evidence is a TransferStore record — NOT a spine
    // artifact — so it is deliberately NOT trace-linked; its queryability is
    // asserted through the store in the brownfield case. The spine's refusal
    // to mint links over non-spine ids is the identity discipline working.)
    // The governance artifacts hang off the SAME chain:
    createTraceLink({
      source: valueModel.artifact.envelope.id,
      target: mission.envelope.id,
      type: 'DERIVED_FROM',
      provenance: ['W17:dogfood:handoff:value-model-subordinated-to-mission'],
    }),
    createTraceLink({
      source: context.envelope.id,
      target: systemStateId,
      type: 'CONSTRAINS',
      provenance: ['W17:dogfood:handoff:context-conditions-realization'],
    }),
    createTraceLink({
      source: missionRevision.revised.envelope.id,
      target: mission.envelope.id,
      type: 'DERIVED_FROM',
      provenance: ['W17:dogfood:mission-evolution'],
    }),
  ];

  // --- 9. The COMPLETE integrated trace ------------------------------------
  const trace: TraceLink[] = [
    ...askRun.trace.links,
    ...actRun.trace.links,
    ...handoffLinks,
    ...conflictingValueModel.conflict_links,
    ...brownfieldNominal.trace,
    ...metaLoop.trace,
    ...causalStore.allLinks(),
  ];

  const artifacts = [
    ...new Set([
      ...askRun.trace.artifacts,
      ...actRun.trace.artifacts,
      missionRevision.revised.envelope.id,
      valueModel.artifact.envelope.id,
      conflictingValueModel.artifact.envelope.id,
      context.envelope.id,
      correlation.envelope.id,
      causalHypothesis.envelope.id,
      ...handoffLinks.flatMap((link) => [link.source, link.target]),
      ...brownfieldNominal.chain.reachable,
      ...metaLoop.chain.reachable,
      ...causalStore.allLinks().flatMap((link) => [link.source, link.target]),
    ]),
  ].sort();

  return {
    ecology,
    askRun,
    actRun,
    brownfieldNominal,
    brownfieldDegraded,
    metaLoop,
    missionRevision,
    valueModel,
    conflictingValueModel,
    context,
    correlation,
    causalHypothesis,
    handoffLinks,
    trace,
    artifacts,
  };
}

/**
 * A canonical, byte-stable projection of the integrated result (the
 * determinism anchor: two runs must serialize identically).
 */
export function dogfoodProjection(result: DogfoodResult): Record<string, unknown> {
  return {
    ask_run: {
      ok: result.askRun.ok,
      summary: result.askRun.summary,
      trace_chain_ok: result.askRun.trace_chain.ok,
    },
    act_run: {
      ok: result.actRun.ok,
      summary: result.actRun.summary,
      trace_chain_ok: result.actRun.trace_chain.ok,
    },
    brownfield_nominal: {
      input_digest: result.brownfieldNominal.input_digest,
      summary: result.brownfieldNominal.summary,
      chain_complete: result.brownfieldNominal.chain.complete,
    },
    brownfield_degraded: {
      input_digest: result.brownfieldDegraded.input_digest,
      decision: result.brownfieldDegraded.summary.decision,
      recovery_declared: result.brownfieldDegraded.summary.decision.recovery_declared,
    },
    meta_loop: {
      input_digest: result.metaLoop.input_digest,
      summary: result.metaLoop.summary,
      chain_complete: result.metaLoop.chain.complete,
    },
    mission_revision: {
      previous: result.missionRevision.previous.envelope.id,
      revised: result.missionRevision.revised.envelope.id,
      version: result.missionRevision.revised.envelope.version,
    },
    value_model: {
      artifact: result.valueModel.artifact.envelope.id,
      subordination: result.valueModel.subordination.status,
      conflicts: result.valueModel.subordination.conflicts.length,
      conflicting_variant_conflicts: result.conflictingValueModel.subordination.conflicts.length,
      conflict_links: result.conflictingValueModel.conflict_links.length,
    },
    context: result.context.envelope.id,
    correlation: result.correlation.envelope.id,
    causal_hypothesis: result.causalHypothesis.envelope.id,
    handoff_links: result.handoffLinks.length,
    trace_links: result.trace.length,
    artifacts: result.artifacts.length,
  };
}
