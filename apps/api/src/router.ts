/**
 * The API router (Work Order P2) — the framework-independent request/response
 * core of apps/api.
 *
 * This module contains NO HTTP plumbing, NO server lifecycle and NO
 * long-running work: `route()` maps one API request context (method, path,
 * query, parsed JSON body) to one API response (status + headers + JSON
 * body) through ONE bounded live-store operation per request. That shape is
 * what lets the SAME contract be hosted as a plain Node process (server.ts),
 * in Vercel functions or behind an external worker boundary later WITHOUT
 * contract change.
 *
 * Error mapping is EXHAUSTIVE and TYPED (never an untyped 500, never a
 * fabricated success):
 *   InvalidRecordError            -> 400 INVALID   RECORD_VALIDATION_FAILED
 *   malformed request bodies      -> 400 INVALID   BODY_* / INVALID_CURSOR / INVALID_QUERY
 *   RecordNotFoundError           -> 404 NOT_FOUND RECORD_NOT_FOUND / EVENT_NOT_FOUND
 *   stale/divergent revisions     -> 409 CONFLICT  STALE_REVISION / REVISION_DIVERGENCE
 *   replayed event delivery       -> 409 DUPLICATE EVENT_REPLAYED (skipped, never double-applied)
 *   divergent event redelivery    -> 409 CONFLICT  EVENT_DIVERGENCE
 *   ProviderUnavailableError      -> 503 UNAVAILABLE (the operation was NOT performed)
 *   ProviderUnknownError          -> 500 UNKNOWN   (outcome cannot be determined)
 *   unknown route/method          -> 404 NOT_FOUND NO_ROUTE
 *   anything unexpected           -> 500 UNKNOWN   INTERNAL_ERROR (loud, never silent)
 */

import {
  assertValidEventIngestionRequest,
  clampPageLimit,
  decodeCursor,
  encodeCursor,
  apiError,
  type ApiErrorEnvelope,
  type JsonValue,
  type Page,
  type ProviderHealthRecord,
  type RecordPageItem,
  type RecordResponse,
  type RecordWriteResponse,
  type ServiceHealthResponse,
  type WriteOutcome,
} from '@sos-2/api-contracts';
import {
  InvalidRecordError,
  ObjectIntegrityError,
  ProviderUnavailableError,
  ProviderUnknownError,
  RecordNotFoundError,
  type Clock,
  type LiveStore,
  type RevisionedRecordPort,
} from '@sos-2/live-store';

export interface ApiRequestContext {
  method: string;
  pathname: string;
  query: URLSearchParams;
  /** The parsed JSON body for PUT/POST requests, or undefined. */
  body?: unknown;
}

export interface ApiResponse {
  status: number;
  headers: Record<string, string>;
  body: JsonValue;
}

export interface ApiRouterOptions {
  store: LiveStore;
  clock: Clock;
}

const JSON_HEADERS: Record<string, string> = { 'content-type': 'application/json; charset=utf-8' };

const CONTENT_TYPE = 'application/json';

function ok(body: JsonValue, headers: Record<string, string> = {}): ApiResponse {
  return { status: 200, headers: { ...JSON_HEADERS, ...headers }, body };
}

function fail(status: number, envelope: ApiErrorEnvelope, headers: Record<string, string> = {}): ApiResponse {
  return { status, headers: { ...JSON_HEADERS, ...headers }, body: envelope as unknown as JsonValue };
}

// ---------------------------------------------------------------------------
// The router
// ---------------------------------------------------------------------------

export interface ApiRouter {
  route(context: ApiRequestContext): Promise<ApiResponse>;
}

export function createApiRouter(options: ApiRouterOptions): ApiRouter {
  const { store, clock } = options;

  async function route(context: ApiRequestContext): Promise<ApiResponse> {
    try {
      return await routeInner(context);
    } catch (cause) {
      return mapThrown(cause);
    }
  }

  async function routeInner(context: ApiRequestContext): Promise<ApiResponse> {
    const method = context.method.toUpperCase();
    const path = context.pathname;

    if (path === '/api/health') {
      if (method !== 'GET') {
        return noRoute(method, path);
      }
      return healthResponse();
    }

    if (path === '/api/mission' || path === '/api/system-state' || path === '/api/evidence' || path === '/api/task' || path === '/api/body-lease') {
      const resource = resourceOf(path);
      if (method === 'GET') {
        return recordGet(store, resource, context.query);
      }
      if (method === 'PUT') {
        return recordPut(store, resource, context.body);
      }
      return noRoute(method, path);
    }

    if (path === '/api/observation/events') {
      if (method === 'GET') {
        return eventList(context.query);
      }
      if (method === 'POST') {
        return eventIngest(context.body);
      }
      return noRoute(method, path);
    }

    return noRoute(method, path);
  }

  // --- Health ---------------------------------------------------------------

  function healthResponse(): ApiResponse {
    const attached = store.health();
    const providers: ProviderHealthRecord[] = [...attached];
    // Typed UNCONFIGURED/UNKNOWN entries for production targets not yet
    // attached: when the active adapter is the in-memory reference, the
    // production provider (Neon/Upstash/R2) is not configured — reported
    // truthfully as typed UNKNOWN, never fabricated UP.
    for (const entry of attached) {
      if (entry.implementation === 'in-memory-reference') {
        const target = entry.target ?? 'production provider';
        providers.push({
          provider: `${roleKeyOf(entry)}:${targetKeyOf(entry)}`,
          role: entry.role,
          target,
          implementation: 'unconfigured',
          availability: 'UNKNOWN',
          code: 'UNCONFIGURED',
          canonical: entry.canonical,
          detail:
            `no ${target} adapter is configured in this deployment (the in-memory reference serves the role); ` +
            'availability of the unconfigured provider is UNKNOWN — never fabricated',
        });
      }
    }
    const coordination = store.coordinationHealth();
    const anyAttachedDegraded = attached.some(
      (entry) => entry.availability === 'UNAVAILABLE' || entry.availability === 'UNKNOWN',
    );
    const response: ServiceHealthResponse = {
      status: anyAttachedDegraded ? 'DEGRADED' : 'UP',
      providers,
      coordination,
      checked_at: clock.now(),
    };
    return ok(response as unknown as JsonValue);
  }

  function roleKeyOf(entry: ProviderHealthRecord): string {
    if (entry.provider.startsWith('postgres')) {
      return 'postgres';
    }
    if (entry.provider.startsWith('redis')) {
      return 'redis';
    }
    return 'object-store';
  }

  function targetKeyOf(entry: ProviderHealthRecord): string {
    if (entry.provider.startsWith('postgres')) {
      return 'neon';
    }
    if (entry.provider.startsWith('redis')) {
      return 'upstash';
    }
    return 'r2';
  }

  // --- Record resources -----------------------------------------------------

  async function recordGet(
    liveStore: LiveStore,
    resource: RecordResource,
    query: URLSearchParams,
  ): Promise<ApiResponse> {
    const repository = repositoryOf(liveStore, resource);
    const id = query.get('id');
    if (id !== null && id !== '') {
      const record = await repository.get(id);
      if (record === undefined) {
        return fail(404, apiError('NOT_FOUND', 'RECORD_NOT_FOUND', `${repository.kind} record not found: ${id}`, { repository: repository.kind, record_id: id }));
      }
      return recordResponse(repository, record);
    }

    const cursor = query.get('cursor');
    let afterKey: string | null;
    try {
      afterKey = decodeCursor(cursor);
    } catch {
      return fail(400, apiError('INVALID', 'INVALID_CURSOR', 'the cursor parameter is not a valid opaque cursor', null));
    }
    const rawLimit = query.get('limit');
    if (rawLimit !== null) {
      const parsed = Number(rawLimit);
      if (!Number.isFinite(parsed) || parsed < 1) {
        return fail(400, apiError('INVALID', 'INVALID_QUERY', `limit must be a positive integer, received: ${JSON.stringify(rawLimit)}`, null));
      }
    }
    const limit = rawLimit === null ? undefined : Number(rawLimit);
    const page = await repository.listPage({ after_key: afterKey, limit: clampPageLimit(limit) });
    const items: RecordPageItem[] = page.items.map((record) => ({
      record: record as unknown as JsonValue,
      revision: repository.revisionOf(record),
    }));
    const body: Page<RecordPageItem> = { items, next_cursor: page.next_key === null ? null : encodeCursor(page.next_key) };
    return ok(body as unknown as JsonValue, {
      'x-sos-total-count': String(page.total),
      'x-sos-repository': repository.kind,
    });
  }

  async function recordPut(
    liveStore: LiveStore,
    resource: RecordResource,
    body: unknown,
  ): Promise<ApiResponse> {
    const repository = repositoryOf(liveStore, resource);
    if (body === undefined) {
      return fail(400, apiError('INVALID', 'BODY_REQUIRED', `the PUT ${repository.kind} request requires a JSON body (the full record)`, null));
    }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return fail(400, apiError('INVALID', 'BODY_MUST_BE_JSON_OBJECT', 'the record body must be a JSON object', null));
    }
    const outcome = await repository.put(body as never);
    if (outcome.outcome === 'REVISION_CONFLICT') {
      const conflict = outcome.conflict;
      return fail(
        409,
        apiError('CONFLICT', conflict.code, conflict.message, conflict as unknown as JsonValue),
      );
    }
    const recordId = recordIdOf(repository, outcome.record);
    const revision = repository.revisionOf(outcome.record);
    const writeOutcome: WriteOutcome = outcome.outcome;
    const response: RecordWriteResponse = {
      outcome: writeOutcome,
      record: outcome.record as unknown as JsonValue,
      revision,
    };
    return ok(response as unknown as JsonValue, {
      'x-sos-record-id': recordId,
      'x-sos-revision': String(revision),
      'x-sos-write-outcome': writeOutcome,
    });
  }

  function recordResponse(repository: RevisionedRecordPort<unknown>, record: unknown): ApiResponse {
    const response: RecordResponse = {
      record: record as JsonValue,
      revision: repository.revisionOf(record),
    };
    return ok(response as unknown as JsonValue, {
      'x-sos-record-id': recordIdOf(repository, record),
      'x-sos-revision': String(repository.revisionOf(record)),
    });
  }

  function recordIdOf(repository: RevisionedRecordPort<unknown>, record: unknown): string {
    const asRecord = record as { envelope?: { id?: string }; id?: string; task_id?: string; lease_id?: string; state_id?: string };
    return (
      asRecord.envelope?.id ?? asRecord.id ?? asRecord.task_id ?? asRecord.lease_id ?? asRecord.state_id ?? ''
    );
  }

  // --- Observation events ------------------------------------------------------

  async function eventList(query: URLSearchParams): Promise<ApiResponse> {
    const eventId = query.get('event_id');
    if (eventId !== null && eventId !== '') {
      const event = await store.events.get(eventId);
      if (event === undefined) {
        return fail(404, apiError('NOT_FOUND', 'EVENT_NOT_FOUND', `observation event not found: ${eventId}`, { event_id: eventId }));
      }
      return ok(event as unknown as JsonValue, { 'x-sos-event-id': event.event_id });
    }
    const cursor = query.get('cursor');
    let afterKey: string | null;
    try {
      afterKey = decodeCursor(cursor);
    } catch {
      return fail(400, apiError('INVALID', 'INVALID_CURSOR', 'the cursor parameter is not a valid opaque cursor', null));
    }
    const rawLimit = query.get('limit');
    if (rawLimit !== null) {
      const parsed = Number(rawLimit);
      if (!Number.isFinite(parsed) || parsed < 1) {
        return fail(400, apiError('INVALID', 'INVALID_QUERY', `limit must be a positive integer, received: ${JSON.stringify(rawLimit)}`, null));
      }
    }
    const limit = rawLimit === null ? undefined : Number(rawLimit);
    const page = await store.events.listPage({ after_key: afterKey, limit: clampPageLimit(limit) });
    const body: Page<JsonValue> = {
      items: page.items as unknown as JsonValue[],
      next_cursor: page.next_key === null ? null : encodeCursor(page.next_key),
    };
    return ok(body as unknown as JsonValue, { 'x-sos-total-count': String(page.total) });
  }

  async function eventIngest(body: unknown): Promise<ApiResponse> {
    if (body === undefined) {
      return fail(400, apiError('INVALID', 'BODY_REQUIRED', 'the POST /api/observation/events request requires a JSON body (the typed event ingestion request)', null));
    }
    try {
      assertValidEventIngestionRequest(body);
    } catch (cause) {
      return fail(400, apiError('INVALID', 'EVENT_VALIDATION_FAILED', cause instanceof Error ? cause.message : String(cause), null));
    }
    const outcome = await store.events.ingest(body);
    if (outcome.outcome === 'DUPLICATE') {
      const duplicate = outcome.duplicate;
      return fail(
        409,
        apiError('DUPLICATE', 'EVENT_REPLAYED', duplicate.message, duplicate as unknown as JsonValue),
        { 'x-sos-event-id': duplicate.event_id },
      );
    }
    if (outcome.outcome === 'EVENT_CONFLICT') {
      const conflict = outcome.conflict;
      return fail(409, apiError('CONFLICT', conflict.code, conflict.message, conflict as unknown as JsonValue), {
        'x-sos-event-id': conflict.event_id,
      });
    }
    return ok(outcome as unknown as JsonValue, { 'x-sos-event-id': outcome.event.event_id });
  }

  function noRoute(method: string, path: string): ApiResponse {
    return fail(404, apiError('NOT_FOUND', 'NO_ROUTE', `no route for ${method} ${path} (supported: GET /api/health; GET/PUT /api/{mission,system-state,evidence,task,body-lease}; GET/POST /api/observation/events)`, null));
  }

  return { route };
}

// ---------------------------------------------------------------------------
// Shared mapping helpers
// ---------------------------------------------------------------------------

type RecordResource = 'mission' | 'system-state' | 'evidence' | 'task' | 'body-lease';

function resourceOf(path: string): RecordResource {
  switch (path) {
    case '/api/mission':
      return 'mission';
    case '/api/system-state':
      return 'system-state';
    case '/api/evidence':
      return 'evidence';
    case '/api/task':
      return 'task';
    case '/api/body-lease':
      return 'body-lease';
    default:
      throw new Error(`unmapped resource path: ${path}`);
  }
}

function repositoryOf(store: LiveStore, resource: RecordResource): RevisionedRecordPort<unknown> {
  switch (resource) {
    case 'mission':
      return store.mission as unknown as RevisionedRecordPort<unknown>;
    case 'system-state':
      return store.systemState as unknown as RevisionedRecordPort<unknown>;
    case 'evidence':
      return store.evidence as unknown as RevisionedRecordPort<unknown>;
    case 'task':
      return store.task as unknown as RevisionedRecordPort<unknown>;
    case 'body-lease':
      return store.bodyLease as unknown as RevisionedRecordPort<unknown>;
  }
}

function mapThrown(cause: unknown): ApiResponse {
  if (cause instanceof InvalidRecordError) {
    return fail(
      400,
      apiError('INVALID', 'RECORD_VALIDATION_FAILED', cause.message, { repository: cause.repository, detail: cause.detail }),
    );
  }
  if (cause instanceof RecordNotFoundError) {
    return fail(404, apiError('NOT_FOUND', 'RECORD_NOT_FOUND', cause.message, { repository: cause.repository, record_id: cause.recordId }));
  }
  if (cause instanceof ObjectIntegrityError) {
    return fail(400, apiError('INVALID', 'OBJECT_INTEGRITY', cause.message, { content_hash: cause.contentHash }));
  }
  if (cause instanceof ProviderUnavailableError) {
    const availability = cause.availability;
    return fail(
      503,
      apiError('UNAVAILABLE', availability.code, `${availability.provider}: ${availability.detail} (the operation was NOT performed)`, availability as unknown as JsonValue),
    );
  }
  if (cause instanceof ProviderUnknownError) {
    const availability = cause.availability;
    return fail(
      500,
      apiError('UNKNOWN', availability.code, `${availability.provider}: ${availability.detail} (the outcome cannot be determined)`, availability as unknown as JsonValue),
    );
  }
  return fail(
    500,
    apiError('UNKNOWN', 'INTERNAL_ERROR', `unexpected internal error: ${cause instanceof Error ? cause.message : String(cause)}`, null),
  );
}

export const API_CONTENT_TYPE = CONTENT_TYPE;
