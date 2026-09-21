/**
 * live-store typed errors (Work Order P2).
 *
 * SEMANTIC OUTCOMES ARE RECORDS, NOT EXCEPTIONS: idempotent replays return
 * the stored record; stale-revision and divergent writes return typed
 * conflict records; duplicate event deliveries return typed duplicate
 * records. Exceptions are reserved for FAILURES:
 *
 *   - INVALID input (a record that fails the owning domain package's guard
 *     — rejected loudly, message preserved);
 *   - provider UNAVAILABLE/UNKNOWN (typed availability payloads — never
 *     fabricated success, never silent absence-of-failure);
 *   - durable row corruption (loud, typed, never silently skipped);
 *   - absent records (typed NOT_FOUND for the API layer to map).
 */

import type { ProviderAvailabilityRecord } from '@sos-2/api-contracts';

export class LiveStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LiveStoreError';
  }
}

/** A record failed the owning package's guard — rejected loudly (never stored). */
export class InvalidRecordError extends LiveStoreError {
  readonly repository: string;
  readonly detail: string;

  constructor(repository: string, detail: string) {
    super(`invalid ${repository} record: ${detail}`);
    this.name = 'InvalidRecordError';
    this.repository = repository;
    this.detail = detail;
  }
}

/** The addressed record id does not exist in the repository. */
export class RecordNotFoundError extends LiveStoreError {
  readonly repository: string;
  readonly recordId: string;

  constructor(repository: string, recordId: string) {
    super(`${repository} record not found: ${recordId}`);
    this.name = 'RecordNotFoundError';
    this.repository = repository;
    this.recordId = recordId;
  }
}

/**
 * A provider call FAILED with a typed UNAVAILABLE availability record —
 * the operation was NOT performed. Never fabricated success.
 */
export class ProviderUnavailableError extends LiveStoreError {
  readonly availability: ProviderAvailabilityRecord;

  constructor(availability: ProviderAvailabilityRecord) {
    super(`provider UNAVAILABLE: ${availability.provider} (${availability.code}): ${availability.detail}`);
    this.name = 'ProviderUnavailableError';
    this.availability = availability;
  }
}

/**
 * A provider call's OUTCOME CANNOT BE DETERMINED — a typed UNKNOWN
 * availability record. UNKNOWN is never conflated with UNAVAILABLE (the
 * frozen truth-state discipline applies to the storage fabric itself).
 */
export class ProviderUnknownError extends LiveStoreError {
  readonly availability: ProviderAvailabilityRecord;

  constructor(availability: ProviderAvailabilityRecord) {
    super(`provider UNKNOWN: ${availability.provider} (${availability.code}): ${availability.detail}`);
    this.name = 'ProviderUnknownError';
    this.availability = availability;
  }
}

/** A durable row's payload failed the owning guard on read — corruption is loud, never silently skipped. */
export class DurableRowCorruptionError extends LiveStoreError {
  readonly repository: string;
  readonly recordId: string;
  readonly detail: string;

  constructor(repository: string, recordId: string, detail: string) {
    super(
      `durable row corruption in ${repository} for ${recordId}: ${detail} ` +
        '(the durable store is the semantic authority — corruption is surfaced loudly, never silently skipped)',
    );
    this.name = 'DurableRowCorruptionError';
    this.repository = repository;
    this.recordId = recordId;
    this.detail = detail;
  }
}

/** An object-store content-address violation: different bytes under an existing content hash. */
export class ObjectIntegrityError extends LiveStoreError {
  readonly contentHash: string;

  constructor(contentHash: string, detail: string) {
    super(`object-store integrity violation for ${contentHash}: ${detail}`);
    this.name = 'ObjectIntegrityError';
    this.contentHash = contentHash;
  }
}
