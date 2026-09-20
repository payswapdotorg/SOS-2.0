/**
 * Retrieval — queries and results for the package/composition registry
 * (Work Order W6 goal: "retrieval returns uncertainty and evidence context").
 *
 * Every retrieval result carries, per candidate:
 *   - the typed ALTITUDE (spec/architecture.md §10, see altitude.ts);
 *   - UNCERTAINTY: the best context-matching applicability estimate's
 *     uncertainty class, plus the calibrated probability (with sample size,
 *     window, calibration ref) when the best estimate is calibrated —
 *     NEVER a bare score; when no estimate matches the query context the
 *     candidate is returned honestly as UNQUANTIFIED with an explicit
 *     basis (distinct states are never conflated);
 *   - EVIDENCE CONTEXT: resolved class counts, successes/failures, and the
 *     unresolved count (refs that did not resolve are counted as
 *     unresolved — never as zero evidence);
 *   - LEARNED LIMITATIONS (verbatim from the entry);
 *   - FAILURE CONTEXTS: the retained failure refs with the resolved
 *     records' truth states, windows and subject revisions (unresolved
 *     failure refs are marked UNAVAILABLE — a gap is data about missing
 *     data, never absence-of-failure);
 *   - the declared DIVERSITY family and dimension stances.
 *
 * DIVERSITY PRESERVATION (spec/architecture.md §11; the lock forbids a
 * "universal package winner replacing a diverse repertoire"): the candidate
 * set is NEVER collapsed to one winner — every matching family's best
 * candidate is ALWAYS included (family representatives), with optional
 * per-family and total caps that can never remove a family's sole
 * representative. There is no single-winner API.
 */

import type { EvidenceTruthState, PackageMaturity } from '@sos-2/semantic-spine';
import type { TimeWindow } from '@sos-2/provenance';
import type { EvidenceRecordW3, UncertaintyClass } from '@sos-2/evidence';
import type {
  ApplicabilityEstimate,
  AssuranceObligation,
  ContextCondition,
  DiversityDimensionStance,
  PackageRealization,
} from '@sos-2/packages';
import { bestEstimateForContext, calibratedProbability, summarizeEvidenceSet } from '@sos-2/packages';
import type { CompositionBinding, CompositionMember, JustifiedCombinedProbability } from '@sos-2/composition';
import { altitudeOfEntry } from './altitude.js';
import type { RegistryEntryKind, RetrievalAltitude } from './altitude.js';
import { RegistryError } from './errors.js';

/** Resolves evidence ids to records (typically backed by the W3 EvidenceGraph). */
export type EvidenceResolver = (id: string) => EvidenceRecordW3 | undefined;

/** A retrieval query. */
export interface RetrievalQuery {
  /** The semantic capability to search for (matched as a case-insensitive substring). */
  capability: string;
  /** Optional required contracts — candidates must realize ALL of them. */
  contracts?: string[];
  /** Optional query context — applicability estimates are matched against it. */
  context?: ContextCondition;
  /**
   * Resolves evidence refs for the result evidence context. When absent,
   * evidence classes are honestly reported as unresolved (never zero).
   */
  evidenceResolver?: EvidenceResolver;
  /** Maximum candidates per declared family (default 3; never removes a family's sole representative). */
  maxPerFamily?: number;
  /** Maximum total candidates (default unlimited; never removes family representatives). */
  maxResults?: number;
}

/** Evidence context of a candidate (resolved where possible; honest otherwise). */
export interface EvidenceContext {
  /** Total cited evidence refs. */
  total_refs: number;
  /** Refs resolved through the resolver. */
  resolved: number;
  /** Refs that did not resolve (distinct from zero evidence). */
  unresolved: number;
  /** Class counts of the RESOLVED records (the 8 package evidence classes). */
  classes: Partial<Record<string, number>>;
  /** Availability counts of the resolved records (the 6 distinct truth states). */
  availability: Partial<Record<string, number>>;
  /** Resolved records with availability SUCCESS. */
  successes: number;
  /** Resolved records with availability FAILURE. */
  failures: number;
}

/** The uncertainty of a candidate for a query (never a bare score). */
export interface CandidateUncertainty {
  /** The uncertainty class of the best matching estimate (UNQUANTIFIED when none matches). */
  uncertainty_class: UncertaintyClass;
  /** Present iff the best matching estimate is calibrated. */
  probability?: {
    value: number;
    sample_size: number;
    window: TimeWindow;
    calibration_ref: string;
  };
  /** How the uncertainty was determined (distinct bases are never conflated). */
  basis: 'MATCHED_ESTIMATE' | 'NO_MATCHING_ESTIMATE' | 'NO_QUERY_CONTEXT';
}

/** A retained failure context. */
export interface FailureContext {
  /** The failure evidence ref (retained verbatim). */
  ref: string;
  /** Availability of the resolved record; UNAVAILABLE when the ref did not resolve (a gap is data about missing data). */
  availability: EvidenceTruthState;
  /** The record's observation window, or null. */
  window: TimeWindow | null;
  /** The subject revision the failure reflects, or null. */
  subject_revision: string | null;
}

/** One retrieval candidate (a typed view of a current, retrievable entry). */
export interface RetrievalCandidate {
  /** Entry kind. */
  kind: RegistryEntryKind;
  /** Spine artifact id of the chain head. */
  id: string;
  /** Envelope version of the chain head. */
  version: number;
  /** The semantic capability (verbatim). */
  semantic_capability: string;
  /** Contracts the entry realizes. */
  contracts: string[];
  /** Maturity of the chain head. */
  maturity: PackageMaturity;
  /** The typed retrieval altitude (§10). */
  altitude: RetrievalAltitude;
  /** Declared solution family (diversity grouping). */
  family: string;
  /** Declared behavioral dimension stances. */
  dimensions: DiversityDimensionStance[];
  /** ALL applicability estimates (verbatim; context-conditioned). */
  applicability: ApplicabilityEstimate[];
  /** Best estimate for the query context, or null when none matches. */
  best_estimate: ApplicabilityEstimate | null;
  /** The uncertainty view for the query (never a bare score). */
  uncertainty: CandidateUncertainty;
  /** The evidence context (resolved where possible). */
  evidence_context: EvidenceContext;
  /** Learned limitations (verbatim; may be empty). */
  learned_limitations: string[];
  /** Retained failure contexts. */
  failure_contexts: FailureContext[];
  /** Assurance obligations (verbatim). */
  assurance_obligations: AssuranceObligation[];
  /** For packages: the realizations (verbatim). */
  realizations: PackageRealization[];
  /** For compositions: members and bindings (verbatim). */
  members: CompositionMember[] | null;
  bindings: CompositionBinding[] | null;
  /** For compositions: the justified independence assessments (verbatim). */
  independence: JustifiedCombinedProbability[] | null;
  /** Whether the query context matched an applicability estimate (distinct from NO_QUERY_CONTEXT). */
  context_match: 'MATCHED' | 'UNMATCHED' | 'NO_QUERY_CONTEXT';
}

/** The result of a retrieval (the DIVERSE candidate set, ranked by altitude). */
export interface RetrievalResult {
  /** The query (verbatim). */
  query: RetrievalQuery;
  /** Ranked candidates: family representatives first (ranked), then the rest (ranked). */
  candidates: RetrievalCandidate[];
  /** Distinct declared families present in the candidate set (sorted). */
  families: string[];
  /** Candidate count per family. */
  family_counts: Record<string, number>;
  /** Distinct altitudes present (ladder order). */
  altitudes_present: RetrievalAltitude[];
  /** Entries matching the capability (+ contracts) filter before diversity shaping. */
  matched_count: number;
  /** Total current (non-superseded, non-retired, ACTIVE) entries in the registry. */
  total_current_entries: number;
}

const CLASS_RANK: Record<UncertaintyClass, number> = { STRONG: 0, MODERATE: 1, WEAK: 2, UNQUANTIFIED: 3 };

function contextMatchRank(match: RetrievalCandidate['context_match']): number {
  return match === 'MATCHED' ? 0 : match === 'NO_QUERY_CONTEXT' ? 1 : 2;
}

/**
 * The total, deterministic ranking comparator (documented):
 *   1. altitude rank (§10 ladder — validated composition first);
 *   2. context match (matched before unmatched when the query carries context);
 *   3. uncertainty quality (calibrated before qualitative; then STRONG >
 *      MODERATE > WEAK > UNQUANTIFIED);
 *   4. resolved evidence volume (more resolved evidence first);
 *   5. id ascending (final deterministic tiebreak).
 */
export function compareCandidates(a: RetrievalCandidate, b: RetrievalCandidate): number {
  const altitudeDelta = altitudeRankOf(a.altitude) - altitudeRankOf(b.altitude);
  if (altitudeDelta !== 0) {
    return altitudeDelta;
  }
  const matchDelta = contextMatchRank(a.context_match) - contextMatchRank(b.context_match);
  if (matchDelta !== 0) {
    return matchDelta;
  }
  const aCalibrated = a.uncertainty.probability !== undefined;
  const bCalibrated = b.uncertainty.probability !== undefined;
  if (aCalibrated !== bCalibrated) {
    return aCalibrated ? -1 : 1;
  }
  const classDelta = CLASS_RANK[a.uncertainty.uncertainty_class] - CLASS_RANK[b.uncertainty.uncertainty_class];
  if (classDelta !== 0) {
    return classDelta;
  }
  const evidenceDelta = b.evidence_context.resolved - a.evidence_context.resolved;
  if (evidenceDelta !== 0) {
    return evidenceDelta;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function altitudeRankOf(altitude: RetrievalAltitude): number {
  const ranks: Record<RetrievalAltitude, number> = {
    VALIDATED_COMPOSITION: 0,
    VALIDATED_PACKAGE: 1,
    PACKAGE_ADAPTATION: 2,
    ARCHITECTURE_PATTERN: 3,
    NOVEL_ARCHITECTURE: 4,
    LOW_LEVEL_SYNTHESIS: 5,
  };
  return ranks[altitude];
}

/** Normalize a capability string for matching (trim + lowercase). */
export function normalizeCapability(value: string): string {
  return value.trim().toLowerCase();
}

/** Does a candidate capability match a query capability (substring, case-insensitive)? */
export function capabilityMatches(candidateCapability: string, queryCapability: string): boolean {
  return normalizeCapability(candidateCapability).includes(normalizeCapability(queryCapability));
}

/** Build the evidence context view of an entry's refs through a resolver. */
export function buildEvidenceContext(
  refs: readonly string[],
  resolver: EvidenceResolver | undefined,
  resolvedRecords: readonly EvidenceRecordW3[],
): EvidenceContext {
  let resolved = 0;
  if (resolver !== undefined) {
    for (const ref of refs) {
      if (resolver(ref) !== undefined) {
        resolved += 1;
      }
    }
  }
  const summary = summarizeEvidenceSet(resolvedRecords);
  const classes: Partial<Record<string, number>> = {};
  for (const [key, value] of Object.entries(summary.classCounts)) {
    classes[key] = value;
  }
  const availability: Partial<Record<string, number>> = {};
  for (const [key, value] of Object.entries(summary.availabilityCounts)) {
    availability[key] = value;
  }
  return {
    total_refs: refs.length,
    resolved: resolver === undefined ? 0 : resolved,
    unresolved: refs.length - (resolver === undefined ? 0 : resolved),
    classes,
    availability,
    successes: summary.successes,
    failures: summary.failures,
  };
}

/** Build the uncertainty view for a candidate against a query context. */
export function buildCandidateUncertainty(
  estimates: readonly ApplicabilityEstimate[],
  queryContext: ContextCondition | undefined,
): { uncertainty: CandidateUncertainty; best: ApplicabilityEstimate | null; match: RetrievalCandidate['context_match'] } {
  if (queryContext === undefined) {
    // No query context: the first estimate's class (or UNQUANTIFIED); no
    // context-matching claim is made.
    const first = estimates[0];
    return {
      uncertainty: {
        uncertainty_class: first ? first.uncertainty_class : 'UNQUANTIFIED',
        basis: 'NO_QUERY_CONTEXT',
      },
      best: null,
      match: 'NO_QUERY_CONTEXT',
    };
  }
  const best = bestEstimateForContext(estimates, queryContext);
  if (best === null) {
    return {
      uncertainty: { uncertainty_class: 'UNQUANTIFIED', basis: 'NO_MATCHING_ESTIMATE' },
      best: null,
      match: 'UNMATCHED',
    };
  }
  const probability = calibratedProbability(best);
  const uncertainty: CandidateUncertainty =
    best.kind === 'CALIBRATED'
      ? {
          uncertainty_class: best.uncertainty_class,
          probability: {
            value: best.probability,
            sample_size: best.sample_size,
            window: best.window,
            calibration_ref: best.calibration_ref,
          },
          basis: 'MATCHED_ESTIMATE',
        }
      : { uncertainty_class: best.uncertainty_class, basis: 'MATCHED_ESTIMATE' };
  return { uncertainty, best, match: 'MATCHED' };
}

/** Build the failure-context view of an entry's failure refs through a resolver. */
export function buildFailureContexts(
  refs: readonly string[],
  resolver: EvidenceResolver | undefined,
): FailureContext[] {
  return refs.map((ref) => {
    const record = resolver?.(ref);
    if (record === undefined) {
      // Unresolved failure ref: UNAVAILABLE — a gap is data about missing
      // data, never absence-of-failure.
      return { ref, availability: 'UNAVAILABLE' as EvidenceTruthState, window: null, subject_revision: null };
    }
    return {
      ref,
      availability: record.availability,
      window: record.window,
      subject_revision: record.subject_revision,
    };
  });
}

/** The altitude of a candidate, derived from entry kind + maturity. */
export function candidateAltitude(kind: RegistryEntryKind, maturity: PackageMaturity): RetrievalAltitude {
  return altitudeOfEntry(kind, maturity);
}

/** Validate a retrieval query (throws RegistryError). */
export function assertValidRetrievalQuery(query: RetrievalQuery): void {
  if (typeof query !== 'object' || query === null) {
    throw new RegistryError('retrieval query must be an object');
  }
  if (typeof query.capability !== 'string' || query.capability.trim().length === 0) {
    throw new RegistryError(
      `query capability must be a non-empty string, received: ${JSON.stringify(query.capability)}`,
    );
  }
  if (query.contracts !== undefined) {
    if (!Array.isArray(query.contracts) || !query.contracts.every((entry) => typeof entry === 'string' && entry.length > 0)) {
      throw new RegistryError('query contracts must be an array of non-empty contract ids');
    }
  }
  if (query.maxPerFamily !== undefined && (!Number.isInteger(query.maxPerFamily) || query.maxPerFamily < 1)) {
    throw new RegistryError(`query maxPerFamily must be a positive integer, received: ${JSON.stringify(query.maxPerFamily)}`);
  }
  if (query.maxResults !== undefined && (!Number.isInteger(query.maxResults) || query.maxResults < 1)) {
    throw new RegistryError(`query maxResults must be a positive integer, received: ${JSON.stringify(query.maxResults)}`);
  }
}

/**
 * Shape the DIVERSE candidate set from ranked candidates (diversity
 * preservation — never one winner):
 *   - candidates are ranked by the TOTAL comparator (§10 ladder first);
 *   - `maxPerFamily` keeps the best-ranked members per declared family (the
 *     family's representative can never be capped away);
 *   - with NO `maxResults` the result is the capped list in pure rank
 *     order — the altitude ladder is honored monotonically in the sequence;
 *   - WITH `maxResults`, the family representatives are floored: they come
 *     first (in rank order) so truncation can NEVER remove a family's sole
 *     entry, then the remaining candidates follow in rank order.
 */
export function shapeDiverseCandidateSet(
  candidates: readonly RetrievalCandidate[],
  maxPerFamily: number,
  maxResults: number | undefined,
): { candidates: RetrievalCandidate[]; families: string[]; family_counts: Record<string, number> } {
  const ranked = [...candidates].sort(compareCandidates);
  // Per-family cap: the best-ranked members per family survive.
  const counts = new Map<string, number>();
  const capped: RetrievalCandidate[] = [];
  for (const candidate of ranked) {
    const count = counts.get(candidate.family) ?? 0;
    if (count >= maxPerFamily) {
      continue;
    }
    counts.set(candidate.family, count + 1);
    capped.push(candidate);
  }
  const familyCounts: Record<string, number> = {};
  for (const candidate of capped) {
    familyCounts[candidate.family] = (familyCounts[candidate.family] ?? 0) + 1;
  }
  const allFamilies = [...new Set(capped.map((candidate) => candidate.family))].sort();

  if (maxResults === undefined || capped.length <= maxResults) {
    // Pure rank order (the §10 ladder is honored monotonically).
    return { candidates: capped, families: allFamilies, family_counts: familyCounts };
  }

  // maxResults truncation with the representative floor: every family's
  // best-ranked candidate survives, then the rest in rank order.
  const seen = new Set<string>();
  const representatives: RetrievalCandidate[] = [];
  const rest: RetrievalCandidate[] = [];
  for (const candidate of capped) {
    if (!seen.has(candidate.family)) {
      seen.add(candidate.family);
      representatives.push(candidate);
    } else {
      rest.push(candidate);
    }
  }
  const shaped = [...representatives, ...rest].slice(0, Math.max(maxResults, representatives.length));
  const shapedCounts: Record<string, number> = {};
  for (const candidate of shaped) {
    shapedCounts[candidate.family] = (shapedCounts[candidate.family] ?? 0) + 1;
  }
  const shapedFamilies = [...new Set(shaped.map((candidate) => candidate.family))].sort();
  return { candidates: shaped, families: shapedFamilies, family_counts: shapedCounts };
}
