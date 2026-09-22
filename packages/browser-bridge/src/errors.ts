/**
 * Typed errors of the browser bridge (Work Order P11).
 *
 * The bridge contract never fails silently: malformed descriptors and
 * contract violations throw TYPED errors; operation outcomes flow through
 * the typed HarnessResult union (OK | FAILED) — a malformed transport
 * reply is a truthful FAILED, never a silent success.
 */

export const BROWSER_BRIDGE_ERROR_CODES = ['UNKNOWN', 'INVALID'] as const;

export type BrowserBridgeErrorCode = (typeof BROWSER_BRIDGE_ERROR_CODES)[number];

/** Base class of every typed browser-bridge error. */
export class BrowserBridgeError extends Error {
  readonly code: BrowserBridgeErrorCode;

  constructor(code: BrowserBridgeErrorCode, message: string) {
    super(message);
    this.name = 'BrowserBridgeError';
    this.code = code;
  }
}

/** A browser-bridge shape failed validation (typed INVALID). */
export class InvalidBrowserBridgeSpecError extends BrowserBridgeError {
  readonly namespace: string;

  constructor(namespace: string, message: string) {
    super('INVALID', message);
    this.name = 'InvalidBrowserBridgeSpecError';
    this.namespace = namespace;
  }
}
