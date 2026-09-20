/**
 * @sos-2/meta-evolution error discipline (W16).
 *
 * One error class with TYPED codes (the brownfield convention): every
 * pipeline failure is loud and carries a machine-checkable code. Normal
 * domain outcomes that the W16 contract requires to be RETAINED (guard
 * rejections, routing rejections, ASK escalations, ROLLBACK decisions) are
 * TYPED RECORDS in the stage records — never exceptions. Exceptions are
 * reserved for contract violations and invariant breaches.
 */

import { SemanticSpineError } from '@sos-2/semantic-spine';

export const META_EVOLUTION_ERROR_CODES = [
  'INVALID_META_INPUT',
  'INVALID_SCENARIO',
  'INVALID_PROCESS_PARAMETERS',
  'INVALID_CHANGE_CONTENT',
  'INVALID_REVISION_OPERATION',
  'GOVERNANCE_GUARD_REJECTED',
  'GUARD_BYPASS_ATTEMPT',
  'OBJECT_META_CONFLATION',
  'OBJECT_PROBE_FAILED',
  'PROPOSAL_STAGE_FAILED',
  'EFFECTIVENESS_UNMEASURED',
  'SIMULATION_MARKER_MISSING',
  'DECISION_STAGE_FAILED',
  'PROMOTION_STAGE_FAILED',
  'ASK_STAGE_FAILED',
  'ROLLBACK_WITHOUT_RECOVERY',
  'RESTORE_NOT_EXACT',
  'LIABILITY_RETENTION_VIOLATION',
  'BROKEN_TRACE_CHAIN',
] as const;

export type MetaEvolutionErrorCode = (typeof META_EVOLUTION_ERROR_CODES)[number];

export class MetaEvolutionError extends SemanticSpineError {
  readonly code: MetaEvolutionErrorCode;

  constructor(code: MetaEvolutionErrorCode, message: string) {
    super(message);
    this.name = 'MetaEvolutionError';
    this.code = code;
  }
}

export function isMetaEvolutionError(value: unknown): value is MetaEvolutionError {
  return value instanceof MetaEvolutionError;
}
