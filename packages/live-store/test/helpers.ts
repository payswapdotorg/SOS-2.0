/**
 * Shared P2 fixtures — deterministic, offline, pure (fixed instants,
 * spine-minted identities, no I/O, no hidden clocks). One valid record of
 * EVERY repository kind, built through the OWNING packages' creators
 * (the live store is a CALLER of the domain packages, exactly like the
 * future orchestrator will be).
 */

import { deriveDeterministicArtifactId } from '@sos-2/semantic-spine';
import { createMission, MissionStore } from '@sos-2/mission';
import type { MissionArtifact } from '@sos-2/mission';
import { createContext } from '@sos-2/context';
import type { ContextArtifact } from '@sos-2/context';
import { createSystemState } from '@sos-2/system-state';
import type { SystemStateArtifact } from '@sos-2/system-state';
import { createEvidence } from '@sos-2/evidence';
import type { EvidenceRecordW3 } from '@sos-2/evidence';
import { createArchitectureGraph } from '@sos-2/architecture';
import type { ArchitectureGraphArtifact } from '@sos-2/architecture';
import { createCandidateState, createExperiment } from '@sos-2/experiments';
import type { CandidateStateFixture, ExperimentArtifact } from '@sos-2/experiments';
import { createAssuranceCase } from '@sos-2/assurance';
import type { AssuranceCaseArtifact } from '@sos-2/assurance';
import { evaluate } from '@sos-2/decision';
import type { DecisionRecord } from '@sos-2/decision';
import { createGrant } from '@sos-2/authority';
import type { AuthorityGrantArtifact } from '@sos-2/authority';
import { createPackageArtifact } from '@sos-2/packages';
import type { PackageArtifact } from '@sos-2/packages';
import { createArchitectureMemory } from '@sos-2/memory';
import type { ArchitectureMemoryArtifact } from '@sos-2/memory';
import { createCausalHypothesis, observationalEvidenceRef } from '@sos-2/causal';
import type { CausalHypothesisArtifact } from '@sos-2/causal';
import { createProvenanceRecord } from '@sos-2/provenance';
import type { ProvenanceRecord, Producer, TimeWindow } from '@sos-2/provenance';
import type { EventIngestionRequest } from '@sos-2/api-contracts';
import {
  assertValidBodyLeaseRecord,
  assertValidDevelopmentStateRecord,
  assertValidTaskRecord,
  type BodyLeaseRecord,
  type DevelopmentStateRecord,
  type TaskRecord,
} from '../src/state-records.js';
import { DeterministicClock } from '../src/clock.js';

// ---------------------------------------------------------------------------
// Fixed instants + shared constants
// ---------------------------------------------------------------------------

export const T0 = '2025-06-01T00:00:00Z';
export const T1 = '2025-06-02T00:00:00Z';
export const T2 = '2025-06-03T00:00:00Z';
export const T3 = '2025-06-04T00:00:00Z';
export const T_FAR = '2025-12-31T00:00:00Z';
export const PROVENANCE = 'P2:live-store:fixture';
export const SOURCE_REVISION = '3f9c1a2b8d7e4f60a1b2c3d4e5f6a7b8c9d0e1f2';
export const WINDOW: TimeWindow = { start: T0, end: T_FAR };

export const TOOL_PRODUCER: Producer = {
  tool: 'p2-fixture-harness',
  tool_version: '1.0.0',
  model: null,
  model_version: null,
  command: 'vitest run packages/live-store',
  environment: 'ci:local',
};

export function fixtureClock(): DeterministicClock {
  return new DeterministicClock('2025-07-01T00:00:00Z', 1000);
}

// ---------------------------------------------------------------------------
// The fixture world (one valid record per repository kind)
// ---------------------------------------------------------------------------

export interface FixtureWorld {
  constitutionId: string;
  mission: MissionArtifact;
  missionV2: MissionArtifact;
  missionV1Final: MissionArtifact;
  context: ContextArtifact;
  systemState: SystemStateArtifact;
  systemStateV2: SystemStateArtifact;
  evidence: EvidenceRecordW3;
  evidenceLlm: EvidenceRecordW3;
  graph: ArchitectureGraphArtifact;
  candidate: CandidateStateFixture;
  assurance: AssuranceCaseArtifact;
  experiment: ExperimentArtifact;
  decision: DecisionRecord;
  grant: AuthorityGrantArtifact;
  pkg: PackageArtifact;
  memory: ArchitectureMemoryArtifact;
  causal: CausalHypothesisArtifact;
  provenance: ProvenanceRecord;
  developmentState: DevelopmentStateRecord;
  developmentStateV2: DevelopmentStateRecord;
  task: TaskRecord;
  taskV2: TaskRecord;
  bodyLease: BodyLeaseRecord;
  events: EventIngestionRequest[];
}

export function buildFixtureWorld(): FixtureWorld {
  const constitutionId = deriveDeterministicArtifactId('Constitution', {
    note: 'P2 live-store fixture governance anchor',
    scenario: 'p2-live-store',
  });

  // --- Mission v1 -> v2 (the sanctioned revision chain) -------------------
  const missionStore = new MissionStore();
  const mission = createMission({
    content: {
      purpose: 'Make the checkout product continuously better while keeping operating costs predictable.',
      goals: [
        { id: 'goal-reliability', statement: 'Keep checkout reliable under peak load', status: 'MEASURABLE', measures: ['measure-uptime'] },
      ],
      outcomes: [{ id: 'outcome-stable', description: 'Shoppers complete checkout without incidents', goal_refs: ['goal-reliability'] }],
      stakeholders: [{ id: 'stakeholder-shoppers', name: 'Shoppers', interest: 'Fast, reliable checkout' }],
      measures: [{ id: 'measure-uptime', description: 'Monthly checkout uptime', target: '>= 99.9%', unit: 'percent' }],
      assumptions: [{ id: 'assumption-load', statement: 'Traffic grows at most 2x year over year' }],
      ambiguities: [{ id: 'ambiguity-regions', statement: 'Which regions matter first?', resolution: null }],
      constraints: [
        { id: 'constraint-cost', statement: 'Monthly cost stays within budget', hard: true, bound: { axis: 'monthly-cost', direction: 'MAX', limit: 8000 } },
      ],
    },
    provenance: [PROVENANCE, 'mission:onboarding'],
    created_at: T0,
    authority_ref: constitutionId,
    version: 1,
    status: 'ACTIVE',
  });
  missionStore.put(mission);
  // A grant authorizing the mission revision (the MissionStore discipline).
  const grantForRevision = createGrant({
    grantee: 'sos://Decision/fixture-reviser',
    scope: { kind: 'KIND', artifact_kind: 'Mission' },
    permissions: ['REVISE'],
    expiry: { kind: 'TIME', at: T_FAR },
    provenance: [PROVENANCE, 'grant:fixture-mission-revision'],
    created_at: T0,
    authority_ref: constitutionId,
    status: 'ACTIVE',
  });
  const missionRevision = missionStore.revise(mission.envelope.id, {
    authority_grant: grantForRevision.envelope.id,
    content: {
      purpose: 'Make checkout better for EU shoppers first, with measurable latency budgets.',
      goals: [
        { id: 'goal-reliability', statement: 'Keep checkout reliable under peak load', status: 'MEASURABLE', measures: ['measure-uptime'] },
        { id: 'goal-latency', statement: 'Reduce EU p95 latency below 250ms', status: 'MEASURABLE', measures: ['measure-p95'] },
      ],
      outcomes: [
        { id: 'outcome-stable', description: 'Shoppers complete checkout without incidents', goal_refs: ['goal-reliability'] },
        { id: 'outcome-fast', description: 'EU shoppers experience fast checkout', goal_refs: ['goal-latency'] },
      ],
      stakeholders: [{ id: 'stakeholder-shoppers', name: 'Shoppers', interest: 'Fast, reliable checkout' }],
      measures: [
        { id: 'measure-uptime', description: 'Monthly checkout uptime', target: '>= 99.9%', unit: 'percent' },
        { id: 'measure-p95', description: 'EU checkout p95 latency', target: '<= 250', unit: 'milliseconds' },
      ],
      assumptions: [{ id: 'assumption-load', statement: 'Traffic grows at most 2x year over year' }],
      ambiguities: [{ id: 'ambiguity-regions', statement: 'Which regions matter first?', resolution: 'EU first' }],
      constraints: [
        { id: 'constraint-cost', statement: 'Monthly cost stays within budget', hard: true, bound: { axis: 'monthly-cost', direction: 'MAX', limit: 8000 } },
        { id: 'constraint-latency', statement: 'EU p95 latency stays within the declared budget', hard: true, bound: { axis: 'p95-latency', direction: 'MAX', limit: 250 } },
      ],
    },
    provenance: [PROVENANCE, 'mission:revision-latency-goal'],
    created_at: T1,
  });
  const missionV2 = missionRevision.revised;
  const missionV1Final = missionRevision.previous;

  // --- Context (built-in dimensions only) ---------------------------------
  const context = createContext({
    dimensions: { user_cohort: 'beta-testers', platform: 'server', environment: 'production' },
    provenance: [PROVENANCE, 'context:fixture'],
    created_at: T0,
    authority_ref: constitutionId,
    status: 'ACTIVE',
  });

  // --- System state v1 -> v2 ----------------------------------------------
  const systemState = createSystemState({
    content: {
      architecture_ref: { artifact_id: deriveDeterministicArtifactId('ArchitectureGraph', { fixture: 'p2 baseline graph' }), version: 1 },
      implementation: [
        {
          artifact_id: deriveDeterministicArtifactId('ImplementationModel', { fixture: 'p2 checkout codebase' }),
          revision: { kind: 'git-sha', value: SOURCE_REVISION },
        },
      ],
      configuration: [{ config_id: 'checkout-config', revision: { kind: 'config-version', value: 'v41' } }],
      deployment: [
        { deployment_id: 'deploy:checkout-prod-2025-06-01', environment: 'production', revision: { kind: 'deployment-id', value: 'deploy:checkout-prod-2025-06-01' } },
      ],
      policy: [],
      environment_relationships: [],
      active_experiments: [],
      package_realizations: [],
    },
    provenance: [PROVENANCE, 'system-state:fixture-import'],
    created_at: T0,
    status: 'ACTIVE',
  });
  const systemStateV2 = createSystemState({
    content: {
      architecture_ref: { artifact_id: deriveDeterministicArtifactId('ArchitectureGraph', { fixture: 'p2 candidate graph' }), version: 2 },
      implementation: [
        {
          artifact_id: deriveDeterministicArtifactId('ImplementationModel', { fixture: 'p2 checkout codebase v2' }),
          revision: { kind: 'git-sha', value: '1111111111111111111111111111111111111111' },
        },
      ],
      configuration: [{ config_id: 'checkout-config', revision: { kind: 'config-version', value: 'v42' } }],
      deployment: [
        { deployment_id: 'deploy:checkout-prod-2025-06-03', environment: 'production', revision: { kind: 'deployment-id', value: 'deploy:checkout-prod-2025-06-03' } },
      ],
      policy: [],
      environment_relationships: [],
      active_experiments: [],
      package_realizations: [],
    },
    provenance: [PROVENANCE, 'system-state:fixture-revision'],
    created_at: T2,
    supersedes: systemState.envelope.id,
    version: 2,
    status: 'ACTIVE',
  });

  // --- Evidence (tool-produced + LLM-produced, truth states preserved) ----
  const evidence = createEvidence({
    kind: 'telemetry',
    subject_ref: missionV2.envelope.id,
    availability: 'SUCCESS',
    evidence_class: 'OBSERVATIONAL',
    method: 'telemetry:capture-availability',
    provenance: [PROVENANCE, 'observation:sha256:' + 'a'.repeat(64)],
    window: WINDOW,
    source_revision: SOURCE_REVISION,
    deployment_revision: 'deploy:checkout-prod-2025-06-01',
    confidence: { kind: 'QUALITATIVE', uncertainty_class: 'STRONG' },
    producer: TOOL_PRODUCER,
  });
  const evidenceLlm = createEvidence({
    kind: 'telemetry',
    subject_ref: missionV2.envelope.id,
    availability: 'UNKNOWN',
    evidence_class: 'OBSERVATIONAL',
    method: 'telemetry:capture-availability',
    provenance: [PROVENANCE, 'llm-observation:fixture'],
    window: WINDOW,
    confidence: { kind: 'QUALITATIVE', uncertainty_class: 'UNQUANTIFIED' },
    producer: { ...TOOL_PRODUCER, model: 'some-llm', model_version: '2025-06' },
  });

  // --- Architecture graph --------------------------------------------------
  const graph = createArchitectureGraph({
    projects_system_state: { system_state_id: systemState.envelope.id, version: 1 },
    nodes: [
      { id: 'capability:checkout', kind: 'Capability', attributes: { name: 'checkout' } },
      { id: 'component:checkout-api', kind: 'Component', attributes: { runtime: 'node' } },
      { id: 'iface:checkout-api', kind: 'Interface', attributes: { protocol: 'https' } },
      { id: 'store:orders', kind: 'DataStore', attributes: { engine: 'postgres' } },
      { id: 'deploy:production', kind: 'Deployment', attributes: { region: 'eu-west-1' } },
    ],
    edges: [
      { source: 'component:checkout-api', target: 'capability:checkout', kind: 'Realizes' },
      { source: 'component:checkout-api', target: 'iface:checkout-api', kind: 'Provides' },
      { source: 'component:checkout-api', target: 'store:orders', kind: 'Owns', criticality: 'critical' },
      { source: 'component:checkout-api', target: 'deploy:production', kind: 'DeploysTo' },
    ],
    provenance: [PROVENANCE, 'architecture:fixture-recovery'],
    created_at: T0,
    authority_ref: missionV2.envelope.id,
    version: 1,
    status: 'ACTIVE',
  });

  // --- Candidate (CandidateState fixture over the graph) -------------------
  const hypothesisId = deriveDeterministicArtifactId('CausalHypothesis', {
    statement: 'P2 fixture: buffering checkout writes through a durable queue reduces p95 latency',
  });
  const candidate = createCandidateState({
    content: {
      invariants: ['The checkout API contract is preserved'],
      predicted_effects: ['EU p95 latency decreases'],
      causal_claim: true,
      confidence: { kind: 'QUALITATIVE', uncertainty_class: 'MODERATE' },
      base_subject_revision: 'system-state-v1',
      hypothesis_ref: hypothesisId,
      bounded_subgraph_ref: { graph_id: graph.envelope.id, version: 1 },
      context: { environment: 'production', workload: 'peak-hour' },
    },
    provenance: [PROVENANCE, 'candidate:fixture-search'],
    created_at: T2,
    authority_ref: missionV2.envelope.id,
    status: 'ACTIVE',
  });

  // --- Assurance case -------------------------------------------------------
  const assurance = createAssuranceCase({
    content: {
      claims: [
        { id: 'claim-evidence-backed', statement: 'The supporting evidence for the fixture candidate is current' },
        { id: 'claim-reliable', statement: 'Checkout remains reliable under the fixture candidate' },
      ],
      arguments: [
        {
          id: 'argument-reliability',
          strategy: 'Current observational evidence supports the reliability claim',
          conclusion: 'claim-reliable',
          premises: ['claim-evidence-backed'],
        },
      ],
      assumptions: [{ id: 'assumption-steady-load', statement: 'Load stays within the tested envelope' }],
      hazards: [{ id: 'hazard-backpressure', description: 'Queue backpressure delays payment calls' }],
      controls: [{ id: 'control-guardrails', mechanism: 'Guardrails roll back automatically', addresses: ['hazard-backpressure'] }],
      evidence: [{ evidence_id: evidence.id, role: 'SUPPORTS', claim_ref: 'claim-reliable' }],
      validity_conditions: [
        { kind: 'IMPLEMENTATION', subject: missionV2.envelope.id, valid_revisions: [SOURCE_REVISION] },
        { kind: 'ENVIRONMENT', subject: 'production', valid_revisions: ['eu-west-1'] },
      ],
      objections: [
        {
          id: 'objection-single-region',
          statement: 'The evidence only covered the eu-west-1 region',
          raised_at: T2,
          status: 'OPEN',
          resolution: null,
        },
      ],
    },
    provenance: [PROVENANCE, 'assurance:fixture-review'],
    created_at: T2,
    authority_ref: missionV2.envelope.id,
    status: 'ACTIVE',
  });

  // --- Experiment -----------------------------------------------------------
  const experiment = createExperiment({
    content: {
      design: {
        kind: 'TREATMENT_CONTROL',
        population: {
          description: 'Production checkout requests in the EU region',
          unit: 'REQUEST',
          context: { environment: 'production', region: 'eu' },
        },
        allocation: {
          unit: 'REQUEST',
          assignment: 'DETERMINISTIC_HASH',
          arms: [
            { id: 'control', role: 'CONTROL', candidate_ref: null },
            { id: 'treatment', role: 'TREATMENT', candidate_ref: candidate.envelope.id },
          ],
          ratios: [9, 1],
        },
        metrics: [
          { id: 'metric-p95', role: 'PRIMARY', description: 'Checkout p95 latency (ms)', direction: 'DECREASE' },
          { id: 'metric-error-rate', role: 'GUARDRAIL', description: 'Checkout error rate (%) — at most 1', direction: 'DECREASE', guardrail_threshold: 1 },
        ],
        stopping_criteria: [{ kind: 'MAX_SAMPLES', max_samples: 500 }],
        rollback_criteria: [
          { id: 'rollback-errors', guardrail_metric_ids: ['metric-error-rate'], description: 'Roll back when the error guardrail trips' },
        ],
      },
      stage: { phase: 'CANARY', exposure_percent: 10 },
      canary_ladder: [5, 10, 25],
      candidate_ref: candidate.envelope.id,
      hypothesis_ref: hypothesisId,
      producer: TOOL_PRODUCER,
    },
    provenance: [PROVENANCE, 'experiment:fixture-plan'],
    created_at: T2,
    authority_ref: missionV2.envelope.id,
    status: 'ACTIVE',
  });

  // --- Decision (through the engine — a REJECT decision needs no grants) ---
  const decisionEvaluation = evaluate(
    {
      action_kind: 'REVISE',
      action_description: 'Revise the checkout mission latency goal without a presenting grant',
      target: { kind: 'ARTIFACT', artifact_id: missionV2.envelope.id },
      blast_radius: 'COMPONENT',
      impact: 'LOW',
      risk: 'LOW',
      reversibility: 'REVERSIBLE',
      causal_claim: false,
      uncertainty: {
        uncertainty_class: 'MODERATE',
        basis: 'The presenting grant is absent; authority must be presented before revision',
      },
      rollback_signals: [],
      evidence: [evidence],
      grants: [],
      evaluation_point: { kind: 'TIME', now: T2 },
      explicit_authority_decision_ref: null,
      confidence: null,
    },
    { provenance: [PROVENANCE, 'decision:fixture-request'], created_at: T2 },
  );
  const decision = decisionEvaluation.record;

  // --- Authority grant -------------------------------------------------------
  const grant = createGrant({
    grantee: 'sos://Decision/fixture-evolver',
    scope: { kind: 'KIND', artifact_kind: 'Mission' },
    permissions: ['REVISE'],
    expiry: { kind: 'TIME', at: T_FAR },
    provenance: [PROVENANCE, 'grant:fixture-revision-authority'],
    created_at: T0,
    authority_ref: constitutionId,
    status: 'ACTIVE',
  });

  // --- Package ----------------------------------------------------------------
  const realizationSubject = deriveDeterministicArtifactId('ImplementationModel', { fixture: 'p2 durable queue realization' });
  const pkg = createPackageArtifact({
    content: {
      semantic_capability: 'Durable checkout write buffering',
      contracts: ['sos://schema/durable-queue'],
      preconditions: ['A message bus with at-least-once delivery is deployed'],
      postconditions: ['Checkout writes are durably buffered under peak load'],
      realizations: [{ ref: realizationSubject, revision: 'r1', note: 'Queue-backed checkout write buffer' }],
      applicability: [
        {
          kind: 'QUALITATIVE',
          uncertainty_class: 'MODERATE',
          context: { environment: 'production', workload: 'peak-hour' },
          sample_size: 14,
          window: { ...WINDOW },
        },
      ],
      evidence_refs: [evidence.id],
      failure_refs: [],
      compatibility_refs: [],
      composition_refs: [],
      assurance_obligations: [{ kind: 'CANARY', obligation: 'Canary every adoption for one ladder cycle' }],
      context: { environment: 'production', workload: 'peak-hour' },
      learned_limitations: ['Assumes EU peak-hour traffic shapes'],
      diversity_profile: {
        family: 'cost-optimized',
        dimensions: [
          { dimension: 'COST', stance: 'optimizes for lower monthly cost' },
          { dimension: 'RESILIENCE', stance: 'buffers upstream outages' },
        ],
      },
      maturity: 'VALIDATED',
      changes: 'Initial validated realization',
      superseded_by: null,
    },
    provenance: [PROVENANCE, 'package:fixture-extraction'],
    created_at: T2,
    authority_ref: missionV2.envelope.id,
    status: 'ACTIVE',
  });

  // --- Architecture memory (history) -----------------------------------------
  const memory = createArchitectureMemory({
    content: {
      entries: [
        {
          entry_kind: 'PREDICTION',
          id: 'prediction-queue-latency',
          recorded_at: T1,
          statement: 'Buffering checkout writes should reduce p95 latency under peak load',
          subject_ref: realizationSubject,
          hypothesis_ref: hypothesisId,
          context: { environment: 'production', region: 'eu' },
        },
        {
          entry_kind: 'OBSERVATION',
          id: 'observation-telemetry-baseline',
          recorded_at: T2,
          statement: 'Baseline p95 telemetry was captured for the checkout path',
          evidence_refs: [evidence.id],
          context: null,
        },
      ],
      update: { producer: TOOL_PRODUCER, evidence_refs: [evidence.id] },
    },
    provenance: [PROVENANCE, 'memory:fixture-update'],
    created_at: T2,
    authority_ref: missionV2.envelope.id,
    status: 'ACTIVE',
  });

  // --- Causal hypothesis (CORRELATIONAL — no interventional evidence needed) -
  const causal = createCausalHypothesis({
    content: {
      statement: 'Buffering checkout writes correlates with lower p95 latency under peak load',
      claim_strength: 'CORRELATIONAL',
      intervention: { description: 'Enable the durable write buffer on the checkout path', target_ref: realizationSubject },
      mechanism: 'Asynchronous buffering removes synchronous round-trips from the request path',
      predicted_outcomes: [{ id: 'outcome-p95', description: 'EU p95 latency decreases', metric: 'p95', direction: 'DECREASE' }],
      assumptions: [{ id: 'assumption-bus', statement: 'The message bus is deployed and healthy' }],
      context: { environment: 'production', region: 'eu' },
      alternatives: [{ id: 'alt-seasonality', explanation: 'Lower traffic during the observation window' }],
      refutations: [{ id: 'refutation-flat-p95', description: 'p95 does not decrease when the buffer is enabled' }],
      graph: {
        factors: [
          { id: 'factor-buffer', description: 'Durable write buffer enabled' },
          { id: 'factor-latency', description: 'Checkout p95 latency' },
          { id: 'factor-traffic', description: 'Peak-hour traffic level' },
        ],
        edges: [
          { type: 'CONTRIBUTES_TO', cause: 'factor-buffer', effect: 'factor-latency' },
          { type: 'CONFOUNDS', confounder: 'factor-traffic', cause: 'factor-buffer', effect: 'factor-latency' },
        ],
      },
      observational_evidence: [observationalEvidenceRef(evidence)],
      interventional_evidence: [],
      uncertainty: { kind: 'QUALITATIVE', uncertainty_class: 'MODERATE' },
      producer: TOOL_PRODUCER,
      correlation_origin: null,
    },
    provenance: [PROVENANCE, 'causal:fixture-hypothesis'],
    created_at: T1,
    authority_ref: missionV2.envelope.id,
    status: 'ACTIVE',
  });

  // --- Provenance record (history) -------------------------------------------
  const provenance = createProvenanceRecord({
    producer: TOOL_PRODUCER,
    source_revision: SOURCE_REVISION,
    deployment_revision: 'deploy:checkout-prod-2025-06-01',
    window: WINDOW,
    context: { environment: 'production', region: 'eu-west-1' },
    chain: [],
    source_availability: 'SUCCESS',
  });

  // --- Development state (machine-state snapshot mirror) ----------------------
  const developmentState: DevelopmentStateRecord = {
    state_id: 'SOS-2.0',
    snapshot: {
      schemaVersion: '2.0',
      program: 'SOS-2.0',
      status: 'COMPLETE',
      currentFrontier: [],
      currentTask: 'P2 fixture machine state',
      tasks: {
        P2: { status: 'READY', dependencies: ['P0'], mergedAs: null },
      },
    },
    provenance: [PROVENANCE, 'development-state:fixture-snapshot'],
    updated_at: T2,
    revision: 1,
  };
  const developmentStateV2: DevelopmentStateRecord = {
    ...developmentState,
    snapshot: { ...(developmentState.snapshot as Record<string, unknown>), status: 'IN_PROGRESS' } as unknown as DevelopmentStateRecord['snapshot'],
    updated_at: T3,
    revision: 2,
  };

  // --- Task (the full section 6 durability shape) ------------------------------
  const task: TaskRecord = {
    task_id: 'task-checkout-queue-implementation',
    mission_ref: missionV2.envelope.id,
    status: 'RUNNING',
    plan: {
      nodes: [
        { node_id: 'plan-implement', state: 'IN_PROGRESS', summary: 'Implement the durable write buffer' },
        { node_id: 'plan-verify', state: 'PENDING', summary: 'Verify with integration tests' },
      ],
      edges: [{ from: 'plan-implement', to: 'plan-verify' }],
    },
    owned_revision: SOURCE_REVISION,
    authority_context: { grant_refs: [grant.envelope.id], note: 'REVISE authority over Mission-kind artifacts' },
    body_lease_ref: 'lease-checkout-body-1',
    checkpoints: [
      {
        checkpoint_id: 'checkpoint-buffer-skeleton',
        created_at: T1,
        state: { files_written: ['src/queue/buffer.ts'], tests_passing: 12 },
        provenance: [PROVENANCE, 'checkpoint:buffer-skeleton'],
        label: 'Buffer skeleton compiles',
      },
    ],
    artifacts: [],
    evidence_refs: [evidence.id],
    unresolved_uncertainty: ['Whether the off-platform partner still integrates the legacy interface'],
    retries: { attempt_count: 1, last_failure: 'body lost connectivity mid-run', last_failure_at: T2, recovery_kind: 'RESUME_FROM_CHECKPOINT' },
    cost: [{ kind: 'TOKENS', amount: 125000, unit: 'tokens', recorded_at: T2 }],
    final_verification: null,
    provenance: [PROVENANCE, 'task:fixture-orchestration'],
    created_at: T0,
    updated_at: T2,
    revision: 1,
  };
  const taskV2: TaskRecord = {
    ...task,
    status: 'PAUSED',
    plan: {
      nodes: [
        { node_id: 'plan-implement', state: 'DONE', summary: 'Implement the durable write buffer' },
        { node_id: 'plan-verify', state: 'PENDING', summary: 'Verify with integration tests' },
      ],
      edges: [{ from: 'plan-implement', to: 'plan-verify' }],
    },
    updated_at: T3,
    revision: 2,
  };

  // --- Body lease ----------------------------------------------------------------
  const bodyLease: BodyLeaseRecord = {
    lease_id: 'lease-checkout-body-1',
    task_ref: task.task_id,
    body_ref: 'body:cloud-sandbox:runner-1',
    capabilities: ['shell', 'git', 'workspace.write'],
    state: 'ACTIVE',
    acquired_at: T1,
    expires_at: T_FAR,
    last_heartbeat_at: T2,
    release_reason: null,
    provenance: [PROVENANCE, 'lease:fixture-acquisition'],
    revision: 1,
  };

  // --- Observation events (the event boundary) -----------------------------------
  const events: EventIngestionRequest[] = [
    {
      event_id: 'gh-delivery-2001',
      source: 'github:webhook:payswapdotorg/SOS-2.0',
      event_kind: 'github:push',
      occurred_at: T0,
      payload: { ref: 'refs/heads/main', after: SOURCE_REVISION },
      subject_ref: null,
      provenance: ['webhook:github:delivery-2001'],
    },
    {
      event_id: 'ci-run-9001',
      source: 'github:actions:SOS-2.0',
      event_kind: 'ci:workflow-run',
      occurred_at: T1,
      payload: { workflow: 'verify', conclusion: 'success', head_sha: SOURCE_REVISION },
      subject_ref: missionV2.envelope.id,
      provenance: ['ci:github-actions:run-9001'],
    },
    {
      event_id: 'deploy-3001',
      source: 'deployment:vercel',
      event_kind: 'deployment',
      occurred_at: T2,
      payload: { environment: 'production', revision: 'deploy:checkout-prod-2025-06-03' },
      subject_ref: null,
      provenance: ['deployment:webhook:delivery-3001'],
    },
  ];

  return {
    constitutionId,
    mission,
    missionV2,
    missionV1Final,
    context,
    systemState,
    systemStateV2,
    evidence,
    evidenceLlm,
    graph,
    candidate,
    assurance,
    experiment,
    decision,
    grant,
    pkg,
    memory,
    causal,
    provenance,
    developmentState,
    developmentStateV2,
    task,
    taskV2,
    bodyLease,
    events,
  };
}

/** Guard smoke-check: every fixture satisfies its owning guard before storage. */
export function assertFixturesValid(world: FixtureWorld): void {
  assertValidTaskRecord(world.task);
  assertValidTaskRecord(world.taskV2);
  assertValidBodyLeaseRecord(world.bodyLease);
  assertValidDevelopmentStateRecord(world.developmentState);
  assertValidDevelopmentStateRecord(world.developmentStateV2);
}
