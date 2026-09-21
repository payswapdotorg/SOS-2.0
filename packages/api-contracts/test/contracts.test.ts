/**
 * api-contracts guard + codec tests (Work Order P2).
 *
 * Deterministic, offline, zero-dependency: every guard accepts its
 * legitimate shapes and rejects the documented forgeries; the cursor codec
 * round-trips; the typed error envelopes carry exactly the six kinds.
 */

import { describe, expect, test } from 'vitest';
import {
  API_ERROR_KINDS,
  type ApiErrorEnvelope,
  type EventIngestionRequest,
  type JsonValue,
  type ObservationEventRecord,
  type ProviderHealthRecord,
  type RevisionConflictRecord,
  type ServiceHealthResponse,
  clampPageLimit,
  decodeCursor,
  encodeCursor,
  isApiErrorEnvelope,
  isApiErrorKind,
  isCursorString,
  isDuplicateEventRecord,
  isEventDivergenceRecord,
  isEventIngestionRequest,
  isJsonValue,
  isObservationEventRecord,
  isProviderAvailabilityRecord,
  isProviderHealthRecord,
  isRecordResponse,
  isRecordWriteResponse,
  isRevisionConflictCode,
  isRevisionConflictRecord,
  isServiceHealthResponse,
  apiError,
} from '../src/index.js';

const EVENT: EventIngestionRequest = {
  event_id: 'gh-delivery-1001',
  source: 'github:webhook:payswapdotorg/SOS-2.0',
  event_kind: 'github:push',
  occurred_at: '2025-07-01T10:00:00Z',
  payload: { ref: 'refs/heads/main', after: 'c924e617650a243df9df7580e60d0e021fac1059' },
  subject_ref: null,
  provenance: ['webhook:github:delivery-1001'],
};

const EVENT_RECORD: ObservationEventRecord = {
  ...EVENT,
  ingested_at: '2025-07-01T10:00:01Z',
};

describe('json boundary guards', () => {
  test('accepts plain JSON values', () => {
    expect(isJsonValue(null)).toBe(true);
    expect(isJsonValue(true)).toBe(true);
    expect(isJsonValue(1.5)).toBe(true);
    expect(isJsonValue('x')).toBe(true);
    expect(isJsonValue([1, { a: 'b' }])).toBe(true);
    expect(isJsonValue({ a: [null, false] })).toBe(true);
  });

  test('rejects non-JSON values', () => {
    expect(isJsonValue(undefined)).toBe(false);
    expect(isJsonValue(Number.NaN)).toBe(false);
    expect(isJsonValue(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isJsonValue(() => 1)).toBe(false);
    expect(isJsonValue(new Date(0))).toBe(false);
    expect(isJsonValue({ a: undefined })).toBe(false);
    expect(isJsonValue(Symbol('x'))).toBe(false);
  });
});

describe('typed error envelopes', () => {
  test('exactly the six typed kinds', () => {
    expect(API_ERROR_KINDS).toEqual(['UNKNOWN', 'UNAVAILABLE', 'CONFLICT', 'DUPLICATE', 'NOT_FOUND', 'INVALID']);
  });

  test('apiError builds a valid envelope and the guard accepts it', () => {
    const envelope: ApiErrorEnvelope = apiError('CONFLICT', 'STALE_REVISION', 'stale revision', {
      current_revision: 3,
    });
    expect(isApiErrorEnvelope(envelope)).toBe(true);
    expect(envelope.error).toBe('CONFLICT');
    expect(envelope.details).toEqual({ current_revision: 3 });
  });

  test('the guard rejects forgeries', () => {
    expect(isApiErrorKind('MAYBE')).toBe(false);
    expect(isApiErrorEnvelope({ error: 'CONFLICT', code: 'x', message: 'y' })).toBe(false);
    expect(isApiErrorEnvelope({ error: 'MAYBE', code: 'x', message: 'y', details: null })).toBe(false);
    expect(isApiErrorEnvelope({ error: 'CONFLICT', code: '', message: 'y', details: null })).toBe(false);
    expect(isApiErrorEnvelope({ error: 'CONFLICT', code: 'x', message: 'y', details: undefined })).toBe(false);
    expect(apiError('INVALID', 'x', 'msg')).toEqual({ error: 'INVALID', code: 'x', message: 'msg', details: null });
  });
});

describe('revision conflict records', () => {
  const conflict: RevisionConflictRecord = {
    error_kind: 'CONFLICT',
    code: 'STALE_REVISION',
    repository: 'mission',
    record_id: 'sos://Mission/00000000000000000000000000000000',
    attempted_revision: 2,
    current_revision: 3,
    message: 'stale revision',
  };

  test('accepts a typed conflict and exposes the codes', () => {
    expect(isRevisionConflictRecord(conflict)).toBe(true);
    expect(isRevisionConflictCode('STALE_REVISION')).toBe(true);
    expect(isRevisionConflictCode('REVISION_DIVERGENCE')).toBe(true);
    expect(isRevisionConflictCode('NOPE')).toBe(false);
  });

  test('rejects forgeries (missing current revision, wrong kind, non-integer revisions)', () => {
    expect(isRevisionConflictRecord({ ...conflict, current_revision: 0 })).toBe(false);
    expect(isRevisionConflictRecord({ ...conflict, current_revision: 1.5 })).toBe(false);
    expect(isRevisionConflictRecord({ ...conflict, error_kind: 'DUPLICATE' })).toBe(false);
    expect(isRevisionConflictRecord({ ...conflict, code: 'NOPE' })).toBe(false);
    const { current_revision: _dropped, ...missing } = conflict;
    expect(isRevisionConflictRecord(missing)).toBe(false);
  });
});

describe('record response guards', () => {
  test('record response and write response', () => {
    expect(isRecordResponse({ record: { a: 1 }, revision: 2 })).toBe(true);
    expect(isRecordResponse({ record: { a: 1 }, revision: 0 })).toBe(false);
    expect(isRecordWriteResponse({ outcome: 'STORED', record: { a: 1 }, revision: 2 })).toBe(true);
    expect(isRecordWriteResponse({ outcome: 'IDEMPOTENT_REPLAY', record: { a: 1 }, revision: 2 })).toBe(true);
    expect(isRecordWriteResponse({ outcome: 'DUPLICATE', record: { a: 1 }, revision: 2 })).toBe(false);
  });
});

describe('cursor codec', () => {
  test('round-trips arbitrary sort keys', () => {
    for (const key of ['a', 'sos://Mission/abc', '2025-07-01T10:00:00Z\u0000evt-1', 'ключ-📘']) {
      const cursor = encodeCursor(key);
      expect(isCursorString(cursor)).toBe(true);
      expect(decodeCursor(cursor)).toBe(key);
    }
  });

  test('null/absent cursors decode to null; malformed cursors throw', () => {
    expect(decodeCursor(null)).toBeNull();
    expect(decodeCursor(undefined)).toBeNull();
    expect(decodeCursor('')).toBeNull();
    expect(() => decodeCursor('!!!not-base64url!!!')).toThrow(TypeError);
    // Valid base64url of a non-cursor JSON payload:
    const forged = Buffer.from('{"x":1}', 'utf8').toString('base64url');
    expect(() => decodeCursor(forged)).toThrow(TypeError);
    const forged2 = Buffer.from('{"k":42}', 'utf8').toString('base64url');
    expect(() => decodeCursor(forged2)).toThrow(TypeError);
  });

  test('limit clamping is deterministic', () => {
    expect(clampPageLimit(undefined)).toBe(50);
    expect(clampPageLimit(0)).toBe(1);
    expect(clampPageLimit(-5)).toBe(1);
    expect(clampPageLimit(10.9)).toBe(10);
    expect(clampPageLimit(500)).toBe(200);
    expect(clampPageLimit(Number.NaN)).toBe(50);
  });
});

describe('event ingestion payloads', () => {
  test('accepts the legitimate request and stored record', () => {
    expect(isEventIngestionRequest(EVENT)).toBe(true);
    expect(isObservationEventRecord(EVENT_RECORD)).toBe(true);
  });

  test('rejects requests missing replay identity or provenance', () => {
    const { event_id: _id, ...noId } = EVENT;
    expect(isEventIngestionRequest(noId)).toBe(false);
    const { provenance: _p, ...noProv } = EVENT;
    expect(isEventIngestionRequest(noProv)).toBe(false);
    expect(isEventIngestionRequest({ ...EVENT, provenance: [] })).toBe(false);
    expect(isEventIngestionRequest({ ...EVENT, occurred_at: '2025-07-01' })).toBe(false);
    expect(isEventIngestionRequest({ ...EVENT, payload: undefined })).toBe(false);
    expect(isEventIngestionRequest({ ...EVENT, subject_ref: '' })).toBe(false);
    expect(isObservationEventRecord(EVENT)).toBe(false);
    expect(isObservationEventRecord({ ...EVENT_RECORD, ingested_at: 'nope' })).toBe(false);
  });

  test('duplicate + divergence records are typed and guarded', () => {
    const duplicate = {
      error_kind: 'DUPLICATE',
      event_id: 'gh-delivery-1001',
      first_ingested_at: '2025-07-01T10:00:01Z',
      message: 'duplicate delivery detected and skipped (never double-applied)',
    };
    expect(isDuplicateEventRecord(duplicate)).toBe(true);
    expect(isDuplicateEventRecord({ ...duplicate, error_kind: 'CONFLICT' })).toBe(false);
    expect(isDuplicateEventRecord({ ...duplicate, first_ingested_at: 'x' })).toBe(false);

    const divergent = {
      error_kind: 'CONFLICT',
      code: 'EVENT_DIVERGENCE',
      event_id: 'gh-delivery-1001',
      first_ingested_at: '2025-07-01T10:00:01Z',
      message: 'same event id redelivered with different content',
    };
    expect(isEventDivergenceRecord(divergent)).toBe(true);
    expect(isEventDivergenceRecord({ ...divergent, code: 'STALE_REVISION' })).toBe(false);
  });
});

describe('provider health payloads', () => {
  const health: ProviderHealthRecord = {
    provider: 'redis:memory-reference',
    role: 'coordination (cache/idempotency/leases) — NEVER canonical',
    target: 'Upstash',
    implementation: 'in-memory-reference',
    availability: 'UP',
    code: null,
    canonical: false,
    detail: 'reference coordination layer',
  };

  test('accepts a typed provider health record', () => {
    expect(isProviderHealthRecord(health)).toBe(true);
  });

  test('rejects forgeries', () => {
    expect(isProviderHealthRecord({ ...health, availability: 'MAYBE' })).toBe(false);
    expect(isProviderHealthRecord({ ...health, canonical: 'no' })).toBe(false);
    expect(isProviderHealthRecord({ ...health, target: '' })).toBe(false);
    const { code: _c, ...noCode } = health;
    expect(isProviderHealthRecord(noCode)).toBe(false);
  });

  test('service health response guard', () => {
    const response: ServiceHealthResponse = {
      status: 'DEGRADED',
      providers: [health],
      coordination: [
        {
          provider: 'redis:memory-reference',
          code: 'CACHE_WRITE_FAILED',
          degraded_operations: 2,
          last_at: '2025-07-01T10:05:00Z',
          detail: 'cache write failed; semantic state intact (durable store authoritative)',
        },
      ],
      checked_at: '2025-07-01T10:05:00Z',
    };
    expect(isServiceHealthResponse(response)).toBe(true);
    expect(isServiceHealthResponse({ ...response, status: 'UP!' })).toBe(false);
    expect(isServiceHealthResponse({ ...response, providers: [{}] })).toBe(false);
  });

  test('provider availability record guard (typed UNAVAILABLE/UNKNOWN)', () => {
    expect(
      isProviderAvailabilityRecord({
        error_kind: 'UNAVAILABLE',
        provider: 'postgres:neon',
        code: 'CONNECTION_FAILED',
        detail: 'connection refused',
      }),
    ).toBe(true);
    expect(
      isProviderAvailabilityRecord({
        error_kind: 'UNKNOWN',
        provider: 'postgres:neon',
        code: 'OUTCOME_UNDETERMINED',
        detail: 'request timed out; outcome unknown',
      }),
    ).toBe(true);
    expect(isProviderAvailabilityRecord({ error_kind: 'FAILURE', provider: 'x', code: 'y', detail: 'z' })).toBe(false);
  });
});

describe('json value re-serialization', () => {
  test('canonical serialization of a wire payload is stable (spine-compatible JSON)', () => {
    const payload: JsonValue = EVENT.payload;
    // Structural equality survives a JSON round trip (the live store pins
    // BIT-EXACT canonical equality; here we pin that the wire value is
    // round-trip-safe JSON).
    expect(JSON.parse(JSON.stringify(payload))).toEqual(payload);
  });
});
