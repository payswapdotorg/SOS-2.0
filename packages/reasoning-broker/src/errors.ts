/**
 * Typed errors of the reasoning broker (Work Order P6).
 *
 * The broker never fails silently: malformed requests, malformed
 * analyses, unknown providers and provenance violations throw TYPED
 * errors; honest operational outcomes (UNAVAILABLE providers) flow
 * through the typed ReasoningOutcome union instead.
 */

export const REASONING_ERROR_CODES = ['INVALID', 'PROVIDER', 'PROVENANCE'] as const;

export type ReasoningErrorCode = (typeof REASONING_ERROR_CODES)[number];

/** Base class of every typed reasoning-broker error. */
export class ReasoningError extends Error {
  readonly code: ReasoningErrorCode;

  constructor(code: ReasoningErrorCode, message: string) {
    super(message);
    this.name = 'ReasoningError';
    this.code = code;
  }
}

/** A reasoning request or analysis failed shape validation (typed INVALID). */
export class InvalidReasoningInputError extends ReasoningError {
  constructor(message: string) {
    super('INVALID', message);
    this.name = 'InvalidReasoningInputError';
  }
}

/** A provider operation failed (typed PROVIDER — unknown ids, double registration). */
export class ReasoningProviderError extends ReasoningError {
  constructor(message: string) {
    super('PROVIDER', message);
    this.name = 'ReasoningProviderError';
  }
}

/**
 * A provenance-discipline violation (typed PROVENANCE): an output
 * without provider identity/model/version, or an attempt to use broker
 * output where authority or verification verdicts are required.
 */
export class ReasoningProvenanceError extends ReasoningError {
  /** The rule that was violated (named — never silent). */
  readonly rule: string;

  constructor(rule: string, message: string) {
    super('PROVENANCE', message);
    this.name = 'ReasoningProvenanceError';
    this.rule = rule;
  }
}
