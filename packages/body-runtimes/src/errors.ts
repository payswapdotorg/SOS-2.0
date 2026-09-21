/**
 * Typed errors of the reference body runtimes (Work Order P8).
 *
 * Construction-time contract violations (malformed options, dishonest
 * advertisements) throw TYPED errors; operation outcomes flow through the
 * P5 HarnessResult union (OK | FAILED | UNSUPPORTED) and sandbox boundary
 * refusals surface as truthful FAILED results carrying the typed sandbox
 * denial — never silent, never a crash.
 */

export const BODY_RUNTIME_ERROR_CODES = ['UNKNOWN', 'INVALID'] as const;

export type BodyRuntimeErrorCode = (typeof BODY_RUNTIME_ERROR_CODES)[number];

/** Base class of every typed body-runtime error. */
export class BodyRuntimeError extends Error {
  readonly code: BodyRuntimeErrorCode;

  constructor(code: BodyRuntimeErrorCode, message: string) {
    super(message);
    this.name = 'BodyRuntimeError';
    this.code = code;
  }
}

/** A body runtime option/shape failed validation (typed INVALID). */
export class InvalidBodyRuntimeOptionsError extends BodyRuntimeError {
  readonly namespace: string;

  constructor(namespace: string, message: string) {
    super('INVALID', message);
    this.name = 'InvalidBodyRuntimeOptionsError';
    this.namespace = namespace;
  }
}
