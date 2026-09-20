/**
 * The retrieval facade — the search-facing composition layer over
 * @sos-2/registry (Work Order W7: "Retrieval facade over @sos-2/registry —
 * the registry is the data authority; retrieval composes it into search
 * context").
 *
 * LAYERING (documented, no authority duplicated):
 *   - THE REGISTRY STAYS THE DATA AUTHORITY: the facade holds an INJECTED
 *     PackageRegistry; every query delegates to `registry.retrieve()`
 *     (altitude-ordered, diversity-preserving, honest-uncertainty retrieval
 *     — all owned by W6). The facade adds NO second registry, NO new
 *     ranking authority and NO evidence storage;
 *   - WHAT THE FACADAD ADDS: it composes registry results into SEARCH
 *     CONTEXT — a stable, search-facing candidate shape that surfaces, per
 *     candidate: the uncertainty view (verbatim, never stripped), the
 *     evidence context (resolved where possible, unresolved reported as
 *     unresolved — never zero), the learned limitations (verbatim) and the
 *     retained failure contexts (verbatim, UNAVAILABLE gaps included), plus
 *     — for compositions — the OWN-EVIDENCE view (own refs, members,
 *     justified independence assessments; member evidence never
 *     substitutes, a locked invariant surfaced as data);
 *   - DIVERSITY IS PRESERVED BY CONSTRUCTION: the facade returns whatever
 *     diverse candidate set the registry shaped (every matching family's
 *     best candidate present; no single-winner API exists here either).
 */

import {
  assertValidRetrievalQuery,
} from '@sos-2/registry';
import type {
  CandidateUncertainty,
  EvidenceContext,
  EvidenceResolver,
  FailureContext,
  PackageRegistry,
  RegistryEntryKind,
  RetrievalAltitude,
  RetrievalCandidate,
  RetrievalQuery,
  RetrievalResult,
} from '@sos-2/registry';
import type {
  ApplicabilityEstimate,
  AssuranceObligation,
  ContextCondition,
  DiversityDimensionStance,
  PackageRealization,
} from '@sos-2/packages';
import type { PackageMaturity } from '@sos-2/semantic-spine';
import type { CompositionBinding, CompositionMember, JustifiedCombinedProbability } from '@sos-2/composition';
import { RetrievalFacadeError } from './errors.js';

/** A facade query (delegates 1:1 to the registry's retrieval query). */
export interface ContextQuery {
  /** The semantic capability to search for (non-empty). */
  capability: string;
  /** Optional required contracts — candidates must realize ALL of them. */
  contracts?: string[];
  /** Optional query context — applicability estimates are matched against it. */
  context?: ContextCondition;
  /** Resolves evidence refs for evidence context; unresolved refs stay honest. */
  evidenceResolver?: EvidenceResolver;
  /** Maximum candidates per declared family (registry discipline; default 3). */
  maxPerFamily?: number;
  /** Maximum total candidates (registry discipline; representative floor). */
  maxResults?: number;
}

/**
 * The own-evidence view of a composition candidate (spec/architecture.md
 * §18 "Compositions require their own evidence"; the lock's "composition
 * probabilities multiplied without justified independence" and member
 * evidence substitution are forbidden — surfaced here as DATA).
 */
export interface CompositionOwnEvidenceView {
  /** The composition's spine id. */
  composition_id: string;
  /** The composition's OWN cited evidence refs (verbatim from the entry). */
  own_evidence_refs: string[];
  /** The member package ids (verbatim). */
  member_ids: string[];
  /** The recorded justified combined probabilities (verbatim; never unjustified). */
  independence: JustifiedCombinedProbability[];
  /** The locked invariant, surfaced: member evidence NEVER substitutes. */
  member_evidence_never_substitutes: true;
}

/** A search-context candidate: the registry view with search-facing fields surfaced. */
export interface ContextCandidate {
  /** Spine artifact id of the chain head. */
  id: string;
  /** Entry kind. */
  kind: RegistryEntryKind;
  /** Maturity of the chain head. */
  maturity: PackageMaturity;
  /** The typed retrieval altitude (§10 ladder — imported vocabulary). */
  altitude: RetrievalAltitude;
  /** The semantic capability (verbatim). */
  semantic_capability: string;
  /** Contracts the entry realizes. */
  contracts: string[];
  /** Declared solution family. */
  family: string;
  /** Declared behavioral dimension stances. */
  dimensions: DiversityDimensionStance[];
  /** ALL applicability estimates (verbatim; context-conditioned). */
  applicability: ApplicabilityEstimate[];
  /** Best estimate for the query context, or null. */
  best_estimate: ApplicabilityEstimate | null;
  /** The uncertainty view for the query (verbatim from the registry; never stripped). */
  uncertainty: CandidateUncertainty;
  /** The evidence context (surfaced). */
  evidence_context: EvidenceContext;
  /** Learned limitations (surfaced, verbatim). */
  learned_limitations: string[];
  /** Retained failure contexts (surfaced, verbatim; UNAVAILABLE gaps included). */
  failure_contexts: FailureContext[];
  /** Assurance obligations (verbatim). */
  assurance_obligations: AssuranceObligation[];
  /** Package realizations (packages only; empty otherwise). */
  realizations: PackageRealization[];
  /** Composition members (compositions only; null otherwise). */
  members: CompositionMember[] | null;
  /** Composition bindings (compositions only; null otherwise). */
  bindings: CompositionBinding[] | null;
  /** The composition own-evidence view (compositions only; null otherwise). */
  own_evidence: CompositionOwnEvidenceView | null;
  /** The FULL registry candidate, verbatim (the authority's view). */
  retrieval: RetrievalCandidate;
}

/** The composed search context of one query (the diverse candidate set, surfaced). */
export interface SearchContext {
  /** The query (verbatim). */
  query: ContextQuery;
  /** The diverse candidate set in registry rank order (altitude ladder first). */
  candidates: ContextCandidate[];
  /** Distinct declared families present (sorted). */
  families: string[];
  /** Candidate count per family. */
  family_counts: Record<string, number>;
  /** Distinct altitudes present (ladder order). */
  altitudes_present: RetrievalAltitude[];
  /** Entries matching the capability (+ contracts) filter before diversity shaping. */
  matched_count: number;
  /** Total current entries in the registry. */
  total_current_entries: number;
  /** The underlying registry result (verbatim, for advanced consumers). */
  registry_result: RetrievalResult;
}

function toRegistryQuery(query: ContextQuery): RetrievalQuery {
  // Conditional field assignment: the spine's canonical serialization
  // rejects undefined properties, and the registry echoes its query
  // verbatim — never inject explicit undefineds.
  const registryQuery: RetrievalQuery = { capability: query.capability };
  if (query.contracts !== undefined) {
    registryQuery.contracts = query.contracts;
  }
  if (query.context !== undefined) {
    registryQuery.context = query.context;
  }
  if (query.evidenceResolver !== undefined) {
    registryQuery.evidenceResolver = query.evidenceResolver;
  }
  if (query.maxPerFamily !== undefined) {
    registryQuery.maxPerFamily = query.maxPerFamily;
  }
  if (query.maxResults !== undefined) {
    registryQuery.maxResults = query.maxResults;
  }
  try {
    assertValidRetrievalQuery(registryQuery);
  } catch (cause) {
    throw new RetrievalFacadeError(`invalid context query: ${(cause as Error).message}`);
  }
  return registryQuery;
}

/**
 * The retrieval facade. In-memory, deterministic; the registry is injected
 * (the data authority) and every query delegates to it.
 */
export class RetrievalFacade {
  private readonly backingRegistry: PackageRegistry;

  constructor(registry: PackageRegistry) {
    if (typeof registry !== 'object' || registry === null || typeof registry.retrieve !== 'function') {
      throw new RetrievalFacadeError('RetrievalFacade requires a PackageRegistry instance (the data authority)');
    }
    this.backingRegistry = registry;
  }

  /** The injected registry (the data authority — no second one exists here). */
  get registry(): PackageRegistry {
    return this.backingRegistry;
  }

  /**
   * Query by capability (+ optional contracts, context, evidence resolver,
   * family caps). Delegates retrieval to the registry and composes the
   * result into search context: the diverse candidate set with uncertainty,
   * evidence context, learned limitations, failure contexts and composition
   * own-evidence views surfaced.
   */
  query(query: ContextQuery): SearchContext {
    const registryQuery = toRegistryQuery(query);
    const result = this.backingRegistry.retrieve(registryQuery);
    const candidates = result.candidates.map((candidate) => this.toContextCandidate(candidate));
    return {
      query,
      candidates,
      families: [...result.families],
      family_counts: { ...result.family_counts },
      altitudes_present: [...result.altitudes_present],
      matched_count: result.matched_count,
      total_current_entries: result.total_current_entries,
      registry_result: result,
    };
  }

  private toContextCandidate(candidate: RetrievalCandidate): ContextCandidate {
    let ownEvidence: CompositionOwnEvidenceView | null = null;
    if (candidate.kind === 'COMPOSITION') {
      ownEvidence = this.buildOwnEvidenceView(candidate);
    }
    return {
      id: candidate.id,
      kind: candidate.kind,
      maturity: candidate.maturity,
      altitude: candidate.altitude,
      semantic_capability: candidate.semantic_capability,
      contracts: [...candidate.contracts],
      family: candidate.family,
      dimensions: candidate.dimensions.map((stance) => ({ ...stance })),
      applicability: candidate.applicability.map((estimate) => structuredClone(estimate)),
      best_estimate: candidate.best_estimate === null ? null : structuredClone(candidate.best_estimate),
      uncertainty: structuredClone(candidate.uncertainty),
      evidence_context: structuredClone(candidate.evidence_context),
      learned_limitations: [...candidate.learned_limitations],
      failure_contexts: candidate.failure_contexts.map((context) => ({ ...context })),
      assurance_obligations: candidate.assurance_obligations.map((obligation) => ({ ...obligation })),
      realizations: candidate.realizations.map((realization) => ({ ...realization })),
      members: candidate.members === null ? null : candidate.members.map((member) => ({ ...member })),
      bindings: candidate.bindings === null ? null : candidate.bindings.map((binding) => structuredClone(binding)),
      own_evidence: ownEvidence,
      retrieval: structuredClone(candidate),
    };
  }

  /**
   * The own-evidence view of a composition candidate: its OWN cited refs
   * (fetched verbatim from the registered entry — the registry candidate
   * exposes only the evidence CONTEXT, so the refs are read from the
   * authority), its members, and its justified independence assessments.
   * Member evidence NEVER substitutes (locked invariant, surfaced as data).
   */
  private buildOwnEvidenceView(candidate: RetrievalCandidate): CompositionOwnEvidenceView {
    const entry = this.backingRegistry.get(candidate.id);
    if (entry === undefined) {
      throw new RetrievalFacadeError(
        `composition entry is no longer registered: ${candidate.id} (the registry is the data authority)`,
      );
    }
    if (entry.kind !== 'COMPOSITION') {
      throw new RetrievalFacadeError(`entry ${candidate.id} is not a composition (kind ${entry.kind})`);
    }
    const content = entry.artifact.content as import('@sos-2/composition').PackageCompositionContent;
    return {
      composition_id: candidate.id,
      own_evidence_refs: [...content.evidence_refs],
      member_ids: content.members.map((member) => member.package_id),
      independence: content.independence.map((assessment) => structuredClone(assessment)),
      member_evidence_never_substitutes: true,
    };
  }
}
