/**
 * The greenfield journey persistence engine (Work Order P4): the pure
 * composition that formalizes a completed journey draft into the frozen
 * domain artifacts — a Mission artifact (@sos-2/mission's createMission,
 * consumed verbatim), an ImplementationModel record for the linked
 * repository (spine-minted identity — never a second registry), a
 * SystemState artifact whose implementation entry carries the EXACT
 * repository revision ({ kind: 'git-sha', value } — @sos-2/system-state's
 * own ImplementationReference), the connection/import Evidence records
 * (@sos-2/evidence), and the typed trace links (@sos-2/semantic-spine).
 *
 * The engine is PURE: the caller supplies every instant (RFC3339
 * literals) and provenance; nothing is minted outside the spine. The
 * durable WRITE is the live store's business (Work Order P2's
 * repositories — exercised end-to-end by the journey integration test
 * in packages/github).
 */

import { createEvidence } from '@sos-2/evidence';
import type { EvidenceRecordW3 } from '@sos-2/evidence';
import { createMission } from '@sos-2/mission';
import type { MissionArtifact } from '@sos-2/mission';
import { buildRationaleChain } from '@sos-2/ui-contracts';
import type { RationaleChain } from '@sos-2/ui-contracts';
import { assertValidProductVmCore } from '@sos-2/web-contracts';
import type { DataSource, NextActionView, ProductVmCore, UncertaintyView } from '@sos-2/web-contracts';
import { createSystemState } from '@sos-2/system-state';
import type { SystemStateArtifact } from '@sos-2/system-state';
import {
  createTraceLink,
  deriveDeterministicArtifactId,
  isImplementationModel,
} from '@sos-2/semantic-spine';
import type { TraceLink } from '@sos-2/semantic-spine';
import type { GreenfieldJourneyDraft } from './greenfield';
import { formalizeMissionContent } from './greenfield';
import type { OnboardingConnectionView } from './connection-view';
import { ONBOARDING_CONFIRMATION_PERMISSION } from './review-core';

/**
 * The structural input the engine needs from the GitHub connection
 * stage — the exact shape of @sos-2/github's ImportedRevision plus the
 * discovered repository summary, carried structurally (the provider
 * package is pinned by the journey integration test).
 */
export interface ConnectedRepositoryInput {
  owner: string;
  name: string;
  /** True when the repository was empty at connection (the initial commit then created the first revision). */
  was_empty: boolean;
  branch: string;
  /** The exact revision (commit sha) linked into System State. */
  head_sha: string;
}

/** The result of a formalized greenfield journey. */
export interface GreenfieldJourneyResult {
  /** The formalized Mission artifact (DRAFT status — activation is a separate human act). */
  mission: MissionArtifact;
  /** The System State artifact with the repository revision linked into its implementation section. */
  system_state: SystemStateArtifact;
  /** The ImplementationModel record for the linked repository (spine-minted identity). */
  implementation_model: ImplementationModelRecord;
  /** The connection + import Evidence records (observational, non-LLM). */
  evidence: EvidenceRecordW3[];
  /** The typed trace links binding the artifacts. */
  trace_links: TraceLink[];
}

/**
 * The ImplementationModel record for the linked repository — the frozen
 * @sos-2/contracts shape (isImplementationModel-guarded), with a
 * spine-minted deterministic identity: the repository's identity in
 * System State is this artifact id, NEVER a second registry.
 */
export interface ImplementationModelRecord {
  /** sos://ImplementationModel/<32-hex> — minted by the spine's deterministic derivation. */
  id: string;
  /** The exact source revision this model was extracted from (the linked commit sha). */
  revision: string;
  components: [];
  source_artifacts: [];
  interfaces: [];
  dependencies: [];
  tests: [];
  builds: [];
  deployments: [];
  runtime_mappings: [];
}

/** The spine-bound result view model (the P1 ProductVmCore over the mission). */
export interface GreenfieldResultVm {
  /** The full P1 core: spine subject + rationale chain + evidence + uncertainty + authority + next action. */
  core: ProductVmCore;
  mission_id: string;
  system_state_id: string;
  system_state_version: number;
  implementation_model_id: string;
  /** The exact repository revision linked into System State. */
  linked_revision: { repository: string; branch: string; sha: string };
  /** Whether the repository was empty at connection (the greenfield flagship path). */
  repository_was_empty: boolean;
  /** The honest connection view of the journey's GitHub connection. */
  connection: OnboardingConnectionView;
}

/**
 * Formalize a COMPLETED greenfield journey draft into the frozen domain
 * artifacts. Throws when the draft is not complete (validate first) or
 * when the domain validators reject the formalized content — the domain
 * is the single authority.
 */
export function formalizeGreenfieldJourney(input: {
  draft: GreenfieldJourneyDraft;
  repository: ConnectedRepositoryInput;
  provenance: string[];
  created_at: string;
  /** The authorizing anchor (a spine artifact id — e.g. the constitution anchor or an explicit grant). */
  authority_ref: string;
}): GreenfieldJourneyResult {
  const { draft, repository } = input;
  if (!draft.authority_confirmed) {
    throw new Error('formalizeGreenfieldJourney: the authority gate is not confirmed — the journey refuses to formalize.');
  }
  if (draft.repository === null) {
    throw new Error('formalizeGreenfieldJourney: no repository is selected — the journey refuses to formalize.');
  }
  const formalization = formalizeMissionContent(draft);
  if (!formalization.valid || formalization.content === null) {
    throw new Error(`formalizeGreenfieldJourney: the mission content is not valid: ${formalization.problems.map((problem) => problem.message).join(' ')}`);
  }

  const mission = createMission({
    content: formalization.content,
    provenance: input.provenance,
    created_at: input.created_at,
    authority_ref: input.authority_ref,
    status: 'DRAFT',
  });

  const implementationModel: ImplementationModelRecord = {
    id: deriveDeterministicArtifactId('ImplementationModel', {
      repository: `${repository.owner}/${repository.name}`,
      revision: repository.head_sha,
      provenance: input.provenance,
    }),
    revision: repository.head_sha,
    components: [],
    source_artifacts: [],
    interfaces: [],
    dependencies: [],
    tests: [],
    builds: [],
    deployments: [],
    runtime_mappings: [],
  };
  if (!isImplementationModel(implementationModel)) {
    throw new Error('formalizeGreenfieldJourney: the implementation model record does not satisfy the frozen ImplementationModel shape.');
  }

  const systemState = createSystemState({
    content: {
      architecture_ref: { artifact_id: deriveDeterministicArtifactId('ArchitectureGraph', { journey: 'greenfield', repository: `${repository.owner}/${repository.name}`, revision: repository.head_sha }), version: 1 },
      implementation: [
        {
          artifact_id: implementationModel.id,
          revision: { kind: 'git-sha', value: repository.head_sha },
        },
      ],
      configuration: [],
      deployment: [],
      policy: [],
      environment_relationships: [],
      active_experiments: [],
      package_realizations: [],
    },
    provenance: input.provenance,
    created_at: input.created_at,
    authority_ref: input.authority_ref,
    status: 'DRAFT',
  });

  const connectionEvidence = createEvidence({
    kind: 'provider-connection',
    subject_ref: systemState.envelope.id,
    availability: repository.was_empty ? 'SUCCESS' : 'SUCCESS',
    evidence_class: 'OBSERVATIONAL',
    method: 'github-adapter:connection-snapshot',
    provenance: input.provenance,
    source_revision: `git:${repository.head_sha}`,
    deployment_revision: null,
    window: null,
    subject_revision: null,
    confidence: { kind: 'QUALITATIVE', uncertainty_class: 'UNQUANTIFIED' },
    producer: {
      tool: 'sos-onboarding',
      tool_version: null,
      model: null,
      model_version: null,
      command: null,
      environment: null,
    },
  });
  const importEvidence = createEvidence({
    kind: 'repository-import',
    subject_ref: implementationModel.id,
    availability: 'SUCCESS',
    evidence_class: 'OBSERVATIONAL',
    method: 'github-adapter:snapshot-import',
    provenance: input.provenance,
    source_revision: `git:${repository.head_sha}`,
    deployment_revision: null,
    window: null,
    subject_revision: null,
    confidence: { kind: 'QUALITATIVE', uncertainty_class: 'UNQUANTIFIED' },
    producer: {
      tool: 'sos-onboarding',
      tool_version: null,
      model: null,
      model_version: null,
      command: null,
      environment: null,
    },
  });

  const traceLinks: TraceLink[] = [
    createTraceLink({ source: mission.envelope.id, target: input.authority_ref, type: 'DERIVED_FROM', provenance: input.provenance }),
    createTraceLink({ source: systemState.envelope.id, target: mission.envelope.id, type: 'DERIVED_FROM', provenance: input.provenance }),
    createTraceLink({ source: implementationModel.id, target: mission.envelope.id, type: 'IMPLEMENTS', provenance: input.provenance }),
    createTraceLink({ source: connectionEvidence.id, target: systemState.envelope.id, type: 'OBSERVES', provenance: input.provenance }),
    createTraceLink({ source: importEvidence.id, target: implementationModel.id, type: 'OBSERVES', provenance: input.provenance }),
  ];

  return {
    mission,
    system_state: systemState,
    implementation_model: implementationModel,
    evidence: [connectionEvidence, importEvidence],
    trace_links: traceLinks,
  };
}

/**
 * Project the spine-bound journey result view model (the PERSISTED
 * step): the full ProductVmCore over the formalized mission, with the
 * exact repository revision shown and the honest connection view.
 */
export function projectGreenfieldResult(input: {
  result: GreenfieldJourneyResult;
  repository: ConnectedRepositoryInput;
  connection: OnboardingConnectionView;
  data_source: DataSource;
}): GreenfieldResultVm {
  const { result, repository, connection } = input;
  const evidenceRefs = [...result.evidence.map((record) => record.id)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const rationale: RationaleChain = buildRationaleChain({
    subject_id: result.mission.envelope.id,
    links: result.trace_links,
    evidence_refs: evidenceRefs,
  });
  const uncertainty: UncertaintyView = {
    uncertainty_class: 'UNQUANTIFIED',
    statement: 'The mission and its repository link are durable, but whether the mission SUCCEEDS is only ever evidence-gated — this journey formalizes the mission, it never certifies it.',
  };
  const nextAction: NextActionView = {
    action_id: 'greenfield-result-open-mission',
    kind: 'NAVIGATE',
    label: 'Open the mission view',
    description: 'The formalized mission and its linked repository revision are durable — continue in the mission view.',
    href: '/mission',
    rationale_ref: result.mission.envelope.id,
    requires_authority: null,
  };
  const core: ProductVmCore = {
    subject_id: result.mission.envelope.id,
    data_source: input.data_source,
    rationale,
    evidence_refs: evidenceRefs,
    uncertainty,
    authority: {
      mode: 'SUPERVISED',
      required_permission: ONBOARDING_CONFIRMATION_PERMISSION,
      grant_ref: null,
      note: 'The mission is a DRAFT artifact formalized under your explicit confirmation; activating or revising it requires the frozen REVISE permission.',
    },
    next_allowed_action: nextAction,
  };
  assertValidProductVmCore(core);
  return {
    core,
    mission_id: result.mission.envelope.id,
    system_state_id: result.system_state.envelope.id,
    system_state_version: result.system_state.envelope.version,
    implementation_model_id: result.implementation_model.id,
    linked_revision: {
      repository: `${repository.owner}/${repository.name}`,
      branch: repository.branch,
      sha: repository.head_sha,
    },
    repository_was_empty: repository.was_empty,
    connection,
  };
}
