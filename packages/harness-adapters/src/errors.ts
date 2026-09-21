/**
 * Typed errors of the harness provider adapters (Work Order P8).
 *
 * Construction-time contract violations (malformed specs, dishonest
 * advertisements, transport/shape mismatches) throw TYPED errors;
 * operation outcomes flow through the P5 HarnessResult union and
 * transport replies (a malformed transport reply is a truthful FAILED
 * result, never a silent success).
 */

export const HARNESS_ADAPTER_ERROR_CODES = ['UNKNOWN', 'INVALID'] as const;

export type HarnessAdapterErrorCode = (typeof HARNESS_ADAPTER_ERROR_CODES)[number];

/** Base class of every typed harness-adapter error. */
export class HarnessAdapterError extends Error {
  readonly code: HarnessAdapterErrorCode;

  constructor(code: HarnessAdapterErrorCode, message: string) {
    super(message);
    this.name = 'HarnessAdapterError';
    this.code = code;
  }
}

/** An adapter spec/shape failed validation (typed INVALID). */
export class InvalidHarnessAdapterSpecError extends HarnessAdapterError {
  readonly namespace: string;

  constructor(namespace: string, message: string) {
    super('INVALID', message);
    this.name = 'InvalidHarnessAdapterSpecError';
    this.namespace = namespace;
  }
}
