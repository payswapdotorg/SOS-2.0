/**
 * The P1 demo world — a scripted, fully deterministic fixture for the
 * production web console shell, constructed EXCLUSIVELY through the frozen
 * domain packages' own builders (createGrant, createMission + MissionStore,
 * createSystemState + its store, createCandidateState, createEvidence,
 * createExperiment + simulateExperiment + evaluateExperimentResult, the
 * decision engine + ASK composition + the AskQueue, createPackageArtifact,
 * createTraceLink). No hand-written domain JSON, no invented spine
 * identifiers: every id is minted by the Semantic Spine's deterministic
 * content addressing over fixed inputs, so the same fixture always produces
 * the same world and byte-identical rendered output.
 *
 * THE DEMO HONESTY CONTRACT: this dataset is DEMO — SIMULATED DATA. Every
 * surface rendered from it carries the visible demo badge and the
 * revision-pinned fixture provenance (see ../data-source.ts); it must never
 * render as live state. All timestamps are static literals; there is no
 * hidden clock and no randomness (the experiment simulator runs with a
 * fixed seed).
 *
 * THE OWNERSHIP HONESTY: active tasks, body leases and the observation
 * record are VIEW-LEVEL fixtures (plain ids) because their durable runtime
 * contracts belong to later Work Orders (P6/P7/P12) and are not frozen yet;
 * they reference real spine ids and every view model binds the rationale
 * chain of the spine subject it serves. See ../autonomous-work.ts.
 *
 * The story (one coherent product system, mirroring the proven W11 demo
 * world): a checkout platform evolves under SOS governance — mission v1 ->
 * v2 with a measurable EU latency goal; system states v0 -> v1 -> v2 with
 * exact implementation/deployment revisions; two candidates from different
 * diversity families; a canary experiment at 10% exposure with an honestly
 * marked simulated evaluation; a pending ASK that only a human can answer;
 * two validated packages with retained limitations; and an active
 * autonomous-work surface with a cloud body at work, a suspended lease
 * after a provider outage (the task survives), a queued local task while
 * the device is offline, and continuous observation without a body.
 */

import { createMission, MissionStore } from '@sos-2/mission';
import type { MissionArtifact } from '@sos-2/mission';
import { createSystemState, createSystemStateStore } from '@sos-2/system-state';
import type { SystemStateArtifact } from '@sos-2/system-state';
import type { TraceLink } from '@sos-2/semantic-spine';
import { createTraceLink, deriveDeterministicArtifactId } from '@sos-2/semantic-spine';
import { createEvidence } from '@sos-2/evidence';
import type { EvidenceRecordW3 } from '@sos-2/evidence';
import {
  createCandidateState,
  createExperiment,
  evaluateExperimentResult,
  simulateExperiment,
} from '@sos-2/experiments';
import type {
  CandidateStateFixture,
  ExperimentArtifact,
  ExperimentResultRecord,
} from '@sos-2/experiments';
import { createAskRequest, createGrant } from '@sos-2/authority';
import type { AskRequestArtifact, AuthorityGrantArtifact } from '@sos-2/authority';
import { evaluate } from '@sos-2/decision';
import type { DecisionRecord } from '@sos-2/decision';
import { assembleEscalationContext, composeAskContent, AskQueue } from '@sos-2/ask';
import type { AskEscalationContext } from '@sos-2/ask';
import { createPackageArtifact } from '@sos-2/packages';
import type { PackageArtifact } from '@sos-2/packages';
import type { DemoBodyLeaseRecord, DemoObservationRecord, DemoTaskRecord } from '../autonomous-work.js';
import type { RecentLearningEntry } from '../overview-cards.js';
import type { DemoGapRecord } from '../hero.js';

// ---------------------------------------------------------------------------
// Fixed instants and revision pins (no hidden clocks anywhere in the demo)
// ---------------------------------------------------------------------------

/** The fixed presentation instant. */
export const DEMO_NOW = '2025-06-15T12:00:00Z';
export const DEMO_T0 = '2025-05-01T00:00:00Z';
export const DEMO_T1 = '2025-05-20T00:00:00Z';
export const DEMO_T2 = '2025-06-01T00:00:00Z';
export const DEMO_WINDOW = { start: '2025-06-01T00:00:00Z', end: '2025-06-30T00:00:00Z' } as const;
export const DEMO_SOURCE_REVISION = '3f9c1a2b8d7e4f60a1b2c3d4e5f6a7b8c9d0e1f2';
export const DEMO_PROVENANCE = 'P1:web-shell:demo-fixture';
/** The exact repository revision this fixture dataset is pinned to (static literal). */
export const DEMO_FIXTURE_REVISION = 'c924e617650a243df9df7580e60d0e021fac1059';
/** The visible note carried by every demo surface. */
export const DEMO_NOTE =
  'This console build renders a fixed demo dataset so the product surfaces can be reviewed before live stores are connected.';

const TOOL_PRODUCER = {
  tool: 'otel-collector',
  tool_version: '1.2.0',
  model: null,
  model_version: null,
  command: null,
  environment: 'production',
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

type DemoProducer = typeof TOOL_PRODUCER | typeof TEST_PRODUCER | typeof LLM_PRODUCER;

// ---------------------------------------------------------------------------
// The demo world
// ---------------------------------------------------------------------------

/** The complete, deterministic demo world for the production shell. */
export interface DemoWebWorld {
  /** The fixed presentation instant (no hidden clocks). */
  now: string;
  /** The exact repository revision the fixture is pinned to. */
  fixture_revision: string;
  constitution_id: string;
  /** Mission v1 (SUPERSEDED) and v2 (ACTIVE). */
  missions: MissionArtifact[];
  /** System states v0 -> v1 -> v2 (v2 is current/ACTIVE). */
  system_states: SystemStateArtifact[];
  /** The observed implementation model id (derived spine id). */
  observed_model_id: string;
  /** The architecture graph ids referenced by the system states (derived spine ids). */
  graph_ids: { baseline: string; v1: string; v2: string };
  /** The evidence pool (all six truth states present, distinct classes retained). */
  evidence: EvidenceRecordW3[];
  /** The two candidates (durable queue + edge cache). */
  candidates: CandidateStateFixture[];
  /** The canary experiment with its honestly-marked simulated run. */
  experiment: {
    artifact: ExperimentArtifact;
    result: ExperimentResultRecord;
    evaluation: ReturnType<typeof evaluateExperimentResult>;
  };
  /** The pending ASK (an irreducible question only a human can answer). */
  ask: {
    request: AskRequestArtifact;
    context: AskEscalationContext;
    decision: DecisionRecord;
    queue_size: number;
  };
  /** The authority grants in play. */
  grants: {
    mission_revision: AuthorityGrantArtifact;
    promotion: AuthorityGrantArtifact;
    retirement: AuthorityGrantArtifact;
  };
  /** The package repertoire (two validated packages from two diversity families). */
  packages: PackageArtifact[];
  /** View-level task fixtures (plain ids; P12 owns the durable runtime). */
  tasks: DemoTaskRecord[];
  /** View-level body-lease fixtures (plain ids; ephemeral execution resources). */
  leases: DemoBodyLeaseRecord[];
  /** The observation status (watching without a body — journey 14). */
  observation: DemoObservationRecord;
  /** Shortfall/opportunity fixtures referencing real spine ids. */
  gaps: DemoGapRecord[];
  /** Recent learning entries (authored over real spine refs). */
  learning: RecentLearningEntry[];
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

/** Build the demo world (deterministic, total, no I/O, no clocks). */
export function buildDemoWebWorld(): DemoWebWorld {
  // --- Anchors -----------------------------------------------------------
  const constitutionId = deriveDeterministicArtifactId('Constitution', {
    name: 'checkout-platform-constitution',
    article: 'Constitution outranks optimization; evidence outranks assertion',
  });
  const baselineGraphId = deriveDeterministicArtifactId('ArchitectureGraph', {
    fixture: 'P1 demo: legacy pre-SOS baseline architecture (outside the demo snapshot)',
  });
  const graphV1Id = deriveDeterministicArtifactId('ArchitectureGraph', {
    fixture: 'P1 demo: recovered checkout architecture v1 (outside the demo snapshot)',
  });
  const graphV2Id = deriveDeterministicArtifactId('ArchitectureGraph', {
    fixture: 'P1 demo: edge-cache hypothesis architecture v2 (outside the demo snapshot)',
  });
  const observedModelId = deriveDeterministicArtifactId('ImplementationModel', {
    fixture: 'P1 demo: observed checkout implementation',
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
      ],
    },
    provenance: [DEMO_PROVENANCE, 'mission:revision-latency-goal'],
    created_at: DEMO_T1,
  });
  const missionV2 = missionRevision.revised;
  const missionV1Final = missionRevision.previous; // SUPERSEDED, identity preserved

  // --- System states v0 -> v1 -> v2 (exact revisions throughout) ---------
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

  const systemStateV1Pre = createSystemState({
    content: {
      architecture_ref: { artifact_id: graphV1Id, version: 1 },
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

  // --- Candidates (two diversity families) -------------------------------
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
      bounded_subgraph_ref: { graph_id: graphV2Id, version: 2 },
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
      bounded_subgraph_ref: { graph_id: graphV2Id, version: 2 },
      context: { environment: 'production', region: 'eu', workload: 'steady' },
    },
    provenance: [DEMO_PROVENANCE, 'candidate:edge-cache-search'],
    created_at: DEMO_T2,
    status: 'ACTIVE',
  });

  // --- The canary experiment (treatment-control on the queue candidate) --
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
  // infrastructure, never intervention evidence).
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

  // --- Evidence pool (all 6 truth states, distinct classes retained) -----
  const evQueueCanary = evidence({
    seed: 'queue-canary', subject: candidateQueue.envelope.id, availability: 'SUCCESS', evidenceClass: 'INTERVENTIONAL',
    kind: 'canary-observation', method: 'canary:threshold-comparison', confidence: 'MODERATE', producer: TOOL_PRODUCER,
  });
  const evCacheShadow = evidence({
    seed: 'cache-shadow-unknown', subject: candidateCache.envelope.id, availability: 'UNKNOWN', evidenceClass: 'OBSERVATIONAL',
    kind: 'shadow-observation', method: 'shadow:pending-analysis', confidence: 'UNQUANTIFIED', producer: TOOL_PRODUCER,
  });
  const evModelCollectorOutage = evidence({
    seed: 'model-collector-outage', subject: observedModelId, availability: 'UNAVAILABLE', evidenceClass: 'OBSERVATIONAL',
    kind: 'telemetry', method: 'telemetry:capture-availability', confidence: 'UNQUANTIFIED', producer: TOOL_PRODUCER,
  });
  const evAdapterTelemetry = evidence({
    seed: 'legacy-adapter-zero-usage', subject: observedModelId, availability: 'SUCCESS', evidenceClass: 'OBSERVATIONAL',
    kind: 'telemetry', method: 'telemetry:capture-availability', confidence: 'MODERATE', producer: TOOL_PRODUCER,
  });
  const evPaymentIncident = evidence({
    seed: 'payment-incident-2025-05', subject: systemStateV0.envelope.id, availability: 'FAILURE', evidenceClass: 'OBSERVATIONAL',
    kind: 'incident-report', method: 'incident:postmortem', confidence: 'STRONG', producer: TOOL_PRODUCER,
  });
  const evRehearsal = evidence({
    seed: 'rollback-rehearsal', subject: candidateQueue.envelope.id, availability: 'SUCCESS', evidenceClass: 'INTERVENTIONAL',
    kind: 'rollback-rehearsal', method: 'rehearsal:executed-and-timed', confidence: 'STRONG', producer: TEST_PRODUCER,
  });
  const evLlmAnalysis = evidence({
    seed: 'llm-architecture-analysis', subject: graphV2Id, availability: 'SUCCESS', evidenceClass: 'OBSERVATIONAL',
    kind: 'architecture-analysis', method: 'llm:structured-analysis', confidence: 'UNQUANTIFIED', producer: LLM_PRODUCER,
  });
  const evGuardrailUnsupported = evidence({
    seed: 'guardrail-telemetry-unsupported', subject: experiment.envelope.id, availability: 'UNSUPPORTED', evidenceClass: 'OBSERVATIONAL',
    kind: 'telemetry', method: 'telemetry:capture-availability', confidence: 'UNQUANTIFIED', producer: TOOL_PRODUCER,
  });

  // --- Packages (two validated capabilities from two families) -----------
  const queueRealizationSubject = deriveDeterministicArtifactId('ImplementationModel', { fixture: 'durable queue realization' });
  const cacheRealizationSubject = deriveDeterministicArtifactId('ImplementationModel', { fixture: 'edge cache realization' });

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

  // --- Authority: the promotion grant over the queue candidate ----------
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

  // --- The current system state (v1 -> v2 through the store) -------------
  const systemStateV2 = systemStateStore.supersede(systemStateV1.envelope.id, {
    content: {
      architecture_ref: { artifact_id: graphV2Id, version: 2 },
      implementation: [{ artifact_id: observedModelId, revision: { kind: 'git-sha', value: DEMO_SOURCE_REVISION } }],
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

  // Telemetry about the CURRENT system state (the June window observes v2):
  // uptime is successful, EU latency is only partially available — the basis
  // of the current shortfall and the DEGRADED system condition chip.
  const evUptime = evidence({
    seed: 'uptime-telemetry', subject: systemStateV2.envelope.id, availability: 'SUCCESS', evidenceClass: 'OBSERVATIONAL',
    kind: 'telemetry', method: 'telemetry:capture-availability', confidence: 'STRONG', producer: TOOL_PRODUCER,
  });
  const evLatencyPartial = evidence({
    seed: 'latency-telemetry-partial', subject: systemStateV2.envelope.id, availability: 'PARTIAL', evidenceClass: 'OBSERVATIONAL',
    kind: 'telemetry', method: 'telemetry:capture-availability', confidence: 'MODERATE', producer: TOOL_PRODUCER,
  });

  // --- The ASK journey (an IRREDUCIBLE-uncertainty retirement) ----------
  // Everything checkable is green — valid authority, safe risk profile,
  // current evidence that the legacy adapter carries zero traffic — but the
  // deciding uncertainty (do any off-platform EU partners still integrate
  // the legacy SOAP interface?) cannot be reduced by observation. Only
  // judgment can decide: the engine escalates a first-class ASK.
  const retirementGrant = createGrant({
    grantee: 'sos://Decision/checkout-evolver',
    scope: { kind: 'ARTIFACT', artifact_id: observedModelId },
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
      target: { kind: 'ARTIFACT', artifact_id: observedModelId },
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
    provenance: [DEMO_PROVENANCE, 'ask:legacy-adapter-retirement-escalation'],
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
  const askQueue = new AskQueue();
  askQueue.enqueue({
    ask: askRequest,
    origin_decision: askEvaluation.record,
    enqueued_at: DEMO_NOW,
  });

  // --- Active autonomous work (view-level fixtures; see module doc) -----
  const tasks: DemoTaskRecord[] = [
    {
      task_id: 'task-canary-guardrail-eval',
      title: 'Evaluate canary guardrail thresholds against the June telemetry window',
      status: 'RUNNING',
      summary: 'A cloud body is re-computing the error-rate and write-latency guardrail thresholds over the fixed June window.',
      mission_ref: missionV2.envelope.id,
      lease_id: 'lease-cloud-eval',
      checkpoint: null,
      ask_ref: null,
      evidence_refs: [evQueueCanary.id, evGuardrailUnsupported.id],
      runs_in_cloud: true,
      updated_at: '2025-06-15T11:45:00Z',
    },
    {
      task_id: 'task-legacy-adapter-retirement',
      title: 'Retire the legacy SOAP payment adapter',
      status: 'AWAITING_DECISION',
      summary: 'Everything checkable is green; the deciding question is escalated to a human and the task waits for the answer.',
      mission_ref: missionV2.envelope.id,
      lease_id: null,
      checkpoint: 'Decision recorded; execution resumes from the retirement plan after the answer.',
      ask_ref: askRequest.envelope.id,
      evidence_refs: [evAdapterTelemetry.id],
      runs_in_cloud: true,
      updated_at: '2025-06-15T12:00:00Z',
    },
    {
      task_id: 'task-edge-cache-shadow',
      title: 'Shadow-render checkout from the edge cache in eu-west-1',
      status: 'PAUSED',
      summary: 'The cloud body running the shadow render was lost in a provider outage; the checkpoint is retained and the task will resume on another body.',
      mission_ref: missionV2.envelope.id,
      lease_id: 'lease-cloud-shadow',
      checkpoint: 'Shadow render 62% complete for the eu-west-1 population; resume from the last captured frame set.',
      ask_ref: null,
      evidence_refs: [evCacheShadow.id],
      runs_in_cloud: true,
      updated_at: '2025-06-15T10:30:00Z',
    },
    {
      task_id: 'task-local-dev-sync',
      title: 'Sync local development fixtures with the observed implementation model',
      status: 'QUEUED',
      summary: 'This task needs the local companion; it is queued while the device is offline and will reconcile on reconnect.',
      mission_ref: missionV2.envelope.id,
      lease_id: null,
      checkpoint: 'Queued before dispatch; nothing to resume yet.',
      ask_ref: null,
      evidence_refs: [],
      runs_in_cloud: false,
      updated_at: '2025-06-15T09:12:00Z',
    },
  ];

  const leases: DemoBodyLeaseRecord[] = [
    {
      lease_id: 'lease-cloud-eval',
      body_kind: 'CLOUD',
      status: 'ACTIVE',
      held_by_task: 'task-canary-guardrail-eval',
      capabilities: ['shell', 'git', 'read-only production metrics access'],
      isolation: 'Cloud sandbox; no user device involved; no authority beyond the task scope.',
      granted_at: '2025-06-15T11:44:00Z',
    },
    {
      lease_id: 'lease-cloud-shadow',
      body_kind: 'CLOUD',
      status: 'SUSPENDED',
      held_by_task: 'task-edge-cache-shadow',
      capabilities: ['shell', 'browser'],
      isolation: 'Cloud sandbox; suspended after the provider outage — the broker will replace it.',
      granted_at: '2025-06-15T08:02:00Z',
    },
  ];

  const observation: DemoObservationRecord = {
    watching: true,
    sources: ['GitHub repository events', 'CI runs', 'Deployment events', 'Runtime telemetry', 'Scheduled probes'],
    last_event_at: '2025-06-15T11:58:00Z',
    events_in_window: 214,
    note: 'Observation runs continuously without a working body; events keep updating evidence and the system state.',
  };

  // --- Shortfall / opportunity + recent learning (view-level) -----------
  const gaps: DemoGapRecord[] = [
    {
      record_id: 'gap-latency-shortfall',
      kind: 'SHORTFALL',
      condition: 'DEGRADED',
      statement: 'EU checkout p95 latency sits above the 250 ms mission target during peak hours.',
      goal_ref: 'goal-latency',
      measure_ref: 'measure-p95',
      evidence_refs: [evLatencyPartial.id],
      uncertainty_class: 'MODERATE',
      uncertainty_statement: 'Latency telemetry for the peak window is only partially available; the exact p95 value remains uncertain.',
    },
    {
      record_id: 'gap-queue-opportunity',
      kind: 'OPPORTUNITY',
      condition: 'HEALTHY',
      statement: 'Buffering checkout writes through a durable queue is predicted to cut EU p95 latency and monthly cost.',
      goal_ref: 'goal-latency',
      measure_ref: 'measure-p95',
      evidence_refs: [evQueueCanary.id],
      uncertainty_class: 'MODERATE',
      uncertainty_statement: 'The prediction is supported by a canary observation so far; full-exposure behavior remains unproven.',
    },
  ];

  const learning: RecentLearningEntry[] = [
    {
      entry_id: 'entry-ambiguity-eu',
      kind: 'AMBIGUITY_RESOLUTION',
      statement: 'The open region ambiguity was resolved EU-first in mission revision 2.',
      refs: [missionV2.envelope.id, missionV1.envelope.id],
      learned_at: DEMO_T1,
    },
    {
      entry_id: 'entry-mission-revision',
      kind: 'MISSION_REVISION',
      statement: 'Mission revision 2 added the measurable EU latency goal and the EU compliance stakeholder.',
      refs: [missionV2.envelope.id, missionV1.envelope.id],
      learned_at: DEMO_T1,
    },
    {
      entry_id: 'entry-cache-limitation',
      kind: 'PACKAGE_LIMITATION',
      statement: 'The edge-cache package retains a learned limitation: cold-start latency spikes after cache invalidation.',
      refs: [packageCache.envelope.id, evCacheIncident.id],
      learned_at: DEMO_T2,
    },
  ];

  // --- The rationale web (typed spine trace links) ------------------------
  const links: TraceLink[] = [
    link(missionV1.envelope.id, constitutionId, 'DERIVED_FROM'),
    link(missionV2.envelope.id, missionV1.envelope.id, 'DERIVED_FROM'),
    link(missionV2.envelope.id, constitutionId, 'DERIVED_FROM'),
    link(systemStateV0.envelope.id, baselineGraphId, 'DERIVED_FROM'),
    link(systemStateV1.envelope.id, graphV1Id, 'DERIVED_FROM'),
    link(systemStateV1.envelope.id, missionV1.envelope.id, 'SATISFIES'),
    link(systemStateV2.envelope.id, graphV2Id, 'DERIVED_FROM'),
    link(systemStateV2.envelope.id, observedModelId, 'DERIVED_FROM'),
    link(systemStateV2.envelope.id, missionV2.envelope.id, 'SATISFIES'),
    link(observedModelId, graphV2Id, 'IMPLEMENTS'),
    link(evUptime.id, systemStateV2.envelope.id, 'OBSERVES'),
    link(evLatencyPartial.id, systemStateV2.envelope.id, 'OBSERVES'),
    link(evPaymentIncident.id, systemStateV0.envelope.id, 'OBSERVES'),
    link(evModelCollectorOutage.id, observedModelId, 'OBSERVES'),
    link(evAdapterTelemetry.id, observedModelId, 'OBSERVES'),
    link(evLlmAnalysis.id, graphV2Id, 'OBSERVES'),
    link(evQueueCanary.id, candidateQueue.envelope.id, 'VERIFIES'),
    link(evRehearsal.id, candidateQueue.envelope.id, 'VERIFIES'),
    link(evCacheShadow.id, candidateCache.envelope.id, 'OBSERVES'),
    link(evGuardrailUnsupported.id, experiment.envelope.id, 'OBSERVES'),
    link(candidateQueue.envelope.id, graphV2Id, 'DERIVED_FROM'),
    link(candidateQueue.envelope.id, missionV2.envelope.id, 'SATISFIES'),
    link(candidateCache.envelope.id, graphV2Id, 'DERIVED_FROM'),
    link(candidateCache.envelope.id, missionV2.envelope.id, 'SATISFIES'),
    link(experiment.envelope.id, candidateQueue.envelope.id, 'VERIFIES'),
    link(experiment.envelope.id, hypothesisQueue, 'DERIVED_FROM'),
    link(simulatedResult.id, candidateQueue.envelope.id, 'VERIFIES'),
    link(simulatedResult.id, experiment.envelope.id, 'CAUSED_BY'),
    link(promotionGrant.envelope.id, constitutionId, 'DERIVED_FROM'),
    link(askEvaluation.record.envelope.id, observedModelId, 'DERIVED_FROM'),
    link(askEvaluation.record.envelope.id, retirementGrant.envelope.id, 'DERIVED_FROM'),
    link(askRequest.envelope.id, askEvaluation.record.envelope.id, 'DERIVED_FROM'),
    link(packageQueue.envelope.id, candidateQueue.envelope.id, 'REALIZES'),
    link(packageCache.envelope.id, candidateCache.envelope.id, 'REALIZES'),
  ];

  const evidencePool: EvidenceRecordW3[] = [
    evUptime,
    evLatencyPartial,
    evQueueCanary,
    evCacheShadow,
    evModelCollectorOutage,
    evAdapterTelemetry,
    evPaymentIncident,
    evRehearsal,
    evLlmAnalysis,
    evGuardrailUnsupported,
    evQueueTest,
    evQueueTelemetry,
    evCacheLoad,
    evCacheTelemetry,
    evCacheIncident,
  ].sort((a, b) => (a.id < b.id ? -1 : 1));

  return {
    now: DEMO_NOW,
    fixture_revision: DEMO_FIXTURE_REVISION,
    constitution_id: constitutionId,
    missions: [missionV1Final, missionV2],
    system_states: [
      systemStateStore.get(systemStateV0.envelope.id)!,
      systemStateStore.get(systemStateV1.envelope.id)!,
      systemStateV2,
    ],
    observed_model_id: observedModelId,
    graph_ids: { baseline: baselineGraphId, v1: graphV1Id, v2: graphV2Id },
    evidence: evidencePool,
    candidates: [candidateQueue, candidateCache],
    experiment: {
      artifact: experiment,
      result: simulatedResult,
      evaluation: experimentEvaluation,
    },
    ask: {
      request: askRequest,
      context: askContext,
      decision: askEvaluation.record,
      queue_size: askQueue.list().length,
    },
    grants: {
      mission_revision: missionRevisionGrant,
      promotion: promotionGrant,
      retirement: retirementGrant,
    },
    packages: [packageQueue, packageCache],
    tasks,
    leases,
    observation,
    gaps,
    learning,
    links,
  };
}
