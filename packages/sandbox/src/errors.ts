/**
 * Typed errors of the sandbox contract (Work Order P8).
 *
 * The CONTRACT never fails silently: malformed policies and contract
 * violations throw TYPED errors at construction time; RUNTIME boundary
 * refusals (out-of-scope access, denied egress, budget overruns) are
 * typed denials in the SandboxResult union — never throws, never silent,
 * never a crash.
 */

export const SANDBOX_ERROR_CODES = ['UNKNOWN', 'INVALID'] as const;

export type SandboxErrorCode = (typeof SANDBOX_ERROR_CODES)[number];

/** Base class of every typed sandbox error. */
export class SandboxError extends Error {
  readonly code: SandboxErrorCode;

  constructor(code: SandboxErrorCode, message: string) {
    super(message);
    this.name = 'SandboxError';
    this.code = code;
  }
}

/** A sandbox policy/shape failed validation (typed INVALID). */
export class InvalidSandboxPolicyError extends SandboxError {
  readonly namespace: string;

  constructor(namespace: string, message: string) {
    super('INVALID', message);
    this.name = 'InvalidSandboxPolicyError';
    this.namespace = namespace;
  }
}
