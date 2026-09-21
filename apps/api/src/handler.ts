/**
 * The transport-agnostic API handler (Work Order P2).
 *
 * Consumes `ApiRequest` and produces `ApiResponse` (both from
 * @sos-2/api-contracts — plain data, no node:http types), so the SAME
 * handler contract can be hosted as a plain Node process today and as a
 * Vercel function or external worker boundary later WITHOUT contract
 * change.
 *
 * Discipline:
 *  - every response is a typed envelope (records, write results, list
 *    pages, event ingestion results) or a TYPED ERROR envelope — never an
 *    untyped string;
 *  - every failure maps to its typed code (INVALID / NOT_FOUND /
 *    CONFLICT / DUPLICATE / UNAVAILABLE / UNKNOWN) with the fixed HTTP
 *    status from api-contracts — UNAVAILABLE and UNKNOWN are never
 *    conflated and never fabricated into success;
 *  - record bodies are the DOMAIN RECORDS THEMSELVES: validation is the
 *    owning package's assert, consumed through the live-store;
 *  - no long-running work inside the request lifetime — handlers perform
 *    bounded store operations only;
 *  - the clock is injected (health generated_at, nothing else reads time).
 */

import type {
  ApiErrorEnvelope,
  ApiRequest,
  ApiResponse,
  ApiErrorCode,
  EventIngestionRequest,
} from '@sos-2/api-contracts';
import {
  apiError,
  decodePageCursor,
  encodePageCursor,
  httpStatusForErrorCode,
  isEventIngestionRequest,
  parseExpectedRevision,
  parseListQuery,
  recordResponseHeaders,
} from '@sos-2/api-contracts';
import type { Clock, LiveStore, LiveRecordRepository, PutResult } from '@sos-2/live-store';
import {
  InvalidRecordError,
  LiveStoreError,
  ProviderUnavailableError,
  formatRfc3339,
} from '@sos-2/live-store';
import type {
  BodyLeaseRecord,
  ObservationEventRecord,
  TaskRecord,
} from '@sos-2/live-store';
import type { MissionArtifact } from '@sos-2/mission';
import type { SystemStateArtifact } from '@sos-2/system-state';
import type { EvidenceRecordW3 } from '@sos-2/evidence';
import type { JsonValue } from '@sos-2/semantic-spine';

/** Upper bound on request bodies (protects the request lifetime). */
export const MAX_BODY_BYTES = 1_048_576;

export interface ApiHandlerDeps {
  store: LiveStore;
  clock: Clock;
}

interface ResourceBinding<R> {
  /** The route segment, e.g. "mission" for GET/PUT /mission. */
  segment: string;
  repo: LiveRecordRepository<R>;
  idOf(record: R): string;
  revisionOf(record: R): number | null;
}

function resourceBindings(store: LiveStore): ResourceBinding<never>[] {
  const bindings: ResourceBinding<unknown>[] = [
    {
      segment: 'mission',
      repo: store.missions,
      idOf: (record: MissionArtifact) => record.envelope.id,
      revisionOf: (record: MissionArtifact) => record.envelope.version,
    },
    {
      segment: 'system-state',
      repo: store.systemStates,
      idOf: (record: SystemStateArtifact) => record.envelope.id,
      revisionOf: (record: SystemStateArtifact) => record.envelope.version,
    },
    {
      segment: 'evidence',
      repo: store.evidence,
      idOf: (record: EvidenceRecordW3) => record.id,
      revisionOf: () => null,
    },
    {
      segment: 'task',
      repo: store.tasks,
      idOf: (record: TaskRecord) => record.task_id,
      revisionOf: (record: TaskRecord) => record.revision,
    },
    {
      segment: 'body-lease',
      repo: store.bodyLeases,
      idOf: (record: BodyLeaseRecord) => record.lease_id,
      revisionOf: (record: BodyLeaseRecord) => record.revision,
    },
    {
      segment: 'observation',
      repo: store.observationEvents,
      idOf: (record: ObservationEventRecord) => record.id,
      revisionOf: () => null,
    },
  ];
  return bindings as ResourceBinding<never>[];
}

function jsonResponse(status: number, body: JsonValue, headers: Record<string, string> = {}): ApiResponse {
  return { status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers }, body };
}

function errorResponse(code: ApiErrorCode, message: string, details?: unknown): ApiResponse {
  const envelope: ApiErrorEnvelope = apiError(code, message, details);
  return jsonResponse(httpStatusForErrorCode(code), envelope as unknown as JsonValue);
}

function parseJsonBody(body: Uint8Array | null): { ok: true; value: unknown } | { ok: false; message: string } {
  if (body === null || body.byteLength === 0) {
    return { ok: false, message: 'a JSON request body is required' };
  }
  const text = new TextDecoder().decode(body);
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (cause) {
    return { ok: false, message: `request body is not valid JSON: ${(cause as Error).message}` };
  }
}

/** Map a thrown value to the typed error code it carries. */
function errorOf(cause: unknown): { code: ApiErrorCode; message: string } {
  if (cause instanceof InvalidRecordError) {
    return { code: 'INVALID', message: cause.message };
  }
  if (cause instanceof ProviderUnavailableError) {
    return { code: 'UNAVAILABLE', message: `provider ${JSON.stringify(cause.provider)} is unavailable: ${cause.message}` };
  }
  if (cause instanceof LiveStoreError) {
    return { code: cause.code === 'INVALID' ? 'INVALID' : 'UNKNOWN', message: cause.message };
  }
  return { code: 'UNKNOWN', message: cause instanceof Error ? cause.message : String(cause) };
}

function conflictDetails(result: Extract<PutResult<unknown>, { kind: 'CONFLICT' }>): unknown {
  return {
    id: result.id,
    current_revision: result.current_revision,
    reason: result.reason,
  };
}

async function handleGetRecord(binding: ResourceBinding<never>, id: string): Promise<ApiResponse> {
  const record = await binding.repo.get(id);
  if (record === undefined) {
    return errorResponse('NOT_FOUND', `no ${binding.segment} record with id ${JSON.stringify(id)}`);
  }
  const loaded = record as never;
  return jsonResponse(
    200,
    loaded as unknown as JsonValue,
    recordResponseHeaders(binding.idOf(loaded), binding.revisionOf(loaded)),
  );
}

async function handleList(binding: ResourceBinding<never>, request: ApiRequest): Promise<ApiResponse> {
  const parsed = parseListQuery(request.query);
  if (!parsed.ok) {
    return errorResponse('INVALID', parsed.error);
  }
  const { limit, cursor } = parsed.request;
  let afterId: string | null = null;
  if (cursor !== null) {
    const decoded = decodePageCursor(cursor);
    if (decoded === null) {
      return errorResponse('INVALID', `malformed pagination cursor: ${JSON.stringify(cursor)}`);
    }
    afterId = decoded.after;
  }
  const page = await binding.repo.list({ limit, after_id: afterId });
  const nextCursor = page.next_after_id === null ? null : encodePageCursor(page.next_after_id, limit);
  return jsonResponse(200, {
    items: page.items as unknown as JsonValue,
    next_cursor: nextCursor,
  } as unknown as JsonValue);
}

async function handlePut(binding: ResourceBinding<never>, request: ApiRequest): Promise<ApiResponse> {
  const body = parseJsonBody(request.body);
  if (!body.ok) {
    return errorResponse('INVALID', body.message);
  }
  const expected = parseExpectedRevision(request.headers['x-sos-expected-revision']);
  if (!expected.ok) {
    return errorResponse('INVALID', expected.error);
  }
  try {
    const result = await binding.repo.put(body.value as never, {
      expected_revision: expected.revision,
    });
    if (result.kind === 'CONFLICT') {
      return errorResponse(
        'CONFLICT',
        `the ${binding.segment} write conflicted (${result.reason}); the current revision is ${
          result.current_revision === null ? 'immutable (content-addressed)' : String(result.current_revision)
        }`,
        conflictDetails(result),
      );
    }
    const record = result.record;
    return jsonResponse(
      200,
      { kind: result.kind, record: record as unknown as JsonValue } as unknown as JsonValue,
      recordResponseHeaders(binding.idOf(record), binding.revisionOf(record)),
    );
  } catch (cause) {
    const typed = errorOf(cause);
    return errorResponse(typed.code, typed.message);
  }
}

async function handleHealth(deps: ApiHandlerDeps): Promise<ApiResponse> {
  const health = deps.store.health();
  const providers = [health.postgres, health.redis, health.objectStore].map((entry) => ({
    provider: entry.provider,
    role: entry.role,
    status: entry.status,
    detail: entry.detail,
  }));
  return jsonResponse(200, {
    providers,
    generated_at: formatRfc3339(deps.clock.nowEpochMs()),
  } as unknown as JsonValue);
}

async function handleEventIngestion(deps: ApiHandlerDeps, request: ApiRequest): Promise<ApiResponse> {
  const body = parseJsonBody(request.body);
  if (!body.ok) {
    return errorResponse('INVALID', body.message);
  }
  if (!isEventIngestionRequest(body.value)) {
    return errorResponse(
      'INVALID',
      'the body does not match the event ingestion contract (exact fields: id, source, kind, occurred_at, payload, provenance — every event carries an id)',
    );
  }
  const payload = body.value as EventIngestionRequest;
  try {
    const outcome = await deps.store.observationEvents.ingest({
      id: payload.id,
      source: payload.source,
      kind: payload.kind,
      occurred_at: payload.occurred_at,
      payload: payload.payload,
      provenance: payload.provenance,
    });
    if (outcome.kind === 'APPLIED') {
      return jsonResponse(201, {
        status: 'APPLIED',
        event_id: outcome.event.id,
        source: outcome.event.source,
        kind: outcome.event.kind,
        received_at: outcome.event.received_at,
      } as unknown as JsonValue);
    }
    return errorResponse('DUPLICATE', `event ${JSON.stringify(outcome.event_id)} was already ingested (replay protected)`, {
      event_id: outcome.event_id,
      first_received_at: outcome.first_received_at,
    });
  } catch (cause) {
    const typed = errorOf(cause);
    return errorResponse(typed.code, typed.message);
  }
}

/** Split a path into decoded segments (percent-encoding is resolved). */
function splitPath(path: string): { ok: true; segments: string[] } | { ok: false; message: string } {
  const raw = path.split('/').filter((segment) => segment.length > 0);
  const segments: string[] = [];
  for (const segment of raw) {
    try {
      segments.push(decodeURIComponent(segment));
    } catch {
      return { ok: false, message: `malformed percent-encoding in path segment: ${JSON.stringify(segment)}` };
    }
  }
  return { ok: true, segments };
}

/** Build the transport-agnostic API request handler. */
export function createApiHandler(deps: ApiHandlerDeps): (request: ApiRequest) => Promise<ApiResponse> {
  const bindings = resourceBindings(deps.store);
  return async function handle(request: ApiRequest): Promise<ApiResponse> {
    const path = request.path.replace(/\/+$/, '') || '/';
    const method = request.method.toUpperCase();
    const split = splitPath(path);
    if (!split.ok) {
      return errorResponse('INVALID', split.message);
    }
    const segments = split.segments;

    if (segments.length === 0) {
      return errorResponse('NOT_FOUND', `no resource at ${JSON.stringify(path)} (see GET /health and the route table)`);
    }

    // Every store operation is dispatched through this typed-error boundary:
    // provider failures answer UNAVAILABLE (503), invalid records INVALID
    // (400), anything unexpected UNKNOWN (500) — never fabricated success.
    try {
      if (segments[0] === 'health') {
        if (segments.length !== 1 || method !== 'GET') {
          return errorResponse('INVALID', 'GET /health is the only health route');
        }
        return await handleHealth(deps);
      }

      if (segments[0] === 'events') {
        if (segments.length !== 1 || method !== 'POST') {
          return errorResponse('INVALID', 'POST /events is the only event ingestion route');
        }
        return await handleEventIngestion(deps, request);
      }

      const binding = bindings.find((entry) => entry.segment === segments[0]);
      if (binding === undefined) {
        return errorResponse('NOT_FOUND', `no resource ${JSON.stringify(segments[0])} (supported: mission, system-state, evidence, task, body-lease, observation)`);
      }

      if (segments.length === 1) {
        if (method === 'GET') {
          return await handleList(binding, request);
        }
        if (method === 'PUT') {
          return await handlePut(binding, request);
        }
        return errorResponse('INVALID', `method ${method} is not supported on /${binding.segment} (GET to list, PUT to write, GET /${binding.segment}/:id to read)`);
      }

      if (segments.length === 2) {
        if (method === 'GET') {
          return await handleGetRecord(binding, segments[1]!);
        }
        return errorResponse('INVALID', `method ${method} is not supported on /${binding.segment}/:id (use GET)`);
      }

      return errorResponse('NOT_FOUND', `no route at ${JSON.stringify(path)}`);
    } catch (cause) {
      const typed = errorOf(cause);
      return errorResponse(typed.code, typed.message);
    }
  };
}
