/**
 * Typed errors of the local companion host (Work Order P11).
 */

export const COMPANION_HOST_ERROR_CODES = ['UNKNOWN', 'INVALID'] as const;

export type CompanionHostErrorCode = (typeof COMPANION_HOST_ERROR_CODES)[number];

/** Base class of every typed companion-host error. */
export class CompanionHostError extends Error {
  readonly code: CompanionHostErrorCode;

  constructor(code: CompanionHostErrorCode, message: string) {
    super(message);
    this.name = 'CompanionHostError';
    this.code = code;
  }
}

/** A host input/shape failed validation (typed INVALID). */
export class InvalidCompanionHostInputError extends CompanionHostError {
  constructor(message: string) {
    super('INVALID', message);
    this.name = 'InvalidCompanionHostInputError';
  }
}
