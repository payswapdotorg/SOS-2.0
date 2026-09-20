/**
 * OpenTelemetry-compatible adapter — ADAPTER/SUBSTRATE ONLY.
 *
 * Per the reference stack (docs/implementation/REFERENCE-STACK.md) an OTel
 * backend implements the evidence-ingestion contract: OTel-shaped data
 * (spans, metric datapoints, log records) is CONVERTED into raw observation
 * records. The OTel shapes are modeled HERE as plain types — no OTel SDK is
 * imported at runtime (zero runtime deps beyond the workspace spine and
 * provenance packages); conversion is pure, total on valid input and
 * deterministic (pinned by golden fixtures).
 *
 * Conversion rules (documented, deterministic):
 *   - subject_ref:    "otel:service:<resource.attributes['service.name']>"
 *                     (service.name is REQUIRED — without it the subject of
 *                     the observation is unknowable and conversion fails loudly)
 *   - availability:   span status ERROR -> FAILURE, OK -> SUCCESS,
 *                     UNSET -> UNKNOWN (unknown is NOT unavailable);
 *                     metric datapoint -> SUCCESS (presence semantics: a
 *                     value was observed; outcome interpretation belongs to
 *                     the evidence layer's threshold methods);
 *                     log record -> FAILURE when severity >= ERROR (17),
 *                     otherwise UNKNOWN (an event was observed; the subject
 *                     outcome is undetermined)
 *   - window:         RFC3339 with millisecond precision derived from
 *                     start/end unix nano (full nano precision is preserved
 *                     inside the observed payload)
 *   - producer:       derived from OTel resource attributes
 *                     (telemetry.sdk.version, deployment.environment.name)
 *   - attributes:     the OTel resource attributes (normalized, JSON-safe)
 *   - observed:       the signal-specific payload (status, severity, value,
 *                     ids, full nano timestamps, span/log attributes)
 */

import type { EvidenceTruthState, JsonValue } from '@sos-2/semantic-spine';
import { assertValidProducer } from '@sos-2/provenance';
import type { Producer } from '@sos-2/provenance';
import { assertValidTimeWindow } from '@sos-2/provenance';
import { TelemetryError } from './errors.js';
import { assertValidRawObservation } from './observation.js';
import type { RawObservation } from './observation.js';

// ---------------------------------------------------------------------------
// Modeled OTel shapes (no SDK imports).
// ---------------------------------------------------------------------------

export type OtelAttributeValue = string | number | boolean | Array<string | number | boolean>;

export interface OtelResource {
  attributes: Record<string, OtelAttributeValue>;
}

export const OTEL_SPAN_KINDS = ['INTERNAL', 'SERVER', 'CLIENT', 'PRODUCER', 'CONSUMER'] as const;
export type OtelSpanKind = (typeof OTEL_SPAN_KINDS)[number];

export const OTEL_STATUS_CODES = ['UNSET', 'OK', 'ERROR'] as const;
export type OtelStatusCode = (typeof OTEL_STATUS_CODES)[number];

export interface OtelSpanStatus {
  code: OtelStatusCode;
  /** Optional status message (for ERROR), or null. */
  message?: string | null;
}

export interface OtelSpan {
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  name: string;
  kind: OtelSpanKind;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  status: OtelSpanStatus;
  attributes: Record<string, OtelAttributeValue>;
  resource: OtelResource;
}

export const OTEL_METRIC_KINDS = ['GAUGE', 'SUM', 'HISTOGRAM'] as const;
export type OtelMetricKind = (typeof OTEL_METRIC_KINDS)[number];

export interface OtelMetricDataPoint {
  metricName: string;
  metricKind: OtelMetricKind;
  timeUnixNano: string;
  value: number;
  attributes: Record<string, OtelAttributeValue>;
  resource: OtelResource;
}

/** OTel severity numbers (subset boundary values). ERROR is 17. */
export const OTEL_SEVERITY_ERROR = 17;
export const OTEL_SEVERITY = {
  TRACE: 1,
  DEBUG: 5,
  INFO: 9,
  WARN: 13,
  ERROR: OTEL_SEVERITY_ERROR,
  FATAL: 21,
} as const;

export interface OtelLogRecord {
  timeUnixNano: string;
  severityNumber: number;
  severityText: string;
  body: string | null;
  attributes: Record<string, OtelAttributeValue>;
  resource: OtelResource;
  traceId?: string | null;
  spanId?: string | null;
}

// ---------------------------------------------------------------------------
// Validation helpers.
// ---------------------------------------------------------------------------

const TRACE_ID_PATTERN = /^[0-9a-f]{32}$/;
const SPAN_ID_PATTERN = /^[0-9a-f]{16}$/;
const UNIX_NANO_PATTERN = /^[0-9]{1,19}$/;

function isOtelAttributeValue(value: unknown): boolean {
  if (typeof value === 'string' || typeof value === 'boolean') {
    return true;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value);
  }
  if (Array.isArray(value)) {
    return value.every((entry) => typeof entry === 'string' || typeof entry === 'boolean' || (typeof entry === 'number' && Number.isFinite(entry)));
  }
  return false;
}

function assertValidAttributes(attributes: unknown, field: string): asserts attributes is Record<string, OtelAttributeValue> {
  if (typeof attributes !== 'object' || attributes === null || Array.isArray(attributes)) {
    throw new TelemetryError(`${field} must be a plain object of OTel attributes`);
  }
  for (const [key, value] of Object.entries(attributes as Record<string, unknown>)) {
    if (key.length === 0) {
      throw new TelemetryError(`${field} keys must be non-empty strings`);
    }
    if (!isOtelAttributeValue(value)) {
      throw new TelemetryError(`${field}.${key} is not a valid OTel attribute value (finite number, string, boolean, or homogeneous array thereof)`);
    }
  }
}

function assertValidResource(resource: unknown): asserts resource is OtelResource {
  if (typeof resource !== 'object' || resource === null || Array.isArray(resource)) {
    throw new TelemetryError('OTel resource must be an object with an attributes object');
  }
  const record = resource as Record<string, unknown>;
  if (Object.keys(record).length !== 1 || !('attributes' in record)) {
    throw new TelemetryError('OTel resource must be an object with the exact field { attributes }');
  }
  assertValidAttributes(record['attributes'], 'resource.attributes');
  const serviceName = (record['attributes'] as Record<string, OtelAttributeValue>)['service.name'];
  if (typeof serviceName !== 'string' || serviceName.length === 0) {
    throw new TelemetryError(
      `OTel resource requires a non-empty string attribute service.name (the observation subject is unknowable without it), received: ${JSON.stringify(serviceName)}`,
    );
  }
}

function assertValidUnixNano(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || !UNIX_NANO_PATTERN.test(value)) {
    throw new TelemetryError(`${field} must be a string of decimal unix-nanoseconds (max 19 digits), received: ${JSON.stringify(value)}`);
  }
}

function assertValidId(value: unknown, field: string, pattern: RegExp): asserts value is string {
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new TelemetryError(`${field} must match ${pattern.source}, received: ${JSON.stringify(value)}`);
  }
}

// ---------------------------------------------------------------------------
// Deterministic conversion helpers.
// ---------------------------------------------------------------------------

/** Unix nanoseconds (decimal string) -> RFC3339 with millisecond precision (UTC). */
export function nanosToRfc3339(nanos: string): string {
  assertValidUnixNano(nanos, 'nanos');
  const ms = Number(BigInt(nanos) / 1_000_000n);
  const date = new Date(ms);
  if (!Number.isFinite(date.getTime())) {
    throw new TelemetryError(`unix nanoseconds out of representable range: ${nanos}`);
  }
  return date.toISOString();
}

function nanosToRfc3339OrThrow(nanos: string, field: string): string {
  try {
    return nanosToRfc3339(nanos);
  } catch (cause) {
    throw new TelemetryError(`${field}: ${(cause as Error).message}`);
  }
}

function resourceString(resource: OtelResource, key: string): string | null {
  const value = resource.attributes[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function subjectOf(resource: OtelResource): string {
  const service = resource.attributes['service.name'];
  return `otel:service:${service}`;
}

function producerFromResource(resource: OtelResource): Producer {
  const environment =
    resourceString(resource, 'deployment.environment.name') ??
    resourceString(resource, 'deployment.environment') ??
    resourceString(resource, 'service.namespace');
  const producer: Producer = {
    tool: 'opentelemetry',
    tool_version: resourceString(resource, 'telemetry.sdk.version'),
    model: null,
    model_version: null,
    command: null,
    environment,
  };
  assertValidProducer(producer);
  return producer;
}

function normalizedResourceAttributes(resource: OtelResource): Record<string, JsonValue> {
  return { ...(resource.attributes as Record<string, JsonValue>) };
}

function spanAvailability(status: OtelSpanStatus): EvidenceTruthState {
  switch (status.code) {
    case 'ERROR':
      return 'FAILURE';
    case 'OK':
      return 'SUCCESS';
    case 'UNSET':
    default:
      return 'UNKNOWN';
  }
}

function logAvailability(severityNumber: number): EvidenceTruthState {
  return severityNumber >= OTEL_SEVERITY_ERROR ? 'FAILURE' : 'UNKNOWN';
}

// ---------------------------------------------------------------------------
// Converters.
// ---------------------------------------------------------------------------

/** Validate an OTel span shape (throws TelemetryError). */
export function assertValidOtelSpan(value: unknown): asserts value is OtelSpan {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TelemetryError('OTel span must be an object');
  }
  const record = value as Record<string, unknown>;
  const required = ['traceId', 'spanId', 'parentSpanId', 'name', 'kind', 'startTimeUnixNano', 'endTimeUnixNano', 'status', 'attributes', 'resource'];
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) {
      throw new TelemetryError(`OTel span is missing required field: ${key}`);
    }
  }
  assertValidId(record['traceId'], 'traceId', TRACE_ID_PATTERN);
  assertValidId(record['spanId'], 'spanId', SPAN_ID_PATTERN);
  if (record['parentSpanId'] !== null && (typeof record['parentSpanId'] !== 'string' || !SPAN_ID_PATTERN.test(record['parentSpanId']))) {
    throw new TelemetryError(`parentSpanId must be null or match ${SPAN_ID_PATTERN.source}, received: ${JSON.stringify(record['parentSpanId'])}`);
  }
  if (typeof record['name'] !== 'string' || record['name'].length === 0) {
    throw new TelemetryError(`span name must be a non-empty string, received: ${JSON.stringify(record['name'])}`);
  }
  if (typeof record['kind'] !== 'string' || !(OTEL_SPAN_KINDS as readonly string[]).includes(record['kind'])) {
    throw new TelemetryError(`span kind must be one of ${OTEL_SPAN_KINDS.join('|')}, received: ${JSON.stringify(record['kind'])}`);
  }
  assertValidUnixNano(record['startTimeUnixNano'], 'startTimeUnixNano');
  assertValidUnixNano(record['endTimeUnixNano'], 'endTimeUnixNano');
  if (BigInt(record['endTimeUnixNano']) < BigInt(record['startTimeUnixNano'])) {
    throw new TelemetryError('span endTimeUnixNano must not precede startTimeUnixNano');
  }
  const status = record['status'];
  if (typeof status !== 'object' || status === null || Array.isArray(status)) {
    throw new TelemetryError('span status must be an object { code, message? }');
  }
  const statusRecord = status as Record<string, unknown>;
  if (typeof statusRecord['code'] !== 'string' || !(OTEL_STATUS_CODES as readonly string[]).includes(statusRecord['code'])) {
    throw new TelemetryError(`span status code must be one of ${OTEL_STATUS_CODES.join('|')}, received: ${JSON.stringify(statusRecord['code'])}`);
  }
  if (
    statusRecord['message'] !== undefined &&
    statusRecord['message'] !== null &&
    (typeof statusRecord['message'] !== 'string' || statusRecord['message'].length === 0)
  ) {
    throw new TelemetryError('span status message must be null or a non-empty string');
  }
  assertValidAttributes(record['attributes'], 'span.attributes');
  assertValidResource(record['resource']);
}

/** Convert an OTel span to a raw observation (deterministic). */
export function convertOtelSpan(span: OtelSpan): RawObservation {
  assertValidOtelSpan(span);
  const start = nanosToRfc3339OrThrow(span.startTimeUnixNano, 'startTimeUnixNano');
  const end = nanosToRfc3339OrThrow(span.endTimeUnixNano, 'endTimeUnixNano');
  const durationMs = Number((BigInt(span.endTimeUnixNano) - BigInt(span.startTimeUnixNano)) / 1_000_000n);
  const observation: RawObservation = {
    subject_ref: subjectOf(span.resource),
    availability: spanAvailability(span.status),
    window: { start, end },
    observed: {
      signal: 'span',
      name: span.name,
      kind: span.kind,
      status_code: span.status.code,
      status_message: span.status.message ?? null,
      trace_id: span.traceId,
      span_id: span.spanId,
      parent_span_id: span.parentSpanId,
      duration_ms: durationMs,
      start_time_unix_nano: span.startTimeUnixNano,
      end_time_unix_nano: span.endTimeUnixNano,
      span_attributes: { ...(span.attributes as Record<string, JsonValue>) },
    },
    attributes: normalizedResourceAttributes(span.resource),
    producer: producerFromResource(span.resource),
  };
  assertValidRawObservation(observation);
  assertValidTimeWindow(observation.window);
  return observation;
}

/** Validate an OTel metric datapoint shape (throws TelemetryError). */
export function assertValidOtelMetricDataPoint(value: unknown): asserts value is OtelMetricDataPoint {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TelemetryError('OTel metric datapoint must be an object');
  }
  const record = value as Record<string, unknown>;
  const required = ['metricName', 'metricKind', 'timeUnixNano', 'value', 'attributes', 'resource'];
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) {
      throw new TelemetryError(`OTel metric datapoint is missing required field: ${key}`);
    }
  }
  if (typeof record['metricName'] !== 'string' || record['metricName'].length === 0) {
    throw new TelemetryError(`metricName must be a non-empty string, received: ${JSON.stringify(record['metricName'])}`);
  }
  if (typeof record['metricKind'] !== 'string' || !(OTEL_METRIC_KINDS as readonly string[]).includes(record['metricKind'])) {
    throw new TelemetryError(`metricKind must be one of ${OTEL_METRIC_KINDS.join('|')}, received: ${JSON.stringify(record['metricKind'])}`);
  }
  assertValidUnixNano(record['timeUnixNano'], 'timeUnixNano');
  if (typeof record['value'] !== 'number' || !Number.isFinite(record['value'])) {
    throw new TelemetryError(`metric value must be a finite number, received: ${JSON.stringify(record['value'])}`);
  }
  assertValidAttributes(record['attributes'], 'metric.attributes');
  assertValidResource(record['resource']);
}

/** Convert an OTel metric datapoint to a raw observation (deterministic). */
export function convertOtelMetricDataPoint(point: OtelMetricDataPoint): RawObservation {
  assertValidOtelMetricDataPoint(point);
  const time = nanosToRfc3339OrThrow(point.timeUnixNano, 'timeUnixNano');
  const observation: RawObservation = {
    subject_ref: subjectOf(point.resource),
    availability: 'SUCCESS',
    window: { start: time, end: time },
    observed: {
      signal: 'metric',
      metric_name: point.metricName,
      metric_kind: point.metricKind,
      value: point.value,
      time_unix_nano: point.timeUnixNano,
      metric_attributes: { ...(point.attributes as Record<string, JsonValue>) },
    },
    attributes: normalizedResourceAttributes(point.resource),
    producer: producerFromResource(point.resource),
  };
  assertValidRawObservation(observation);
  return observation;
}

/** Validate an OTel log record shape (throws TelemetryError). */
export function assertValidOtelLogRecord(value: unknown): asserts value is OtelLogRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TelemetryError('OTel log record must be an object');
  }
  const record = value as Record<string, unknown>;
  const required = ['timeUnixNano', 'severityNumber', 'severityText', 'body', 'attributes', 'resource'];
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) {
      throw new TelemetryError(`OTel log record is missing required field: ${key}`);
    }
  }
  assertValidUnixNano(record['timeUnixNano'], 'timeUnixNano');
  if (typeof record['severityNumber'] !== 'number' || !Number.isInteger(record['severityNumber']) || record['severityNumber'] < 1 || record['severityNumber'] > 24) {
    throw new TelemetryError(`severityNumber must be an integer in [1, 24], received: ${JSON.stringify(record['severityNumber'])}`);
  }
  if (typeof record['severityText'] !== 'string' || record['severityText'].length === 0) {
    throw new TelemetryError(`severityText must be a non-empty string, received: ${JSON.stringify(record['severityText'])}`);
  }
  if (record['body'] !== null && (typeof record['body'] !== 'string' || record['body'].length === 0)) {
    throw new TelemetryError('log body must be null or a non-empty string');
  }
  if (record['traceId'] !== undefined && record['traceId'] !== null) {
    assertValidId(record['traceId'], 'traceId', TRACE_ID_PATTERN);
  }
  if (record['spanId'] !== undefined && record['spanId'] !== null) {
    assertValidId(record['spanId'], 'spanId', SPAN_ID_PATTERN);
  }
  assertValidAttributes(record['attributes'], 'log.attributes');
  assertValidResource(record['resource']);
}

/** Convert an OTel log record to a raw observation (deterministic). */
export function convertOtelLogRecord(log: OtelLogRecord): RawObservation {
  assertValidOtelLogRecord(log);
  const time = nanosToRfc3339OrThrow(log.timeUnixNano, 'timeUnixNano');
  const observation: RawObservation = {
    subject_ref: subjectOf(log.resource),
    availability: logAvailability(log.severityNumber),
    window: { start: time, end: time },
    observed: {
      signal: 'log',
      severity_number: log.severityNumber,
      severity_text: log.severityText,
      body: log.body,
      trace_id: log.traceId ?? null,
      span_id: log.spanId ?? null,
      time_unix_nano: log.timeUnixNano,
      log_attributes: { ...(log.attributes as Record<string, JsonValue>) },
    },
    attributes: normalizedResourceAttributes(log.resource),
    producer: producerFromResource(log.resource),
  };
  assertValidRawObservation(observation);
  return observation;
}

/** An OTel-shaped batch of signals. */
export interface OtelBatch {
  spans?: OtelSpan[];
  metrics?: OtelMetricDataPoint[];
  logs?: OtelLogRecord[];
}

/**
 * Convert a batch of OTel-shaped signals: spans first, then metric
 * datapoints, then log records (deterministic order). Invalid entries fail
 * loudly (telemetry ingestion VALIDATES).
 */
export function convertOtelBatch(batch: OtelBatch): RawObservation[] {
  if (typeof batch !== 'object' || batch === null || Array.isArray(batch)) {
    throw new TelemetryError('OTel batch must be an object { spans?, metrics?, logs? }');
  }
  const observations: RawObservation[] = [];
  for (const span of batch.spans ?? []) {
    observations.push(convertOtelSpan(span));
  }
  for (const point of batch.metrics ?? []) {
    observations.push(convertOtelMetricDataPoint(point));
  }
  for (const log of batch.logs ?? []) {
    observations.push(convertOtelLogRecord(log));
  }
  return observations;
}
