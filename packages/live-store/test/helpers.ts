/**
 * Deterministic fixtures for the live-store tests (Work Order P2).
 *
 * Every record is built through the OWNING PACKAGE's own creation API with
 * fixed timestamps — no randomness, no clocks, no network. Deterministic
 * content addressing means identical construction -> identical id.
 */

import { createArchitectureGraph } from '@sos-2/architecture';
import type { ArchitectureGraphArtifact } from '@sos-2/architecture';
import { createAssuranceCase } from '@sos-2/assurance';
import type { AssuranceCaseArtifact } from '@sos-2/assurance';
import { createGrant } from '@sos-2/authority';
import type { AuthorityGrantArtifact } from '@sos-2/authority';
import { createCausalHypothesis, observationalEvidenceRef } from '@sos-2/causal';
import type { CausalHypothesisArtifact } from '@sos-2/causal';
import { createContext } from '@sos-2/context';
import type { ContextArtifact } from '@sos-2/context';
import { createDecisionRecord, DECISION_ENGINE_VERSION } from '@sos-2/decision';
import type { DecisionRecord } from '@sos-2/decision';
import { createEvidence, unquantifiedConfidence } from '@sos-2/evidence';
import type { EvidenceRecordW3 } from '@sos-2/evidence';
import { createCandidateState, createExperiment } from '@sos-2/experiments';
import type { CandidateStateFixture, ExperimentArtifact } from '@sos-2/experiments';
import { createArchitectureMemory } from '@sos-2/memory';
import type { ArchitectureMemoryArtifact } from '@sos-2/memory';
import { createMission } from '@sos-2/mission';
import type { MissionArtifact } from '@sos-2/mission';
import { createPackageArtifact } from '@sos-2/packages';
import type { PackageArtifact } from '@sos-2/packages';
import { createEnvelope } from '@sos-2/semantic-spine';
import type { ArtifactEnvelope, ArtifactStatus } from '@sos-2/semantic-spine';
import type { Producer, TimeWindow } from '@sos-2/provenance';
import { createSystemState } from '@sos-2/system-state';
import type { SystemStateArtifact } from '@sos-2/system-state';

export const T0 = '2026-01-01T00:00:00.000Z';
export const T1 = '2026-01-02T00:00:00.000Z';
export const T2 = '2026-01-03T00:00:00.000Z';

export const TEST_WINDOW: TimeWindow = { start: T0, end: T1 };

export function toolProducer(): Producer {
  return {
    tool: 'p2-live-store-tests',
    tool_version: '0.1.0',
    model: null,
    model_version: null,
    command: 'vitest run packages/live-store',
    environment: 'ci:local',
  };
}

export function missionFixture(): MissionArtifact {
  return createMission({
    content: {
      purpose: 'Ship the SOS 2.0 live persistence boundary with truthful failure states.',
      goals: [],
      outcomes: [],
      stakeholders: [],
      measures: [],
      assumptions: [],
      ambiguities: [],
      constraints: [],
    },
    provenance: ['P2:live-store-test'],
    created_at: T0,
  });
}

/** A lifecycle transition at the SAME revision (id preserved — spine withStatus). */
export function missionWithStatus(mission: MissionArtifact, status: ArtifactStatus): MissionArtifact {
  const envelope = createEnvelope({
    kind: 'Mission',
    version: mission.envelope.version,
    status,
    authority_ref: mission.envelope.authority_ref,
    provenance: mission.envelope.provenance,
    created_at: mission.envelope.created_at,
    supersedes: mission.envelope.supersedes,
    id: mission.envelope.id,
  });
  return { envelope, content: structuredClone(mission.content) };
}

/** A mission under the SAME id at an arbitrary revision (CAS/conflict tests). */
export function missionAtVersion(mission: MissionArtifact, version: number, status: ArtifactStatus = 'ACTIVE'): MissionArtifact {
  const envelope: ArtifactEnvelope = createEnvelope({
    kind: 'Mission',
    version,
    status,
    authority_ref: mission.envelope.authority_ref,
    provenance: mission.envelope.provenance,
    created_at: mission.envelope.created_at,
    supersedes: mission.envelope.supersedes,
    id: mission.envelope.id,
  });
  return { envelope, content: structuredClone(mission.content) };
}

export function contextFixture(): ContextArtifact {
  return createContext({
    dimensions: {
      user_cohort: 'beta-testers',
      platform: 'web',
      environment: 'production',
      regulatory: ['GDPR'],
    },
    provenance: ['P2:live-store-test'],
    created_at: T0,
  });
}

export function systemStateFixture(): SystemStateArtifact {
  return createSystemState({
    content: {
      architecture_ref: { artifact_id: `sos://ArchitectureGraph/${'a'.repeat(32)}`, version: 1 },
      implementation: [],
      configuration: [],
      deployment: [],
      policy: [],
      environment_relationships: [],
      active_experiments: [],
      package_realizations: [],
    },
    provenance: ['P2:live-store-test'],
    created_at: T0,
  });
}

export function evidenceFixture(availability: EvidenceRecordW3['availability'] = 'UNAVAILABLE'): EvidenceRecordW3 {
  return evidenceFixtureWithSubject(`sos://SystemState/${'a'.repeat(32)}`, availability);
}

export function evidenceFixtureWithSubject(
  subjectRef: string,
  availability: EvidenceRecordW3['availability'] = 'UNAVAILABLE',
): EvidenceRecordW3 {
  return createEvidence({
    kind: 'telemetry',
    subject_ref: subjectRef,
    availability,
    evidence_class: 'OBSERVATIONAL',
    method: 'telemetry:capture-availability',
    provenance: ['observation:sha256:' + 'a'.repeat(64)],
    source_revision: 'git-sha:' + 'f'.repeat(40),
    deployment_revision: 'deploy-2026-01-01',
    window: TEST_WINDOW,
    subject_revision: 'system-state:r1',
    confidence: unquantifiedConfidence(),
    producer: toolProducer(),
  });
}

export function architectureFixture(): ArchitectureGraphArtifact {
  return createArchitectureGraph({
    projects_system_state: { system_state_id: `sos://SystemState/${'a'.repeat(32)}`, version: 1 },
    nodes: [{ id: 'component:checkout', kind: 'Component', attributes: { runtime: 'node' } }],
    edges: [],
    provenance: ['P2:live-store-test'],
    created_at: T0,
  });
}

export function candidateFixture(): CandidateStateFixture {
  return createCandidateState({
    content: {
      invariants: ['p99 read latency stays below 500ms'],
      predicted_effects: ['p99 read latency drops below 200ms'],
      causal_claim: true,
      confidence: null,
      base_subject_revision: 'system-state:r1',
      hypothesis_ref: `sos://CausalHypothesis/${'a'.repeat(32)}`,
      bounded_subgraph_ref: null,
      context: { environment: 'production', service: 'checkout' },
    },
    provenance: ['P2:live-store-test'],
    created_at: T0,
  });
}

export function assuranceFixture(): AssuranceCaseArtifact {
  return createAssuranceCase({
    content: {
      claims: [{ id: 'claim-live-store-safe', statement: 'The live store preserves truth states and provenance bit-exact.' }],
      arguments: [],
      assumptions: [],
      hazards: [],
      controls: [],
      evidence: [],
      validity_conditions: [],
      objections: [],
    },
    provenance: ['P2:live-store-test'],
    created_at: T0,
    status: 'ACTIVE',
  });
}

export function experimentFixture(): ExperimentArtifact {
  const candidate = candidateFixture();
  return createExperiment({
    content: {
      design: {
        kind: 'TREATMENT_CONTROL',
        population: {
          description: 'Checkout read traffic in the production region.',
          unit: 'REQUEST',
          context: { environment: 'production', service: 'checkout' },
        },
        allocation: {
          unit: 'REQUEST',
          assignment: 'RANDOM',
          arms: [
            { id: 'control', role: 'CONTROL', candidate_ref: null },
            { id: 'treatment', role: 'TREATMENT', candidate_ref: candidate.envelope.id },
          ],
          ratios: [1, 1],
        },
        metrics: [
          { id: 'p99-latency', role: 'PRIMARY', description: 'p99 read latency (ms).', direction: 'DECREASE' },
          {
            id: 'error-rate',
            role: 'GUARDRAIL',
            description: 'Read error rate (fraction).',
            direction: 'DECREASE',
            guardrail_threshold: 0.01,
          },
        ],
        stopping_criteria: [
          { kind: 'MAX_SAMPLES', max_samples: 10_000 },
          { kind: 'EARLY_SUCCESS', description: 'Stop when satisfied.' },
        ],
        rollback_criteria: [
          { id: 'error-budget', guardrail_metric_ids: ['error-rate'], description: 'Roll back on error-budget breach.' },
        ],
      },
      stage: { phase: 'SHADOW', exposure_percent: 0 },
      canary_ladder: [1, 5, 25, 50],
      candidate_ref: candidate.envelope.id,
      hypothesis_ref: `sos://CausalHypothesis/${'a'.repeat(32)}`,
      producer: toolProducer(),
    },
    provenance: ['P2:live-store-test'],
    created_at: T0,
  });
}

export function decisionFixture(): DecisionRecord {
  return createDecisionRecord(
    { provenance: ['P2:live-store-test'], created_at: T0 },
    {
      action: 'ACT',
      engine_version: DECISION_ENGINE_VERSION,
      input_digest: 'a'.repeat(64),
      rule_trace: [{ rule: 'R5_ACT', order: 1, outcome: 'ACT', code: null, reason: 'All gates passed.' }],
      request_summary: {
        action_kind: 'REVISE',
        action_description: 'Revise the checkout mission document with the revised latency budget.',
        target: { kind: 'KIND', artifact_kind: 'Mission' },
        blast_radius: 'SERVICE',
        impact: 'MODERATE',
        risk: 'LOW',
        reversibility: 'REVERSIBLE',
        causal_claim: false,
        uncertainty: { uncertainty_class: 'LOW', basis: 'the revision is fully specified and reviewed' },
      },
      authority: {
        required_level: 'BOUNDED',
        effective_level: 'BOUNDED',
        verdict_code: 'PERMITTED',
        grant_ref: null,
        consulted_grant_refs: [],
        applied_raise_refs: [],
      },
      escalation: null,
      resolution: null,
      evidence_refs: [],
      confidence: null,
      reasons: ['All gates passed.'],
    },
  );
}

export function grantFixture(): AuthorityGrantArtifact {
  return createGrant({
    grantee: 'p2-live-store-test-actor',
    scope: { kind: 'KIND', artifact_kind: 'Mission' },
    permissions: ['READ', 'REVISE'],
    expiry: { kind: 'TIME', at: '2026-12-31T00:00:00.000Z' },
    provenance: ['P2:live-store-test'],
    created_at: T0,
    status: 'ACTIVE',
  });
}

export function packageFixture(): PackageArtifact {
  const evidence = evidenceFixture('SUCCESS');
  return createPackageArtifact({
    content: {
      semantic_capability: 'sample-capability',
      contracts: ['contract:sample/v1'],
      preconditions: ['precondition-a'],
      postconditions: ['postcondition-a'],
      realizations: [],
      applicability: [
        { kind: 'QUALITATIVE', uncertainty_class: 'UNQUANTIFIED', context: { environment: 'test' }, sample_size: 1, window: null },
      ],
      evidence_refs: [evidence.id],
      failure_refs: [],
      compatibility_refs: [],
      composition_refs: [],
      assurance_obligations: [{ kind: 'TEST', obligation: 'sample tests pass' }],
      context: { environment: 'test' },
      learned_limitations: [],
      diversity_profile: { family: 'sample-family', dimensions: [{ dimension: 'COST', stance: 'low cost' }] },
      maturity: 'DISCOVERED',
      changes: 'initial discovery',
      superseded_by: null,
    },
    provenance: ['P2:live-store-test'],
    created_at: T0,
  });
}

export function memoryFixture(): ArchitectureMemoryArtifact {
  return createArchitectureMemory({
    content: {
      entries: [],
      update: { producer: toolProducer(), evidence_refs: [] },
    },
    provenance: ['P2:live-store-test'],
    created_at: T0,
  });
}

export function hypothesisFixture(): CausalHypothesisArtifact {
  const observational = evidenceFixture('SUCCESS');
  return createCausalHypothesis({
    content: {
      statement: 'Cache hit rate correlates with p99 read latency.',
      claim_strength: 'CORRELATIONAL',
      intervention: {
        description: 'Enable the write-through cache layer on the read path.',
        target_ref: `sos://SystemState/${'a'.repeat(32)}`,
      },
      mechanism: 'Cache hits bypass the primary datastore round-trip.',
      predicted_outcomes: [
        { id: 'p99-drop', description: 'p99 read latency falls below 200ms.', metric: 'p99-latency', direction: 'DECREASE' },
      ],
      assumptions: [{ id: 'traffic-stable', statement: 'Traffic volume is comparable across the compared windows.' }],
      context: { environment: 'production', service: 'checkout' },
      alternatives: [],
      refutations: [{ id: 'latency-flat', description: 'p99 latency is unchanged when the cache is enabled.' }],
      graph: {
        factors: [
          { id: 'cache-enabled', description: 'Write-through cache layer is enabled.' },
          { id: 'p99-latency', description: 'p99 read latency.' },
        ],
        edges: [{ type: 'CONTRIBUTES_TO', cause: 'cache-enabled', effect: 'p99-latency' }],
      },
      observational_evidence: [observationalEvidenceRef(observational)],
      interventional_evidence: [],
      uncertainty: unquantifiedConfidence(),
      producer: toolProducer(),
      correlation_origin: null,
    },
    provenance: ['P2:live-store-test'],
    created_at: T0,
  });
}
