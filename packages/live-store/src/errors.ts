/**
 * Typed live-store errors (Work Order P2).
 *
 * Every failure surfaces as a TYPED error carrying the API error code it
 * maps to — never a silent absence-of-failure, never fabricated success
 * (spec/productization-requirements.md: "Provider outages remain truthful
 * unknown/unavailable states").
 */

/** The typed error codes of the live store (mapped 1:1 onto api-contracts). */
export const LIVE_STORE_ERROR_CODES = ['UNKNOWN', 'UNAVAILABLE', 'INVALID'] as const;

export type LiveStoreErrorCode = (typeof LIVE_STORE_ERROR_CODES)[number];

/** Base class of every typed live-store error. */
export class LiveStoreError extends Error {
  readonly code: LiveStoreErrorCode;

  constructor(code: LiveStoreErrorCode, message: string) {
    super(message);
    this.name = 'LiveStoreError';
    this.code = code;
  }
}

/**
 * A record failed the OWNING PACKAGE's semantic validation (the assert was
 * consumed from the owning package — never reimplemented here). Maps to the
 * API code INVALID.
 */
export class InvalidRecordError extends LiveStoreError {
  readonly namespace: string;

  constructor(namespace: string, message: string) {
    super('INVALID', message);
    this.name = 'InvalidRecordError';
    this.namespace = namespace;
  }
}

/**
 * A provider adapter operation failed (the configured provider is failing).
 * Maps to the API code UNAVAILABLE — never fabricated success.
 */
export class ProviderUnavailableError extends LiveStoreError {
  readonly provider: string;

  constructor(provider: string, message: string) {
    super('UNAVAILABLE', message);
    this.name = 'ProviderUnavailableError';
    this.provider = provider;
  }
}

/**
 * Durable storage returned a row that fails the owning package's validation
 * (corruption). Maps to the API code UNKNOWN — an unexpected internal
 * condition, never silently patched.
 */
export class CorruptRowError extends LiveStoreError {
  readonly namespace: string;
  readonly id: string;

  constructor(namespace: string, id: string, message: string) {
    super('UNKNOWN', message);
    this.name = 'CorruptRowError';
    this.namespace = namespace;
    this.id = id;
  }
}

/** Any other unexpected condition inside the store. Maps to UNKNOWN. */
export class UnknownStoreError extends LiveStoreError {
  constructor(message: string) {
    super('UNKNOWN', message);
    this.name = 'UnknownStoreError';
  }
}
