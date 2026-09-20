/**
 * STAGE 4 — Realization (Work Order W14).
 *
 * The APPROVED candidate -> a System State revision (through
 * @sos-2/system-state — the W2 exact-revision discipline, registered as
 * the root of a complete, queryable revision chain) + the declared
 * ArchitectureGraph hypothesis (through @sos-2/architecture — a versioned
 * projection over the realized state) + the observed ImplementationModel
 * (the W0.5 contract), bound by typed trace links REALIZES and IMPLEMENTS.
 *
 * AUTHORIZATION GATE (no silent autonomy): the stage REFUSES to realize a
 * candidate that the decision flow did not approve — an ASK without a
 * resolution, a REJECT, an EXPERIMENT or a GATHER_EVIDENCE outcome all
 * leave the candidate unapproved, and bypassing the authority is rejected
 * loudly (the negative-testable greenfield gate).
 *
 * IDENTITY NOTE (the declared-hypothesis discipline): the ArchitectureGraph
 * is DECLARED before the state revision is committed — it is the hypothesis
 * the realization is checked against. Its id is therefore content-addressed
 * by the spine over its DECLARATION address (mission + candidate + the
 * declared node/edge shape + the run provenance) and minted BEFORE the
 * SystemState exists (the spine's sanctioned explicit-id flow — the same
 * discipline as W2's fixture ids and @sos-2/packages' explicit-id path).
 * The pair is MUTUALLY CONSISTENT: the state's architecture_ref points at
 * the declared graph's id, and the graph's projects_system_state points at
 * the realized state's id — both directions machine-verified by
 * assertRealizationRevision (exported for the negative tests).
 */

import { buildGraphContent } from '@sos-2/architecture';
import type { ArchitectureGraphArtifact, BuildEdgeInput, BuildNodeInput } from '@sos-2/architecture';
import type { CompositionBinding, CompositionMember } from '@sos-2/composition';
import type { ImplementationModel } from '@sos-2/semantic-spine';
import { assertValidArchitectureGraphArtifact } from '@sos-2/architecture';
import {
  createSystemState,
  createSystemStateStore,
} from '@sos-2/system-state';
import type { SystemStateArtifact } from '@sos-2/system-state';
import {
  createEnvelope,
  createTraceLink,
  deriveDeterministicArtifactId,
} from '@sos-2/semantic-spine';
import type { TraceLink } from '@sos-2/semantic-spine';
import type {
  GreenfieldRealizationPlan,
  GreenfieldRunContext,
} from '../context.js';
import { GreenfieldError } from '../errors.js';
import type { CandidateStageRecord } from './candidate.js';
import type { DecisionStageRecord } from './decision.js';
import type { MissionStageRecord } from './mission.js';

/** The binding-kind -> graph-edge-kind projection (deterministic, documented). */
export const BINDING_EDGE_KINDS: Readonly<Record<CompositionBinding['kind'], string>> = {
  PROVIDES_TO: 'Provides',
  CONSUMES_FROM: 'Consumes',
  CONFIGURES: 'Constrains',
  DATA_FLOW: 'Dependency',
  CONTROL_FLOW: 'Dependency',
};

function nodeIdSanitize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '') || 'node';
}

function componentIdOf(role: string): string {
  return `component:${nodeIdSanitize(role)}`;
}

function interfaceIdOf(contract: string): string {
  return `iface:${nodeIdSanitize(contract)}`;
}

/** The typed stage record of realization (plain JSON, spine-traceable). */
export interface RealizationStageRecord {
  stage: 'REALIZATION';
  /** The realized System State revision (root v1, ACTIVE, exact revisions). */
  system_state: SystemStateArtifact;
  /** The declared ArchitectureGraph hypothesis (explicit declared id, ACTIVE). */
  architecture_graph: ArchitectureGraphArtifact;
  /** The observed ImplementationModel (the realized implementation, exact revision). */
  implementation_model: ImplementationModel;
  /** The exact source revision the realization was built from. */
  revision: string;
  /** The complete, queryable revision chain of the realized state (root -> head). */
  revision_chain: { id: string; version: number; status: string }[];
  /**
   * The stage's trace links: the SystemState REALIZES the approved
   * candidate and its declared architecture; the ImplementationModel
   * IMPLEMENTS the declared architecture.
   */
  links: TraceLink[];
}

export interface RealizationStageInput {
  mission_stage: MissionStageRecord;
  candidate_stage: CandidateStageRecord;
  decision_stage: DecisionStageRecord;
  plan: GreenfieldRealizationPlan;
  run: GreenfieldRunContext;
}

/**
 * Assert the realization revision discipline (exported for the negative
 * tests): both artifacts are contract-valid, the state is registered in a
 * complete revision chain (root v1), and the state <-> graph references
 * are MUTUALLY CONSISTENT (the state's architecture_ref points at the
 * declared graph; the graph's projects_system_state points at the state).
 */
export function assertRealizationRevision(realization: {
  system_state: SystemStateArtifact;
  architecture_graph: ArchitectureGraphArtifact;
}): void {
  const { system_state, architecture_graph } = realization;
  if (system_state.envelope.kind !== 'SystemState' || system_state.envelope.status !== 'ACTIVE') {
    throw new GreenfieldError(
      'the realization must produce an ACTIVE SystemState revision — a realization without a System State revision is REJECTED',
    );
  }
  if (architecture_graph.envelope.kind !== 'ArchitectureGraph') {
    throw new GreenfieldError('the realization must declare an ArchitectureGraph hypothesis');
  }
  if (system_state.content.architecture_ref.artifact_id !== architecture_graph.envelope.id) {
    throw new GreenfieldError(
      `the realized SystemState's architecture_ref (${system_state.content.architecture_ref.artifact_id}) ` +
        `does not point at the declared ArchitectureGraph (${architecture_graph.envelope.id}) — the realization pair is inconsistent`,
    );
  }
  const projected = architecture_graph.content.projects_system_state;
  if (projected.system_state_id !== system_state.envelope.id || projected.version !== system_state.envelope.version) {
    throw new GreenfieldError(
      `the declared ArchitectureGraph projects SystemState ${projected.system_state_id} v${String(projected.version)}, ` +
        `but the realized revision is ${system_state.envelope.id} v${String(system_state.envelope.version)} — the realization pair is inconsistent`,
    );
  }
  const store = createSystemStateStore([system_state]);
  const history = store.history(system_state.envelope.id);
  if (history.length !== 1 || history[0]!.envelope.id !== system_state.envelope.id) {
    throw new GreenfieldError(
      'the realized SystemState revision is not a complete, queryable revision chain root — ' +
        'a realization without a System State revision is REJECTED',
    );
  }
}

/** Run the realization stage. Deterministic and pure. */
export function runRealizationStage(input: RealizationStageInput): RealizationStageRecord {
  const { mission_stage, candidate_stage, decision_stage, plan, run } = input;

  if (!decision_stage.approved) {
    throw new GreenfieldError(
      `realization REFUSED: the decision flow produced ${JSON.stringify(decision_stage.action)} without an approval ` +
        'for the candidate — realizing an unapproved candidate would bypass the human decision flow ' +
        '(spec/architecture-lock.md "no silent autonomy"); the candidate is NOT realized',
    );
  }

  const mission = mission_stage.mission;
  const candidate = candidate_stage.candidate;
  const members: CompositionMember[] = candidate.content.members;
  const bindings: CompositionBinding[] = candidate.content.bindings;

  const authorizingDecision =
    decision_stage.resolution ?? decision_stage.record;

  // --- The declared architecture graph (nodes/edges derived from the
  // --- approved candidate + the realization plan) -------------------------
  const capabilityNodeId = `capability:${nodeIdSanitize(candidate_stage.capability)}`;
  const deploymentNodeId = `deploy:${nodeIdSanitize(plan.environment)}`;

  const nodes: BuildNodeInput[] = [
    { id: capabilityNodeId, kind: 'Capability', criticality: 'critical', attributes: { capability: candidate_stage.capability } },
    { id: deploymentNodeId, kind: 'Deployment', attributes: { environment: plan.environment } },
  ];
  for (const member of members) {
    nodes.push({
      id: componentIdOf(member.role),
      kind: 'Component',
      attributes: { role: member.role, package: member.package_id },
    });
    for (const contract of member.bound_contracts) {
      nodes.push({ id: interfaceIdOf(contract), kind: 'Interface', attributes: { contract } });
    }
  }
  const edges: BuildEdgeInput[] = [];
  for (const member of members) {
    edges.push({
      source: componentIdOf(member.role),
      target: capabilityNodeId,
      kind: 'Realizes',
    });
    edges.push({
      source: componentIdOf(member.role),
      target: deploymentNodeId,
      kind: 'DeploysTo',
    });
    for (const contract of member.bound_contracts) {
      edges.push({
        source: componentIdOf(member.role),
        target: interfaceIdOf(contract),
        kind: 'Provides',
      });
    }
  }
  for (const binding of bindings) {
    edges.push({
      source: componentIdOf(binding.source_role),
      target: componentIdOf(binding.target_role),
      kind: BINDING_EDGE_KINDS[binding.kind],
    });
  }

  // The declared-hypothesis identity: content-addressed over the DECLARATION
  // address (mission + candidate + the declared shape + the run), minted
  // BEFORE the state revision exists (the spine's sanctioned explicit-id
  // flow — see the module doc).
  const declarationAddress = {
    work_order: 'W14',
    mission: mission.envelope.id,
    candidate: candidate.envelope.id,
    provenance: [...run.provenance],
    declared: {
      nodes: nodes.map((node) => node.id).sort(),
      edges: edges.map((edge) => `${edge.source}->${edge.target}->${edge.kind}`).sort(),
    },
  };
  const declaredGraphId = deriveDeterministicArtifactId('ArchitectureGraph', declarationAddress);

  // --- The observed implementation model (the realized implementation) ---
  // The components declare which declared nodes they (partially) REALIZE
  // (the W0.5 ImplementationModel contract): each member component realizes
  // its own Component node, the shared Capability node, its Interface nodes
  // and the Deployment node — the classifier maps these to
  // PRESERVING_REFINEMENT findings (the declared nodes are realized by
  // refinement components).
  const realizesOf = (member: CompositionMember): string[] => [
    componentIdOf(member.role),
    capabilityNodeId,
    deploymentNodeId,
    ...member.bound_contracts.map((contract) => interfaceIdOf(contract)),
  ];
  const implementationModelContent = {
    revision: plan.revision,
    components: [
      ...members.map((member) => ({
        id: componentIdOf(member.role),
        kind: 'service',
        realized_by: [`src/${nodeIdSanitize(member.role)}/index.ts`],
        realizes: realizesOf(member),
      })),
      {
        // Supporting glue every real implementation carries; undeclared in
        // the architecture hypothesis -> classified IMPLEMENTATION_DETAIL by
        // the reconciliation stage (the documented default policy).
        id: 'component:observability-glue',
        kind: 'library',
        realized_by: ['src/observability/glue.ts'],
        realizes: [],
      },
    ],
    source_artifacts: [
      ...members.map((member) => ({
        path: `src/${nodeIdSanitize(member.role)}/index.ts`,
        revision: plan.revision,
      })),
      { path: 'src/observability/glue.ts', revision: plan.revision },
    ],
    interfaces: members.flatMap((member) =>
      member.bound_contracts.map((contract) => ({
        id: interfaceIdOf(contract),
        provider: componentIdOf(member.role),
        contract_ref: contract,
        consumers: [],
      })),
    ),
    dependencies: edges.map((edge) => ({
      source: edge.source,
      target: edge.target,
      // The realized implementation's normalized dependency graph mirrors the
      // declared wiring: the edge kinds are the declared graph's registered
      // kinds verbatim (they pass the conformance normalization unchanged).
      kind: edge.kind,
    })),
    tests: [
      ...members.map((member) => ({
        id: `test:${componentIdOf(member.role)}`,
        subject: componentIdOf(member.role),
        framework: 'vitest',
      })),
      { id: 'test:greenfield-pipeline', subject: capabilityNodeId, framework: 'vitest' },
    ],
    builds: [
      {
        id: 'build:greenfield-realization',
        source_revision: plan.revision,
        outputs: ['dist/'],
        reproducible: true,
      },
    ],
    deployments: plan.deployment.map((deployment) => ({
      id: deployment.deployment_id,
      build_id: 'build:greenfield-realization',
      environment: deployment.environment,
      revision: deployment.revision.value,
    })),
    runtime_mappings: members.map((member) => ({
      id: `runtime:${nodeIdSanitize(member.role)}`,
      component: componentIdOf(member.role),
      runtime_ref: `service://${nodeIdSanitize(member.role)}`,
      environment: plan.environment,
    })),
  };
  const implementationModelId = deriveDeterministicArtifactId('ImplementationModel', implementationModelContent);
  const implementationModel: ImplementationModel = {
    id: implementationModelId,
    ...implementationModelContent,
  };

  // --- The System State revision (W2 exact-revision discipline) ----------
  let systemState: SystemStateArtifact;
  try {
    systemState = createSystemState({
      content: {
        architecture_ref: { artifact_id: declaredGraphId, version: 1 },
        implementation: [
          { artifact_id: implementationModelId, revision: { kind: 'git-sha', value: plan.revision } },
        ],
        configuration: plan.configuration.map((entry) => structuredClone(entry)),
        deployment: plan.deployment.map((entry) => structuredClone(entry)),
        policy: plan.policy.map((entry) => structuredClone(entry)),
        environment_relationships: plan.environment_relationships.map((entry) => structuredClone(entry)),
        active_experiments: [],
        package_realizations: members.map((member) => ({
          package_id: member.package_id,
          version: candidate_stage.member_versions.find((entry) => entry.package_id === member.package_id)?.version ?? '1',
          realized_by: [componentIdOf(member.role)],
        })),
      },
      provenance: [...run.provenance, 'W14:greenfield:realization'],
      created_at: run.t_realization,
      status: 'ACTIVE',
      authority_ref: authorizingDecision.envelope.id,
    });
  } catch (cause) {
    throw new GreenfieldError(`system state creation failed against the W2 contract: ${(cause as Error).message}`, {
      cause,
    });
  }

  // --- The declared ArchitectureGraph artifact (explicit declared id) -----
  let graphContent: ReturnType<typeof buildGraphContent>;
  let architectureGraph: ArchitectureGraphArtifact;
  try {
    graphContent = buildGraphContent({
      projects_system_state: { system_state_id: systemState.envelope.id, version: systemState.envelope.version },
      nodes,
      edges,
    });
    architectureGraph = {
      envelope: createEnvelope({
        id: declaredGraphId,
        kind: 'ArchitectureGraph',
        version: 1,
        status: 'ACTIVE',
        authority_ref: mission.envelope.id,
        provenance: [...run.provenance, 'W14:greenfield:declared-architecture'],
        created_at: run.t_realization,
        supersedes: null,
      }),
      content: graphContent,
    };
    assertValidArchitectureGraphArtifact(architectureGraph);
  } catch (cause) {
    throw new GreenfieldError(`the declared architecture graph is invalid: ${(cause as Error).message}`, { cause });
  }

  // --- The revision chain (R7: versioned, complete, queryable) -----------
  const store = createSystemStateStore([systemState]);
  const revisionChain = store.history(systemState.envelope.id).map((artifact) => ({
    id: artifact.envelope.id,
    version: artifact.envelope.version,
    status: artifact.envelope.status,
  }));

  // --- The realization revision discipline (machine-checked) -------------
  assertRealizationRevision({ system_state: systemState, architecture_graph: architectureGraph });

  // --- The stage's trace links --------------------------------------------
  const stageProvenance = [...run.provenance, 'W14:greenfield:realization'];
  const links: TraceLink[] = [
    createTraceLink({
      source: systemState.envelope.id,
      target: candidate.envelope.id,
      type: 'REALIZES',
      provenance: [...stageProvenance],
    }),
    createTraceLink({
      source: systemState.envelope.id,
      target: architectureGraph.envelope.id,
      type: 'REALIZES',
      provenance: [...stageProvenance],
    }),
    createTraceLink({
      source: implementationModel.id,
      target: architectureGraph.envelope.id,
      type: 'IMPLEMENTS',
      provenance: [...stageProvenance],
    }),
  ];

  return {
    stage: 'REALIZATION',
    system_state: systemState,
    architecture_graph: architectureGraph,
    implementation_model: implementationModel,
    revision: plan.revision,
    revision_chain: revisionChain,
    links,
  };
}
