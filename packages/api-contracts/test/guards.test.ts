/**
 * api-contracts guards — typed envelopes, cursors, headers, event payloads
 * and health payloads (deterministic; no network, no clock, no random).
 */

import { describe, expect, it } from 'vitest';
import {
  API_ERROR_HTTP_STATUS,
  API_ROUTES,
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
  apiError,
  decodePageCursor,
  encodePageCursor,
  isApiErrorEnvelope,
  isConflictErrorDetails,
  isDuplicateErrorDetails,
  isEventIngestionAccepted,
  isEventIngestionReplayed,
  isEventIngestionRequest,
  isHealthReportPayload,
  isProviderHealthPayload,
  parseExpectedRevision,
  parseListQuery,
  recordResponseHeaders,
  ARTIFACT_ID_HEADER,
  EXPECTED_REVISION_HEADER,
  REVISION_HEADER,
} from '../src/index.js';

describe('typed error envelopes', () => {
  it('builds and guards error envelopes for all six codes', () => {
    for (const code of ['UNKNOWN', 'UNAVAILABLE', 'CONFLICT', 'DUPLICATE', 'NOT_FOUND', 'INVALID'] as const) {
      const envelope = apiError(code, 'message');
      expect(isApiErrorEnvelope(envelope)).toBe(true);
      expect(envelope.error.code).toBe(code);
      expect(envelope.error.details).toBeUndefined();
      expect(API_ERROR_HTTP_STATUS[code]).toBeGreaterThan(0);
    }
    expect(apiError('CONFLICT', 'stale', { id: 'x', current_revision: 2, reason: 'STALE_REVISION' }).error.details)
      .toEqual({ id: 'x', current_revision: 2, reason: 'STALE_REVISION' });
  });

  it('rejects untyped or malformed envelopes', () => {
    expect(isApiErrorEnvelope(null)).toBe(false);
    expect(isApiErrorEnvelope({ error: { code: 'MAYBE', message: 'x' } })).toBe(false);
    expect(isApiErrorEnvelope({ error: { code: 'INVALID' } })).toBe(false);
    expect(isApiErrorEnvelope({ error: { code: 'INVALID', message: '' } })).toBe(false);
    expect(() => apiError('MAYBE' as never, 'x')).toThrow();
  });

  it('keeps UNKNOWN and UNAVAILABLE distinct with different HTTP statuses', () => {
    expect(API_ERROR_HTTP_STATUS['UNKNOWN']).toBe(500);
    expect(API_ERROR_HTTP_STATUS['UNAVAILABLE']).toBe(503);
    expect(API_ERROR_HTTP_STATUS['CONFLICT']).toBe(409);
    expect(API_ERROR_HTTP_STATUS['DUPLICATE']).toBe(409);
    expect(API_ERROR_HTTP_STATUS['NOT_FOUND']).toBe(404);
    expect(API_ERROR_HTTP_STATUS['INVALID']).toBe(400);
  });

  it('guards typed conflict and duplicate details', () => {
    expect(isConflictErrorDetails({ id: 'sos://Mission/abc', current_revision: 3, reason: 'STALE_REVISION' })).toBe(true);
    expect(isConflictErrorDetails({ id: 'sos://Evidence/abc', current_revision: null, reason: 'IMMUTABLE_COLLISION' })).toBe(true);
    expect(isConflictErrorDetails({ id: 'x', current_revision: '3', reason: 'STALE_REVISION' })).toBe(false);
    expect(isConflictErrorDetails({ id: 'x', current_revision: 3 })).toBe(false);
    expect(isDuplicateErrorDetails({ event_id: 'evt-1', first_received_at: '2026-01-01T00:00:00Z' })).toBe(true);
    expect(isDuplicateErrorDetails({ event_id: 'evt-1' })).toBe(false);
    expect(isDuplicateErrorDetails({ event_id: 'evt-1', first_received_at: 42 })).toBe(false);
  });
});

describe('pagination cursors', () => {
  it('round-trips a cursor deterministically', () => {
    const cursor = encodePageCursor('sos://Mission/0000000000000000000000000000000a', 25);
    expect(cursor).toBe(encodePageCursor('sos://Mission/0000000000000000000000000000000a', 25));
    const decoded = decodePageCursor(cursor);
    expect(decoded).toEqual({ after: 'sos://Mission/0000000000000000000000000000000a', limit: 25 });
  });

  it('rejects malformed cursors with null (never a silent reset)', () => {
    expect(decodePageCursor('not-a-cursor!!!')).toBeNull();
    expect(decodePageCursor(Buffer.from('{"after":1,"limit":5}').toString('base64url'))).toBeNull();
    expect(decodePageCursor(Buffer.from('{"after":"a","limit":0}').toString('base64url'))).toBeNull();
    expect(decodePageCursor(Buffer.from('{"after":"a","limit":9999}').toString('base64url'))).toBeNull();
    expect(decodePageCursor(Buffer.from('{"after":"a"}').toString('base64url'))).toBeNull();
  });

  it('parses list queries with typed errors', () => {
    expect(parseListQuery({})).toEqual({ ok: true, request: { limit: DEFAULT_PAGE_LIMIT, cursor: null } });
    expect(parseListQuery({ limit: '10' })).toEqual({ ok: true, request: { limit: 10, cursor: null } });
    expect(parseListQuery({ limit: '0' }).ok).toBe(false);
    expect(parseListQuery({ limit: String(MAX_PAGE_LIMIT + 1) }).ok).toBe(false);
    expect(parseListQuery({ limit: 'x' }).ok).toBe(false);
    expect(parseListQuery({ cursor: 'garbage' }).ok).toBe(false);
    const cursor = encodePageCursor('after-id', 7);
    expect(parseListQuery({ cursor })).toEqual({ ok: true, request: { limit: 7, cursor } });
  });
});

describe('revision headers', () => {
  it('emits artifact id and revision headers, omitting revision for immutable records', () => {
    expect(recordResponseHeaders('sos://Mission/abc', 4)).toEqual({
      [ARTIFACT_ID_HEADER]: 'sos://Mission/abc',
      [REVISION_HEADER]: '4',
    });
    expect(recordResponseHeaders('sos://Evidence/abc', null)).toEqual({
      [ARTIFACT_ID_HEADER]: 'sos://Evidence/abc',
    });
  });

  it('parses expected-revision headers with typed errors', () => {
    expect(parseExpectedRevision(undefined)).toEqual({ ok: true, revision: null });
    expect(parseExpectedRevision('5')).toEqual({ ok: true, revision: 5 });
    expect(parseExpectedRevision('0').ok).toBe(false);
    expect(parseExpectedRevision('abc').ok).toBe(false);
    expect(parseExpectedRevision('2.5').ok).toBe(false);
    expect(parseExpectedRevision('')).toEqual({ ok: true, revision: null });
    expect(EXPECTED_REVISION_HEADER).toBe('x-sos-expected-revision');
  });
});

describe('event ingestion payloads', () => {
  const request = {
    id: 'evt-0001',
    source: 'github:webhook:payswapdotorg/SOS-2.0',
    kind: 'ci.run',
    occurred_at: '2026-01-02T03:04:05Z',
    payload: { availability: 'UNAVAILABLE', subject_ref: 'otel:service:checkout' },
    provenance: ['webhook:delivery:1'],
  };

  it('guards a well-formed ingestion request', () => {
    expect(isEventIngestionRequest(request)).toBe(true);
  });

  it('rejects requests without an id or provenance (hard rules)', () => {
    expect(isEventIngestionRequest({ ...request, id: '' })).toBe(false);
    expect(isEventIngestionRequest({ ...request, id: 42 })).toBe(false);
    expect(isEventIngestionRequest({ ...request, provenance: [] })).toBe(false);
    expect(isEventIngestionRequest({ ...request, occurred_at: 'not-rfc3339' })).toBe(false);
    expect(isEventIngestionRequest({ ...request, extra: 1 })).toBe(false);
    expect(isEventIngestionRequest(null)).toBe(false);
  });

  it('guards ingestion responses', () => {
    expect(isEventIngestionAccepted({ status: 'APPLIED', event_id: 'e', source: 's', kind: 'k', received_at: '2026-01-01T00:00:00Z' })).toBe(true);
    expect(isEventIngestionAccepted({ status: 'DUPLICATE', event_id: 'e' })).toBe(false);
    expect(isEventIngestionReplayed({ status: 'DUPLICATE', event_id: 'e', first_received_at: '2026-01-01T00:00:00Z' })).toBe(true);
    expect(isEventIngestionReplayed({ status: 'APPLIED', event_id: 'e' })).toBe(false);
  });
});

describe('provider-health payloads', () => {
  it('guards typed UNKNOWN/UNAVAILABLE health records and never conflates them', () => {
    const unknown = { provider: 'postgres', role: 'durable-canonical-state', status: 'UNKNOWN', detail: 'in-memory reference backend; no provider configured' };
    const unavailable = { provider: 'redis', role: 'coordination-only-never-canonical', status: 'UNAVAILABLE', detail: 'connection refused' };
    expect(isProviderHealthPayload(unknown)).toBe(true);
    expect(isProviderHealthPayload(unavailable)).toBe(true);
    expect(unknown.status).not.toBe(unavailable.status);
    expect(isProviderHealthPayload({ ...unknown, status: 'AVAILABLE', detail: null })).toBe(true);
    expect(isProviderHealthPayload({ ...unknown, provider: 'mysql' })).toBe(false);
    expect(isProviderHealthPayload({ ...unknown, status: 'OK' })).toBe(false);
    expect(isProviderHealthPayload({ ...unknown, role: '' })).toBe(false);
  });

  it('guards the full health report', () => {
    const report = {
      providers: [
        { provider: 'postgres', role: 'durable-canonical-state', status: 'UNKNOWN', detail: null },
        { provider: 'redis', role: 'coordination-only-never-canonical', status: 'UNKNOWN', detail: null },
        { provider: 'object-store', role: 'large-immutable-artifacts', status: 'UNKNOWN', detail: null },
      ],
      generated_at: '2026-01-01T00:00:00Z',
    };
    expect(isHealthReportPayload(report)).toBe(true);
    expect(isHealthReportPayload({ providers: [], generated_at: 42 })).toBe(false);
    expect(isHealthReportPayload({ providers: [{}], generated_at: '2026-01-01T00:00:00Z' })).toBe(false);
  });
});

describe('route table', () => {
  it('declares the P2 route surface', () => {
    expect(API_ROUTES).toContain('GET /health');
    expect(API_ROUTES).toContain('POST /events');
    for (const resource of ['mission', 'system-state', 'evidence', 'task', 'body-lease', 'observation']) {
      expect(API_ROUTES).toContain(`GET /${resource}`);
      expect(API_ROUTES).toContain(`GET /${resource}/:id`);
      expect(API_ROUTES).toContain(`PUT /${resource}`);
    }
  });
});
