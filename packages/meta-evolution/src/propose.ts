/**
 * Meta-evolution stage 2 — META-PROPOSAL (W16).
 *
 * Candidate self-changes are generated THROUGH THE PACKAGE REGISTRY (R24
 * reuse — SOS internals consume the same package mechanism as everything
 * else): the injected registry is queried through @sos-2/retrieval's
 * RetrievalFacade with the meta context (R26 context-conditioned
 * applicability), each retrieved meta-strategy package backs the fixture's
 * change specs, and the resulting MetaChange proposals are minted as typed,
 * versioned spine artifacts (DERIVED_FROM the process revision and the
 * source package).
 *
 * Ranking is Pareto + QUALITY-DIVERSITY through @sos-2/optimization (R12
 * applied to internals): nonDominatedSort over the frozen §11 axes (the
 * FRONT, never a single winner) plus a MAP-Elites repertoire over §11
 * behavior axes (per-cell elites, families never evicted).
 *
 * R19 (liability memory): the proposal weight of each package is penalized
 * by its RECORDED TRANSFER FAILURES — weight = fitness / (1 + failures) —
 * read from the injected TransferStore. Failed proposals therefore reduce
 * future proposal probability, deterministically.
 */

import { RetrievalFacade } from '@sos-2/retrieval';
import type { SearchContext } from '@sos-2/retrieval';
import { MapElitesArchive, nonDominatedSort } from '@sos-2/optimization';
import type { CarriedUncertainty, ParetoCandidate, ParetoResult, TypedObjective } from '@sos-2/optimization';
import { createMetaChange } from './change.js';
import type { MetaChangeArtifact } from './change.js';
import { MetaEvolutionError } from './errors.js';
import type { MetaEvolutionInput, MetaChangeSpec } from './input.js';
import type { ProposalStageRecord } from './stages.js';
import { metaTraceLink } from './trace.js';
import { cloneParameters } from './parameters.js';
import type { MetaProcessArtifact } from './process.js';

export interface ProposalStageOutput {
  record: ProposalStageRecord;
  changes: MetaChangeArtifact[];
  searchContext: SearchContext;
  pareto: ParetoResult;
  /** Spec key -> minted MetaChange (fixture order preserved). */
  changesByKey: Map<string, MetaChangeArtifact>;
}

/** The R19 penalty: 1 / (1 + recorded transfer failures). */
export function failurePenalty(failureCount: number): number {
  return 1 / (1 + Math.max(0, failureCount));
}

/** Build the MetaChange content for one spec against a process revision (shared with the loop's lane probe). */
export function buildMetaChangeContent(
  input: MetaEvolutionInput,
  process: MetaProcessArtifact,
  spec: MetaChangeSpec,
): import('./change.js').MetaChangeContent {
  return {
    target_process_id: process.envelope.id,
    target_process_version: process.envelope.version,
    patch: structuredClone(spec.patch),
    intent: spec.intent,
    source_package_id: spec.package_id,
    predicted_effects: [...spec.predicted_effects],
    proposed_against: cloneParameters(process.content.parameters),
  };
}

/** Deterministic carried uncertainty from a retrieval candidate. */
function carriedUncertaintyOf(candidate: SearchContext['candidates'][number]): CarriedUncertainty {
  const probability = candidate.uncertainty.probability;
  if (probability !== undefined) {
    return {
      uncertainty_class: candidate.uncertainty.uncertainty_class,
      sample_size: probability.sample_size,
      calibrated_probability: probability.value,
      calibration_ref: probability.calibration_ref,
    };
  }
  return {
    uncertainty_class: candidate.uncertainty.uncertainty_class,
    sample_size: candidate.evidence_context.resolved,
  };
}

/** Run the meta-proposal stage (deterministic, pure). */
export function runProposalStage(input: MetaEvolutionInput, process: MetaProcessArtifact): ProposalStageOutput {
  // 1. Registry-driven retrieval (R24 + R26 through the merged authorities).
  const facade = new RetrievalFacade(input.registry);
  let searchContext: SearchContext;
  try {
    searchContext = facade.query({ capability: 'sos-process-strategy', context: input.meta_context });
  } catch (cause) {
    throw new MetaEvolutionError('PROPOSAL_STAGE_FAILED', `meta-strategy retrieval failed: ${(cause as Error).message}`);
  }
  const candidatesById = new Map(searchContext.candidates.map((candidate) => [candidate.id, candidate]));

  // 2. Mint the MetaChange proposals (fixture order; deterministic ids).
  const changes: MetaChangeArtifact[] = [];
  const changesByKey = new Map<string, MetaChangeArtifact>();
  const specById = new Map<string, MetaChangeSpec>();
  for (const spec of input.changes) {
    const retrieved = candidatesById.get(spec.package_id) ?? input.registry.current(spec.package_id);
    if (retrieved === undefined) {
      throw new MetaEvolutionError(
        'PROPOSAL_STAGE_FAILED',
        `change spec "${spec.key}" references package ${spec.package_id}, which is not registered in the injected registry`,
      );
    }
    const change = createMetaChange({
      content: buildMetaChangeContent(input, process, spec),
      provenance: [...input.provenance, 'meta-evolution:proposal', `meta-evolution:spec:${spec.key}`],
      created_at: input.now,
      authority_ref: input.authority_ref,
      status: 'ACTIVE',
    });
    changes.push(change);
    changesByKey.set(spec.key, change);
    specById.set(change.envelope.id, spec);
  }

  // 3. Pareto ranking (R12: the front, never a single winner) over the
  //    frozen §11 axes, with uncertainty carried verbatim.
  const axes = input.effectiveness.objective_axes;
  const paretoCandidates: ParetoCandidate[] = changes.map((change) => {
    const spec = specById.get(change.envelope.id);
    if (spec === undefined) {
      throw new MetaEvolutionError('PROPOSAL_STAGE_FAILED', `unreachable: spec resolved for change ${change.envelope.id}`);
    }
    const retrieved = candidatesById.get(spec.package_id);
    const objectives: TypedObjective[] = axes.map((axis) => ({
      axis: axis.axis,
      direction: axis.direction,
      value: spec.predicted_estimates[axis.axis] ?? 0,
    }));
    return {
      id: change.envelope.id,
      family: retrieved?.family ?? 'unresolved',
      objectives,
      uncertainty:
        retrieved === undefined
          ? { uncertainty_class: 'UNQUANTIFIED', sample_size: 0 }
          : carriedUncertaintyOf(retrieved),
    };
  });
  let pareto: ParetoResult;
  try {
    pareto = nonDominatedSort(paretoCandidates);
  } catch (cause) {
    throw new MetaEvolutionError('PROPOSAL_STAGE_FAILED', `pareto ranking failed: ${(cause as Error).message}`);
  }
  const rankOf = new Map<string, number>();
  for (const front of pareto.fronts) {
    for (const candidate of front.candidates) {
      rankOf.set(candidate.id, front.rank);
    }
  }

  // 4. Quality-diversity repertoire (MAP-Elites over §11 behavior axes).
  const dimensions = Object.entries(input.effectiveness.repertoire_edges).map(([axis, edges]) => ({ axis, edges: [...edges] }));
  let archive: MapElitesArchive;
  let cellOf = new Map<string, number[]>();
  try {
    archive = new MapElitesArchive({ dimensions });
    for (const change of changes) {
      const spec = specById.get(change.envelope.id);
      if (spec === undefined) {
        continue;
      }
      const retrieved = candidatesById.get(spec.package_id);
      archive.insert({
        id: change.envelope.id,
        family: retrieved?.family ?? 'unresolved',
        fitness: spec.fitness,
        behavior: { ...spec.behavior },
        uncertainty:
          retrieved === undefined
            ? { uncertainty_class: 'UNQUANTIFIED', sample_size: 0 }
            : carriedUncertaintyOf(retrieved),
      });
    }
    cellOf = new Map(archive.cellsWithElites().map(({ cell, elite }) => [elite.id, cell]));
  } catch (cause) {
    throw new MetaEvolutionError('PROPOSAL_STAGE_FAILED', `quality-diversity repertoire failed: ${(cause as Error).message}`);
  }

  // 5. R19 penalty-scaled proposal weights (failed transfers reduce
  //    proposal probability, deterministically).
  const weights = changes.map((change) => {
    const spec = specById.get(change.envelope.id);
    const failureCount = input.stores.transfer.failedTransfersFor(spec?.package_id ?? '').length;
    const weight = (spec?.fitness ?? 0) * failurePenalty(failureCount);
    return { change, spec, failureCount, weight };
  });
  const totalWeight = weights.reduce((sum, entry) => sum + entry.weight, 0);
  const proposals: ProposalStageRecord['proposals'] = weights.map((entry) => {
    const retrieved = entry.spec ? candidatesById.get(entry.spec.package_id) : undefined;
    return {
      change_id: entry.change.envelope.id,
      package_id: entry.spec?.package_id ?? '',
      family: retrieved?.family ?? 'unresolved',
      key: entry.spec?.key ?? '',
      pareto_rank: rankOf.get(entry.change.envelope.id) ?? -1,
      cell: cellOf.get(entry.change.envelope.id) ?? [],
      failure_count: entry.failureCount,
      weight: entry.weight,
      proposal_probability: totalWeight > 0 ? entry.weight / totalWeight : 0,
    };
  });

  // 6. The stage handoff links: each proposal DERIVED_FROM the process
  //    revision and its source package.
  const links = changes.flatMap((change) => {
    const spec = specById.get(change.envelope.id);
    if (spec === undefined) {
      return [];
    }
    return [
      metaTraceLink({
        source: change.envelope.id,
        target: process.envelope.id,
        type: 'DERIVED_FROM',
        provenance: [...input.provenance, 'meta-evolution:stage:proposal', `meta-evolution:spec:${spec.key}`],
      }),
      metaTraceLink({
        source: change.envelope.id,
        target: spec.package_id,
        type: 'DERIVED_FROM',
        provenance: [...input.provenance, 'meta-evolution:stage:proposal', `meta-evolution:package:${spec.package_id}`],
      }),
    ];
  });

  const record: ProposalStageRecord = {
    stage: 'PROPOSAL',
    input_refs: [process.envelope.id],
    output_refs: changes.map((change) => change.envelope.id),
    links,
    retrieval: {
      candidate_count: searchContext.candidates.length,
      families: [...searchContext.families],
      altitudes_present: [...searchContext.altitudes_present],
      matched_count: searchContext.matched_count,
    },
    pareto: {
      fronts: pareto.fronts.length,
      front_zero: [...pareto.fronts[0]?.candidates.map((candidate) => candidate.id) ?? []],
      axes: axes.map((axis) => axis.axis),
    },
    repertoire: {
      dimensions: dimensions.map((dimension) => ({ axis: dimension.axis, edges: [...dimension.edges] })),
      cells: archive.size,
      families: archive.families(),
    },
    proposals,
  };

  return { record, changes, searchContext, pareto, changesByKey };
}
