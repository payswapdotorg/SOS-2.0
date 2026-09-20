/**
 * Pareto multi-objective evaluation (spec/architecture.md §9: "Candidate
 * selection supports hard constraints, Pareto sets, uncertainty-aware
 * evaluation, contextual priors, quality-diversity repertoires and
 * deliberate exploration/exploitation. Never use a single global
 * architecture score as the sole authority."; requirement R12).
 *
 * NON-DOMINATED SORTING over typed objectives:
 *   - candidate A DOMINATES candidate B iff A is at least as good as B on
 *     EVERY objective and strictly better on at least one (weak dominance,
 *     the standard Pareto relation);
 *   - the result is the full ranked sequence of Pareto FRONTS (front 0 =
 *     the non-dominated set, front 1 = the non-dominated set of the
 *     remainder, ...). `paretoFrontOf` returns front 0 — THE FRONT, never a
 *     single winner: every mutually non-dominated candidate is returned,
 *     and every input candidate appears in exactly one front (the fronts
 *     PARTITION the input — nothing is discarded in a ranking collapse).
 *   - there is NO single-global-score API in this package (the lock forbids
 *     a single global architecture score as the sole authority; the result
 *     shape itself cannot express a winner);
 *   - UNCERTAINTY IS PRESERVED: every candidate MUST carry a CarriedUncertainty
 *     payload (applicability class, sample size, calibrated probability when
 *     calibrated); the payload rides through evaluation verbatim and is
 *     present on every result — results never collapse to point scores alone.
 *
 * COMPARABILITY (machine-enforced): dominance is defined only over a COMMON
 * objective space — every candidate in one sort must declare the SAME axis
 * set with the SAME directions. Mixed axis sets are rejected loudly (an
 * undefined comparison is never silently resolved).
 *
 * DETERMINISM: O(n²) non-dominated sorting with canonical-id ordering inside
 * each front. The result is a pure function of the input SET — permutation
 * invariance is property-tested.
 */

import { OptimizationError } from './errors.js';
import { assertValidCarriedUncertainty } from './uncertainty.js';
import type { CarriedUncertainty } from './uncertainty.js';
import { assertValidTypedObjective } from './objectives.js';
import type { ObjectiveAxis, TypedObjective } from './objectives.js';

/** A candidate for Pareto evaluation (uncertainty mandatory — never stripped). */
export interface ParetoCandidate {
  /** Candidate id (non-empty; typically a spine artifact id). */
  id: string;
  /** Declared solution family (diversity grouping; non-empty). */
  family: string;
  /** Typed objectives (>= 1; unique axes; the SAME axis set across one sort). */
  objectives: TypedObjective[];
  /** The uncertainty carried through evaluation (mandatory, preserved verbatim). */
  uncertainty: CarriedUncertainty;
  /** Opaque caller payload (e.g. a search candidate); carried through untouched. */
  payload?: unknown;
}

/** One Pareto front (rank 0 = non-dominated). */
export interface ParetoFront {
  /** 0-based front rank. */
  rank: number;
  /** The front's candidates in canonical id order (deterministic). */
  candidates: ParetoCandidate[];
}

/** The result of a non-dominated sort: the ranked fronts (a partition of the input). */
export interface ParetoResult {
  /** Fronts in rank order; fronts[0] is the Pareto front. */
  fronts: ParetoFront[];
  /** The common objective axes of the sort (sorted). */
  axes: ObjectiveAxis[];
  /** Total candidates across all fronts (== input length). */
  total_candidates: number;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function objectiveKey(objective: TypedObjective): string {
  return `${objective.axis}:${objective.direction}`;
}

/** Validate one Pareto candidate (throws OptimizationError). */
export function assertValidParetoCandidate(value: unknown): asserts value is ParetoCandidate {
  if (!isPlainObject(value)) {
    throw new OptimizationError(`Pareto candidate must be an object, received: ${JSON.stringify(value)}`);
  }
  const record = value as Record<string, unknown>;
  const hasPayload = 'payload' in record;
  if (Object.keys(record).length !== (hasPayload ? 5 : 4)) {
    throw new OptimizationError(
      'Pareto candidate must have the exact field set { id, family, objectives, uncertainty [, payload] }',
    );
  }
  if (typeof record['id'] !== 'string' || record['id'].length === 0) {
    throw new OptimizationError(`Pareto candidate id must be a non-empty string, received: ${JSON.stringify(record['id'])}`);
  }
  if (typeof record['family'] !== 'string' || record['family'].length === 0) {
    throw new OptimizationError(`Pareto candidate family must be a non-empty string, received: ${JSON.stringify(record['family'])}`);
  }
  const objectives = record['objectives'];
  if (!Array.isArray(objectives) || objectives.length === 0) {
    throw new OptimizationError(
      `Pareto candidate ${JSON.stringify(record['id'])} requires at least one typed objective`,
    );
  }
  const seen = new Set<string>();
  for (const objective of objectives) {
    assertValidTypedObjective(objective);
    const key = objectiveKey(objective);
    if (seen.has(key)) {
      throw new OptimizationError(
        `Pareto candidate ${JSON.stringify(record['id'])} declares objective axis ${JSON.stringify((objective as TypedObjective).axis)} twice`,
      );
    }
    seen.add(key);
  }
  try {
    assertValidCarriedUncertainty(record['uncertainty']);
  } catch (cause) {
    throw new OptimizationError(
      `Pareto candidate ${JSON.stringify(record['id'])} carries invalid uncertainty: ${(cause as Error).message}`,
    );
  }
}

/** Predicate form of assertValidParetoCandidate. */
export function isValidParetoCandidate(value: unknown): value is ParetoCandidate {
  try {
    assertValidParetoCandidate(value);
    return true;
  } catch {
    return false;
  }
}

/** Validate a candidate SET for one sort: common axis set, unique ids (throws). */
export function assertValidParetoCandidateSet(candidates: readonly unknown[]): asserts candidates is ParetoCandidate[] {
  if (!Array.isArray(candidates)) {
    throw new OptimizationError('Pareto candidate set must be an array');
  }
  if (candidates.length === 0) {
    return; // an empty sort is valid (an honest empty front, never an error)
  }
  const ids = new Set<string>();
  let referenceKeys: string[] | null = null;
  let referenceId: string | null = null;
  for (const candidate of candidates) {
    assertValidParetoCandidate(candidate);
    if (ids.has(candidate.id)) {
      throw new OptimizationError(`duplicate Pareto candidate id: ${JSON.stringify(candidate.id)}`);
    }
    ids.add(candidate.id);
    const keys = [...candidate.objectives].map(objectiveKey).sort();
    if (referenceKeys === null) {
      referenceKeys = keys;
      referenceId = candidate.id;
    } else if (keys.join('|') !== referenceKeys.join('|')) {
      throw new OptimizationError(
        `Pareto comparability violated: candidate ${JSON.stringify(candidate.id)} declares axes [${keys.join(', ')}] ` +
          `but candidate ${JSON.stringify(referenceId)} declares [${referenceKeys.join(', ')}] — dominance is defined ` +
          'only over a common objective space',
      );
    }
  }
}

/**
 * Does candidate `a` DOMINATE candidate `b`? (At least as good on every
 * objective, strictly better on at least one.) Throws on non-comparable
 * objective spaces.
 */
export function dominates(a: ParetoCandidate, b: ParetoCandidate): boolean {
  const aByAxis = new Map(a.objectives.map((objective) => [objectiveKey(objective), objective]));
  const bByAxis = new Map(b.objectives.map((objective) => [objectiveKey(objective), objective]));
  if (aByAxis.size !== bByAxis.size || [...aByAxis.keys()].some((key) => !bByAxis.has(key))) {
    throw new OptimizationError(
      `dominates() is defined only over comparable objective spaces, received ${JSON.stringify(a.id)} ` +
        `(${[...aByAxis.keys()].sort().join(', ')}) vs ${JSON.stringify(b.id)} (${[...bByAxis.keys()].sort().join(', ')})`,
    );
  }
  let strictlyBetterSomewhere = false;
  for (const [key, aObjective] of aByAxis) {
    const bObjective = bByAxis.get(key)!;
    if (aObjective.direction !== bObjective.direction || aObjective.axis !== bObjective.axis) {
      throw new OptimizationError(`objective direction mismatch between ${JSON.stringify(a.id)} and ${JSON.stringify(b.id)}`);
    }
    const aBetter = aObjective.direction === 'MINIMIZE' ? aObjective.value <= bObjective.value : aObjective.value >= bObjective.value;
    if (!aBetter) {
      return false;
    }
    const aStrict = aObjective.direction === 'MINIMIZE' ? aObjective.value < bObjective.value : aObjective.value > bObjective.value;
    if (aStrict) {
      strictlyBetterSomewhere = true;
    }
  }
  return strictlyBetterSomewhere;
}

function canonicalOrder(candidates: readonly ParetoCandidate[]): ParetoCandidate[] {
  return [...candidates].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Non-dominated sorting: the full ranked sequence of Pareto fronts over the
 * common objective space. Deterministic and permutation-invariant (the
 * fronts are a pure function of the input SET; ordering inside a front is
 * canonical by id).
 */
export function nonDominatedSort(candidates: readonly ParetoCandidate[]): ParetoResult {
  assertValidParetoCandidateSet(candidates);
  const axes = candidates.length === 0
    ? []
    : [...new Set(candidates[0]!.objectives.map((objective) => objective.axis as ObjectiveAxis))].sort();
  const remaining = [...candidates];
  const fronts: ParetoFront[] = [];
  let rank = 0;
  while (remaining.length > 0) {
    const front: ParetoCandidate[] = remaining.filter(
      (candidate) => !remaining.some((other) => other.id !== candidate.id && dominates(other, candidate)),
    );
    // The front is never empty when remaining is non-empty (a set of
    // pairwise-dominance-ordered candidates always has minimal elements).
    if (front.length === 0) {
      throw new OptimizationError('internal invariant violated: non-dominated front is empty');
    }
    fronts.push({ rank, candidates: canonicalOrder(front) });
    const frontIds = new Set(front.map((member) => member.id));
    const nextRemaining = remaining.filter((candidate) => !frontIds.has(candidate.id));
    remaining.length = 0;
    remaining.push(...nextRemaining);
    rank += 1;
  }
  return { fronts, axes, total_candidates: candidates.length };
}

/**
 * THE Pareto front of a candidate set (rank 0 of the non-dominated sort).
 * Returns EVERY mutually non-dominated candidate — never a single winner
 * (spec/architecture-lock.md: never a single global architecture score as
 * the sole authority).
 */
export function paretoFrontOf(candidates: readonly ParetoCandidate[]): ParetoFront {
  const result = nonDominatedSort(candidates);
  return result.fronts[0] ?? { rank: 0, candidates: [] };
}
