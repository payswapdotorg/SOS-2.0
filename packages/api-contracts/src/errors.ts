/**
 * Typed error envelopes (Work Order P2).
 *
 * The API boundary NEVER returns an untyped failure. Every failure surface
 * is one of the six typed error kinds, each with a machine-readable code
 * and a human-readable message, and (where applicable) typed structured
 * details. In particular:
 *
 *   UNKNOWN       the outcome cannot be determined (never conflated with
 *                 UNAVAILABLE — the frozen truth-state discipline applies
 *                 to the boundary itself)
 *   UNAVAILABLE   a dependency/provider is down; the operation was NOT
 *                 performed (never fabricated success, never silent
 *                 absence-of-failure)
 *   CONFLICT      optimistic-concurrency failure (stale revision or
 *                 divergent same-revision write) — details carry the
 *                 CURRENT revision so the caller can retry forward
 *   DUPLICATE     replayed event delivery — detected and skipped, never
 *                 double-applied
 *   NOT_FOUND     the addressed record/route does not exist
 *   INVALID       the request payload failed validation (domain guards
 *                 reject loudly; their messages flow into `message`)
 */

import { isJsonObject, isJsonValue, type JsonValue } from './json.js';

export const API_ERROR_KINDS = [
  'UNKNOWN',
  'UNAVAILABLE',
  'CONFLICT',
  'DUPLICATE',
  'NOT_FOUND',
  'INVALID',
] as const;

export type ApiErrorKind = (typeof API_ERROR_KINDS)[number];

const API_ERROR_KIND_SET: ReadonlySet<string> = new Set(API_ERROR_KINDS);

export function isApiErrorKind(value: unknown): value is ApiErrorKind {
  return typeof value === 'string' && API_ERROR_KIND_SET.has(value);
}

/** The typed error envelope returned by every failing route. */
export interface ApiErrorEnvelope {
  /** The typed error kind (exactly one of the six). */
  error: ApiErrorKind;
  /** Machine-readable sub-code, e.g. STALE_REVISION, EVENT_REPLAYED, RECORD_VALIDATION_FAILED. */
  code: string;
  /** Human-readable explanation (deterministic given the same failure). */
  message: string;
  /** Structured, typed details when applicable (e.g. conflict revisions), or null. */
  details: JsonValue | null;
}

const ERROR_ENVELOPE_KEYS = ['error', 'code', 'message', 'details'] as const;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

export function isApiErrorEnvelope(value: unknown): value is ApiErrorEnvelope {
  if (!isJsonObject(value)) {
    return false;
  }
  const record = value as unknown as Record<string, unknown>;
  const actual = Object.keys(record);
  if (actual.length !== ERROR_ENVELOPE_KEYS.length) {
    return false;
  }
  if (!ERROR_ENVELOPE_KEYS.every((key) => Object.prototype.hasOwnProperty.call(record, key))) {
    return false;
  }
  if (!isApiErrorKind(record['error'])) {
    return false;
  }
  if (!isNonEmptyString(record['code']) || !isNonEmptyString(record['message'])) {
    return false;
  }
  if (record['details'] !== null && !isJsonValue(record['details'])) {
    return false;
  }
  return true;
}

/** Build a typed error envelope (deterministic; the single constructor used by apps/api). */
export function apiError(
  error: ApiErrorKind,
  code: string,
  message: string,
  details: JsonValue | null = null,
): ApiErrorEnvelope {
  if (!isApiErrorKind(error)) {
    throw new TypeError(`not an API error kind: ${JSON.stringify(error)}`);
  }
  if (!isNonEmptyString(code)) {
    throw new TypeError(`error code must be a non-empty string, received: ${JSON.stringify(code)}`);
  }
  if (!isNonEmptyString(message)) {
    throw new TypeError(`error message must be a non-empty string, received: ${JSON.stringify(message)}`);
  }
  return { error, code, message, details };
}
