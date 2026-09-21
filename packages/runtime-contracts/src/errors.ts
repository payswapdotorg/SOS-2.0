/**
 * Typed errors of the runtime contracts (Work Order P5).
 *
 * Every failure is LOUD and typed — never a silent default, never a
 * fabricated availability (the same discipline as the live-store and
 * authority error models).
 */

export const RUNTIME_CONTRACT_ERROR_CODES = ['UNKNOWN', 'INVALID'] as const;

export type RuntimeContractErrorCode = (typeof RUNTIME_CONTRACT_ERROR_CODES)[number];

/** Base class of every typed runtime-contracts error. */
export class RuntimeContractError extends Error {
  readonly code: RuntimeContractErrorCode;

  constructor(code: RuntimeContractErrorCode, message: string) {
    super(message);
    this.name = 'RuntimeContractError';
    this.code = code;
  }
}

/** A runtime contract shape failed validation (typed INVALID). */
export class InvalidRuntimeContractError extends RuntimeContractError {
  readonly namespace: string;

  constructor(namespace: string, message: string) {
    super('INVALID', message);
    this.name = 'InvalidRuntimeContractError';
    this.namespace = namespace;
  }
}
