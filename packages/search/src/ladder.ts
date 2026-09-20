/**
 * The reasoning-altitude ladder (spec/architecture.md §10, Work Order W7:
 * "Reasoning-altitude ladder enforced: candidate generation STARTS at the
 * highest validated abstraction ... and DESCENDS only when the higher level
 * cannot satisfy mission + constraints; the engine records the altitude
 * used and the descent justification").
 *
 *   VALIDATED_COMPOSITION -> VALIDATED_PACKAGE -> PACKAGE_ADAPTATION ->
 *   ARCHITECTURE_PATTERN -> NOVEL_ARCHITECTURE -> LOW_LEVEL_SYNTHESIS
 *
 * The ladder vocabulary and its total order are IMPORTED from
 * @sos-2/registry (through @sos-2/retrieval) — never redefined here.
 *
 * MACHINE-ENFORCED TRACE DISCIPLINE (`assertValidLadderTrace`):
 *   - a trace STARTS at a declared altitude (the ladder engine always
 *     starts at VALIDATED_COMPOSITION — the highest safe validated
 *     abstraction; alternative engines may declare their own start);
 *   - steps visit CONSECUTIVE rungs — descending only, never skipping a
 *     rung, never ascending;
 *   - EVERY descent carries a NON-EMPTY justification (why the higher
 *     altitude could not satisfy mission + constraints) — a descent
 *     without justification is REJECTED (negative-tested);
 *   - a SATISFIED rung TERMINATES the trace (search stops at the highest
 *     altitude that satisfies; descending past satisfaction is rejected).
 */

import { ALTITUDE_RANK, RETRIEVAL_ALTITUDES } from '@sos-2/retrieval';
import type { RetrievalAltitude } from '@sos-2/retrieval';
import { SearchError } from './errors.js';

/** Why a rung ended without survivors. */
export type LadderExhaustionReason = 'NO_CANDIDATES' | 'ALL_REJECTED_BY_CONSTRAINTS';

/** The outcome of one ladder rung. */
export type LadderOutcome = 'SATISFIED' | LadderExhaustionReason;

/** One recorded step of the descent trace. */
export interface LadderStep {
  /** The rung this step describes. */
  altitude: RetrievalAltitude;
  /** SATISFIED (survivors found — the search stops here) or an exhaustion reason. */
  outcome: LadderOutcome;
  /** Candidates gathered at this rung (before constraint filtering). */
  candidates_considered: number;
  /** Candidates surviving the hard-constraint filter at this rung. */
  candidates_surviving: number;
  /** Ids rejected by constraints at this rung (empty when none). */
  rejected_ids: string[];
  /**
   * REQUIRED on every non-final step: the descent record (the next rung and
   * WHY the higher altitude could not satisfy mission + constraints).
   */
  descent?: { to: RetrievalAltitude; justification: string };
}

/** The full ladder order (imported §10 vocabulary, ladder order). */
export const SEARCH_LADDER: readonly RetrievalAltitude[] = RETRIEVAL_ALTITUDES;

/** Rank of an altitude on the ladder (lower = higher, safer reuse altitude). */
export function altitudeRank(altitude: RetrievalAltitude): number {
  return ALTITUDE_RANK[altitude];
}

/**
 * Validate a ladder trace (throws SearchError). See module doc for the
 * enforced discipline. `startingAltitude` declares where the trace begins
 * (the ladder engine always begins at VALIDATED_COMPOSITION).
 */
export function assertValidLadderTrace(
  steps: readonly LadderStep[],
  options: { startingAltitude?: RetrievalAltitude } = {},
): void {
  const startingAltitude = options.startingAltitude ?? 'VALIDATED_COMPOSITION';
  if (!Array.isArray(steps) || steps.length === 0) {
    throw new SearchError('a ladder trace requires at least one step (an honest trace, never an empty one)');
  }
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index]!;
    if (typeof step !== 'object' || step === null) {
      throw new SearchError(`ladder step ${index} must be an object`);
    }
    if (!(step.altitude as string in ALTITUDE_RANK)) {
      throw new SearchError(
        `ladder step ${index} altitude must be a §10 retrieval altitude, received: ${JSON.stringify(step.altitude)}`,
      );
    }
    const isFinalStep = index === steps.length - 1;
    if (index === 0) {
      if (step.altitude !== startingAltitude) {
        throw new SearchError(
          `a ladder trace must start at ${startingAltitude} (the highest safe abstraction; descents are recorded), received ${step.altitude}`,
        );
      }
    } else {
      const previous = steps[index - 1]!;
      if (altitudeRank(step.altitude) !== altitudeRank(previous.altitude) + 1) {
        throw new SearchError(
          `ladder trace must visit consecutive rungs (descending one at a time): ${previous.altitude} -> ${step.altitude} is not a single-rung descent (never skip a rung, never ascend)`,
        );
      }
    }
    if (step.outcome === 'SATISFIED') {
      if (step.candidates_surviving < 1) {
        throw new SearchError(
          `ladder step ${step.altitude} claims SATISFIED but records ${step.candidates_surviving} surviving candidates — a satisfied rung has survivors`,
        );
      }
      if (!isFinalStep) {
        throw new SearchError(
          `ladder trace continues past a SATISFIED rung (${step.altitude}) — search stops at the highest altitude that satisfies mission + constraints`,
        );
      }
      if (step.descent !== undefined) {
        throw new SearchError(`a SATISFIED ladder step (${step.altitude}) carries a descent record — nothing is descended past`);
      }
    } else {
      if (step.outcome !== 'NO_CANDIDATES' && step.outcome !== 'ALL_REJECTED_BY_CONSTRAINTS') {
        throw new SearchError(
          `ladder step ${step.altitude} outcome must be SATISFIED, NO_CANDIDATES or ALL_REJECTED_BY_CONSTRAINTS, received: ${JSON.stringify(step.outcome)}`,
        );
      }
      if (step.outcome === 'NO_CANDIDATES' && step.candidates_considered !== 0) {
        throw new SearchError(`ladder step ${step.altitude} claims NO_CANDIDATES but considered ${step.candidates_considered}`);
      }
      if (step.outcome === 'ALL_REJECTED_BY_CONSTRAINTS' && step.candidates_considered !== step.rejected_ids.length) {
        throw new SearchError(
          `ladder step ${step.altitude} claims ALL_REJECTED_BY_CONSTRAINTS but rejected ${step.rejected_ids.length} of ${step.candidates_considered} — the counts must match`,
        );
      }
      if (step.candidates_surviving !== 0) {
        throw new SearchError(
          `ladder step ${step.altitude} is not SATISFIED but records ${step.candidates_surviving} surviving candidates`,
        );
      }
      if (!isFinalStep) {
        if (step.descent === undefined) {
          throw new SearchError(
            `UNJUSTIFIED DESCENT REJECTED: ladder step ${step.altitude} is exhausted but carries no descent record — every descent requires a recorded justification (spec/architecture.md §10)`,
          );
        }
        if (typeof step.descent.justification !== 'string' || step.descent.justification.trim().length === 0) {
          throw new SearchError(
            `UNJUSTIFIED DESCENT REJECTED: the descent from ${step.altitude} carries an empty justification — why the higher altitude cannot satisfy mission + constraints must be recorded`,
          );
        }
        if (step.descent.to == null || altitudeRank(step.descent.to) !== altitudeRank(step.altitude) + 1) {
          throw new SearchError(
            `ladder step ${step.altitude} descends to ${JSON.stringify(step.descent.to)} — must be the immediately next rung`,
          );
        }
      }
    }
  }
}

/** Build (validate + return) a ladder trace — the only trace constructor. */
export function buildLadderTrace(
  steps: readonly LadderStep[],
  options: { startingAltitude?: RetrievalAltitude } = {},
): LadderStep[] {
  assertValidLadderTrace(steps, options);
  return steps.map((step) => {
    // Never materialize an explicit `descent: undefined` — the spine's
    // canonical serialization rejects undefined properties.
    const copy: LadderStep = { ...step };
    if (step.descent !== undefined) {
      copy.descent = { ...step.descent };
    } else {
      delete copy.descent;
    }
    return copy;
  });
}

/** The auto-generated, deterministic descent justification of one exhausted rung. */
export function descentJustification(
  altitude: RetrievalAltitude,
  to: RetrievalAltitude,
  outcome: LadderExhaustionReason,
  candidateCount: number,
  rejectedIds: readonly string[],
  capability: string,
): string {
  if (outcome === 'NO_CANDIDATES') {
    return (
      `altitude ${altitude} yielded 0 candidates for capability ${JSON.stringify(capability)} — ` +
      `the higher level cannot satisfy mission + constraints; descending to ${to} (spec/architecture.md §10)`
    );
  }
  return (
    `altitude ${altitude} yielded ${candidateCount} candidate(s) for capability ${JSON.stringify(capability)}; all were ` +
    `rejected by hard constraints [${rejectedIds.join(', ')}] — the higher level cannot satisfy mission + constraints; ` +
    `descending to ${to} (spec/architecture.md §10)`
  );
}
