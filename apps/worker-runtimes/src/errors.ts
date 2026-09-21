/**
 * Typed errors of the worker runtime host (Work Order P8).
 */

export const WORKER_RUNTIME_ERROR_CODES = ['UNKNOWN', 'INVALID'] as const;

export type WorkerRuntimeErrorCode = (typeof WORKER_RUNTIME_ERROR_CODES)[number];

/** Base class of every typed worker-runtime error. */
export class WorkerRuntimeError extends Error {
  readonly code: WorkerRuntimeErrorCode;

  constructor(code: WorkerRuntimeErrorCode, message: string) {
    super(message);
    this.name = 'WorkerRuntimeError';
    this.code = code;
  }
}

/** A host input/shape failed validation (typed INVALID). */
export class InvalidHostInputError extends WorkerRuntimeError {
  constructor(message: string) {
    super('INVALID', message);
    this.name = 'InvalidHostInputError';
  }
}
