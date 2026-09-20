/**
 * The W11 demo world builder — a scripted, fully deterministic fixture
 * constructed EXCLUSIVELY through the domain packages' own builders
 * (createMission, createArchitectureGraph, createSystemState, createEvidence,
 * createAssuranceCase + evaluateAssuranceCase, createExperiment +
 * simulateExperiment + evaluateExperimentResult, evaluate (decision engine),
 * composeAskContent + createAskRequest + assembleEscalationContext,
 * createRecoveryDeclaration, createPackageArtifact + PackageRegistry
 * put/promote/retrieve, evaluatePromotion, createTraceLink).
 *
 * No hand-written JSON, no invented identifiers: every id is minted by the
 * Semantic Spine (deterministic content addressing over fixed inputs — the
 * same fixtures always produce the same ids, the same world, byte-identical
 * rendered output).
 *
 * The story (one coherent product system): a checkout platform evolves
 * under SOS governance — mission v1 -> v2, a legacy baseline architecture
 * recovered into graph v1 -> v2, a live system state with an observed
 * implementation model, two candidates from different diversity families,
 * a canary experiment (simulated run, honestly marked), two assurance
 * cases (one objectioned, one valid), a promotion decision (ACT, bounded
 * recovery wired), an authority-insufficient promotion request (ASK), a
 * package repertoire (two packages + one composition), and the SOS-2.0
 * program's own machine state for the self-evolution review.
 */

import { createMission, MissionStore } from '@sos-2/mission';
import type { MissionArtifact } from '@sos-2/mission';
import { createArchitectureGraph } from '@sos-2/architecture';
import type { ArchitectureGraphArtifact } from '@sos-2/architecture';
import { createSystemState, createSystemStateStore, SystemStateStore } from '@sos-2/system-state';
import type { SystemStateArtifact } from '@sos-2/system-state';
import type { ImplementationModel, TraceLink } from '@sos-2/semantic-spine';
import { createTraceLink, deriveDeterministicArtifactId, withStatus } from '@sos-2/semantic-spine';
import { createEvidence } from '@sos-2/evidence';
import type { EvidenceRecordW3 } from '@sos-2/evidence';
import { createAssuranceCase, evaluateAssuranceCase } from '@sos-2/assurance';
import type { AssuranceCaseArtifact, AssuranceEvaluation } from '@sos-2/assurance';
import {
  createCandidateState,
  createExperiment,
  evaluateExperimentResult,
  simulateExperiment,
} from '@sos-2/experiments';
import type {
  CandidateStateFixture,
  ExperimentArtifact,
  ExperimentEvaluation,
  ExperimentResultRecord,
} from '@sos-2/experiments';
import { createAskRequest, createGrant } from '@sos-2/authority';
import type { AskRequestArtifact, AuthorityGrantArtifact } from '@sos-2/authority';
import { evaluate } from '@sos-2/decision';
import type { DecisionRecord } from '@sos-2/decision';
import { assembleEscalationContext, composeAskContent } from '@sos-2/ask';
import type { AskEscalationContext } from '@sos-2/ask';
import { createRecoveryDeclaration } from '@sos-2/recovery-control';
import type { RecoveryDeclarationArtifact } from '@sos-2/recovery-control';
import { evaluatePromotion } from '@sos-2/promotion';
import type { PromotionEvaluation } from '@sos-2/promotion';
import { createPackageArtifact } from '@sos-2/packages';
import { createPackageComposition } from '@sos-2/composition';
import { PackageRegistry } from '@sos-2/registry';
import type { RetrievalResult } from '@sos-2/registry';
import type { MachineStateSnapshot } from '@sos-2/ui-contracts';

// ---------------------------------------------------------------------------
// Fixed instants (no hidden clocks anywhere in the demo world)
// ---------------------------------------------------------------------------

export const DEMO_NOW = '2025-06-15T12:00:00Z';
export const DEMO_T0 = '2025-05-01T00:00:00Z';
export const DEMO_T1 = '2025-05-20T00:00:00Z';
export const DEMO_T2 = '2025-06-01T00:00:00Z';
export const DEMO_WINDOW = { start: '2025-06-01T00:00:00Z', end: '2025-06-30T00:00:00Z' } as const;
export const DEMO_SOURCE_REVISION = '3f9c1a2b8d7e4f60a1b2c3d4e5f6a7b8c9d0e1f2';
export const DEMO_PROVENANCE = 'W11:console:demo-fixture';

const TOOL_PRODUCER = {
  tool: 'otel-collector',
  tool_version: '1.2.0',
  model: null,
  model_version: null,
  command: null,
  environment: 'production',
} as const;

const REHEARSAL_PRODUCER = {
  tool: 'rehearsal-runner',
  tool_version: '2.0.0',
  model: null,
  model_version: null,
  command: 'rehearsal run checkout-rollback',
  environment: 'staging',
} as const;

const TEST_PRODUCER = {
  tool: 'vitest',
  tool_version: '3.0.0',
  model: null,
  model_version: null,
  command: 'pnpm -r test',
  environment: 'ci:github-actions:ubuntu-24.04',
} as const;

const LLM_PRODUCER = {
  tool: 'architecture-analyst',
  tool_version: '0.9.0',
  model: 'gpt-architecture',
  model_version: '2025-05',
  command: 'analyze checkout repository',
  environment: 'analysis-sandbox',
} as const;

type DemoProducer = typeof TOOL_PRODUCER | typeof REHEARSAL_PRODUCER | typeof TEST_PRODUCER | typeof LLM_PRODUCER;

// ---------------------------------------------------------------------------
// The demo world
// ---------------------------------------------------------------------------

export interface DemoWorld {
  /** The fixed presentation instant (no hidden clocks). */
  now: string;
  constitution_id: string;
  /** The legacy baseline graph the pre-SOS era was observed against (pre-minted spine id; predates the demo snapshot). */
  baseline_graph_id: string;
  missions: MissionArtifact[];
  graphs: ArchitectureGraphArtifact[];
  system_states: SystemStateArtifact[];
  observed_model: ImplementationModel;
  evidence: EvidenceRecordW3[];
  candidates: CandidateStateFixture[];
  assurance_cases: { artifact: AssuranceCaseArtifact; evaluation: AssuranceEvaluation }[];
  experiment: {
    artifact: ExperimentArtifact;
    result: ExperimentResultRecord;
    evaluation: ExperimentEvaluation;
  };
  ask: {
    request: AskRequestArtifact;
    context: AskEscalationContext;
    decision: DecisionRecord;
  };
  grant: AuthorityGrantArtifact;
  promotion: PromotionEvaluation;
  recovery_declaration: RecoveryDeclarationArtifact;
  repertoire: RetrievalResult;
  /** Package/composition id -> the evidence refs it registered with (for rationale chains). */
  package_evidence: Record<string, string[]>;
  machine_state: MachineStateSnapshot;
  /** The full typed trace-link pool (the rationale web). */
  links: TraceLink[];
}

function link(source: string, target: string, type: TraceLink['type']): TraceLink {
  return createTraceLink({ source, target, type, provenance: [DEMO_PROVENANCE] });
}

interface EvidenceSeed {
  seed: string;
  subject: string;
  availability: 'SUCCESS' | 'FAILURE' | 'UNKNOWN' | 'UNAVAILABLE' | 'UNSUPPORTED' | 'PARTIAL';
  evidenceClass: 'OBSERVATIONAL' | 'INTERVENTIONAL';
  kind: string;
  method: string;
  confidence: 'STRONG' | 'MODERATE' | 'WEAK' | 'UNQUANTIFIED';
  producer: DemoProducer;
}

function evidence(input: EvidenceSeed): EvidenceRecordW3 {
  return createEvidence({
    kind: input.kind,
    subject_ref: input.subject,
    availability: input.availability,
    evidence_class: input.evidenceClass,
    method: input.method,
    provenance: [DEMO_PROVENANCE, `evidence:${input.seed}`],
    window: { ...DEMO_WINDOW },
    source_revision: DEMO_SOURCE_REVISION,
    deployment_revision: 'deploy:checkout-prod-2025-06-01',
    confidence: { kind: 'QUALITATIVE', uncertainty_class: input.confidence },
    producer: { ...input.producer },
  });
}

/** Build the demo world (deterministic, total, no I/O). */
export function buildDemoWorld(): DemoWorld {
  // --- Anchors -----------------------------------------------------------
  const constitutionId = deriveDeterministicArtifactId('Constitution', {
    name: 'checkout-platform-constitution',
    article: 'Constitution outranks optimization; evidence outranks assertion',
  });
  const baselineGraphId = deriveDeterministicArtifactId('ArchitectureGraph', {
    fixture: 'W11 demo: legacy pre-SOS baseline architecture (outside the demo snapshot)',
  });

  // --- Mission v1 -> v2 (the explicit, authority-controlled revision) ----
  const missionRevisionGrant = createGrant({
    grantee: 'sos://Decision/mission-reviser',
    scope: { kind: 'KIND', artifact_kind: 'Mission' },
    permissions: ['REVISE'],
    expiry: { kind: 'TIME', at: '2026-01-01T00:00:00Z' },
    provenance: [DEMO_PROVENANCE, 'grant:mission-revision-authority'],
    created_at: DEMO_T0,
    authority_ref: constitutionId,
    status: 'ACTIVE',
  });

  const missionStore = new MissionStore();
  const missionV1 = createMission({
    content: {
      purpose: 'Make checkout continuously better for shoppers while keeping operating costs predictable.',
      goals: [
        { id: 'goal-reliability', statement: 'Keep checkout reliable under peak load', status: 'MEASURABLE', measures: ['measure-uptime'] },
      ],
      outcomes: [{ id: 'outcome-stable-checkout', description: 'Shoppers complete checkout without incidents', goal_refs: ['goal-reliability'] }],
      stakeholders: [
        { id: 'stakeholder-shoppers', name: 'Shoppers', interest: 'Fast, reliable checkout' },
        { id: 'stakeholder-finance', name: 'Finance', interest: 'Predictable monthly cost' },
      ],
      measures: [{ id: 'measure-uptime', description: 'Monthly checkout uptime', target: '>= 99.9%', unit: 'percent' }],
      assumptions: [{ id: 'assumption-load-growth', statement: 'Traffic grows at most 2x year over year' }],
      ambiguities: [{ id: 'ambiguity-regions', statement: 'Which regions matter first?', resolution: null }],
      constraints: [
        { id: 'constraint-cost', statement: 'Monthly infrastructure cost stays within budget', hard: true, bound: { axis: 'monthly-cost', direction: 'MAX', limit: 8000 } },
      ],
    },
    provenance: [DEMO_PROVENANCE, 'mission:onboarding-workshop-2025-05'],
    created_at: DEMO_T0,
    authority_ref: constitutionId,
    version: 1,
    status: 'ACTIVE',
  });
  missionStore.put(missionV1);

  const missionRevision = missionStore.revise(missionV1.envelope.id, {
    authority_grant: missionRevisionGrant.envelope.id,
    content: {
      purpose: 'Make checkout continuously better for EU shoppers first, with measurable cost and latency budgets.',
      goals: [
        { id: 'goal-reliability', statement: 'Keep checkout reliable under peak load', status: 'MEASURABLE', measures: ['measure-uptime'] },
        { id: 'goal-latency', statement: 'Reduce checkout p95 latency below 250ms in the EU region', status: 'MEASURABLE', measures: ['measure-p95', 'measure-cost'] },
      ],
      outcomes: [
        { id: 'outcome-stable-checkout', description: 'Shoppers complete checkout without incidents', goal_refs: ['goal-reliability'] },
        { id: 'outcome-fast-checkout', description: 'EU shoppers experience fast checkout', goal_refs: ['goal-latency'] },
      ],
      stakeholders: [
        { id: 'stakeholder-shoppers', name: 'Shoppers', interest: 'Fast, reliable checkout' },
        { id: 'stakeholder-finance', name: 'Finance', interest: 'Predictable monthly cost' },
        { id: 'stakeholder-eu-compliance', name: 'EU compliance', interest: 'Regional data handling' },
      ],
      measures: [
        { id: 'measure-uptime', description: 'Monthly checkout uptime', target: '>= 99.9%', unit: 'percent' },
        { id: 'measure-p95', description: 'EU checkout p95 latency', target: '<= 250', unit: 'milliseconds' },
        { id: 'measure-cost', description: 'Monthly infrastructure cost', target: '<= 8000', unit: 'euros' },
      ],
      assumptions: [{ id: 'assumption-load-growth', statement: 'Traffic grows at most 2x year over year' }],
      ambiguities: [{ id: 'ambiguity-regions', statement: 'Which regions matter first?', resolution: 'Resolved: EU first (this revision)' }],
      constraints: [
        { id: 'constraint-cost', statement: 'Monthly infrastructure cost stays within budget', hard: true, bound: { axis: 'monthly-cost', direction: 'MAX', limit: 8000 } },
        { id: 'constraint-latency', statement: 'EU checkout p95 latency stays within the declared budget', hard: true, bound: { axis: 'p95-latency', direction: 'MAX', limit: 250 } },
      ],
    },
    provenance: [DEMO_PROVENANCE, 'mission:revision-latency-goal'],
    created_at: DEMO_T1,
  });
  const missionV2 = missionRevision.revised;
  const missionV1Final = missionRevision.previous; // SUPERSEDED, identity preserved

  // --- System states and architecture hypotheses -------------------------
  const systemStateV0 = createSystemState({
    content: {
      architecture_ref: { artifact_id: baselineGraphId, version: 1 },
      implementation: [
        {
          artifact_id: deriveDeterministicArtifactId('ImplementationModel', { fixture: 'legacy checkout codebase' }),
          revision: { kind: 'git-sha', value: '0000000000000000000000000000000000000001' },
        },
      ],
      configuration: [],
      deployment: [{ deployment_id: 'deploy:checkout-prod-legacy', environment: 'production', revision: { kind: 'deployment-id', value: 'deploy:checkout-prod-legacy' } }],
      policy: [],
      environment_relationships: [],
      active_experiments: [],
      package_realizations: [],
    },
    provenance: [DEMO_PROVENANCE, 'system-state:legacy-import'],
    created_at: DEMO_T0,
    status: 'ACTIVE',
  });
  const systemStateStore = createSystemStateStore([systemStateV0]);

  const graphV1 = createArchitectureGraph({
    projects_system_state: { system_state_id: systemStateV0.envelope.id, version: 1 },
    nodes: [
      { id: 'capability:checkout', kind: 'Capability', attributes: { name: 'checkout' } },
      { id: 'component:checkout-api', kind: 'Component', attributes: { runtime: 'node' } },
      { id: 'component:payment-service', kind: 'Component', criticality: 'critical', attributes: { runtime: 'jvm' } },
      { id: 'iface:checkout-api', kind: 'Interface', attributes: { protocol: 'https' } },
      { id: 'store:orders', kind: 'DataStore', attributes: { engine: 'postgres' } },
      { id: 'deploy:production', kind: 'Deployment', attributes: { region: 'eu-west-1' } },
    ],
    edges: [
      { source: 'component:checkout-api', target: 'capability:checkout', kind: 'Realizes' },
      { source: 'component:checkout-api', target: 'iface:checkout-api', kind: 'Provides' },
      { source: 'component:checkout-api', target: 'component:payment-service', kind: 'Dependency' },
      { source: 'component:checkout-api', target: 'store:orders', kind: 'Owns', criticality: 'critical' },
      { source: 'component:checkout-api', target: 'deploy:production', kind: 'DeploysTo' },
      { source: 'component:payment-service', target: 'deploy:production', kind: 'DeploysTo' },
    ],
    provenance: [DEMO_PROVENANCE, 'architecture:recovered-from-legacy'],
    created_at: DEMO_T0,
    authority_ref: missionV1.envelope.id,
    version: 1,
    status: 'ACTIVE',
  });

  // SS v0 -> v1 through the store's supersede workflow (identity preserved,
  // the previous revision becomes SUPERSEDED atomically).
  const systemStateV1Pre = createSystemState({
    content: {
      architecture_ref: { artifact_id: graphV1.envelope.id, version: 1 },
      implementation: [
        {
          artifact_id: deriveDeterministicArtifactId('ImplementationModel', { fixture: 'checkout codebase at 2025-05-20' }),
          revision: { kind: 'git-sha', value: '1111111111111111111111111111111111111111' },
        },
      ],
      configuration: [{ config_id: 'checkout-config', revision: { kind: 'config-version', value: 'v41' } }],
      deployment: [{ deployment_id: 'deploy:checkout-prod-2025-05', environment: 'production', revision: { kind: 'deployment-id', value: 'deploy:checkout-prod-2025-05' } }],
      policy: [{ policy_id: 'deployment-policy', version: 3 }],
      environment_relationships: [{ source: 'staging', target: 'production', kind: 'promotes-to' }],
      active_experiments: [],
      package_realizations: [],
    },
    provenance: [DEMO_PROVENANCE, 'system-state:observed-2025-05-20'],
    created_at: DEMO_T1,
    status: 'ACTIVE',
  });
  const systemStateV1 = systemStateStore.supersede(systemStateV0.envelope.id, {
    content: systemStateV1Pre.content,
    provenance: [DEMO_PROVENANCE, 'system-state:observed-2025-05-20'],
    created_at: DEMO_T1,
  }).supersededBy;

  const graphV2 = createArchitectureGraph({
    projects_system_state: { system_state_id: systemStateV1.envelope.id, version: systemStateV1.envelope.version },
    nodes: [
      { id: 'capability:checkout', kind: 'Capability', attributes: { name: 'checkout' } },
      { id: 'component:checkout-api', kind: 'Component', attributes: { runtime: 'node' } },
      { id: 'component:payment-service', kind: 'Component', criticality: 'critical', attributes: { runtime: 'jvm' } },
      { id: 'component:render-cache', kind: 'Component', attributes: { runtime: 'edge' } },
      { id: 'iface:checkout-api', kind: 'Interface', attributes: { protocol: 'https' } },
      { id: 'store:orders', kind: 'DataStore', attributes: { engine: 'postgres' } },
      { id: 'deploy:production', kind: 'Deployment', attributes: { region: 'eu-west-1' } },
      { id: 'policy:gdpr', kind: 'Policy', attributes: { jurisdiction: 'EU' } },
    ],
    edges: [
      { source: 'component:checkout-api', target: 'capability:checkout', kind: 'Realizes' },
      { source: 'component:render-cache', target: 'capability:checkout', kind: 'Realizes' },
      { source: 'component:checkout-api', target: 'iface:checkout-api', kind: 'Provides' },
      { source: 'component:checkout-api', target: 'component:payment-service', kind: 'Dependency' },
      { source: 'component:checkout-api', target: 'store:orders', kind: 'Owns', criticality: 'critical' },
      { source: 'component:render-cache', target: 'store:orders', kind: 'Dependency' },
      { source: 'component:checkout-api', target: 'deploy:production', kind: 'DeploysTo' },
      { source: 'component:payment-service', target: 'deploy:production', kind: 'DeploysTo' },
      { source: 'policy:gdpr', target: 'store:orders', kind: 'Constrains' },
    ],
    provenance: [DEMO_PROVENANCE, 'architecture:edge-cache-hypothesis'],
    created_at: DEMO_T2,
    authority_ref: missionV2.envelope.id,
    version: 2,
    status: 'ACTIVE',
    supersedes: graphV1.envelope.id,
  });
  // Graph v1 becomes SUPERSEDED through the spine's lifecycle transition
  // (identity preserved; the supersedes pointer carries the chain).
  const graphV1Final: ArchitectureGraphArtifact = {
    envelope: withStatus(graphV1.envelope, 'SUPERSEDED'),
    content: graphV1.content,
  };

  // --- The observed implementation model (system import journey) ---------
  const observedModel: ImplementationModel = {
    id: deriveDeterministicArtifactId('ImplementationModel', { fixture: 'W11 demo: observed checkout implementation' }),
    revision: DEMO_SOURCE_REVISION,
    components: [
      { id: 'component:checkout-api', kind: 'service', realized_by: ['src/checkout/api.ts', 'src/checkout/routes.ts'], realizes: ['component:checkout-api'] },
      { id: 'component:payment-service', kind: 'service', realized_by: ['src/payment/service.ts'], realizes: ['component:payment-service'] },
      { id: 'component:render-cache', kind: 'service', realized_by: ['src/edge/cache.ts'], realizes: ['component:render-cache'] },
      { id: 'component:audit-log', kind: 'library', realized_by: ['src/audit/log.ts'], realizes: [] },
    ],
    source_artifacts: [
      { path: 'src/checkout/api.ts', revision: DEMO_SOURCE_REVISION },
      { path: 'src/checkout/routes.ts', revision: DEMO_SOURCE_REVISION },
      { path: 'src/payment/service.ts', revision: DEMO_SOURCE_REVISION },
      { path: 'src/edge/cache.ts', revision: DEMO_SOURCE_REVISION },
      { path: 'src/audit/log.ts', revision: DEMO_SOURCE_REVISION },
    ],
    interfaces: [
      { id: 'iface:checkout-api', provider: 'component:checkout-api', contract_ref: null, consumers: ['component:payment-service'] },
    ],
    dependencies: [
      { source: 'component:checkout-api', target: 'component:payment-service', kind: 'uses' },
      { source: 'component:checkout-api', target: 'component:render-cache', kind: 'uses' },
      { source: 'component:render-cache', target: 'store:orders', kind: 'reads' },
      { source: 'component:checkout-api', target: 'component:audit-log', kind: 'imports' },
    ],
    tests: [
      { id: 'test:checkout-api', subject: 'component:checkout-api', framework: 'vitest' },
      { id: 'test:render-cache', subject: 'component:render-cache', framework: 'vitest' },
    ],
    builds: [{ id: 'build:checkout-2025-06-01', source_revision: DEMO_SOURCE_REVISION, outputs: ['dist/checkout'], reproducible: true }],
    deployments: [{ id: 'deploy:checkout-prod-2025-06-01', build_id: 'build:checkout-2025-06-01', environment: 'production', revision: DEMO_SOURCE_REVISION }],
    runtime_mappings: [
      { id: 'rt:checkout-api', component: 'component:checkout-api', runtime_ref: 'proc:checkout-api', environment: 'production' },
      { id: 'rt:render-cache', component: 'component:render-cache', runtime_ref: 'cdn:edge-cache', environment: 'production' },
    ],
  };

  // --- Candidates (two diversity families over graph v2) -----------------
  const hypothesisQueue = deriveDeterministicArtifactId('CausalHypothesis', {
    statement: 'Buffering checkout writes through a durable queue reduces p95 latency under peak load',
  });
  const hypothesisCache = deriveDeterministicArtifactId('CausalHypothesis', {
    statement: 'Rendering checkout from the edge cache reduces EU p95 latency',
  });

  const candidateQueue = createCandidateState({
    content: {
      invariants: ['The checkout API contract is preserved', 'Order writes remain transactional'],
      predicted_effects: ['EU p95 latency decreases', 'Monthly cost decreases (fewer synchronous DB round-trips)'],
      causal_claim: true,
      confidence: { kind: 'QUALITATIVE', uncertainty_class: 'MODERATE' },
      base_subject_revision: 'system-state-v2',
      hypothesis_ref: hypothesisQueue,
      bounded_subgraph_ref: { graph_id: graphV2.envelope.id, version: 2 },
      context: { environment: 'production', region: 'eu', workload: 'peak-hour' },
    },
    provenance: [DEMO_PROVENANCE, 'candidate:durable-queue-search'],
    created_at: DEMO_T2,
    status: 'ACTIVE',
  });

  const candidateCache = createCandidateState({
    content: {
      invariants: ['The checkout API contract is preserved', 'GDPR constraints on order data are respected'],
      predicted_effects: ['EU p95 latency decreases sharply', 'CDN cost increases'],
      causal_claim: true,
      confidence: { kind: 'QUALITATIVE', uncertainty_class: 'WEAK' },
      base_subject_revision: 'system-state-v2',
      hypothesis_ref: hypothesisCache,
      bounded_subgraph_ref: { graph_id: graphV2.envelope.id, version: 2 },
      context: { environment: 'production', region: 'eu', workload: 'steady' },
    },
    provenance: [DEMO_PROVENANCE, 'candidate:edge-cache-search'],
    created_at: DEMO_T2,
    status: 'ACTIVE',
  });

  // --- Evidence pool (all 6 truth states, distinct classes) --------------
  const queueRealizationSubject = deriveDeterministicArtifactId('ImplementationModel', { fixture: 'durable queue realization' });
  const cacheRealizationSubject = deriveDeterministicArtifactId('ImplementationModel', { fixture: 'edge cache realization' });

  const evUptime = evidence({
    seed: 'uptime-telemetry', subject: systemStateV1.envelope.id, availability: 'SUCCESS', evidenceClass: 'OBSERVATIONAL',
    kind: 'telemetry', method: 'telemetry:capture-availability', confidence: 'STRONG', producer: TOOL_PRODUCER,
  });
  const evLatencyPartial = evidence({
    seed: 'latency-telemetry-partial', subject: systemStateV1.envelope.id, availability: 'PARTIAL', evidenceClass: 'OBSERVATIONAL',
    kind: 'telemetry', method: 'telemetry:capture-availability', confidence: 'MODERATE', producer: TOOL_PRODUCER,
  });
  const evQueueCanary = evidence({
    seed: 'queue-canary', subject: candidateQueue.envelope.id, availability: 'SUCCESS', evidenceClass: 'INTERVENTIONAL',
    kind: 'canary-observation', method: 'canary:threshold-comparison', confidence: 'MODERATE', producer: TOOL_PRODUCER,
  });
  const evCacheShadow = evidence({
    seed: 'cache-shadow-unknown', subject: candidateCache.envelope.id, availability: 'UNKNOWN', evidenceClass: 'OBSERVATIONAL',
    kind: 'shadow-observation', method: 'shadow:pending-analysis', confidence: 'UNQUANTIFIED', producer: TOOL_PRODUCER,
  });
  const evModelCollectorOutage = evidence({
    seed: 'model-collector-outage', subject: observedModel.id, availability: 'UNAVAILABLE', evidenceClass: 'OBSERVATIONAL',
    kind: 'telemetry', method: 'telemetry:capture-availability', confidence: 'UNQUANTIFIED', producer: TOOL_PRODUCER,
  });
  const evAdapterTelemetry = evidence({
    seed: 'legacy-adapter-zero-usage', subject: observedModel.id, availability: 'SUCCESS', evidenceClass: 'OBSERVATIONAL',
    kind: 'telemetry', method: 'telemetry:capture-availability', confidence: 'MODERATE', producer: TOOL_PRODUCER,
  });
  const evPaymentIncident = evidence({
    seed: 'payment-incident-2025-05', subject: systemStateV0.envelope.id, availability: 'FAILURE', evidenceClass: 'OBSERVATIONAL',
    kind: 'incident-report', method: 'incident:postmortem', confidence: 'STRONG', producer: TOOL_PRODUCER,
  });
  const evRehearsal = evidence({
    seed: 'rollback-rehearsal', subject: candidateQueue.envelope.id, availability: 'SUCCESS', evidenceClass: 'INTERVENTIONAL',
    kind: 'rollback-rehearsal', method: 'rehearsal:executed-and-timed', confidence: 'STRONG', producer: REHEARSAL_PRODUCER,
  });
  const evLlmAnalysis = evidence({
    seed: 'llm-architecture-analysis', subject: graphV2.envelope.id, availability: 'SUCCESS', evidenceClass: 'OBSERVATIONAL',
    kind: 'architecture-analysis', method: 'llm:structured-analysis', confidence: 'UNQUANTIFIED', producer: LLM_PRODUCER,
  });
  const evQueueTest = evidence({
    seed: 'queue-integration-test', subject: queueRealizationSubject, availability: 'SUCCESS', evidenceClass: 'INTERVENTIONAL',
    kind: 'integration-test', method: 'test-run:exit-code', confidence: 'STRONG', producer: TEST_PRODUCER,
  });
  const evQueueTelemetry = evidence({
    seed: 'queue-telemetry', subject: queueRealizationSubject, availability: 'SUCCESS', evidenceClass: 'OBSERVATIONAL',
    kind: 'telemetry', method: 'telemetry:capture-availability', confidence: 'MODERATE', producer: TOOL_PRODUCER,
  });
  const evCacheLoad = evidence({
    seed: 'cache-load-test', subject: cacheRealizationSubject, availability: 'SUCCESS', evidenceClass: 'INTERVENTIONAL',
    kind: 'load-test', method: 'load-test:threshold-check', confidence: 'STRONG', producer: TEST_PRODUCER,
  });
  const evCacheTelemetry = evidence({
    seed: 'cache-telemetry', subject: cacheRealizationSubject, availability: 'SUCCESS', evidenceClass: 'OBSERVATIONAL',
    kind: 'telemetry', method: 'telemetry:capture-availability', confidence: 'MODERATE', producer: TOOL_PRODUCER,
  });
  const evCacheIncident = evidence({
    seed: 'cache-cold-start-incident', subject: cacheRealizationSubject, availability: 'FAILURE', evidenceClass: 'OBSERVATIONAL',
    kind: 'incident-report', method: 'incident:postmortem', confidence: 'MODERATE', producer: TOOL_PRODUCER,
  });

  // --- Experiment (treatment-control on the queue candidate) -------------
  const experiment = createExperiment({
    content: {
      design: {
        kind: 'TREATMENT_CONTROL',
        population: {
          description: 'Production checkout requests in the EU region during peak hours',
          unit: 'REQUEST',
          context: { environment: 'production', region: 'eu', workload: 'peak-hour' },
        },
        allocation: {
          unit: 'REQUEST',
          assignment: 'DETERMINISTIC_HASH',
          arms: [
            { id: 'control', role: 'CONTROL', candidate_ref: null },
            { id: 'treatment', role: 'TREATMENT', candidate_ref: candidateQueue.envelope.id },
          ],
          ratios: [9, 1],
        },
        metrics: [
          { id: 'metric-p95', role: 'PRIMARY', description: 'Checkout p95 latency (ms)', direction: 'DECREASE' },
          { id: 'metric-cost', role: 'SECONDARY', description: 'Monthly cost proxy (credits per 1k requests)', direction: 'DECREASE' },
          { id: 'metric-error-rate', role: 'GUARDRAIL', description: 'Checkout error rate (%) — at most 1%', direction: 'DECREASE', guardrail_threshold: 1 },
          { id: 'metric-write-latency', role: 'GUARDRAIL', description: 'Order write p99 latency (ms) — at most 400', direction: 'DECREASE', guardrail_threshold: 400 },
        ],
        stopping_criteria: [
          { kind: 'MAX_SAMPLES', max_samples: 5000 },
          { kind: 'EARLY_SUCCESS', description: 'Stop early when the primary and every guardrail hold for two consecutive windows' },
        ],
        rollback_criteria: [
          { id: 'rollback-errors', guardrail_metric_ids: ['metric-error-rate'], description: 'Roll back when the error-rate guardrail trips' },
          { id: 'rollback-write-latency', guardrail_metric_ids: ['metric-write-latency'], description: 'Roll back when order write latency breaches its bound' },
        ],
      },
      stage: { phase: 'CANARY', exposure_percent: 10 },
      canary_ladder: [5, 10, 25, 50],
      candidate_ref: candidateQueue.envelope.id,
      hypothesis_ref: hypothesisQueue,
      producer: {
        tool: 'experiment-runner',
        tool_version: '1.1.0',
        model: null,
        model_version: null,
        command: 'experiment plan queue-canary',
        environment: 'production',
      },
    },
    provenance: [DEMO_PROVENANCE, 'experiment:queue-canary-plan'],
    created_at: DEMO_T2,
    authority_ref: missionV2.envelope.id,
    status: 'ACTIVE',
  });

  // A SIMULATED run — honestly marked (simulation is evaluation
  // infrastructure, never intervention evidence; the promotion gate
  // separately consumes the REAL canary + rehearsal evidence).
  const simulatedResult = simulateExperiment({
    experiment,
    effects: [
      { arm_id: 'control', metric_id: 'metric-p95', true_mean: 230, noise_std: 12 },
      { arm_id: 'treatment', metric_id: 'metric-p95', true_mean: 195, noise_std: 12 },
      { arm_id: 'control', metric_id: 'metric-cost', true_mean: 42, noise_std: 3 },
      { arm_id: 'treatment', metric_id: 'metric-cost', true_mean: 38, noise_std: 3 },
      { arm_id: 'control', metric_id: 'metric-error-rate', true_mean: 0.4, noise_std: 0.05 },
      { arm_id: 'treatment', metric_id: 'metric-error-rate', true_mean: 0.5, noise_std: 0.05 },
      { arm_id: 'control', metric_id: 'metric-write-latency', true_mean: 310, noise_std: 20 },
      { arm_id: 'treatment', metric_id: 'metric-write-latency', true_mean: 330, noise_std: 20 },
    ],
    seed: 424242,
    samples_per_arm: 240,
    observed_at: DEMO_NOW,
    provenance: [DEMO_PROVENANCE, 'experiment:simulated-canary-run'],
    producer: {
      tool: 'experiment-simulator',
      tool_version: '1.1.0',
      model: null,
      model_version: null,
      command: 'simulate queue-canary --seed 424242',
      environment: 'sandbox',
    },
  });
  const experimentEvaluation = evaluateExperimentResult(experiment, simulatedResult);

  const evGuardrailUnsupported = evidence({
    seed: 'guardrail-telemetry-unsupported', subject: experiment.envelope.id, availability: 'UNSUPPORTED', evidenceClass: 'OBSERVATIONAL',
    kind: 'telemetry', method: 'telemetry:capture-availability', confidence: 'UNQUANTIFIED', producer: TOOL_PRODUCER,
  });

  // --- Assurance cases (one objectioned, one valid) ----------------------
  const assuranceObjectioned = createAssuranceCase({
    content: {
      claims: [
        { id: 'claim-reliable', statement: 'Checkout remains reliable under the durable-queue candidate' },
        { id: 'claim-recoverable', statement: 'Recovery from the candidate completes within the declared bound' },
      ],
      arguments: [
        {
          id: 'argument-reliability',
          strategy: 'Canary evidence plus rollback rehearsal supports both reliability and recoverability',
          conclusion: 'claim-reliable',
          premises: ['claim-recoverable'],
        },
      ],
      assumptions: [{ id: 'assumption-steady-load', statement: 'Load stays within the tested envelope during the canary' }],
      hazards: [{ id: 'hazard-payment-outage', description: 'Queue backpressure delays payment calls under peak load' }],
      controls: [{ id: 'control-guardrails', mechanism: 'Wired guardrails roll the canary back automatically', addresses: ['hazard-payment-outage'] }],
      evidence: [
        { evidence_id: evQueueCanary.id, role: 'VERIFIES', claim_ref: 'claim-reliable' },
        { evidence_id: evRehearsal.id, role: 'VERIFIES', claim_ref: 'claim-recoverable' },
      ],
      validity_conditions: [
        { kind: 'IMPLEMENTATION', subject: observedModel.id, valid_revisions: [DEMO_SOURCE_REVISION] },
        { kind: 'ENVIRONMENT', subject: 'production', valid_revisions: ['eu-west-1'] },
      ],
      objections: [
        {
          id: 'objection-single-region',
          statement: 'The rehearsal only covered the eu-west-1 region; failover behavior elsewhere is unproven',
          raised_at: '2025-06-10T00:00:00Z',
          status: 'OPEN',
          resolution: null,
        },
        {
          id: 'objection-old-collector',
          statement: 'Canary evidence was produced by collector 1.1.x while telemetry discipline requires 1.2.x',
          raised_at: '2025-06-08T00:00:00Z',
          status: 'RESOLVED',
          resolution: {
            note: 'Collector 1.2.0 re-collected the same window; thresholds unchanged (see the uptime telemetry provenance)',
            resolved_at: '2025-06-09T00:00:00Z',
            provenance: [DEMO_PROVENANCE, 'objection:collector-recheck'],
          },
        },
      ],
    },
    provenance: [DEMO_PROVENANCE, 'assurance:queue-candidate-review'],
    created_at: DEMO_T2,
    authority_ref: missionV2.envelope.id,
    status: 'ACTIVE',
  });
  const assuranceObjectionedEvaluation = evaluateAssuranceCase(assuranceObjectioned, {
    now: DEMO_NOW,
    implementation_revisions: { [observedModel.id]: DEMO_SOURCE_REVISION },
    environment_revisions: { production: 'eu-west-1' },
    assumption_checks: { 'assumption-steady-load': true },
    evidence: [evQueueCanary, evRehearsal],
  });

  const assuranceValid = createAssuranceCase({
    content: {
      claims: [
        { id: 'claim-evidence-current', statement: 'The supporting evidence for the queue candidate is current and interventional' },
        { id: 'claim-safe-to-promote', statement: 'The durable-queue candidate is safe to promote under the declared guardrails and recovery bound' },
      ],
      arguments: [
        {
          id: 'argument-promotion',
          strategy: 'Fresh interventional canary evidence plus a timed rollback rehearsal supports the promotion claim',
          conclusion: 'claim-safe-to-promote',
          premises: ['claim-evidence-current'],
        },
      ],
      assumptions: [{ id: 'assumption-canary-population', statement: 'The canary population is representative of peak-hour EU traffic' }],
      hazards: [{ id: 'hazard-write-latency', description: 'The queue write path adds latency to order writes' }],
      controls: [{ id: 'control-write-guardrail', mechanism: 'The write-latency guardrail is wired to automatic rollback', addresses: ['hazard-write-latency'] }],
      evidence: [
        { evidence_id: evQueueCanary.id, role: 'VERIFIES', claim_ref: 'claim-evidence-current' },
        { evidence_id: evRehearsal.id, role: 'VERIFIES', claim_ref: 'claim-safe-to-promote' },
      ],
      validity_conditions: [
        { kind: 'IMPLEMENTATION', subject: observedModel.id, valid_revisions: [DEMO_SOURCE_REVISION] },
      ],
      objections: [
        {
          id: 'objection-rehearsal-scope',
          statement: 'The rehearsal must cover the full rollback path including the payment-service restart',
          raised_at: '2025-06-11T00:00:00Z',
          status: 'RESOLVED',
          resolution: {
            note: 'Rehearsal v2 covered the full path including the payment-service restart; total time 214s < 300s bound',
            resolved_at: '2025-06-12T00:00:00Z',
            provenance: [DEMO_PROVENANCE, 'objection:rehearsal-v2'],
          },
        },
      ],
    },
    provenance: [DEMO_PROVENANCE, 'assurance:queue-promotion-case'],
    created_at: DEMO_T2,
    authority_ref: missionV2.envelope.id,
    status: 'ACTIVE',
  });
  const assuranceValidEvaluation = evaluateAssuranceCase(assuranceValid, {
    now: DEMO_NOW,
    implementation_revisions: { [observedModel.id]: DEMO_SOURCE_REVISION },
    assumption_checks: { 'assumption-canary-population': true },
    evidence: [evQueueCanary, evRehearsal],
  });

  // --- Package ecology (two families + one composition) ------------------
  const packageQueue = createPackageArtifact({
    content: {
      semantic_capability: 'Durable checkout write buffering',
      contracts: ['sos://schema/durable-queue'],
      preconditions: ['A message bus with at-least-once delivery is deployed'],
      postconditions: ['Checkout writes are durably buffered under peak load'],
      realizations: [{ ref: queueRealizationSubject, revision: 'r1', note: 'Queue-backed checkout write buffer' }],
      applicability: [
        { kind: 'QUALITATIVE', uncertainty_class: 'MODERATE', context: { environment: 'production', workload: 'peak-hour' }, sample_size: 14, window: { ...DEMO_WINDOW } },
      ],
      evidence_refs: [evQueueTest.id, evQueueTelemetry.id],
      failure_refs: [],
      compatibility_refs: [],
      composition_refs: [],
      assurance_obligations: [{ kind: 'CANARY', obligation: 'Canary every adoption for at least one ladder cycle before full exposure' }],
      context: { environment: 'production', workload: 'peak-hour' },
      learned_limitations: ['Assumes peak-hour traffic shapes similar to the observed EU pattern'],
      diversity_profile: {
        family: 'cost-optimized',
        dimensions: [
          { dimension: 'COST', stance: 'optimizes for lower monthly cost (fewer synchronous round-trips)' },
          { dimension: 'RESILIENCE', stance: 'buffers upstream outages for the queue depth window' },
          { dimension: 'OPERATIONAL_COMPLEXITY', stance: 'accepts one more stateful component to operate' },
        ],
      },
      maturity: 'VALIDATED',
      changes: 'Initial validated realization (integration test + production telemetry)',
      superseded_by: null,
    },
    provenance: [DEMO_PROVENANCE, 'package:durable-queue-extraction'],
    created_at: DEMO_T2,
    authority_ref: missionV2.envelope.id,
    status: 'ACTIVE',
  });

  const packageCache = createPackageArtifact({
    content: {
      semantic_capability: 'Edge-cached checkout rendering',
      contracts: ['sos://schema/render-cache'],
      preconditions: ['A CDN with regional edge presence is deployed'],
      postconditions: ['Checkout rendering is served from the regional edge'],
      realizations: [{ ref: cacheRealizationSubject, revision: 'r1', note: 'Edge cache for checkout rendering' }],
      applicability: [
        { kind: 'QUALITATIVE', uncertainty_class: 'STRONG', context: { environment: 'production', region: 'eu' }, sample_size: 31, window: { ...DEMO_WINDOW } },
      ],
      evidence_refs: [evCacheLoad.id, evCacheTelemetry.id],
      failure_refs: [evCacheIncident.id],
      compatibility_refs: [],
      composition_refs: [],
      assurance_obligations: [{ kind: 'SHADOW', obligation: 'Shadow-render before serving any live traffic in a new region' }],
      context: { environment: 'production', region: 'eu' },
      learned_limitations: ['Cold-start latency spikes after cache invalidation (see the retained failure evidence)'],
      diversity_profile: {
        family: 'latency-optimized',
        dimensions: [
          { dimension: 'LATENCY', stance: 'optimizes for p99 render latency < 50ms in-region' },
          { dimension: 'COST', stance: 'accepts higher CDN cost' },
          { dimension: 'HUMAN_COMPREHENSIBILITY', stance: 'cache invalidation reasoning is explicit and logged' },
        ],
      },
      maturity: 'VALIDATED',
      changes: 'Initial validated realization (load test + telemetry; one retained failure context)',
      superseded_by: null,
    },
    provenance: [DEMO_PROVENANCE, 'package:edge-cache-extraction'],
    created_at: DEMO_T2,
    authority_ref: missionV2.envelope.id,
    status: 'ACTIVE',
  });

  const registry = new PackageRegistry();
  registry.putPackage(packageQueue, [evQueueTest, evQueueTelemetry]);
  registry.putPackage(packageCache, [evCacheLoad, evCacheTelemetry]);

  // The composition: form first, then promote with its OWN evidence
  // (the documented no-circularity workflow of the own-evidence discipline).
  const compositionV1 = createPackageComposition({
    content: {
      semantic_capability: 'Fast-and-cheap checkout delivery (buffered writes + edge rendering)',
      contracts: ['sos://schema/durable-queue', 'sos://schema/render-cache'],
      members: [
        { package_id: packageQueue.envelope.id, role: 'write-buffer', bound_contracts: ['sos://schema/durable-queue'] },
        { package_id: packageCache.envelope.id, role: 'render-edge', bound_contracts: ['sos://schema/render-cache'] },
      ],
      bindings: [
        { kind: 'CONFIGURES', source_role: 'render-edge', target_role: 'write-buffer', contract: 'sos://schema/durable-queue', wiring: { cache_flush: 'on-write-commit' } },
      ],
      preconditions: ['Both member preconditions hold'],
      postconditions: ['Checkout renders from the edge and buffers writes durably'],
      applicability: [
        { kind: 'QUALITATIVE', uncertainty_class: 'WEAK', context: { environment: 'production', region: 'eu', workload: 'peak-hour' }, sample_size: 4, window: { ...DEMO_WINDOW } },
      ],
      evidence_refs: [],
      failure_refs: [],
      compatibility_refs: [],
      assurance_obligations: [{ kind: 'CONTROLLED_EXPERIMENT', obligation: 'Run a controlled experiment on the composed system before promotion' }],
      context: { environment: 'production', region: 'eu', workload: 'peak-hour' },
      learned_limitations: [],
      diversity_profile: {
        family: 'balanced-composition',
        dimensions: [
          { dimension: 'COST', stance: 'balances CDN cost against round-trip savings' },
          { dimension: 'LATENCY', stance: 'targets p95 < 250ms end to end' },
        ],
      },
      maturity: 'FORMING',
      independence: [],
      changes: 'Composition formed; awaiting own composed-system evidence',
      superseded_by: null,
    },
    provenance: [DEMO_PROVENANCE, 'composition:fast-cheap-checkout'],
    created_at: DEMO_T2,
    authority_ref: missionV2.envelope.id,
    status: 'ACTIVE',
  });
  registry.putComposition(compositionV1);

  // The own-evidence discipline's documented no-circularity workflow: create
  // evidence ABOUT the formed revision, cite it in a same-maturity revision,
  // then promote — the chain ids make the evidence "own".
  const evCompositionOwn = evidence({
    seed: 'composition-own-evidence', subject: compositionV1.envelope.id, availability: 'SUCCESS', evidenceClass: 'INTERVENTIONAL',
    kind: 'composed-system-test', method: 'composition:combined-scenario', confidence: 'WEAK', producer: TEST_PRODUCER,
  });
  const evCompositionOwn2 = evidence({
    seed: 'composition-own-evidence-2', subject: compositionV1.envelope.id, availability: 'SUCCESS', evidenceClass: 'INTERVENTIONAL',
    kind: 'composed-system-canary', method: 'composition:canary-comparison', confidence: 'MODERATE', producer: TOOL_PRODUCER,
  });
  const compositionV2 = createPackageComposition({
    content: {
      ...compositionV1.content,
      evidence_refs: [evCompositionOwn.id, evCompositionOwn2.id],
      changes: 'Revision cites the composed-system evidence (own evidence about the formed revision)',
    },
    provenance: [DEMO_PROVENANCE, 'composition:cite-own-evidence'],
    created_at: DEMO_NOW,
    authority_ref: missionV2.envelope.id,
    version: 2,
    status: 'ACTIVE',
    supersedes: compositionV1.envelope.id,
  });
  registry.putComposition(compositionV2);
  const compositionPromotion = registry.promote({
    id: compositionV2.envelope.id,
    target: 'VALIDATED',
    evidence: [evCompositionOwn, evCompositionOwn2],
    evidence_refs: [evCompositionOwn.id, evCompositionOwn2.id],
    changes: 'Validated with own composed-system evidence (member evidence deliberately not counted)',
    provenance: [DEMO_PROVENANCE, 'composition:own-evidence-promotion'],
    created_at: DEMO_NOW,
  });
  const compositionHeadId = compositionPromotion.promoted.artifact.envelope.id;

  const evidenceById = new Map<string, EvidenceRecordW3>();
  for (const record of [
    evUptime,
    evLatencyPartial,
    evQueueCanary,
    evCacheShadow,
    evModelCollectorOutage,
    evAdapterTelemetry,
    evPaymentIncident,
    evRehearsal,
    evLlmAnalysis,
    evQueueTest,
    evQueueTelemetry,
    evCacheLoad,
    evCacheTelemetry,
    evCacheIncident,
    evGuardrailUnsupported,
    evCompositionOwn,
    evCompositionOwn2,
  ]) {
    evidenceById.set(record.id, record);
  }
  const repertoire = registry.retrieve({
    capability: 'checkout',
    evidenceResolver: (id) => evidenceById.get(id),
  });

  // --- Authority grant + promotion (ACT with bounded recovery) -----------
  const promotionGrant = createGrant({
    grantee: 'sos://Decision/promotion-actor',
    scope: { kind: 'ARTIFACT', artifact_id: candidateQueue.envelope.id },
    permissions: ['PROMOTE'],
    expiry: { kind: 'TIME', at: '2025-07-01T00:00:00Z' },
    provenance: [DEMO_PROVENANCE, 'grant:queue-promotion-authority'],
    created_at: DEMO_T2,
    authority_ref: constitutionId,
    status: 'ACTIVE',
  });

  const promotion = evaluatePromotion(candidateQueue, {
    authority: { grant: promotionGrant, now: DEMO_NOW },
    assurance: {
      id: assuranceValid.envelope.id,
      claims: assuranceValid.content.claims.map((claim) => ({ id: claim.id, statement: claim.statement })),
      verdict: 'SATISFIED',
      validity: {
        status: 'CURRENT',
        expires_at: '2025-07-01T00:00:00Z',
        reason: `Living evaluation at ${DEMO_NOW}: every validity condition holds, all assumptions checked, supporting evidence fresh and conclusive, no fresh contradiction`,
      },
    },
    evidence: [evQueueCanary, evRehearsal],
    liveTriggers: experimentEvaluation.rollback,
    systemState: { revision: 'system-state-v2', description: 'The current observed system state' },
    recovery: {
      mechanism: 'Redeploy the prior production deployment (deploy:checkout-prod-2025-06-01) and drain the queue',
      max_recovery_seconds: 300,
      containment_exception: null,
      rollback_triggers: experimentEvaluation.rollback.map((trigger) => ({
        experiment_id: experiment.envelope.id,
        trigger,
      })),
      authority_ref: promotionGrant.envelope.id,
    },
    provenance: [DEMO_PROVENANCE, 'promotion:queue-candidate-gate'],
    created_at: DEMO_NOW,
  });

  const recoveryDeclaration = createRecoveryDeclaration({
    content: {
      change_ref: promotion.record.envelope.id,
      mechanism: { kind: 'ROLLBACK_DEPLOYMENT', to_deployment_id: 'deploy:checkout-prod-2025-06-01' },
      trigger: { kind: 'BUDGET', metric: 'checkout-error-rate', threshold: '1%', window_ms: 300000 },
      authority_ref: promotionGrant.envelope.id,
      evidence_ref: evRehearsal.id,
      exception: null,
    },
    provenance: [DEMO_PROVENANCE, 'recovery:promotion-rollback-declaration'],
    created_at: DEMO_NOW,
    authority_ref: promotionGrant.envelope.id,
    status: 'ACTIVE',
  });

  // --- The ASK journey (an IRREDUCIBLE-uncertainty retirement) ----------
  // Everything checkable is green — valid authority, safe risk profile,
  // current evidence that the legacy adapter carries zero traffic — but the
  // deciding uncertainty (do any off-platform EU partners still integrate
  // the legacy SOAP interface?) cannot be reduced by observation. Only
  // judgment can decide: the engine escalates a first-class ASK.
  const retirementGrant = createGrant({
    grantee: 'sos://Decision/checkout-evolver',
    scope: { kind: 'ARTIFACT', artifact_id: observedModel.id },
    permissions: ['RETIRE'],
    expiry: { kind: 'TIME', at: '2025-07-01T00:00:00Z' },
    provenance: [DEMO_PROVENANCE, 'grant:legacy-adapter-retirement-authority'],
    created_at: DEMO_T2,
    authority_ref: constitutionId,
    status: 'ACTIVE',
  });
  const askEvaluation = evaluate(
    {
      action_kind: 'RETIRE',
      action_description: 'Retire the legacy SOAP payment adapter from the checkout implementation',
      target: { kind: 'ARTIFACT', artifact_id: observedModel.id },
      blast_radius: 'COMPONENT',
      impact: 'HIGH',
      risk: 'LOW',
      reversibility: 'REVERSIBLE',
      causal_claim: false,
      uncertainty: {
        uncertainty_class: 'IRREDUCIBLE',
        basis: 'Whether any off-platform EU partner still integrates the legacy SOAP interface cannot be observed from telemetry — only judgment can decide',
      },
      rollback_signals: [],
      evidence: [evAdapterTelemetry],
      grants: [retirementGrant],
      evaluation_point: { kind: 'TIME', now: DEMO_NOW },
      explicit_authority_decision_ref: null,
      confidence: null,
    },
    { provenance: [DEMO_PROVENANCE, 'decision:legacy-adapter-retirement-request'], created_at: DEMO_NOW },
  );
  const askContent = composeAskContent({
    decision: askEvaluation.record,
    evidence: [evAdapterTelemetry],
  });
  const askRequest = createAskRequest({
    content: askContent,
    provenance: [DEMO_PROVENANCE, 'ask:cache-promotion-escalation'],
    created_at: DEMO_NOW,
    authority_ref: constitutionId,
    status: 'ACTIVE',
  });
  const askContext = assembleEscalationContext({
    ask: askRequest,
    decision: askEvaluation.record,
    evidence: [evAdapterTelemetry],
    now: DEMO_NOW,
  });

  // --- The current system state (SS v1 -> v2 through the store) ----------
  const systemStateV2 = systemStateStore.supersede(systemStateV1.envelope.id, {
    content: {
      architecture_ref: { artifact_id: graphV2.envelope.id, version: 2 },
      implementation: [{ artifact_id: observedModel.id, revision: { kind: 'git-sha', value: DEMO_SOURCE_REVISION } }],
      configuration: [{ config_id: 'checkout-config', revision: { kind: 'config-version', value: 'v42' } }],
      deployment: [{ deployment_id: 'deploy:checkout-prod-2025-06-01', environment: 'production', revision: { kind: 'deployment-id', value: 'deploy:checkout-prod-2025-06-01' } }],
      policy: [{ policy_id: 'deployment-policy', version: 4 }],
      environment_relationships: [
        { source: 'staging', target: 'production', kind: 'promotes-to' },
        { source: 'production', target: 'production-dr', kind: 'mirrors' },
      ],
      active_experiments: [{ experiment_id: experiment.envelope.id, environment: 'production' }],
      package_realizations: [
        { package_id: packageQueue.envelope.id, version: '1', realized_by: ['component:checkout-api'] },
        { package_id: packageCache.envelope.id, version: '1', realized_by: ['component:render-cache'] },
      ],
    },
    provenance: [DEMO_PROVENANCE, 'system-state:current-observed'],
    created_at: DEMO_T2,
  }).supersededBy;
  const systemStatesByVersion: SystemStateArtifact[] = [
    systemStateStore.get(systemStateV0.envelope.id)!,
    systemStateStore.get(systemStateV1.envelope.id)!,
    systemStateV2,
  ];

  // --- The rationale web (typed spine trace links) ------------------------
  const links: TraceLink[] = [
    link(missionV1.envelope.id, constitutionId, 'DERIVED_FROM'),
    link(missionV2.envelope.id, missionV1.envelope.id, 'DERIVED_FROM'),
    link(missionV2.envelope.id, constitutionId, 'DERIVED_FROM'),
    link(graphV1.envelope.id, missionV1.envelope.id, 'SATISFIES'),
    link(graphV1.envelope.id, systemStateV0.envelope.id, 'DERIVED_FROM'),
    link(graphV2.envelope.id, graphV1.envelope.id, 'DERIVED_FROM'),
    link(graphV2.envelope.id, missionV2.envelope.id, 'SATISFIES'),
    link(graphV2.envelope.id, systemStateV1.envelope.id, 'DERIVED_FROM'),
    link(observedModel.id, graphV2.envelope.id, 'IMPLEMENTS'),
    link(evUptime.id, systemStateV1.envelope.id, 'OBSERVES'),
    link(evLatencyPartial.id, systemStateV1.envelope.id, 'OBSERVES'),
    link(evPaymentIncident.id, systemStateV0.envelope.id, 'OBSERVES'),
    link(evModelCollectorOutage.id, observedModel.id, 'OBSERVES'),
    link(evLlmAnalysis.id, graphV2.envelope.id, 'OBSERVES'),
    link(evQueueCanary.id, candidateQueue.envelope.id, 'VERIFIES'),
    link(evRehearsal.id, candidateQueue.envelope.id, 'VERIFIES'),
    link(evCacheShadow.id, candidateCache.envelope.id, 'OBSERVES'),
    link(evGuardrailUnsupported.id, experiment.envelope.id, 'OBSERVES'),
    link(candidateQueue.envelope.id, graphV2.envelope.id, 'DERIVED_FROM'),
    link(candidateQueue.envelope.id, missionV2.envelope.id, 'SATISFIES'),
    link(candidateCache.envelope.id, graphV2.envelope.id, 'DERIVED_FROM'),
    link(candidateCache.envelope.id, missionV2.envelope.id, 'SATISFIES'),
    link(experiment.envelope.id, candidateQueue.envelope.id, 'VERIFIES'),
    link(experiment.envelope.id, hypothesisQueue, 'DERIVED_FROM'),
    link(simulatedResult.id, candidateQueue.envelope.id, 'VERIFIES'),
    link(simulatedResult.id, hypothesisQueue, 'OBSERVES'),
    link(simulatedResult.id, experiment.envelope.id, 'CAUSED_BY'),
    link(assuranceObjectioned.envelope.id, candidateQueue.envelope.id, 'VERIFIES'),
    link(assuranceObjectioned.envelope.id, missionV2.envelope.id, 'SATISFIES'),
    link(assuranceValid.envelope.id, candidateQueue.envelope.id, 'VERIFIES'),
    link(assuranceValid.envelope.id, missionV2.envelope.id, 'SATISFIES'),
    link(promotion.record.envelope.id, candidateQueue.envelope.id, 'DERIVED_FROM'),
    link(promotion.record.envelope.id, assuranceValid.envelope.id, 'DERIVED_FROM'),
    link(promotion.record.envelope.id, promotionGrant.envelope.id, 'DERIVED_FROM'),
    link(recoveryDeclaration.envelope.id, promotion.record.envelope.id, 'CONSTRAINS'),
    link(evRehearsal.id, recoveryDeclaration.envelope.id, 'VERIFIES'),
    link(evAdapterTelemetry.id, observedModel.id, 'OBSERVES'),
    link(askEvaluation.record.envelope.id, observedModel.id, 'DERIVED_FROM'),
    link(askEvaluation.record.envelope.id, retirementGrant.envelope.id, 'DERIVED_FROM'),
    link(askRequest.envelope.id, askEvaluation.record.envelope.id, 'DERIVED_FROM'),
    link(packageQueue.envelope.id, candidateQueue.envelope.id, 'REALIZES'),
    link(packageCache.envelope.id, candidateCache.envelope.id, 'REALIZES'),
    link(compositionV1.envelope.id, packageQueue.envelope.id, 'COMPOSES'),
    link(compositionV1.envelope.id, packageCache.envelope.id, 'COMPOSES'),
    link(compositionV2.envelope.id, compositionV1.envelope.id, 'DERIVED_FROM'),
    link(compositionHeadId, compositionV2.envelope.id, 'DERIVED_FROM'),
    link(compositionHeadId, packageQueue.envelope.id, 'COMPOSES'),
    link(compositionHeadId, packageCache.envelope.id, 'COMPOSES'),
    link(systemStateV2.envelope.id, graphV2.envelope.id, 'DERIVED_FROM'),
    link(systemStateV2.envelope.id, observedModel.id, 'DERIVED_FROM'),
    link(systemStateV2.envelope.id, missionV2.envelope.id, 'SATISFIES'),
  ];

  // --- The machine state (the SOS self-evolution review input) -----------
  const machineState: MachineStateSnapshot = {
    schemaVersion: '2.0',
    program: 'SOS-2.0',
    status: 'ACTIVE',
    currentFrontier: ['W11', 'W12'],
    currentTask: 'W11+W12 (final parallel wave; W14 unlocks after both)',
    tasks: {
      W0: { status: 'BOOTSTRAP_COMPLETE', dependencies: [], mergedAs: 'INITIAL_BOOTSTRAP' },
      'W0.5': { status: 'COMPLETE', dependencies: ['W0'], mergedAs: 'adf3156c904a7fbbb3214a2036396ec5a1d67212' },
      W1: { status: 'COMPLETE', dependencies: ['W0.5'], mergedAs: '645f5a582ea296c5ad446ff31c7956437378e529' },
      W2: { status: 'COMPLETE', dependencies: ['W0.5'], mergedAs: 'cc9354aca1570704a3ad4d3e287874967c10c28b' },
      W3: { status: 'COMPLETE', dependencies: ['W0.5'], mergedAs: '615dd7ff73fcb7c7b15237bd110e66d44792aa54' },
      W4: { status: 'COMPLETE', dependencies: ['W2', 'W3'], mergedAs: '19f71220fbd32ce9f397d46d3e9b2d8cd228b893' },
      W5: { status: 'COMPLETE', dependencies: ['W1', 'W3'], mergedAs: '4ab276bc9afe8de33ae507c057f0257e3ccae9ca' },
      W6: { status: 'COMPLETE', dependencies: ['W1', 'W2', 'W3'], mergedAs: '43297a549b81f9d6f6d9cc60c0d5a6998d799fa0' },
      W7: { status: 'COMPLETE', dependencies: ['W4', 'W5', 'W6'], mergedAs: '8483027586ed88d7372d2906149fc89cb63fafc3' },
      W8: { status: 'COMPLETE', dependencies: ['W2', 'W3'], mergedAs: 'ce26a8b085f1d74675928db2c2fab6efccb76f54' },
      W9: { status: 'COMPLETE', dependencies: ['W2', 'W3', 'W6'], mergedAs: '72ff4570dc3267a266566471ea63aeb529a8f891' },
      W10: { status: 'COMPLETE', dependencies: ['W1', 'W8', 'W9'], mergedAs: '97ff90a615272f28dac62ac7360595f2312df204' },
      W11: { status: 'ELIGIBLE', dependencies: ['W1', 'W2', 'W8', 'W10'], mergedAs: null },
      W12: { status: 'ELIGIBLE', dependencies: ['W2', 'W3', 'W8', 'W10'], mergedAs: null },
      W13: { status: 'COMPLETE', dependencies: ['W5', 'W6', 'W7'], mergedAs: 'f6bcd2901b71192ce913f09193012122b5f056a9' },
      W14: { status: 'BLOCKED', dependencies: ['W1', 'W2', 'W6', 'W10', 'W11', 'W12'], mergedAs: null },
      W15: { status: 'BLOCKED', dependencies: ['W4', 'W5', 'W7', 'W8', 'W9', 'W10', 'W12', 'W13'], mergedAs: null },
      W16: { status: 'BLOCKED', dependencies: ['W9', 'W10', 'W13', 'W15'], mergedAs: null },
      W17: { status: 'BLOCKED', dependencies: ['W11', 'W12', 'W13', 'W14', 'W15', 'W16'], mergedAs: null },
      W18: { status: 'BLOCKED', dependencies: ['W17'], mergedAs: null },
    },
  };

  return {
    now: DEMO_NOW,
    constitution_id: constitutionId,
    baseline_graph_id: baselineGraphId,
    missions: [missionV1Final, missionV2],
    graphs: [graphV1Final, graphV2],
    system_states: systemStatesByVersion,
    observed_model: observedModel,
    evidence: [...evidenceById.values()].sort((a, b) => (a.id < b.id ? -1 : 1)),
    candidates: [candidateQueue, candidateCache],
    assurance_cases: [
      { artifact: assuranceObjectioned, evaluation: assuranceObjectionedEvaluation },
      { artifact: assuranceValid, evaluation: assuranceValidEvaluation },
    ],
    experiment: { artifact: experiment, result: simulatedResult, evaluation: experimentEvaluation },
    ask: { request: askRequest, context: askContext, decision: askEvaluation.record },
    grant: promotionGrant,
    promotion,
    recovery_declaration: recoveryDeclaration,
    repertoire,
    package_evidence: {
      [packageQueue.envelope.id]: [evQueueTest.id, evQueueTelemetry.id],
      [packageCache.envelope.id]: [evCacheLoad.id, evCacheTelemetry.id],
      [compositionHeadId]: [evCompositionOwn.id, evCompositionOwn2.id],
    },
    machine_state: machineState,
    links,
  };
}
