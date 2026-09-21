/**
 * Typed errors of the body broker (Work Order P5).
 *
 * Loud and typed — never a silent failure, never a fabricated lease or
 * availability.
 */

export const BODY_BROKER_ERROR_CODES = ['UNKNOWN', 'INVALID', 'UNAVAILABLE'] as const;

export type BodyBrokerErrorCode = (typeof BODY_BROKER_ERROR_CODES)[number];

/** Base class of every typed body-broker error. */
export class BodyBrokerError extends Error {
  readonly code: BodyBrokerErrorCode;

  constructor(code: BodyBrokerErrorCode, message: string) {
    super(message);
    this.name = 'BodyBrokerError';
    this.code = code;
  }
}

/** A broker record/shape failed validation (typed INVALID). */
export class InvalidBodyRecordError extends BodyBrokerError {
  readonly namespace: string;

  constructor(namespace: string, message: string) {
    super('INVALID', message);
    this.name = 'InvalidBodyRecordError';
    this.namespace = namespace;
  }
}

/** A required body is absent/unusable (typed UNAVAILABLE — never fabricated). */
export class BodyUnavailableError extends BodyBrokerError {
  readonly bodyId: string;

  constructor(bodyId: string, message: string) {
    super('UNAVAILABLE', message);
    this.name = 'BodyUnavailableError';
    this.bodyId = bodyId;
  }
}
