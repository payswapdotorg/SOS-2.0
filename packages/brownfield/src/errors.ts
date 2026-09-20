/**
 * @sos-2/brownfield — errors (Work Order W15).
 *
 * All brownfield pipeline failures are loud and typed (the repo-wide
 * fail-loud discipline). The hierarchy extends the spine's base error so a
 * single catch surface covers every SOS package.
 */

import { SemanticSpineError } from '@sos-2/semantic-spine';

/** Machine-checkable brownfield failure codes (frozen vocabulary). */
export const BROWNFIELD_ERROR_CODES = [
  'INVALID_SNAPSHOT',
  'INVALID_DECLARED_ARCHITECTURE',
  'INVALID_GOAL',
  'INVALID_LOOP_INPUT',
  'AMBIGUITY_COLLAPSED',
  'INGESTION_FAILED',
  'RECOVERY_FAILED',
  'RETRIEVAL_EMPTY',
  'EVOLUTION_NO_EVALUABLE_CANDIDATES',
  'EVOLUTION_NO_INVARIANT_PRESERVING_CANDIDATE',
  'EVOLUTION_TARGET_NOT_IN_HYPOTHESIS',
  'INVARIANT_VIOLATED_BY_CANDIDATE',
  'ASSURANCE_EVALUATION_FAILED',
  'SIMULATION_MARKER_MISSING',
  'PROMOTION_EVALUATION_FAILED',
  'ROLLBACK_WITHOUT_RECOVERY',
  'RECONCILIATION_FAILED',
  'LEARNING_FAILED',
  'BROKEN_TRACE_CHAIN',
  'INVALID_FIXTURE',
] as const;

export type BrownfieldErrorCode = (typeof BROWNFIELD_ERROR_CODES)[number];

/** Base class for every brownfield pipeline failure. */
export class BrownfieldError extends SemanticSpineError {
  readonly code: BrownfieldErrorCode;

  constructor(code: BrownfieldErrorCode, message: string) {
    super(`[${code}] ${message}`);
    this.name = 'BrownfieldError';
    this.code = code;
  }
}

/** Narrow an unknown thrown value to a BrownfieldError (predicate). */
export function isBrownfieldError(value: unknown): value is BrownfieldError {
  return value instanceof BrownfieldError;
}
