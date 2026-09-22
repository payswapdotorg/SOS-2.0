/**
 * Typed errors of the IDE bridge (Work Order P11).
 *
 * The bridge contract never fails silently: malformed descriptors and
 * contract violations throw TYPED errors; operation outcomes flow through
 * the typed bridge result union (OK | FAILED) — a malformed transport
 * reply is a truthful FAILED, never a silent success.
 */

export const IDE_BRIDGE_ERROR_CODES = ['UNKNOWN', 'INVALID'] as const;

export type IdeBridgeErrorCode = (typeof IDE_BRIDGE_ERROR_CODES)[number];

/** Base class of every typed IDE-bridge error. */
export class IdeBridgeError extends Error {
  readonly code: IdeBridgeErrorCode;

  constructor(code: IdeBridgeErrorCode, message: string) {
    super(message);
    this.name = 'IdeBridgeError';
    this.code = code;
  }
}

/** An IDE-bridge shape failed validation (typed INVALID). */
export class InvalidIdeBridgeSpecError extends IdeBridgeError {
  readonly namespace: string;

  constructor(namespace: string, message: string) {
    super('INVALID', message);
    this.name = 'InvalidIdeBridgeSpecError';
    this.namespace = namespace;
  }
}
