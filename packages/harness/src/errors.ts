/**
 * Typed errors of the harness contract (Work Order P5).
 *
 * The CONTRACT never fails silently: malformed advertisements, malformed
 * requests and contract violations throw TYPED errors; operation outcomes
 * flow through the typed HarnessResult union (OK | FAILED | UNSUPPORTED).
 */

export const HARNESS_ERROR_CODES = ['UNKNOWN', 'INVALID'] as const;

export type HarnessErrorCode = (typeof HARNESS_ERROR_CODES)[number];

/** Base class of every typed harness error. */
export class HarnessError extends Error {
  readonly code: HarnessErrorCode;

  constructor(code: HarnessErrorCode, message: string) {
    super(message);
    this.name = 'HarnessError';
    this.code = code;
  }
}

/** A harness contract shape failed validation (typed INVALID). */
export class InvalidHarnessContractError extends HarnessError {
  readonly namespace: string;

  constructor(namespace: string, message: string) {
    super('INVALID', message);
    this.name = 'InvalidHarnessContractError';
    this.namespace = namespace;
  }
}
