/**
 * Observation event ingestion payloads (Work Order P2).
 *
 * The event boundary used by the persistent Spirit and the Observation
 * Plane (spec/productization-execution-architecture.md section 5): GitHub
 * webhooks, CI/build/test/security events, deployment events, runtime
 * telemetry batches, incidents, provider health signals and explicit user
 * observations all cross into durable storage through this ONE typed
 * payload shape.
 *
 * REPLAY PROTECTION IS MANDATORY: every event carries an `event_id`. A
 * duplicate delivery of the same event id with identical content is
 * detected and skipped — never double-applied — and answered with the typed
 * DUPLICATE record below. A divergent redelivery (same id, different
 * content) is a typed conflict, never a silent overwrite.
 *
 * `payload` is the VERBATIM source event (preserved bit-exactly on canonical
 * serialization). `subject_ref` is the spine artifact id when the source has
 * already been mapped semantically, or null — semantic mapping is the
 * evidence layer's job, never invented here.
 */

import { isJsonObject, isJsonValue, type JsonValue } from './json.js';

/**
 * RFC3339 date-time (mirrors the spine's RFC3339_PATTERN — a pattern
 * mirror, not a second semantic authority; the canonical check stays in
 * @sos-2/semantic-spine and @sos-2/live-store re-validates through the
 * owning guards).
 */
export const RFC3339_BOUNDARY_PATTERN =
  /^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/;

export function isRfc3339Timestamp(value: unknown): value is string {
  return typeof value === 'string' && RFC3339_BOUNDARY_PATTERN.test(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isNonEmptyStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every((entry) => typeof entry === 'string' && entry.length > 0);
}

function isNullOrNonEmptyString(value: unknown): value is string | null {
  return value === null || isNonEmptyString(value);
}

const EVENT_REQUEST_KEYS = [
  'event_id',
  'source',
  'event_kind',
  'occurred_at',
  'payload',
  'subject_ref',
  'provenance',
] as const;

/** The typed event ingestion request (one event; batches are arrays of requests). */
export interface EventIngestionRequest {
  /** Stable event identity (caller/source-supplied — delivery id, webhook id, ...). REQUIRED for replay protection. */
  event_id: string;
  /** Observation source identifier, e.g. "github:webhook:payswapdotorg/SOS-2.0", "otel:collector:prod". */
  source: string;
  /** Event type, e.g. "github:push", "ci:workflow-run", "deployment", "telemetry:otel", "user:observation". */
  event_kind: string;
  /** RFC3339 instant the event occurred at the source. */
  occurred_at: string;
  /** The verbatim source event payload (any JSON value). */
  payload: JsonValue;
  /** Spine artifact id when the subject is already mapped, or null. */
  subject_ref: string | null;
  /** Delivery provenance (non-empty; e.g. webhook delivery ids) — the SOS no-provenance-less-records discipline. */
  provenance: string[];
}

/** Field-level validation shared by the request and stored-record guards (does NOT check key counts). */
function checkEventFields(record: Record<string, unknown>): boolean {
  if (!isNonEmptyString(record['event_id']) || !isNonEmptyString(record['source']) || !isNonEmptyString(record['event_kind'])) {
    return false;
  }
  if (!isRfc3339Timestamp(record['occurred_at'])) {
    return false;
  }
  if (!isJsonValue(record['payload'])) {
    return false;
  }
  if (!isNullOrNonEmptyString(record['subject_ref'])) {
    return false;
  }
  return isNonEmptyStringArray(record['provenance']);
}

export function isEventIngestionRequest(value: unknown): value is EventIngestionRequest {
  if (!isJsonObject(value)) {
    return false;
  }
  const record = value as unknown as Record<string, unknown>;
  const actual = Object.keys(record);
  if (actual.length !== EVENT_REQUEST_KEYS.length || !EVENT_REQUEST_KEYS.every((key) => Object.prototype.hasOwnProperty.call(record, key))) {
    return false;
  }
  return checkEventFields(record);
}

/** Full validation with a specific message (throws TypeError). */
export function assertValidEventIngestionRequest(value: unknown): asserts value is EventIngestionRequest {
  if (!isJsonObject(value)) {
    throw new TypeError('event ingestion request must be a JSON object');
  }
  const record = value as unknown as Record<string, unknown>;
  for (const key of EVENT_REQUEST_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) {
      throw new TypeError(`event ingestion request is missing the field ${JSON.stringify(key)}`);
    }
  }
  if (Object.keys(record).length !== EVENT_REQUEST_KEYS.length) {
    throw new TypeError(
      `event ingestion request must have the exact field set { ${EVENT_REQUEST_KEYS.join(', ')} }`,
    );
  }
  if (!isNonEmptyString(record['event_id'])) {
    throw new TypeError(`event_id must be a non-empty string, received: ${JSON.stringify(record['event_id'])}`);
  }
  if (!isNonEmptyString(record['source'])) {
    throw new TypeError(`source must be a non-empty string, received: ${JSON.stringify(record['source'])}`);
  }
  if (!isNonEmptyString(record['event_kind'])) {
    throw new TypeError(`event_kind must be a non-empty string, received: ${JSON.stringify(record['event_kind'])}`);
  }
  if (!isRfc3339Timestamp(record['occurred_at'])) {
    throw new TypeError(`occurred_at must be an RFC3339 timestamp, received: ${JSON.stringify(record['occurred_at'])}`);
  }
  if (!isJsonValue(record['payload'])) {
    throw new TypeError('payload must be a plain JSON value (the verbatim source event)');
  }
  if (!isNullOrNonEmptyString(record['subject_ref'])) {
    throw new TypeError(`subject_ref must be null or a non-empty string, received: ${JSON.stringify(record['subject_ref'])}`);
  }
  if (!isNonEmptyStringArray(record['provenance'])) {
    throw new TypeError('provenance must be a non-empty array of non-empty strings (delivery provenance is mandatory)');
  }
}

/** The stored observation event: the request plus the store-side ingestion instant (injected clock; never a hidden clock). */
export interface ObservationEventRecord extends EventIngestionRequest {
  /** RFC3339 instant the store durably ingested the event. */
  ingested_at: string;
}

const EVENT_RECORD_KEYS = [...EVENT_REQUEST_KEYS, 'ingested_at'] as const;

export function isObservationEventRecord(value: unknown): value is ObservationEventRecord {
  if (!isJsonObject(value)) {
    return false;
  }
  const record = value as unknown as Record<string, unknown>;
  const actual = Object.keys(record);
  if (actual.length !== EVENT_RECORD_KEYS.length || !EVENT_RECORD_KEYS.every((key) => Object.prototype.hasOwnProperty.call(record, key))) {
    return false;
  }
  if (!checkEventFields(record)) {
    return false;
  }
  return isRfc3339Timestamp(record['ingested_at']);
}

/** The typed DUPLICATE record answering a replayed event delivery. */
export interface DuplicateEventRecord {
  error_kind: 'DUPLICATE';
  event_id: string;
  first_ingested_at: string;
  message: string;
}

export function isDuplicateEventRecord(value: unknown): value is DuplicateEventRecord {
  if (!isJsonObject(value)) {
    return false;
  }
  const record = value as unknown as Record<string, unknown>;
  const actual = Object.keys(record);
  if (actual.length !== 4 || !['error_kind', 'event_id', 'first_ingested_at', 'message'].every((key) => Object.prototype.hasOwnProperty.call(record, key))) {
    return false;
  }
  if (record['error_kind'] !== 'DUPLICATE') {
    return false;
  }
  return isNonEmptyString(record['event_id']) && isRfc3339Timestamp(record['first_ingested_at']) && isNonEmptyString(record['message']);
}

/** The typed event-ingestion conflict (same event id, divergent content — never silently overwritten). */
export interface EventDivergenceRecord {
  error_kind: 'CONFLICT';
  code: 'EVENT_DIVERGENCE';
  event_id: string;
  first_ingested_at: string;
  message: string;
}

export function isEventDivergenceRecord(value: unknown): value is EventDivergenceRecord {
  if (!isJsonObject(value)) {
    return false;
  }
  const record = value as unknown as Record<string, unknown>;
  const actual = Object.keys(record);
  if (actual.length !== 5 || !['error_kind', 'code', 'event_id', 'first_ingested_at', 'message'].every((key) => Object.prototype.hasOwnProperty.call(record, key))) {
    return false;
  }
  if (record['error_kind'] !== 'CONFLICT' || record['code'] !== 'EVENT_DIVERGENCE') {
    return false;
  }
  return isNonEmptyString(record['event_id']) && isRfc3339Timestamp(record['first_ingested_at']) && isNonEmptyString(record['message']);
}

/** The successful ingestion outcome. */
export interface EventIngestedResponse {
  outcome: 'APPLIED';
  event: ObservationEventRecord;
}
