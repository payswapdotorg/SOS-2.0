/**
 * Typed errors of the local companion contract (Work Order P11).
 *
 * The contract never fails silently: malformed pairing requests, malformed
 * scope grants and contract violations throw TYPED errors; boundary
 * refusals (scope, process, session, reconciliation gaps) flow through the
 * typed CompanionResult union (OK | DENIED) — never a crash, never a
 * silent success (the P8 sandbox denial discipline).
 */

export const COMPANION_ERROR_CODES = ['UNKNOWN', 'INVALID'] as const;

export type CompanionErrorCode = (typeof COMPANION_ERROR_CODES)[number];

/** Base class of every typed local-companion error. */
export class CompanionError extends Error {
  readonly code: CompanionErrorCode;

  constructor(code: CompanionErrorCode, message: string) {
    super(message);
    this.name = 'CompanionError';
    this.code = code;
  }
}

/** A local-companion shape failed validation (typed INVALID). */
export class InvalidCompanionContractError extends CompanionError {
  readonly namespace: string;

  constructor(namespace: string, message: string) {
    super('INVALID', message);
    this.name = 'InvalidCompanionContractError';
    this.namespace = namespace;
  }
}

/** A reconciliation violation (typed INVALID — a gap is never silent). */
export class CompanionReconciliationError extends CompanionError {
  readonly namespace: string;

  constructor(namespace: string, message: string) {
    super('INVALID', message);
    this.name = 'CompanionReconciliationError';
    this.namespace = namespace;
  }
}
