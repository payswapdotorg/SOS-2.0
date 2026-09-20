/**
 * Unit tests — every W11 view-model projection over fixtures built through
 * the domain packages' own builders.
 */

import { describe, expect, test } from 'vitest';
import { createArchitectureGraph } from '@sos-2/architecture';
import type { ArchitectureGraphArtifact } from '@sos-2/architecture';
import { createSystemState } from '@sos-2/system-state';
import type { SystemStateArtifact } from '@sos-2/system-state';
import { reconcile } from '@sos-2/conformance';
import type { ReconciliationResult } from '@sos-2/conformance';
import { createEvidence } from '@sos-2/evidence';
import type { EvidenceRecordW3 } from '@sos-2/evidence';
import { createAssuranceCase, evaluateAssuranceCase } from '@sos-2/assurance';
import type { AssuranceCaseArtifact, AssuranceEvaluation } from '@sos-2/assurance';
import {
  assertValidCandidateState,
  createCandidateState,
  createExperiment,
  createExperimentResult,
  evaluateExperimentResult,
} from '@sos-2/experiments';
import type {
  CandidateStateFixture,
  ExperimentArtifact,
  ExperimentEvaluation,
  ExperimentResultRecord,
} from '@sos-2/experiments';
import { createAskRequest } from '@sos-2/authority';
import type { AskRequestArtifact } from '@sos-2/authority';
import { assembleEscalationContext } from '@sos-2/ask';
import type { AskEscalationContext } from '@sos-2/ask';
import { createRecoveryDeclaration } from '@sos-2/recovery-control';
import type { RecoveryDeclarationArtifact } from '@sos-2/recovery-control';
import { evaluate } from '@sos-2/decision';
import type { DecisionRecord } from '@sos-2/decision';
import { createPackageArtifact } from '@sos-2/packages';
import { PackageRegistry } from '@sos-2/registry';
import type { RetrievalResult } from '@sos-2/registry';
import {
  candidateId,
  CONSTITUTION_ID,
  evidenceId,
  fixtureMission,
  hypothesisId,
  link,
  NOW,
  rawId,
  systemStateId,
} from './helpers.js';
import {
  buildRationaleChain,
  projectAsk,
  projectAssurance,
  projectCandidateComparison,
  projectEvidenceSet,
  projectExperiment,
  projectHistory,
  projectMetaState,
  projectMission,
  projectPackage,
  projectReconciliation,
  projectRepertoire,
  projectRollback,
  projectSystemState,
} from '../src/index.js';
import type { MachineStateSnapshot } from '../src/index.js';

function rationale(subject: string, links: Parameters<typeof buildRationaleChain>[0]['links'], evidenceRefs: string[] = []) {
  return buildRationaleChain({ subject_id: subject, links, evidence_refs: evidenceRefs });
}

describe('MissionVM', () => {
  test('projects the mission with rationale and preserves all content', () => {
    const mission = fixtureMission('Make checkout continuously better');
    const chain = rationale(mission.envelope.id, [link(mission.envelope.id, CONSTITUTION_ID, 'DERIVED_FROM')]);
    const vm = projectMission(mission, chain);
    expect(vm.id).toBe(mission.envelope.id);
    expect(vm.purpose).toBe('Make checkout continuously better');
    expect(vm.goals).toHaveLength(1);
    expect(vm.goals[0]?.status).toBe('MEASURABLE');
    expect(vm.constraints[0]?.bound).toEqual({ axis: 'monthly-cost', direction: 'MAX', limit: 5000 });
    expect(vm.rationale.upstream).toHaveLength(1);
    expect(vm.rationale.upstream[0]?.type).toBe('DERIVED_FROM');
  });
});

describe('SystemStateVM', () => {
  test('projects the eight sections and the observed model summary', () => {
    const graph = fixtureGraph();
    const model = fixtureImplementationModel(graph);
    const state = fixtureSystemState(graph, model);
    const chain = rationale(state.envelope.id, [
      link(graph.envelope.id, state.envelope.id, 'DERIVED_FROM'),
      link(model.id, state.envelope.id, 'OBSERVES'),
    ]);
    const vm = projectSystemState(state, model, chain);
    expect(vm.architecture_ref.artifact_id).toBe(graph.envelope.id);
    expect(vm.implementation).toHaveLength(1);
    expect(vm.observed_model?.component_count).toBe(model.components.length);
    expect(vm.observed_model?.revision).toBe(model.revision);
    // Direction typology: the graph (a dependent of the state) is downstream;
    // the observed model (acting on the state) is upstream.
    expect(vm.rationale.downstream).toHaveLength(1);
    expect(vm.rationale.upstream).toHaveLength(1);
    expect(vm.rationale.upstream[0]?.type).toBe('OBSERVES');
  });
});

describe('ReconciliationVM', () => {
  test('declared vs observed vs classification + why, with all 7 counts', () => {
    const graph = fixtureGraph();
    const model = fixtureImplementationModel(graph);
    const result: ReconciliationResult = reconcile(model, graph);
    const chain = rationale(model.id, [link(model.id, graph.envelope.id, 'OBSERVES')]);
    const vm = projectReconciliation({ result, declared: graph, observed: model, rationale: chain });
    expect(vm.observed_model_id).toBe(model.id);
    expect(vm.declared_graph_id).toBe(graph.envelope.id);
    expect(vm.rows.length).toBe(result.records.length);
    for (const row of vm.rows) {
      expect(row.declared.length).toBeGreaterThan(0);
      expect(row.observed.length).toBeGreaterThan(0);
      expect(row.reason.length).toBeGreaterThan(0);
      expect(row.link.type).toBeOneOf(['OBSERVES', 'REFINES', 'DERIVED_FROM', 'CONTRADICTS']);
    }
    const total = Object.values(vm.counts_by_classification).reduce((sum, count) => sum + count, 0);
    expect(total).toBe(result.records.length);
    expect(Object.keys(vm.counts_by_classification)).toHaveLength(7);
  });
});

describe('EvidenceVM', () => {
  test('preserves all 6 distinct truth states, provenance and uncertainty', () => {
    const subject = systemStateId('subject');
    const records = (
      ['SUCCESS', 'FAILURE', 'UNKNOWN', 'UNAVAILABLE', 'UNSUPPORTED', 'PARTIAL'] as const
    ).map((availability, index) =>
      fixtureEvidence(`evidence-${index}`, subject, availability, index % 2 === 0 ? 'OBSERVATIONAL' : 'INTERVENTIONAL'),
    );
    const chain = rationale(subject, [link(evidenceId('evidence-0'), subject, 'OBSERVES')], records.map((r) => r.id));
    const vm = projectEvidenceSet({ records, query: {}, now: NOW, rationale: chain });
    // All 6 distinct states counted (never folded, zeros included).
    expect(vm.counts_by_truth_state).toEqual({
      SUCCESS: 1,
      FAILURE: 1,
      UNKNOWN: 1,
      UNAVAILABLE: 1,
      UNSUPPORTED: 1,
      PARTIAL: 1,
    });
    expect(vm.rows).toHaveLength(6);
    for (const row of vm.rows) {
      expect(row.provenance).toHaveLength(1);
      expect(row.confidence.kind).toBe('QUALITATIVE');
      expect(row.freshness).not.toBeNull();
    }
  });

  test('query by subject and truth state filters rows but counts the whole pool', () => {
    const subjectA = systemStateId('subject-a');
    const subjectB = systemStateId('subject-b');
    const records = [
      fixtureEvidence('a-success', subjectA, 'SUCCESS', 'OBSERVATIONAL'),
      fixtureEvidence('b-failure', subjectB, 'FAILURE', 'OBSERVATIONAL'),
    ];
    const chain = rationale(subjectA, [link(records[0]!.id, subjectA, 'OBSERVES')], [records[0]!.id]);
    const vm = projectEvidenceSet({
      records,
      query: { subject: subjectA, truth_states: ['SUCCESS'] },
      rationale: chain,
    });
    expect(vm.rows).toHaveLength(1);
    expect(vm.rows[0]?.availability).toBe('SUCCESS');
    expect(vm.counts_by_truth_state.SUCCESS).toBe(1);
    expect(vm.counts_by_truth_state.FAILURE).toBe(1);
  });
});

describe('CandidateComparisonVM', () => {
  test('side-by-side with uncertainty and per-candidate evidence context', () => {
    const graph = fixtureGraph();
    const candidateA = fixtureCandidate('candidate-a', graph);
    const candidateB = fixtureCandidate('candidate-b', graph);
    const evidenceAboutA = fixtureEvidence('evidence-a', candidateA.envelope.id, 'SUCCESS', 'INTERVENTIONAL');
    const chain = rationale(candidateA.envelope.id, [link(candidateA.envelope.id, graph.envelope.id, 'DERIVED_FROM')], [
      evidenceAboutA.id,
    ]);
    const vm = projectCandidateComparison({
      candidates: [candidateB, candidateA],
      base: { graph_id: graph.envelope.id, version: graph.envelope.version },
      evidence: [evidenceAboutA],
      rationale: chain,
    });
    expect(vm.candidates.map((side) => side.id)).toEqual([candidateA.envelope.id, candidateB.envelope.id].sort());
    const sideA = vm.candidates.find((side) => side.id === candidateA.envelope.id);
    expect(sideA?.evidence.counts_by_truth_state.SUCCESS).toBe(1);
    expect(sideA?.confidence).not.toBeNull();
    const sideB = vm.candidates.find((side) => side.id === candidateB.envelope.id);
    expect(sideB?.evidence.counts_by_truth_state.SUCCESS).toBe(0);
  });
});

describe('AssuranceVM', () => {
  test('carries claims, objections (open + resolved) and the derived verdict', () => {
    const { caseArtifact, evaluation } = fixtureAssurance();
    const evidenceRef = caseArtifact.content.evidence[0]!.evidence_id;
    const chain = rationale(caseArtifact.envelope.id, [link(evidenceRef, caseArtifact.envelope.id, 'VERIFIES')], [evidenceRef]);
    const vm = projectAssurance({ case: caseArtifact, evaluation, rationale: chain });
    expect(vm.claims.length).toBeGreaterThan(0);
    expect(vm.objections).toHaveLength(2);
    expect(vm.open_objections).toHaveLength(1);
    expect(vm.verdict).toBe('OBJECTIONED');
    expect(vm.invalidations).toHaveLength(0);
  });
});

// NOTE (fixture calibration): the assurance evidence window must still be
// OPEN at the evaluation instant NOW, otherwise the living evaluation
// truthfully reports EVIDENCE_EXPIRED.

describe('ExperimentVM', () => {
  test('lifecycle + guardrails + stopping triggers with exact truth states', () => {
    const { experiment, result, evaluation } = fixtureExperiment();
    const chain = rationale(experiment.envelope.id, [link(experiment.envelope.id, result.candidate_ref, 'VERIFIES')], [
      evidenceId('experiment-evidence'),
    ]);
    const vm = projectExperiment({ experiment, result, evaluation, rationale: chain });
    expect(vm.stage.phase).toBe('CANARY');
    expect(vm.design_kind).toBe('TREATMENT_CONTROL');
    expect(vm.guardrails.length).toBeGreaterThan(0);
    expect(vm.stopping.length).toBeGreaterThan(0);
    expect(vm.rollback.length).toBeGreaterThan(0);
    expect(['SUCCESS', 'FAILURE', 'UNKNOWN', 'UNAVAILABLE', 'UNSUPPORTED', 'PARTIAL']).toContain(
      vm.result?.overall_availability,
    );
  });
});

describe('AskVM', () => {
  test('the structured ask view: exact decision, alternatives, uncertainty, trade-offs, risk, insufficiency', () => {
    const { ask, context, decision } = fixtureAsk();
    const chain = rationale(ask.envelope.id, [link(decision.envelope.id, ask.envelope.id, 'DERIVED_FROM')], [
      evidenceId('ask-evidence'),
    ]);
    const vm = projectAsk({ ask, context, decision, rationale: chain });
    expect(vm.decision).toContain('Decide');
    expect(vm.alternatives.length).toBeGreaterThan(0);
    expect(['NONE', 'WEAK', 'MODERATE', 'STRONG']).toContain(vm.evidence_quality.quality);
    expect(['LOW', 'MODERATE', 'HIGH', 'IRREDUCIBLE']).toContain(vm.uncertainty.uncertainty_class);
    expect(vm.trade_offs.length).toBeGreaterThan(0);
    expect(['LOW', 'MODERATE', 'HIGH', 'SEVERE']).toContain(vm.risk.severity);
    expect(vm.authority_insufficiency.length).toBeGreaterThan(0);
    expect(vm.rule_trace.length).toBeGreaterThan(0);
  });
});

describe('RollbackVM', () => {
  test('recovery declaration view with mechanism, trigger, authority and evidence', () => {
    const declaration = fixtureRecovery();
    const chain = rationale(declaration.envelope.id, [link(declaration.content.evidence_ref, declaration.envelope.id, 'VERIFIES')], [
      declaration.content.evidence_ref,
    ]);
    const vm = projectRollback({ declaration, promotionDecision: null, rationale: chain });
    expect(vm.mechanism.kind).toBe('ROLLBACK_DEPLOYMENT');
    expect(vm.trigger.kind).toBe('BUDGET');
    expect(vm.evidence_ref).toBe(declaration.content.evidence_ref);
    expect(vm.promotion_decision).toBeNull();
  });
});

describe('PackageVM / RepertoireVM', () => {
  test('repertoire view preserves diversity families, limitations and failures', () => {
    const { result, packageA, packageB } = fixtureRepertoire();
    const rationales = new Map([
      [packageA.envelope.id, rationale(packageA.envelope.id, [link(packageA.envelope.id, packageB.envelope.id, 'COMPOSES')], [evidenceId('pkg-a')])],
      [packageB.envelope.id, rationale(packageB.envelope.id, [link(packageB.envelope.id, packageA.envelope.id, 'COMPOSES')], [evidenceId('pkg-b')])],
    ]);
    const vm = projectRepertoire(result, rationales);
    expect(vm.candidates).toHaveLength(2);
    expect(vm.families.sort()).toEqual(['cost-optimized', 'latency-optimized'].sort());
    for (const candidate of vm.candidates) {
      expect(candidate.dimensions.length).toBeGreaterThan(0);
      expect(candidate.applicability.length).toBeGreaterThan(0);
      expect(candidate.assurance_obligations.length).toBeGreaterThan(0);
      expect(candidate.uncertainty.uncertainty_class).toBeDefined();
    }
    const costEntry = vm.candidates.find((candidate) => candidate.family === 'cost-optimized');
    expect(costEntry?.learned_limitations).toContain('Assumes read-heavy workload');
  });
});

describe('HistoryVM', () => {
  test('supersedes chains over time, oldest -> newest, head = newest', () => {
    const missionV1 = fixtureMission('Purpose v1', 1, null);
    const missionV2 = fixtureMission('Purpose v2', 2, missionV1.envelope.id);
    const chain = rationale(missionV2.envelope.id, [link(missionV1.envelope.id, missionV2.envelope.id, 'DERIVED_FROM')]);
    const vm = projectHistory([missionV2, missionV1], chain);
    expect(vm.chains).toHaveLength(1);
    const missionChain = vm.chains[0]!;
    expect(missionChain.kind).toBe('Mission');
    expect(missionChain.chain.map((entry) => entry.version)).toEqual([1, 2]);
    expect(missionChain.current_head).toBe(missionV2.envelope.id);
  });
});

describe('MetaStateVM', () => {
  test('read-only projection of the machine state', () => {
    const snapshot = fixtureMachineState();
    const chain = rationale(rawId('ArchitectureGraph', 'meta'), [
      link(rawId('Mission', 'meta'), rawId('ArchitectureGraph', 'meta'), 'SATISFIES'),
    ]);
    const vm = projectMetaState(snapshot, chain);
    expect(vm.program).toBe('SOS-2.0');
    expect(vm.frontier).toEqual(['W11', 'W12']);
    expect(vm.tasks.length).toBeGreaterThan(3);
    expect(vm.tasks.map((task) => task.id)).toEqual([...vm.tasks.map((task) => task.id)].sort());
    expect(vm.eligible).toEqual(['W11', 'W12']);
    expect(vm.self_evolution_note).toMatch(/READ-ONLY/i);
  });
});

// ---------------------------------------------------------------------------
// Domain fixture builders (domain packages' own builders only)
// ---------------------------------------------------------------------------

function fixtureGraph(): ArchitectureGraphArtifact {
  return createArchitectureGraph({
    projects_system_state: { system_state_id: systemStateId('graph-base'), version: 1 },
    nodes: [
      { id: 'checkout-api', kind: 'Component', criticality: 'critical' },
      { id: 'payment-service', kind: 'Component' },
      { id: 'orders-store', kind: 'DataStore' },
    ],
    edges: [
      { source: 'checkout-api', target: 'payment-service', kind: 'Dependency' },
      { source: 'checkout-api', target: 'orders-store', kind: 'Dependency', criticality: 'critical' },
    ],
    provenance: ['W11:ui-contracts:fixture'],
    created_at: NOW,
    status: 'ACTIVE',
  });
}

function fixtureImplementationModel(graph: ArchitectureGraphArtifact) {
  return {
    id: rawId('ImplementationModel', 'observed'),
    revision: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0',
    components: [
      { id: 'checkout-api', kind: 'service', realized_by: ['src/checkout/api.ts'], realizes: ['checkout-api'] },
      { id: 'payment-service', kind: 'service', realized_by: ['src/payment/service.ts'], realizes: ['payment-service'] },
      // orders-store is NOT observed — a genuine drift finding.
      { id: 'audit-log', kind: 'library', realized_by: ['src/audit/log.ts'], realizes: [] },
    ],
    source_artifacts: [
      { path: 'src/checkout/api.ts', revision: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0' },
      { path: 'src/payment/service.ts', revision: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0' },
      { path: 'src/audit/log.ts', revision: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0' },
    ],
    interfaces: [
      { id: 'iface:checkout-api', provider: 'checkout-api', contract_ref: null, consumers: ['payment-service'] },
    ],
    dependencies: [
      { source: 'checkout-api', target: 'payment-service', kind: 'uses' },
      { source: 'checkout-api', target: 'audit-log', kind: 'imports' },
    ],
    tests: [{ id: 'test:checkout', subject: 'checkout-api', framework: 'vitest' }],
    builds: [{ id: 'build:1', source_revision: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0', outputs: ['dist/'], reproducible: true }],
    deployments: [
      { id: 'deploy:prod-1', build_id: 'build:1', environment: 'production', revision: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0' },
    ],
    runtime_mappings: [
      { id: 'rt:checkout', component: 'checkout-api', runtime_ref: 'proc:checkout', environment: 'production' },
    ],
  };
}

function fixtureSystemState(graph: ArchitectureGraphArtifact, model: ReturnType<typeof fixtureImplementationModel>): SystemStateArtifact {
  return createSystemState({
    content: {
      architecture_ref: { artifact_id: graph.envelope.id, version: graph.envelope.version },
      implementation: [{ artifact_id: model.id, revision: { kind: 'git-sha', value: model.revision } }],
      configuration: [{ config_id: 'checkout-config', revision: { kind: 'config-version', value: 'v42' } }],
      deployment: [
        {
          deployment_id: 'deploy:prod-1',
          environment: 'production',
          revision: { kind: 'deployment-id', value: 'deploy:prod-1' },
        },
      ],
      policy: [{ policy_id: 'deployment-policy', version: 3 }],
      environment_relationships: [{ source: 'staging', target: 'production', kind: 'promotes-to' }],
      active_experiments: [],
      package_realizations: [],
    },
    provenance: ['W11:ui-contracts:fixture'],
    created_at: NOW,
    status: 'ACTIVE',
  });
}

function fixtureEvidence(
  seed: string,
  subject: string,
  availability: 'SUCCESS' | 'FAILURE' | 'UNKNOWN' | 'UNAVAILABLE' | 'UNSUPPORTED' | 'PARTIAL',
  evidenceClass: 'OBSERVATIONAL' | 'INTERVENTIONAL',
): EvidenceRecordW3 {
  return createEvidence({
    kind: 'telemetry',
    subject_ref: subject,
    availability,
    evidence_class: evidenceClass,
    method: 'telemetry:capture-availability',
    provenance: [`W11:ui-contracts:${seed}`],
    window: { start: '2025-06-01T00:00:00Z', end: '2025-06-15T00:00:00Z' },
    source_revision: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0',
    deployment_revision: 'deploy:prod-1',
    confidence: { kind: 'QUALITATIVE', uncertainty_class: 'MODERATE' },
    producer: { tool: 'otel-collector', tool_version: '1.0.0', model: null, model_version: null, command: null, environment: 'production' },
  });
}

function fixtureCandidate(seed: string, graph: ArchitectureGraphArtifact): CandidateStateFixture {
  const candidate = createCandidateState({
    content: {
      invariants: ['Checkout API contract preserved'],
      predicted_effects: ['p95 latency decreases'],
      causal_claim: true,
      confidence: { kind: 'QUALITATIVE', uncertainty_class: 'MODERATE' },
      base_subject_revision: 'rev-1',
      hypothesis_ref: hypothesisId(seed),
      bounded_subgraph_ref: { graph_id: graph.envelope.id, version: graph.envelope.version },
      context: { environment: 'production' },
    },
    provenance: ['W11:ui-contracts:fixture'],
    created_at: NOW,
    status: 'ACTIVE',
  });
  assertValidCandidateState(candidate);
  return candidate;
}

function fixtureAssurance(): { caseArtifact: AssuranceCaseArtifact; evaluation: AssuranceEvaluation } {
  // Evidence is created FIRST (about the claimed-about subject — the
  // candidate under assurance, not the case itself), so the case can cite
  // the record's exact deterministic id.
  const claimedAbout = candidateId('assurance-candidate');
  const evidence = createEvidence({
    kind: 'rollback-rehearsal',
    subject_ref: claimedAbout,
    availability: 'SUCCESS',
    evidence_class: 'INTERVENTIONAL',
    method: 'rehearsal:executed-and-timed',
    provenance: ['W11:ui-contracts:fixture'],
    window: { start: '2025-06-01T00:00:00Z', end: '2025-06-30T00:00:00Z' },
    source_revision: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0',
    confidence: { kind: 'QUALITATIVE', uncertainty_class: 'STRONG' },
    producer: { tool: 'rehearsal-runner', tool_version: '1.0.0', model: null, model_version: null, command: null, environment: 'production' },
  });
  const evidenceA = evidence.id;
  const caseArtifact = createAssuranceCase({
    content: {
      claims: [
        { id: 'claim-reliable', statement: 'Checkout remains reliable under the candidate' },
        { id: 'claim-rollback', statement: 'Recovery completes within the declared bound' },
      ],
      arguments: [
        {
          id: 'argument-reliability',
          strategy: 'Testing over the declared guardrails plus rehearsal evidence',
          conclusion: 'claim-reliable',
          premises: ['claim-rollback'],
        },
      ],
      assumptions: [{ id: 'assumption-steady-load', statement: 'Load stays within the tested envelope' }],
      hazards: [{ id: 'hazard-payment-outage', description: 'Payment calls fail under the new candidate' }],
      controls: [{ id: 'control-guardrails', mechanism: 'Wired guardrails roll the change back', addresses: ['hazard-payment-outage'] }],
      evidence: [{ evidence_id: evidenceA, role: 'VERIFIES', claim_ref: 'claim-reliable' }],
      validity_conditions: [
        { kind: 'IMPLEMENTATION', subject: 'sos://ImplementationModel/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', valid_revisions: ['a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0'] },
      ],
      objections: [
        {
          id: 'objection-single-region',
          statement: 'Rehearsal only covered one region',
          raised_at: '2025-06-10T00:00:00Z',
          status: 'OPEN',
          resolution: null,
        },
        {
          id: 'objection-old-tooling',
          statement: 'Evidence produced by an older collector version',
          raised_at: '2025-06-09T00:00:00Z',
          status: 'RESOLVED',
          resolution: {
            note: 'Collector upgrade verified; windows overlap',
            resolved_at: '2025-06-11T00:00:00Z',
            provenance: ['W11:ui-contracts:fixture'],
          },
        },
      ],
    },
    provenance: ['W11:ui-contracts:fixture'],
    created_at: NOW,
    status: 'ACTIVE',
  });
  const evaluation = evaluateAssuranceCase(caseArtifact, {
    now: NOW,
    implementation_revisions: { 'sos://ImplementationModel/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa': 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0' },
    assumption_checks: { 'assumption-steady-load': true },
    evidence: [evidence],
  });
  return { caseArtifact, evaluation };
}

function fixtureExperiment(): {
  experiment: ExperimentArtifact;
  result: ExperimentResultRecord;
  evaluation: ExperimentEvaluation;
} {
  const candidate = candidateId('experiment-candidate');
  const hypothesis = hypothesisId('experiment-hypothesis');
  const experiment = createExperiment({
    content: {
      design: {
        kind: 'TREATMENT_CONTROL',
        population: {
          description: 'Production checkout requests',
          unit: 'REQUEST',
          context: { environment: 'production' },
        },
        allocation: {
          unit: 'REQUEST',
          assignment: 'DETERMINISTIC_HASH',
          arms: [
            { id: 'control', role: 'CONTROL', candidate_ref: null },
            { id: 'treatment', role: 'TREATMENT', candidate_ref: candidate },
          ],
          ratios: [9, 1],
        },
        metrics: [
          { id: 'metric-p95', role: 'PRIMARY', description: 'Checkout p95 latency (ms)', direction: 'DECREASE' },
          { id: 'metric-error-rate', role: 'GUARDRAIL', description: 'Error rate (%)', direction: 'INCREASE', guardrail_threshold: 1 },
        ],
        stopping_criteria: [{ kind: 'MAX_SAMPLES', max_samples: 1000 }],
        rollback_criteria: [{ id: 'rollback-errors', guardrail_metric_ids: ['metric-error-rate'], description: 'Roll back when the error-rate guardrail trips' }],
      },
      stage: { phase: 'CANARY', exposure_percent: 10 },
      canary_ladder: [5, 10, 25],
      candidate_ref: candidate,
      hypothesis_ref: hypothesis,
      producer: { tool: 'experiment-runner', tool_version: '1.0.0', model: null, model_version: null, command: null, environment: 'production' },
    },
    provenance: ['W11:ui-contracts:fixture'],
    created_at: '2025-06-01T00:00:00Z',
    status: 'ACTIVE',
  });
  const result = createExperimentResult(experiment, {
    experiment_id: experiment.envelope.id,
    observed_at: NOW,
    sample_size: 400,
    outcomes: [
      { metric_id: 'metric-p95', arm_id: 'control', value: 220, availability: 'SUCCESS' },
      { metric_id: 'metric-p95', arm_id: 'treatment', value: 180, availability: 'SUCCESS' },
      { metric_id: 'metric-error-rate', arm_id: 'control', value: 0.4, availability: 'SUCCESS' },
      { metric_id: 'metric-error-rate', arm_id: 'treatment', value: 0.6, availability: 'SUCCESS' },
    ],
    provenance: ['W11:ui-contracts:fixture'],
    producer: { tool: 'experiment-runner', tool_version: '1.0.0', model: null, model_version: null, command: null, environment: 'production' },
  });
  const evaluation = evaluateExperimentResult(experiment, result);
  return { experiment, result, evaluation };
}

function fixtureAsk(): { ask: AskRequestArtifact; context: AskEscalationContext; decision: DecisionRecord } {
  const candidate = candidateId('ask-candidate');
  const evaluation = evaluate(
    {
      action_kind: 'PROMOTE',
      action_description: 'Promote the checkout latency candidate to production',
      target: { kind: 'ARTIFACT', artifact_id: candidate },
      blast_radius: 'SERVICE',
      impact: 'HIGH',
      risk: 'HIGH',
      reversibility: 'PARTIALLY_REVERSIBLE',
      causal_claim: true,
      uncertainty: { uncertainty_class: 'MODERATE', basis: 'Canary evidence is partial' },
      rollback_signals: [],
      evidence: [],
      grants: [],
      evaluation_point: { kind: 'TIME', now: NOW },
      explicit_authority_decision_ref: null,
      confidence: null,
    },
    { provenance: ['W11:ui-contracts:fixture'], created_at: NOW },
  );
  const ask = createAskRequest({
    content: {
      decision: `Decide the escalated action: promote the checkout latency candidate (action PROMOTE, blast radius SERVICE, risk HIGH, reversibility PARTIALLY_REVERSIBLE).`,
      alternatives: [
        { id: 'act-under-granted-authority', action: 'ACT', description: 'Proceed with the action under an explicit grant covering it.' },
        { id: 'experiment-first', action: 'EXPERIMENT', description: 'Run a controlled experiment before the action.' },
        { id: 'reject', action: 'REJECT', description: 'Refuse the action.' },
      ],
      evidence_quality: { quality: 'WEAK', summary: 'No admissible evidence backed the escalated decision request' },
      uncertainty: { uncertainty_class: 'MODERATE', basis: 'Canary evidence is partial' },
      trade_offs: ['risk HIGH vs reversibility PARTIALLY_REVERSIBLE', 'impact HIGH vs evidence quality WEAK'],
      risk: { description: 'A misfiring promotion degrades checkout for all shoppers', severity: 'HIGH' },
      authority_insufficiency: evaluation.escalation?.message ?? 'Current authority is insufficient for this promotion.',
    },
    provenance: ['W11:ui-contracts:fixture'],
    created_at: NOW,
    status: 'ACTIVE',
  });
  const context = assembleEscalationContext({ ask, decision: evaluation.record, evidence: [], now: NOW });
  return { ask, context, decision: evaluation.record };
}

function fixtureRecovery(): RecoveryDeclarationArtifact {
  return createRecoveryDeclaration({
    content: {
      change_ref: candidateId('recovery-change'),
      mechanism: { kind: 'ROLLBACK_DEPLOYMENT', to_deployment_id: 'deploy:prod-1' },
      trigger: { kind: 'BUDGET', metric: 'error-rate', threshold: '1%', window_ms: 300000 },
      authority_ref: rawId('AuthorityGrant', 'recovery-grant'),
      evidence_ref: evidenceId('recovery-rehearsal'),
      exception: null,
    },
    provenance: ['W11:ui-contracts:fixture'],
    created_at: NOW,
    status: 'ACTIVE',
  });
}

function fixtureRepertoire(): { result: RetrievalResult; packageA: ReturnType<typeof createPackageArtifact>; packageB: ReturnType<typeof createPackageArtifact> } {
  // Evidence about the realizations, created FIRST so packages can cite the
  // ids (deterministic content addressing). Two SUCCESS records with one
  // INTERVENTIONAL escape the one-lucky-success regime (the W6 gate).
  const realizationSubject = rawId('ImplementationModel', 'realization-subject');
  const evidenceA1 = createEvidence({
    kind: 'integration-test',
    subject_ref: realizationSubject,
    availability: 'SUCCESS',
    evidence_class: 'INTERVENTIONAL',
    method: 'test-run:exit-code',
    provenance: ['W11:ui-contracts:fixture'],
    window: { start: '2025-06-01T00:00:00Z', end: '2025-06-30T00:00:00Z' },
    source_revision: 'r1',
    confidence: { kind: 'QUALITATIVE', uncertainty_class: 'STRONG' },
    producer: { tool: 'vitest', tool_version: '3.0.0', model: null, model_version: null, command: 'pnpm test', environment: 'ci' },
  });
  const evidenceA2 = createEvidence({
    kind: 'telemetry',
    subject_ref: realizationSubject,
    availability: 'SUCCESS',
    evidence_class: 'OBSERVATIONAL',
    method: 'telemetry:capture-availability',
    provenance: ['W11:ui-contracts:fixture'],
    window: { start: '2025-06-01T00:00:00Z', end: '2025-06-30T00:00:00Z' },
    source_revision: 'r1',
    confidence: { kind: 'QUALITATIVE', uncertainty_class: 'MODERATE' },
    producer: { tool: 'otel-collector', tool_version: '1.0.0', model: null, model_version: null, command: null, environment: 'production' },
  });
  const evidenceB1 = createEvidence({
    kind: 'load-test',
    subject_ref: rawId('ImplementationModel', 'cache-realization-subject'),
    availability: 'SUCCESS',
    evidence_class: 'INTERVENTIONAL',
    method: 'load-test:threshold-check',
    provenance: ['W11:ui-contracts:fixture'],
    window: { start: '2025-06-01T00:00:00Z', end: '2025-06-30T00:00:00Z' },
    source_revision: 'r1',
    confidence: { kind: 'QUALITATIVE', uncertainty_class: 'STRONG' },
    producer: { tool: 'load-runner', tool_version: '1.0.0', model: null, model_version: null, command: null, environment: 'staging' },
  });
  const evidenceB2 = createEvidence({
    kind: 'telemetry',
    subject_ref: rawId('ImplementationModel', 'cache-realization-subject'),
    availability: 'SUCCESS',
    evidence_class: 'OBSERVATIONAL',
    method: 'telemetry:capture-availability',
    provenance: ['W11:ui-contracts:fixture'],
    window: { start: '2025-06-01T00:00:00Z', end: '2025-06-30T00:00:00Z' },
    source_revision: 'r1',
    confidence: { kind: 'QUALITATIVE', uncertainty_class: 'MODERATE' },
    producer: { tool: 'otel-collector', tool_version: '1.0.0', model: null, model_version: null, command: null, environment: 'production' },
  });
  const packageA = createPackageArtifact({
    content: {
      semantic_capability: 'Durable checkout queue',
      contracts: ['sos://schema/queue'],
      preconditions: ['A message bus is deployed'],
      postconditions: ['Checkout events are durably buffered'],
      realizations: [{ ref: rawId('ImplementationModel', 'queue-realization'), revision: 'r1', note: 'Queue-backed checkout buffer' }],
      applicability: [
        { kind: 'QUALITATIVE', uncertainty_class: 'MODERATE', context: { environment: 'production', workload: 'read-heavy' }, sample_size: 12, window: { start: '2025-06-01T00:00:00Z', end: '2025-06-15T00:00:00Z' } },
      ],
      evidence_refs: [evidenceA1.id, evidenceA2.id],
      failure_refs: [],
      compatibility_refs: [],
      composition_refs: [],
      assurance_obligations: [{ kind: 'CANARY', obligation: 'Canary every adoption for one ladder cycle' }],
      context: { environment: 'production' },
      learned_limitations: ['Assumes read-heavy workload'],
      diversity_profile: {
        family: 'cost-optimized',
        dimensions: [
          { dimension: 'COST', stance: 'optimizes for low monthly cost' },
          { dimension: 'RESILIENCE', stance: 'buffers upstream outages' },
        ],
      },
      maturity: 'VALIDATED',
      changes: 'Initial validated realization',
      superseded_by: null,
    },
    provenance: ['W11:ui-contracts:fixture'],
    created_at: NOW,
    status: 'ACTIVE',
  });
  const packageB = createPackageArtifact({
    content: {
      semantic_capability: 'Edge-cached checkout rendering',
      contracts: ['sos://schema/render-cache'],
      preconditions: ['A CDN is deployed'],
      postconditions: ['Checkout renders from the edge'],
      realizations: [{ ref: rawId('ImplementationModel', 'cache-realization'), revision: 'r1', note: 'Edge cache for checkout rendering' }],
      applicability: [
        { kind: 'QUALITATIVE', uncertainty_class: 'STRONG', context: { environment: 'production', region: 'eu' }, sample_size: 30, window: { start: '2025-06-01T00:00:00Z', end: '2025-06-15T00:00:00Z' } },
      ],
      evidence_refs: [evidenceB1.id, evidenceB2.id],
      failure_refs: [evidenceId('pkg-b-failure')],
      compatibility_refs: [],
      composition_refs: [],
      assurance_obligations: [{ kind: 'SHADOW', obligation: 'Shadow before serving any live traffic' }],
      context: { environment: 'production', region: 'eu' },
      learned_limitations: [],
      diversity_profile: {
        family: 'latency-optimized',
        dimensions: [
          { dimension: 'LATENCY', stance: 'optimizes for p99 < 50ms' },
          { dimension: 'COST', stance: 'accepts higher CDN cost' },
        ],
      },
      maturity: 'VALIDATED',
      changes: 'Initial validated realization',
      superseded_by: null,
    },
    provenance: ['W11:ui-contracts:fixture'],
    created_at: NOW,
    status: 'ACTIVE',
  });
  const registry = new PackageRegistry();
  registry.putPackage(packageA, [evidenceA1, evidenceA2]);
  registry.putPackage(packageB, [evidenceB1, evidenceB2]);
  const result = registry.retrieve({ capability: 'checkout' });
  return { result, packageA, packageB };
}

function fixtureMachineState(): MachineStateSnapshot {
  return {
    schemaVersion: '2.0',
    program: 'SOS-2.0',
    status: 'ACTIVE',
    currentFrontier: ['W11', 'W12'],
    currentTask: 'W11+W12 (final parallel wave)',
    tasks: {
      W0: { status: 'BOOTSTRAP_COMPLETE', dependencies: [], mergedAs: 'INITIAL_BOOTSTRAP' },
      W1: { status: 'COMPLETE', dependencies: ['W0.5'], mergedAs: '645f5a582ea296c5ad446ff31c7956437378e529' },
      W10: { status: 'COMPLETE', dependencies: ['W1', 'W8', 'W9'], mergedAs: '97ff90a615272f28dac62ac7360595f2312df204' },
      W11: { status: 'ELIGIBLE', dependencies: ['W1', 'W2', 'W8', 'W10'], mergedAs: null },
      W12: { status: 'ELIGIBLE', dependencies: ['W2', 'W3', 'W8', 'W10'], mergedAs: null },
    },
  };
}
