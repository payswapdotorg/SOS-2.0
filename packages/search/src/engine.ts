/**
 * The candidate search engine (Work Order W7; spec/architecture.md §9;
 * the reference stack: "search/optimization engines implement
 * candidate-search contracts" — engines are REPLACEABLE reasoning
 * mechanisms, never authorities).
 *
 * THE CONTRACT: `CandidateSearchEngine` — a stable interface with swappable
 * implementations. Two ship here:
 *   - `createLadderSearchEngine` (the default): enforces the §10
 *     reasoning-altitude ladder — candidate generation STARTS at
 *     VALIDATED_COMPOSITION (the highest safe validated abstraction) and
 *     DESCENDS one rung at a time (validated package -> package adaptation
 *     -> architecture pattern -> novel architecture -> low-level
 *     synthesis) ONLY when the higher rung cannot satisfy mission +
 *     constraints; every descent is recorded with its justification; the
 *     result carries the altitude used and the full descent trace;
 *   - `createFixedAltitudeEngine`: a single-rung engine (a swappable
 *     alternative demonstrating the contract — e.g. a pattern-first
 *     engine); its trace starts at its own declared altitude.
 *
 * SHARED DISCIPLINE (both engines):
 *   - HARD CONSTRAINTS FILTER BEFORE EVALUATION: candidates are filtered
 *     by the typed machine-checkable hard-constraint set (consumed from
 *     mission-shaped views) BEFORE any evaluation ordering happens;
 *     UNCHECKED axes are surfaced, never conflated with satisfaction;
 *   - THE CANDIDATE SET IS DIVERSE AND NEVER COLLAPSED: family
 *     representatives always survive an optional maxCandidates cap;
 *   - EXPLORATION/EXPLOITATION IS EXPLICIT: the typed policy is REQUIRED
 *     (no implicit default); it orders and annotates the survivors — it
 *     never drops candidates;
 *   - UNCERTAINTY IS PRESERVED: every candidate carries its applicability
 *     estimate's uncertainty (class, sample size, calibrated probability
 *     with its §12 companions) through the result.
 */

import { ALTITUDE_RANK, RETRIEVAL_ALTITUDES } from '@sos-2/retrieval';
import type { EvidenceResolver, RetrievalAltitude } from '@sos-2/retrieval';
import type { ContextCondition } from '@sos-2/packages';
import { SearchError } from './errors.js';
import type { SearchCandidate } from './candidate.js';
import { assertValidSearchCandidate, searchCandidateFromContext } from './candidate.js';
import type { CandidateConstraintReport, HardConstraintSet } from './constraints.js';
import { assertValidHardConstraintSet, filterByHardConstraints } from './constraints.js';
import type { ExplorationPolicy, SelectionAnnotation } from './policy.js';
import { applyExplorationPolicy, assertValidExplorationPolicy } from './policy.js';
import type { LadderStep } from './ladder.js';
import { buildLadderTrace, descentJustification } from './ladder.js';
import type { RetrievalFacade } from '@sos-2/retrieval';

/** A search request. The policy is REQUIRED (explicit, never implicit). */
export interface SearchRequest {
  /** The semantic capability to search for (non-empty). */
  capability: string;
  /** The typed hard-constraint set (consumed from mission/value views). */
  constraints: HardConstraintSet;
  /** The EXPLICIT exploration/exploitation policy (required — no implicit default). */
  policy: ExplorationPolicy;
  /** Optional query context (matched against applicability estimates). */
  context?: ContextCondition;
  /** Optional required contracts. */
  contracts?: string[];
  /** Resolves evidence refs (passed through to retrieval). */
  evidenceResolver?: EvidenceResolver;
  /**
   * Predicted measures per candidate id (axis -> estimate), merged into
   * candidates BEFORE constraint filtering. Estimates are predictions, not
   * evaluation results.
   */
  estimates_by_id?: Record<string, Record<string, number>>;
  /** Optional cap on the returned set; family representatives always survive. */
  maxCandidates?: number;
}

/** A selected candidate: the candidate + policy annotation + constraint report. */
export interface SelectedCandidate {
  candidate: SearchCandidate;
  annotation: SelectionAnnotation;
  constraint_report: CandidateConstraintReport;
}

/** The result of a search. */
export interface SearchResult {
  /** The engine that produced the result. */
  engine: string;
  /** The request (verbatim). */
  request: SearchRequest;
  /** The altitude used (the highest rung with survivors), or null when nothing survived. */
  final_altitude: RetrievalAltitude | null;
  /** The full, justified descent trace (every rung considered, in ladder order). */
  ladder: LadderStep[];
  /** The diverse, policy-ordered candidate set (never a single winner). */
  candidates: SelectedCandidate[];
  /** Distinct families present in the result (sorted). */
  families_present: string[];
  /** All rungs the engine considered (ladder order). */
  altitudes_considered: RetrievalAltitude[];
  /** Total candidates rejected by hard constraints across all rungs. */
  total_rejected: number;
}

/** THE candidate-search contract (stable interface, swappable implementations). */
export interface CandidateSearchEngine {
  /** The engine's name (identity in results; provenance of the reasoning mechanism). */
  readonly name: string;
  /** Search for candidates (the diverse set, never a single winner). */
  search(request: SearchRequest): SearchResult;
}

/** A pluggable candidate generator for a ladder rung (a replaceable reasoning mechanism). */
export type CandidateGenerator = (request: SearchRequest) => SearchCandidate[];

/** Options of the default ladder engine. */
export interface LadderEngineOptions {
  /** The retrieval facade over the package/composition registry (required). */
  facade: RetrievalFacade;
  /** Generator for the ARCHITECTURE_PATTERN rung (optional). */
  patternSource?: CandidateGenerator;
  /** Generator for the NOVEL_ARCHITECTURE rung (optional). */
  novelSource?: CandidateGenerator;
  /** Generator for the LOW_LEVEL_SYNTHESIS rung (optional). */
  synthesisSource?: CandidateGenerator;
  /** Engine name (defaults to 'ladder-search'). */
  name?: string;
}

function assertValidSearchRequest(request: SearchRequest): void {
  if (typeof request !== 'object' || request === null) {
    throw new SearchError(`search request must be an object, received: ${JSON.stringify(request)}`);
  }
  if (typeof request.capability !== 'string' || request.capability.trim().length === 0) {
    throw new SearchError(
      `search request capability must be a non-empty string, received: ${JSON.stringify(request.capability)}`,
    );
  }
  assertValidHardConstraintSet(request.constraints);
  assertValidExplorationPolicy(request.policy);
  if (request.estimates_by_id !== undefined) {
    if (typeof request.estimates_by_id !== 'object' || request.estimates_by_id === null) {
      throw new SearchError('search request estimates_by_id must be an object of candidate id -> axis -> estimate');
    }
    for (const [candidateId, estimates] of Object.entries(request.estimates_by_id)) {
      if (candidateId.length === 0 || typeof estimates !== 'object' || estimates === null) {
        throw new SearchError(
          `search request estimates_by_id[${JSON.stringify(candidateId)}] must be an object of axis -> finite number`,
        );
      }
      for (const [axis, estimate] of Object.entries(estimates)) {
        if (axis.length === 0 || typeof estimate !== 'number' || !Number.isFinite(estimate)) {
          throw new SearchError(
            `search request estimates_by_id[${JSON.stringify(candidateId)}][${JSON.stringify(axis)}] must be a finite number, received: ${JSON.stringify(estimate)}`,
          );
        }
      }
    }
  }
  if (request.maxCandidates !== undefined && (!Number.isInteger(request.maxCandidates) || request.maxCandidates < 1)) {
    throw new SearchError(
      `search request maxCandidates must be a positive integer, received: ${JSON.stringify(request.maxCandidates)}`,
    );
  }
}

function mergeEstimates(candidate: SearchCandidate, request: SearchRequest): SearchCandidate {
  const extra = request.estimates_by_id?.[candidate.id];
  if (extra === undefined) {
    return candidate;
  }
  return { ...candidate, estimates: { ...candidate.estimates, ...extra } };
}

/** Cap the candidate list with a family-representative floor (mirrors the registry discipline). */
function capWithFamilyFloor(
  selected: SelectedCandidate[],
  maxCandidates: number,
): SelectedCandidate[] {
  if (selected.length <= maxCandidates) {
    return selected;
  }
  const seen = new Set<string>();
  const representatives: SelectedCandidate[] = [];
  const rest: SelectedCandidate[] = [];
  for (const entry of selected) {
    if (!seen.has(entry.candidate.family)) {
      seen.add(entry.candidate.family);
      representatives.push(entry);
    } else {
      rest.push(entry);
    }
  }
  return [...representatives, ...rest].slice(0, Math.max(maxCandidates, representatives.length));
}

function finalize(
  engineName: string,
  request: SearchRequest,
  ladder: LadderStep[],
  survivors: { candidate: SearchCandidate; report: CandidateConstraintReport }[],
  totalRejected: number,
): SearchResult {
  const trace = buildLadderTrace(ladder);
  const ordering = applyExplorationPolicy(survivors.map((entry) => entry.candidate), request.policy);
  const reports = new Map(survivors.map((entry) => [entry.candidate.id, entry.report]));
  let selected: SelectedCandidate[] = ordering.ordered.map(({ candidate, annotation }) => ({
    candidate,
    annotation,
    constraint_report: reports.get(candidate.id)!,
  }));
  if (request.maxCandidates !== undefined) {
    selected = capWithFamilyFloor(selected, request.maxCandidates);
  }
  return {
    engine: engineName,
    request,
    final_altitude: survivors.length > 0 ? survivors[0]!.candidate.altitude : null,
    ladder: trace,
    candidates: selected,
    families_present: [...new Set(selected.map((entry) => entry.candidate.family))].sort(),
    altitudes_considered: ladder.map((step) => step.altitude),
    total_rejected: totalRejected,
  };
}

/**
 * Create the default ladder search engine: §10 altitude discipline, hard
 * constraints before evaluation, explicit policy ordering, diversity
 * preserved. Registry rungs (validated composition / validated package /
 * package adaptation) come from the retrieval facade; the lower rungs
 * (architecture pattern / novel architecture / low-level synthesis) come
 * from the injected generators — pluggable reasoning mechanisms, never
 * authorities. Generator candidates MUST declare their rung's altitude
 * (mismatched altitudes are rejected loudly — the rung assignment is the
 * engine's authority).
 */
export function createLadderSearchEngine(options: LadderEngineOptions): CandidateSearchEngine {
  if (typeof options !== 'object' || options === null || typeof options.facade?.query !== 'function') {
    throw new SearchError(
      'the ladder engine requires a RetrievalFacade (the retrieval facade over the package/composition registry)',
    );
  }
  const name = options.name ?? 'ladder-search';
  const generators = new Map<RetrievalAltitude, CandidateGenerator>();
  if (options.patternSource !== undefined) {
    generators.set('ARCHITECTURE_PATTERN', options.patternSource);
  }
  if (options.novelSource !== undefined) {
    generators.set('NOVEL_ARCHITECTURE', options.novelSource);
  }
  if (options.synthesisSource !== undefined) {
    generators.set('LOW_LEVEL_SYNTHESIS', options.synthesisSource);
  }

  return {
    name,
    search(request: SearchRequest): SearchResult {
      assertValidSearchRequest(request);
      // The registry candidate set, queried ONCE (diversity shaping by the
      // registry authority), grouped by the typed §10 altitude.
      const context = options.facade.query({
        capability: request.capability,
        contracts: request.contracts,
        context: request.context,
        evidenceResolver: request.evidenceResolver,
      });
      const byAltitude = new Map<RetrievalAltitude, SearchCandidate[]>();
      const registryIds = new Set<string>();
      for (const candidate of context.candidates) {
        const searchCandidate = mergeEstimates(searchCandidateFromContext(candidate), request);
        registryIds.add(searchCandidate.id);
        const bucket = byAltitude.get(searchCandidate.altitude) ?? [];
        bucket.push(searchCandidate);
        byAltitude.set(searchCandidate.altitude, bucket);
      }

      // Gather generator candidates for the lower rungs (validated + altitude-matched).
      const generatedIds = new Set<string>();
      for (const [altitude, generator] of generators) {
        const generated = generator(request);
        const bucket = byAltitude.get(altitude) ?? [];
        for (const candidate of generated) {
          assertValidSearchCandidate(candidate);
          if (candidate.altitude !== altitude) {
            throw new SearchError(
              `generator for rung ${altitude} returned a candidate at ${candidate.altitude} (${candidate.id}) — ` +
                'the rung assignment is the engine\'s authority (a candidate may not misreport its altitude)',
            );
          }
          if (generatedIds.has(candidate.id) || registryIds.has(candidate.id)) {
            throw new SearchError(`duplicate candidate id: ${candidate.id} (ids are unique per search — registry and generated ids never collide)`);
          }
          generatedIds.add(candidate.id);
          bucket.push(mergeEstimates(candidate, request));
        }
        byAltitude.set(altitude, bucket);
      }

      // Walk the ladder from the top: filter by hard constraints at each
      // rung; stop at the first rung with survivors; record every descent.
      const ladder: LadderStep[] = [];
      let survivors: { candidate: SearchCandidate; report: CandidateConstraintReport }[] = [];
      let totalRejected = 0;
      for (let index = 0; index < RETRIEVAL_ALTITUDES.length; index += 1) {
        const altitude = RETRIEVAL_ALTITUDES[index]!;
        const rungCandidates = byAltitude.get(altitude) ?? [];
        const { survivors: rungSurvivors, rejected } = filterByHardConstraints(rungCandidates, request.constraints);
        totalRejected += rejected.length;
        const satisfied = rungSurvivors.length > 0;
        const step: LadderStep = {
          altitude,
          outcome: satisfied ? 'SATISFIED' : rungCandidates.length === 0 ? 'NO_CANDIDATES' : 'ALL_REJECTED_BY_CONSTRAINTS',
          candidates_considered: rungCandidates.length,
          candidates_surviving: rungSurvivors.length,
          rejected_ids: rejected.map((entry) => entry.candidate.id),
        };
        if (satisfied) {
          ladder.push(step);
          survivors = rungSurvivors;
          break;
        }
        const next = RETRIEVAL_ALTITUDES[index + 1];
        if (next !== undefined) {
          step.descent = {
            to: next,
            justification: descentJustification(
              altitude,
              next,
              step.outcome as 'NO_CANDIDATES' | 'ALL_REJECTED_BY_CONSTRAINTS',
              rungCandidates.length,
              step.rejected_ids,
              request.capability,
            ),
          };
        }
        ladder.push(step);
      }
      return finalize(name, request, ladder, survivors, totalRejected);
    },
  };
}

/** Options of the fixed-altitude engine. */
export interface FixedAltitudeEngineOptions {
  /** The single rung this engine searches at. */
  altitude: RetrievalAltitude;
  /** The candidate generator for the rung (required). */
  source: CandidateGenerator;
  /** Engine name (defaults to `fixed-<altitude>`). */
  name?: string;
}

/**
 * Create a single-rung engine — a swappable alternative implementation of
 * the contract (e.g. a pattern-first engine for architecture exploration
 * missions). The same shared discipline applies: constraints before
 * evaluation, explicit policy, uncertainty preserved; the trace starts at
 * the engine's declared altitude (one step, no descent).
 */
export function createFixedAltitudeEngine(options: FixedAltitudeEngineOptions): CandidateSearchEngine {
  if (typeof options !== 'object' || options === null) {
    throw new SearchError('fixed-altitude engine options must be an object { altitude, source, name? }');
  }
  if (!(options.altitude as string in ALTITUDE_RANK)) {
    throw new SearchError(
      `fixed-altitude engine requires a §10 retrieval altitude, received: ${JSON.stringify(options.altitude)}`,
    );
  }
  if (typeof options.source !== 'function') {
    throw new SearchError('fixed-altitude engine requires a candidate generator function');
  }
  const name = options.name ?? `fixed-${options.altitude.toLowerCase()}`;
  return {
    name,
    search(request: SearchRequest): SearchResult {
      assertValidSearchRequest(request);
      const generated = options.source(request);
      const rungCandidates: SearchCandidate[] = [];
      const seen = new Set<string>();
      for (const candidate of generated) {
        assertValidSearchCandidate(candidate);
        if (candidate.altitude !== options.altitude) {
          throw new SearchError(
            `fixed-${options.altitude} generator returned a candidate at ${candidate.altitude} (${candidate.id}) — the rung assignment is the engine's authority`,
          );
        }
        if (seen.has(candidate.id)) {
          throw new SearchError(`duplicate generated candidate id: ${candidate.id} (ids are unique per search)`);
        }
        seen.add(candidate.id);
        rungCandidates.push(mergeEstimates(candidate, request));
      }
      const { survivors, rejected } = filterByHardConstraints(rungCandidates, request.constraints);
      const satisfied = survivors.length > 0;
      const step: LadderStep = {
        altitude: options.altitude,
        outcome: satisfied ? 'SATISFIED' : rungCandidates.length === 0 ? 'NO_CANDIDATES' : 'ALL_REJECTED_BY_CONSTRAINTS',
        candidates_considered: rungCandidates.length,
        candidates_surviving: survivors.length,
        rejected_ids: rejected.map((entry) => entry.candidate.id),
      };
      const trace = buildLadderTrace([step], { startingAltitude: options.altitude });
      const ordering = applyExplorationPolicy(survivors.map((entry) => entry.candidate), request.policy);
      const reports = new Map(survivors.map((entry) => [entry.candidate.id, entry.report]));
      let selected: SelectedCandidate[] = ordering.ordered.map(({ candidate, annotation }) => ({
        candidate,
        annotation,
        constraint_report: reports.get(candidate.id)!,
      }));
      if (request.maxCandidates !== undefined) {
        selected = capWithFamilyFloor(selected, request.maxCandidates);
      }
      return {
        engine: name,
        request,
        final_altitude: survivors.length > 0 ? options.altitude : null,
        ladder: trace,
        candidates: selected,
        families_present: [...new Set(selected.map((entry) => entry.candidate.family))].sort(),
        altitudes_considered: [options.altitude],
        total_rejected: rejected.length,
      };
    },
  };
}
