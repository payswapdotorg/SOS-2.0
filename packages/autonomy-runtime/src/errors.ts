/**
 * Typed errors of the autonomy runtime (Work Order P12).
 *
 * Every failure surface is a typed error naming its code — never a bare
 * Error, never a swallowed failure. Codes are frozen vocabulary
 * (add-only, like every SOS vocabulary).
 */

export const AUTONOMY_ERROR_CODES = [
  'LEASE_SUPERVISION',
  'LEASE_ACTION',
  'RECOVERY_PLAN',
  'OUTAGE_POLICY',
  'COST_LEDGER',
  'INVALID_INPUT',
] as const;

export type AutonomyErrorCode = (typeof AUTONOMY_ERROR_CODES)[number];

export class AutonomyRuntimeError extends Error {
  readonly code: AutonomyErrorCode;

  constructor(code: AutonomyErrorCode, message: string) {
    super(message);
    this.name = 'AutonomyRuntimeError';
    this.code = code;
  }
}

export function isAutonomyRuntimeError(value: unknown): value is AutonomyRuntimeError {
  return value instanceof AutonomyRuntimeError;
}
