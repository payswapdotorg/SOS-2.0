/**
 * Typed errors of the execution fabric (Work Order P5).
 *
 * Expected refusals flow as TYPED RESULTS (denials) — never thrown; the
 * typed errors below mark contract violations and indeterminate internal
 * conditions (loud, never silent).
 */

export const FABRIC_ERROR_CODES = ['UNKNOWN', 'INVALID'] as const;

export type FabricErrorCode = (typeof FABRIC_ERROR_CODES)[number];

/** Base class of every typed execution-fabric error. */
export class FabricError extends Error {
  readonly code: FabricErrorCode;

  constructor(code: FabricErrorCode, message: string) {
    super(message);
    this.name = 'FabricError';
    this.code = code;
  }
}

/** A fabric input/shape failed validation (typed INVALID). */
export class InvalidFabricInputError extends FabricError {
  constructor(message: string) {
    super('INVALID', message);
    this.name = 'InvalidFabricInputError';
  }
}
