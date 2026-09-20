/**
 * Brownfield stage 4 — CANDIDATE EVOLUTION (W15).
 *
 * Search + optimization propose a bounded, invariant-preserving candidate
 * subgraph replacement:
 *   1. the merged W7 ladder search engine (@sos-2/search) runs the §10
 *      ladder over the retrieval facade with the mission-shaped hard
 *      constraints and a GREEDY (deterministic) exploration policy;
 *   2. the survivors are evaluated multi-objectively (@sos-2/optimization):
 *      non-dominated Pareto sorting (the front — never a single winner) and
 *      a MAP-Elites quality-diversity repertoire (per-cell elites; families
 *      never evict each other), with uncertainty CARRIED end-to-end;
 *   3. the deterministic selection rule picks the first Pareto-front
 *      candidate in canonical id order whose REGISTRY package backs a
 *      bounded REPLACE_COMPONENT LocalCandidate over the selected recovery
 *      hypothesis that PRESERVES every declared executable invariant
 *      (@sos-2/conformance checkInvariants over the APPLIED graph — a
 *      candidate violating an invariant is REJECTED and the next candidate
 *      is tried);
 *   4. the applied candidate architecture becomes a new ArchitectureGraph
 *      artifact and the W2 LocalCandidate is adapted into a CandidateState
 *      fixture through the merged W9 bridge (candidateStateFromLocalCandidate).
 *
 * Links:
 *   candidate architecture --DERIVED_FROM--> selected hypothesis
 *   CandidateState         --REFINES-->     candidate architecture
 *   CandidateState         --DERIVED_FROM--> selected package
 */

import { applyLocalCandidate, createArchitectureGraph } from '@sos-2/architecture';
import type { ArchitectureGraphArtifact, ArchitectureGraphContent, GraphDiff, LocalCandidate, BuildEdgeInput, GraphNode, GraphEdge, EvolutionOperation } from '@sos-2/architecture';
import { createLadderSearchEngine, hardConstraintsFromMission } from '@sos-2/search';
import type { SearchResult } from '@sos-2/search';
import { nonDominatedSort, MapElitesArchive } from '@sos-2/optimization';
import type { CarriedUncertainty, ParetoCandidate, ParetoResult, ObjectiveAxis } from '@sos-2/optimization';
import { checkInvariants } from '@sos-2/conformance';
import type { Invariant, InvariantCheckResult } from '@sos-2/conformance';
import { candidateStateFromLocalCandidate } from '@sos-2/experiments';
import type { CandidateStateFixture } from '@sos-2/experiments';
import type { RecoveryHypothesis } from '@sos-2/recovery';
import type { SystemStateArtifact } from '@sos-2/system-state';
import type { RetrievalFacade } from '@sos-2/retrieval';
import { deriveDeterministicArtifactId } from '@sos-2/semantic-spine';
import type { JsonValue } from '@sos-2/semantic-spine';
import { BrownfieldError } from './errors.js';
import type { BrownfieldLoopInput, BrownfieldObjective } from './input.js';
import type { EvolutionStageRecord } from './stages.js';
import { brownfieldTraceLink } from './trace.js';

/** Everything stage 4 produces. */
export interface EvolutionStageOutput {
  record: EvolutionStageRecord;
  search: SearchResult;
  pareto: ParetoResult;
  repertoire: {
    dimensions: Array<{ axis: string; edges: number[] }>;
    cells: number;
    families: string[];
    elites: Array<{ id: string; family: string; cell: number[] }>;
  };
  localCandidate: LocalCandidate;
  appliedContent: ArchitectureGraphContent;
  appliedDiff: GraphDiff;
  candidateArchitecture: ArchitectureGraphArtifact;
  candidateState: CandidateStateFixture;
  selectedPackageId: string;
  hypothesisId: string;
  /** The full invariant check results over the APPLIED candidate graph. */
  invariantCheckResults: InvariantCheckResult[];
}

/** The deterministic candidate selection rule (documented in the record). */
export const EVOLUTION_SELECTION_RULE =
  'first Pareto-front (rank 0) candidate in canonical id order with a REGISTRY package id whose bounded REPLACE_COMPONENT preserves every declared executable invariant (invariant-violating candidates are rejected in order)';

/** Render one invariant as a human-checkable string for LocalCandidate.invariants. */
export function invariantStatement(invariant: Invariant): string {
  switch (invariant.kind) {
    case 'REQUIRED_INTERFACE':
      return `REQUIRED_INTERFACE: every ${invariant.componentKind} provides interface ${invariant.interfaceId}`;
    case 'FORBIDDEN_DEPENDENCY':
      return `FORBIDDEN_DEPENDENCY: no ${invariant.fromKind} -> ${invariant.toKind} ${invariant.edgeKind ?? 'Dependency'} edge`;
    case 'LAYERING':
      return `LAYERING: ${invariant.layers.join(' <- ')}`;
    case 'DATA_OWNERSHIP':
      return 'DATA_OWNERSHIP: every data store has exactly one owning component';
  }
}

function objectivesOf(candidate: { id: string; family: string; estimates: Record<string, number> }, axes: BrownfieldObjective[]): { complete: boolean; objectives: Array<{ axis: ObjectiveAxis; direction: 'MINIMIZE' | 'MAXIMIZE'; value: number }> } {
  const objectives: Array<{ axis: ObjectiveAxis; direction: 'MINIMIZE' | 'MAXIMIZE'; value: number }> = [];
  let complete = true;
  for (const objective of axes) {
    const value = candidate.estimates[objective.axis];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      complete = false;
      continue;
    }
    objectives.push({ axis: objective.axis, direction: objective.direction, value });
  }
  return { complete, objectives };
}

/** Run the candidate evolution stage (deterministic, pure). */
export function runEvolutionStage(
  input: BrownfieldLoopInput,
  selectedHypothesis: RecoveryHypothesis,
  facade: RetrievalFacade,
  systemState: SystemStateArtifact,
  systemStateAnchor: string,
): EvolutionStageOutput {
  const engine = createLadderSearchEngine({ facade });
  let search: SearchResult;
  try {
    search = engine.search({
      capability: input.goal.capability,
      constraints: hardConstraintsFromMission({
        artifact_id: input.goal.mission_ref,
        constraints: input.goal.constraints,
      }),
      policy: { kind: 'GREEDY' },
      context: input.goal.query_context,
      estimates_by_id: input.goal.predicted_estimates,
    });
  } catch (cause) {
    throw new BrownfieldError('EVOLUTION_NO_EVALUABLE_CANDIDATES', `candidate search failed: ${(cause as Error).message}`);
  }
  if (search.candidates.length === 0) {
    throw new BrownfieldError(
      'EVOLUTION_NO_EVALUABLE_CANDIDATES',
      `the search engine returned no surviving candidates for capability "${input.goal.capability}" (ladder outcome: ${search.final_altitude ?? 'none'})`,
    );
  }

  // --- Multi-objective evaluation (Pareto front — never a single winner) ---
  const axes: ObjectiveAxis[] = input.goal.objective_axes.map((objective) => objective.axis);
  const paretoCandidates: ParetoCandidate[] = [];
  const carriedById = new Map<string, CarriedUncertainty>();
  for (const selected of search.candidates) {
    const candidate = selected.candidate;
    const { complete, objectives } = objectivesOf({ id: candidate.id, family: candidate.family, estimates: candidate.estimates }, input.goal.objective_axes);
    if (!complete || objectives.length !== input.goal.objective_axes.length) {
      continue; // no full objective vector for this candidate — not evaluable
    }
    const uncertainty = candidate.uncertainty;
    const carried: CarriedUncertainty =
      uncertainty.calibrated !== undefined && uncertainty.calibrated !== null
        ? {
            uncertainty_class: uncertainty.uncertainty_class,
            sample_size: uncertainty.sample_size,
            calibrated_probability: uncertainty.calibrated.probability,
            calibration_ref: uncertainty.calibrated.calibration_ref,
          }
        : {
            uncertainty_class: uncertainty.uncertainty_class,
            sample_size: uncertainty.sample_size,
          };
    carriedById.set(candidate.id, carried);
    paretoCandidates.push({ id: candidate.id, family: candidate.family, objectives, uncertainty: carried });
  }
  if (paretoCandidates.length === 0) {
    throw new BrownfieldError(
      'EVOLUTION_NO_EVALUABLE_CANDIDATES',
      'no search survivor carries a full predicted objective vector (goal.predicted_estimates must cover the objective axes for at least one candidate)',
    );
  }
  const pareto = nonDominatedSort(paretoCandidates);
  const frontZero = pareto.fronts[0];
  if (frontZero === undefined) {
    throw new BrownfieldError('EVOLUTION_NO_EVALUABLE_CANDIDATES', 'Pareto sorting produced an empty front');
  }

  // --- Quality-diversity repertoire (MAP-Elites; per-cell elites) ---
  const dimensions = Object.entries(input.goal.repertoire_edges).map(([axis, edges]) => ({ axis, edges }));
  const archive = new MapElitesArchive({ dimensions });
  const fitnessAxis = input.goal.fitness_axis;
  for (const candidate of paretoCandidates) {
    const behavior: Record<string, number> = {};
    let complete = true;
    for (const dimension of dimensions) {
      const value = candidate.objectives.find((objective) => objective.axis === dimension.axis)?.value;
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        complete = false;
        break;
      }
      behavior[dimension.axis] = value;
    }
    if (!complete) {
      continue;
    }
    const fitnessValue = candidate.objectives.find((objective) => objective.axis === fitnessAxis.axis)?.value;
    if (typeof fitnessValue !== 'number' || !Number.isFinite(fitnessValue)) {
      continue;
    }
    const fitness = fitnessAxis.direction === 'MINIMIZE' ? -fitnessValue : fitnessValue;
    try {
      archive.insert({ id: candidate.id, family: candidate.family, fitness, behavior, uncertainty: candidate.uncertainty });
    } catch {
      // defensive: a duplicate insertion is retained once
    }
  }
  const repertoire = {
    dimensions,
    cells: archive.cellsWithElites().length,
    families: archive.families(),
    elites: archive.cellsWithElites().map(({ cell, elite }) => ({ id: elite.id, family: elite.family, cell })),
  };

  // --- Deterministic bounded replacement over the selected hypothesis ---
  const baseGraph = selectedHypothesis.artifact;
  const target = input.goal.target_component;
  const targetNode = baseGraph.content.nodes.find((node) => node.id === target);
  if (targetNode === undefined) {
    throw new BrownfieldError(
      'EVOLUTION_TARGET_NOT_IN_HYPOTHESIS',
      `goal.target_component "${target}" is not a node of the selected recovery hypothesis ${baseGraph.envelope.id}`,
    );
  }
  const incidentEdges: GraphEdge[] = baseGraph.content.edges.filter((edge) => edge.source === target || edge.target === target);
  const bounded = {
    nodes: [target],
    edges: incidentEdges.map((edge) => ({ source: edge.source, target: edge.target, kind: edge.kind })),
  };
  const rewrite = (edge: GraphEdge): BuildEdgeInput => ({
    source: edge.source === target ? input.goal.replacement_id : edge.source,
    target: edge.target === target ? input.goal.replacement_id : edge.target,
    kind: edge.kind,
    criticality: edge.criticality,
    attributes: edge.attributes,
  });

  const invariantStrings = input.invariants.map((invariant) => invariantStatement(invariant));
  interface AppliedAttempt {
    local: LocalCandidate;
    appliedContent: ArchitectureGraphContent;
    appliedDiff: GraphDiff;
    packageId: string;
    family: string;
  }
  let appliedAttempt: AppliedAttempt | null = null;
  let invariantResults: InvariantCheckResult[] = [];
  let rejectionCount = 0;
  const orderedFront = [...frontZero.candidates].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const paretoCandidate of orderedFront) {
    const searchCandidate = search.candidates.find((selected) => selected.candidate.id === paretoCandidate.id)?.candidate;
    if (searchCandidate === undefined || searchCandidate.origin !== 'REGISTRY' || searchCandidate.retrieval === undefined) {
      continue; // only registry-backed packages back a package-adaptation replacement
    }
    const replacement: EvolutionOperation[] = [
      {
        op: 'REPLACE_COMPONENT',
        component: target,
        with: {
          id: input.goal.replacement_id,
          kind: input.goal.replacement_kind,
          criticality: targetNode.criticality,
          attributes: {
            'brownfield.replaced': target,
            'brownfield.replaced_by_package': paretoCandidate.id,
            'brownfield.package_family': paretoCandidate.family,
            'brownfield.capability': input.goal.capability,
          } satisfies Record<string, JsonValue>,
        },
        edges: incidentEdges.map((edge) => rewrite(edge)),
      },
    ];
    const local: LocalCandidate = {
      baseGraphRef: { graph_id: baseGraph.envelope.id, version: baseGraph.envelope.version },
      boundedSubgraph: bounded,
      replacement,
      invariants: invariantStrings,
      predictedEffects: [...input.goal.predicted_effects],
    };
    let applied: { content: ArchitectureGraphContent; diff: GraphDiff };
    try {
      applied = applyLocalCandidate(local, baseGraph);
    } catch {
      rejectionCount += 1;
      continue;
    }
    const results = checkInvariants(input.invariants, { nodes: applied.content.nodes, edges: applied.content.edges });
    if (results.some((result) => result.status === 'FAIL')) {
      rejectionCount += 1;
      invariantResults = results;
      continue;
    }
    appliedAttempt = {
      local,
      appliedContent: applied.content,
      appliedDiff: applied.diff,
      packageId: paretoCandidate.id,
      family: paretoCandidate.family,
    };
    invariantResults = results;
    break;
  }
  if (appliedAttempt === null) {
    throw new BrownfieldError(
      'EVOLUTION_NO_INVARIANT_PRESERVING_CANDIDATE',
      `no Pareto-front candidate produced an invariant-preserving bounded replacement (rejected: ${rejectionCount}) — candidate evolution refuses to violate the declared executable invariants`,
    );
  }

  // --- The candidate architecture artifact (new versioned hypothesis) ---
  const candidateArchitecture = createArchitectureGraph({
    projects_system_state: { system_state_id: systemStateAnchor, version: 1 },
    nodes: appliedAttempt.appliedContent.nodes,
    edges: appliedAttempt.appliedContent.edges,
    provenance: [
      ...input.provenance,
      'brownfield:candidate-evolution',
      `brownfield:base-hypothesis:${baseGraph.envelope.id}`,
      `brownfield:package:${appliedAttempt.packageId}`,
    ],
    created_at: input.now,
    authority_ref: input.authority_ref,
  });

  // --- The causal hypothesis id + the CandidateState bridge ---
  const hypothesisId = deriveDeterministicArtifactId('CausalHypothesis', {
    note: 'w15 brownfield causal hypothesis',
    statement: input.goal.hypothesis_statement,
    target: input.goal.target_component,
    replacement: input.goal.replacement_id,
    package: appliedAttempt.packageId,
  });
  const context: Record<string, JsonValue> = {
    environment: input.goal.query_context['environment'] ?? 'production',
    target_component: input.goal.target_component,
    replacement_component: input.goal.replacement_id,
    package_family: appliedAttempt.family,
  };
  const candidateState = candidateStateFromLocalCandidate(
    appliedAttempt.local,
    {
      provenance: [...input.provenance, 'brownfield:candidate-evolution', `brownfield:package:${appliedAttempt.packageId}`],
      created_at: input.now,
      authority_ref: input.authority_ref,
    },
    {
      causal_claim: true,
      confidence: null,
      hypothesis_ref: hypothesisId,
      base_subject_revision: `${systemState.envelope.id}@v${systemState.envelope.version}`,
      context,
    },
  );

  // --- Stage handoff links ---
  const links = [
    brownfieldTraceLink({
      source: candidateArchitecture.envelope.id,
      target: baseGraph.envelope.id,
      type: 'DERIVED_FROM',
      provenance: [...input.provenance, 'brownfield:stage:evolution'],
    }),
    brownfieldTraceLink({
      source: candidateState.envelope.id,
      target: candidateArchitecture.envelope.id,
      type: 'REFINES',
      provenance: [...input.provenance, 'brownfield:stage:evolution'],
    }),
    brownfieldTraceLink({
      source: candidateState.envelope.id,
      target: appliedAttempt.packageId,
      type: 'DERIVED_FROM',
      provenance: [...input.provenance, `brownfield:package-family:${appliedAttempt.family}`],
    }),
  ];

  const record: EvolutionStageRecord = {
    stage: 'EVOLUTION',
    input_refs: [baseGraph.envelope.id],
    output_refs: [candidateArchitecture.envelope.id, candidateState.envelope.id, appliedAttempt.packageId],
    links,
    search: {
      engine: search.engine,
      final_altitude: search.final_altitude,
      ladder: search.ladder,
      candidate_count: search.candidates.length,
      families: search.families_present,
    },
    pareto: {
      fronts: pareto.fronts.length,
      front_zero: orderedFront.map((candidate) => candidate.id),
      axes,
    },
    repertoire,
    selected_candidate_id: appliedAttempt.packageId,
    selected_package_id: appliedAttempt.packageId,
    selected_family: appliedAttempt.family,
    selection_rule: EVOLUTION_SELECTION_RULE,
    local_candidate: appliedAttempt.local,
    bounded,
    replacement: appliedAttempt.local.replacement,
    applied: {
      node_count: appliedAttempt.appliedContent.nodes.length,
      edge_count: appliedAttempt.appliedContent.edges.length,
      diff_size:
        appliedAttempt.appliedDiff.added_nodes.length +
        appliedAttempt.appliedDiff.removed_nodes.length +
        appliedAttempt.appliedDiff.added_edges.length +
        appliedAttempt.appliedDiff.removed_edges.length,
      diff: appliedAttempt.appliedDiff,
    },
    invariant_results: invariantResults.map((result) => ({ invariant: result.invariant, status: result.status })),
    candidate_state_id: candidateState.envelope.id,
    candidate_architecture_id: candidateArchitecture.envelope.id,
    carried_uncertainty: carriedById.get(appliedAttempt.packageId) ?? {
      uncertainty_class: 'UNQUANTIFIED',
      sample_size: 0,
    },
  };

  return {
    record,
    search,
    pareto,
    repertoire,
    localCandidate: appliedAttempt.local,
    appliedContent: appliedAttempt.appliedContent,
    appliedDiff: appliedAttempt.appliedDiff,
    candidateArchitecture,
    candidateState,
    selectedPackageId: appliedAttempt.packageId,
    hypothesisId,
    invariantCheckResults: invariantResults,
  };
}
