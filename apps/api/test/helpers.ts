/**
 * API contract fixtures — deterministic, offline, minted through the OWNING
 * packages' creators (test-only workspace devDependencies), exactly like
 * the future orchestrator/observation callers will mint them.
 */

import { createMission, MissionStore } from '@sos-2/mission';
import type { MissionArtifact } from '@sos-2/mission';
import { createSystemState } from '@sos-2/system-state';
import type { SystemStateArtifact } from '@sos-2/system-state';
import { createEvidence } from '@sos-2/evidence';
import type { EvidenceRecordW3 } from '@sos-2/evidence';
import type { BodyLeaseRecord, TaskRecord } from '@sos-2/live-store';

export const T0 = '2025-06-01T00:00:00Z';
export const T1 = '2025-06-02T00:00:00Z';
export const T2 = '2025-06-03T00:00:00Z';
export const T_FAR = '2025-12-31T00:00:00Z';
export const PROVENANCE = 'P2:api-contract:fixture';
export const SOURCE_REVISION = '3f9c1a2b8d7e4f60a1b2c3d4e5f6a7b8c9d0e1f2';

const PRODUCER = {
  tool: 'p2-api-contract-harness',
  tool_version: '1.0.0',
  model: null,
  model_version: null,
  command: 'vitest run apps/api',
  environment: 'ci:local',
} as const;

export interface ApiFixtures {
  mission: MissionArtifact;
  systemState: SystemStateArtifact;
  evidence: EvidenceRecordW3;
  task: TaskRecord;
  taskV2: TaskRecord;
  taskV3: TaskRecord;
  bodyLease: BodyLeaseRecord;
  events: Array<{
    event_id: string;
    source: string;
    event_kind: string;
    occurred_at: string;
    payload: Record<string, string>;
    subject_ref: string | null;
    provenance: string[];
  }>;
}

export function buildApiFixtures(): ApiFixtures {
  const missionStore = new MissionStore();
  const mission: MissionArtifact = createMission({
    content: {
      purpose: 'Make the checkout product continuously better while keeping costs predictable.',
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
    provenance: [PROVENANCE, 'mission:api-contract'],
    created_at: T0,
    authority_ref: null,
    version: 1,
    status: 'ACTIVE',
  });
  missionStore.put(mission);

  const systemState: SystemStateArtifact = createSystemState({
    content: {
      architecture_ref: { artifact_id: 'sos://ArchitectureGraph/' + '1'.repeat(32), version: 1 },
      implementation: [
        {
          artifact_id: 'sos://ImplementationModel/' + '2'.repeat(32),
          revision: { kind: 'git-sha', value: SOURCE_REVISION },
        },
      ],
      configuration: [],
      deployment: [
        { deployment_id: 'deploy:checkout-prod-2025-06-01', environment: 'production', revision: { kind: 'deployment-id', value: 'deploy:checkout-prod-2025-06-01' } },
      ],
      policy: [],
      environment_relationships: [],
      active_experiments: [],
      package_realizations: [],
    },
    provenance: [PROVENANCE, 'system-state:api-contract'],
    created_at: T0,
    status: 'ACTIVE',
  });

  const evidence: EvidenceRecordW3 = createEvidence({
    kind: 'telemetry',
    subject_ref: mission.envelope.id,
    availability: 'SUCCESS',
    evidence_class: 'OBSERVATIONAL',
    method: 'telemetry:capture-availability',
    provenance: [PROVENANCE, 'observation:sha256:' + 'a'.repeat(64)],
    window: { start: T0, end: T_FAR },
    source_revision: SOURCE_REVISION,
    confidence: { kind: 'QUALITATIVE', uncertainty_class: 'STRONG' },
    producer: PRODUCER,
  });

  const task: TaskRecord = {
    task_id: 'task-api-contract-1',
    mission_ref: mission.envelope.id,
    status: 'RUNNING',
    plan: {
      nodes: [
        { node_id: 'plan-implement', state: 'IN_PROGRESS', summary: 'Implement the durable write buffer' },
        { node_id: 'plan-verify', state: 'PENDING', summary: 'Verify with integration tests' },
      ],
      edges: [{ from: 'plan-implement', to: 'plan-verify' }],
    },
    owned_revision: SOURCE_REVISION,
    authority_context: { grant_refs: [], note: null },
    body_lease_ref: 'lease-api-contract-1',
    checkpoints: [
      {
        checkpoint_id: 'checkpoint-1',
        created_at: T1,
        state: { files_written: ['src/queue/buffer.ts'] },
        provenance: [PROVENANCE, 'checkpoint:1'],
        label: null,
      },
    ],
    artifacts: [],
    evidence_refs: [evidence.id],
    unresolved_uncertainty: [],
    retries: { attempt_count: 0, last_failure: null, last_failure_at: null, recovery_kind: 'NONE' },
    cost: [],
    final_verification: null,
    provenance: [PROVENANCE, 'task:api-contract'],
    created_at: T0,
    updated_at: T1,
    revision: 1,
  };
  const taskV2: TaskRecord = {
    ...task,
    status: 'PAUSED',
    updated_at: T2,
    revision: 2,
  };
  const taskV3: TaskRecord = {
    ...task,
    status: 'SUCCEEDED',
    updated_at: T_FAR,
    revision: 3,
  };

  const bodyLease: BodyLeaseRecord = {
    lease_id: 'lease-api-contract-1',
    task_ref: task.task_id,
    body_ref: 'body:cloud-sandbox:runner-1',
    capabilities: ['shell', 'git'],
    state: 'ACTIVE',
    acquired_at: T1,
    expires_at: T_FAR,
    last_heartbeat_at: null,
    release_reason: null,
    provenance: [PROVENANCE, 'lease:api-contract'],
    revision: 1,
  };

  const events: ApiFixtures['events'] = [
    {
      event_id: 'gh-delivery-1001',
      source: 'github:webhook:payswapdotorg/SOS-2.0',
      event_kind: 'github:push',
      occurred_at: T0,
      payload: { ref: 'refs/heads/main', after: SOURCE_REVISION },
      subject_ref: null,
      provenance: ['webhook:github:delivery-1001'],
    },
    {
      event_id: 'ci-run-8001',
      source: 'github:actions:SOS-2.0',
      event_kind: 'ci:workflow-run',
      occurred_at: T1,
      payload: { workflow: 'verify', conclusion: 'success' },
      subject_ref: mission.envelope.id,
      provenance: ['ci:github-actions:run-8001'],
    },
  ];

  return { mission, systemState, evidence, task, taskV2, taskV3, bodyLease, events };
}
