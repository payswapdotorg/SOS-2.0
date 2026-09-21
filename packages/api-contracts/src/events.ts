/**
 * Event ingestion payloads (Work Order P2 — the Observation Plane boundary).
 *
 * Every event CARRIES AN ID (hard rule: replay protection is keyed on it).
 * The payload is an opaque canonical JSON value preserved VERBATIM — the
 * store never interprets, merges or rewrites observation content; truth
 * states inside payloads (e.g. an UNAVAILABLE telemetry capture) survive
 * ingestion bit-exact and are never folded into success.
 */

import type { JsonValue } from '@sos-2/semantic-spine';

/** The event ingestion request body (POST /events). */
export interface EventIngestionRequest {
  /** REQUIRED delivery-level event id (replay-protection key; non-empty). */
  id: string;
  /** Stable source identifier, e.g. "github:webhook:payswapdotorg/SOS-2.0" (non-empty). */
  source: string;
  /** Event kind, e.g. "ci.run", "deployment", "telemetry.observation" (non-empty). */
  kind: string;
  /** When the event occurred, RFC3339 (caller-supplied; never a hidden clock). */
  occurred_at: string;
  /** Opaque canonical-JSON payload, stored verbatim. */
  payload: JsonValue;
  /** Provenance entries (at least one non-empty string). */
  provenance: string[];
}

const EVENT_REQUEST_KEYS = ['id', 'source', 'kind', 'occurred_at', 'payload', 'provenance'] as const;

/** RFC3339 date-time (the same pattern the spine enforces for envelopes). */
export const RFC3339_PATTERN = /^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.length > 0 && value.every((entry) => typeof entry === 'string' && entry.length > 0)
  );
}

function isJsonOrNull(value: unknown): value is JsonValue | null {
  if (value === null) {
    return true;
  }
  return typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' || Array.isArray(value) || (typeof value === 'object' && isPlainObject(value));
}

/** Structural check for the event ingestion request (throws never; returns false). */
export function isEventIngestionRequest(value: unknown): value is EventIngestionRequest {
  if (!isPlainObject(value)) {
    return false;
  }
  const actual = Object.keys(value);
  if (actual.length !== EVENT_REQUEST_KEYS.length) {
    return false;
  }
  if (!actual.every((key) => (EVENT_REQUEST_KEYS as readonly string[]).includes(key))) {
    return false;
  }
  if (typeof value['id'] !== 'string' || value['id'].length === 0) {
    return false;
  }
  if (typeof value['source'] !== 'string' || value['source'].length === 0) {
    return false;
  }
  if (typeof value['kind'] !== 'string' || value['kind'].length === 0) {
    return false;
  }
  if (typeof value['occurred_at'] !== 'string' || !RFC3339_PATTERN.test(value['occurred_at'])) {
    return false;
  }
  if (!isJsonOrNull(value['payload'])) {
    return false;
  }
  return isNonEmptyStringArray(value['provenance']);
}

/** Validated ingestion: the event was applied for the first time. */
export interface EventIngestionAccepted {
  status: 'APPLIED';
  event_id: string;
  source: string;
  kind: string;
  /** When the store accepted the event, RFC3339 (injected clock). */
  received_at: string;
}

/** Rejected replay: the event id was already ingested (delivery retried). */
export interface EventIngestionReplayed {
  status: 'DUPLICATE';
  event_id: string;
  /** When the event was FIRST applied, RFC3339. */
  first_received_at: string;
}

export type EventIngestionResponse = EventIngestionAccepted | EventIngestionReplayed;

/** Guard: the success half of an ingestion response. */
export function isEventIngestionAccepted(value: unknown): value is EventIngestionAccepted {
  if (!isPlainObject(value)) {
    return false;
  }
  return (
    value['status'] === 'APPLIED' &&
    typeof value['event_id'] === 'string' &&
    typeof value['source'] === 'string' &&
    typeof value['kind'] === 'string' &&
    typeof value['received_at'] === 'string'
  );
}

/** Guard: the replay half of an ingestion response. */
export function isEventIngestionReplayed(value: unknown): value is EventIngestionReplayed {
  if (!isPlainObject(value)) {
    return false;
  }
  return (
    value['status'] === 'DUPLICATE' &&
    typeof value['event_id'] === 'string' &&
    typeof value['first_received_at'] === 'string'
  );
}
