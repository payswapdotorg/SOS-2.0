/**
 * Observation event records (Work Order P2 — the Observation Plane boundary).
 *
 * spec/productization-execution-architecture.md §5: "Continuous governance
 * does not require a permanent coding agent. The Observation Plane consumes
 * GitHub webhooks and repository events, CI/build/test/security events,
 * deployment events, runtime logs/metrics/traces, incidents and provider
 * health signals, scheduled probes and explicit user observations."
 *
 * EVERY EVENT CARRIES AN ID (hard rule): the id is the replay-protection
 * key — duplicate delivery is detected against the DURABLE event index and
 * answered with a typed DUPLICATE record, never double-applied.
 *
 * The payload is an OPAQUE canonical-JSON value preserved VERBATIM: the
 * store never interprets, merges or rewrites observation content. Truth
 * states inside payloads (e.g. an UNAVAILABLE telemetry capture) survive
 * ingestion bit-exact and are never folded into success or zero.
 *
 * `received_at` is stamped by the INJECTED clock (no hidden clocks). This
 * record is execution-fabric vocabulary (P2's own boundary), NOT a Semantic
 * Spine artifact: observation events are pre-semantic input, mirroring
 * @sos-2/telemetry's RawObservation discipline ("telemetry is input, not
 * semantic truth").
 */

import { canonicalSerialize } from '@sos-2/semantic-spine';
import { InvalidRecordError } from '../errors.js';
import type { JsonValue } from '@sos-2/semantic-spine';

export const OBSERVATION_EVENT_NAMESPACE = 'observation-event';

/** The input an ingestion caller supplies (received_at is clock-stamped). */
export interface ObservationEventInput {
  /** REQUIRED delivery-level event id (replay-protection key). */
  id: string;
  /** Stable source identifier, e.g. "github:webhook:payswapdotorg/SOS-2.0". */
  source: string;
  /** Event kind, e.g. "ci.run", "deployment", "telemetry.observation". */
  kind: string;
  /** When the event occurred, RFC3339 (caller-supplied). */
  occurred_at: string;
  /** Opaque canonical-JSON payload, stored verbatim. */
  payload: JsonValue;
  /** Provenance entries (at least one non-empty string). */
  provenance: string[];
}

/** The stored observation event (the input plus the clock-stamped receipt). */
export interface ObservationEventRecord extends ObservationEventInput {
  /** When the store accepted the event, RFC3339 (injected clock). */
  received_at: string;
}

/** RFC3339 (the same pattern the spine enforces). */
export const RFC3339_PATTERN = /^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isNonEmptyStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every((entry) => typeof entry === 'string' && entry.length > 0);
}

/** Validate an event input (throws InvalidRecordError with a precise message). */
export function assertValidObservationEventInput(value: unknown): asserts value is ObservationEventInput {
  if (!isPlainObject(value)) {
    throw new InvalidRecordError(OBSERVATION_EVENT_NAMESPACE, 'observation event must be an object');
  }
  const actual = Object.keys(value);
  const expected = ['id', 'source', 'kind', 'occurred_at', 'payload', 'provenance'];
  if (actual.length !== expected.length || !expected.every((key) => actual.includes(key))) {
    throw new InvalidRecordError(
      OBSERVATION_EVENT_NAMESPACE,
      'observation event must have the exact field set { id, source, kind, occurred_at, payload, provenance }',
    );
  }
  if (!isNonEmptyString(value['id'])) {
    throw new InvalidRecordError(OBSERVATION_EVENT_NAMESPACE, `event id must be a non-empty string, received: ${JSON.stringify(value['id'])}`);
  }
  if (!isNonEmptyString(value['source'])) {
    throw new InvalidRecordError(OBSERVATION_EVENT_NAMESPACE, `event source must be a non-empty string, received: ${JSON.stringify(value['source'])}`);
  }
  if (!isNonEmptyString(value['kind'])) {
    throw new InvalidRecordError(OBSERVATION_EVENT_NAMESPACE, `event kind must be a non-empty string, received: ${JSON.stringify(value['kind'])}`);
  }
  if (typeof value['occurred_at'] !== 'string' || !RFC3339_PATTERN.test(value['occurred_at'])) {
    throw new InvalidRecordError(
      OBSERVATION_EVENT_NAMESPACE,
      `event occurred_at must be an RFC3339 timestamp, received: ${JSON.stringify(value['occurred_at'])}`,
    );
  }
  try {
    canonicalSerialize(value['payload']);
  } catch {
    throw new InvalidRecordError(OBSERVATION_EVENT_NAMESPACE, 'event payload must be a canonical-JSON value');
  }
  if (!isNonEmptyStringArray(value['provenance'])) {
    throw new InvalidRecordError(
      OBSERVATION_EVENT_NAMESPACE,
      'event provenance must be a non-empty array of non-empty strings',
    );
  }
}

/** Validate a stored observation event record (adds received_at). */
export function assertValidObservationEventRecord(value: unknown): asserts value is ObservationEventRecord {
  if (!isPlainObject(value)) {
    throw new InvalidRecordError(OBSERVATION_EVENT_NAMESPACE, 'observation event record must be an object');
  }
  const actual = Object.keys(value);
  const expected = ['id', 'source', 'kind', 'occurred_at', 'payload', 'provenance', 'received_at'];
  if (actual.length !== expected.length || !expected.every((key) => actual.includes(key))) {
    throw new InvalidRecordError(
      OBSERVATION_EVENT_NAMESPACE,
      'observation event record must have the exact field set { id, source, kind, occurred_at, payload, provenance, received_at }',
    );
  }
  assertValidObservationEventInput({
    id: value['id'],
    source: value['source'],
    kind: value['kind'],
    occurred_at: value['occurred_at'] as string,
    payload: value['payload'] as JsonValue,
    provenance: value['provenance'] as string[],
  });
  if (typeof value['received_at'] !== 'string' || !RFC3339_PATTERN.test(value['received_at'])) {
    throw new InvalidRecordError(
      OBSERVATION_EVENT_NAMESPACE,
      `received_at must be an RFC3339 timestamp, received: ${JSON.stringify(value['received_at'])}`,
    );
  }
}
