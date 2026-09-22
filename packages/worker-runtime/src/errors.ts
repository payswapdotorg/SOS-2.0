/**
 * Typed errors of the worker runtime (Work Order P6).
 */

export const WORKER_RUNTIME_ERROR_CODES = ['INVALID', 'STATE'] as const;

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

/** A malformed step program / result / input (typed INVALID). */
export class InvalidWorkerInputError extends WorkerRuntimeError {
  constructor(message: string) {
    super('INVALID', message);
    this.name = 'InvalidWorkerInputError';
  }
}

/** The task is not in the state the runtime expects (typed STATE). */
export class InvalidWorkerStateError extends WorkerRuntimeError {
  constructor(message: string) {
    super('STATE', message);
    this.name = 'InvalidWorkerStateError';
  }
}
