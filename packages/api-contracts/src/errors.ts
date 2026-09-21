/**
 * Typed error envelopes (Work Order P2).
 *
 * The live API never answers with an untyped string error: every failure is a
 * typed envelope carrying one of six codes —
 *
 *   UNKNOWN        an unexpected internal condition; nothing was fabricated
 *   UNAVAILABLE    a configured provider is failing (never silent success)
 *   CONFLICT       stale-revision / optimistic-concurrency rejection
 *   DUPLICATE      replayed event delivery (replay protection engaged)
 *   NOT_FOUND      unknown id / route
 *   INVALID        malformed or contract-violating request
 *
 * Provider-outage discipline (spec/productization-requirements.md: "Provider
 * outages remain truthful unknown/unavailable states"): UNAVAILABLE and
 * UNKNOWN are distinct codes and are never folded into success responses;
 * the truth-state vocabulary consumed here is the spine's frozen one.
 */

export const API_ERROR_CODES = [
  'UNKNOWN',
  'UNAVAILABLE',
  'CONFLICT',
  'DUPLICATE',
  'NOT_FOUND',
  'INVALID',
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

const API_ERROR_CODE_SET: ReadonlySet<string> = new Set(API_ERROR_CODES);

/** Structural check: is this one of the six typed API error codes? */
export function isApiErrorCode(value: unknown): value is ApiErrorCode {
  return typeof value === 'string' && API_ERROR_CODE_SET.has(value);
}

/**
 * The typed error body. `details` carries a structured JSON value whose shape
 * depends on the code (see the typed detail guards below).
 */
export interface ApiErrorEnvelope {
  error: {
    code: ApiErrorCode;
    message: string;
    details?: unknown;
  };
}

/** Typed details for CONFLICT (stale revision / optimistic concurrency). */
export interface ConflictErrorDetails {
  /** The record id the rejected write targeted. */
  id: string;
  /** The CURRENT stored revision (the conflict cause), or null for immutable records. */
  current_revision: number | null;
  /** Why the write conflicted: 'STALE_REVISION' | 'REVISION_MISMATCH' | 'IMMUTABLE_COLLISION'. */
  reason: string;
}

/** Typed details for DUPLICATE (replayed event delivery). */
export interface DuplicateErrorDetails {
  /** The replayed event id. */
  event_id: string;
  /** When the event was FIRST applied (RFC3339). */
  first_received_at: string;
}

const ERROR_ENVELOPE_KEYS = ['code', 'message', 'details'] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Structural check for the error envelope. */
export function isApiErrorEnvelope(value: unknown): value is ApiErrorEnvelope {
  if (!isPlainObject(value)) {
    return false;
  }
  const error = value['error'];
  if (!isPlainObject(error)) {
    return false;
  }
  const actual = Object.keys(error);
  if (!actual.every((key) => (ERROR_ENVELOPE_KEYS as readonly string[]).includes(key))) {
    return false;
  }
  if (!isApiErrorCode(error['code'])) {
    return false;
  }
  return typeof error['message'] === 'string' && error['message'].length > 0;
}

/** Structural check for CONFLICT details. */
export function isConflictErrorDetails(value: unknown): value is ConflictErrorDetails {
  if (!isPlainObject(value)) {
    return false;
  }
  const actual = Object.keys(value);
  if (actual.length !== 3) {
    return false;
  }
  if (!actual.every((key) => key === 'id' || key === 'current_revision' || key === 'reason')) {
    return false;
  }
  if (typeof value['id'] !== 'string' || value['id'].length === 0) {
    return false;
  }
  if (value['current_revision'] !== null && typeof value['current_revision'] !== 'number') {
    return false;
  }
  return typeof value['reason'] === 'string' && (value['reason'] as string).length > 0;
}

/** Structural check for DUPLICATE details. */
export function isDuplicateErrorDetails(value: unknown): value is DuplicateErrorDetails {
  if (!isPlainObject(value)) {
    return false;
  }
  const actual = Object.keys(value);
  if (actual.length !== 2) {
    return false;
  }
  if (!actual.every((key) => key === 'event_id' || key === 'first_received_at')) {
    return false;
  }
  return typeof value['event_id'] === 'string' && typeof value['first_received_at'] === 'string';
}

/**
 * The HTTP status each typed error code maps to. The mapping is part of the
 * contract (apps/api consumes it verbatim; a later Vercel-functions host
 * keeps the same mapping without contract change).
 */
export const API_ERROR_HTTP_STATUS: Readonly<Record<ApiErrorCode, number>> = {
  UNKNOWN: 500,
  UNAVAILABLE: 503,
  CONFLICT: 409,
  DUPLICATE: 409,
  NOT_FOUND: 404,
  INVALID: 400,
};

/** HTTP status for a typed error code. */
export function httpStatusForErrorCode(code: ApiErrorCode): number {
  return API_ERROR_HTTP_STATUS[code];
}

/** Build a typed error envelope. */
export function apiError(code: ApiErrorCode, message: string, details?: unknown): ApiErrorEnvelope {
  if (!isApiErrorCode(code)) {
    throw new TypeError(`untyped API error code: ${JSON.stringify(code)}`);
  }
  if (typeof message !== 'string' || message.length === 0) {
    throw new TypeError('API error message must be a non-empty string');
  }
  return details === undefined ? { error: { code, message } } : { error: { code, message, details } };
}
