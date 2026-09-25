/**
 * Typed errors of the task runtime (Work Order P12).
 *
 * Every failure is a typed error naming its code; the CHECKPOINT_INVALID
 * denial is the fail-closed integrity gate (a corrupted or tampered
 * checkpoint is NEVER silently re-derived).
 */

export const TASK_RUNTIME_ERROR_CODES = [
  'CHECKPOINT_INVALID',
  'TASK_RUNTIME',
  'INVALID_INPUT',
  'RESUME_REFUSED',
] as const;

export type TaskRuntimeErrorCode = (typeof TASK_RUNTIME_ERROR_CODES)[number];

export class TaskRuntimeError extends Error {
  readonly code: TaskRuntimeErrorCode;

  constructor(code: TaskRuntimeErrorCode, message: string) {
    super(message);
    this.name = 'TaskRuntimeError';
    this.code = code;
  }
}

export function isTaskRuntimeError(value: unknown): value is TaskRuntimeError {
  return value instanceof TaskRuntimeError;
}
