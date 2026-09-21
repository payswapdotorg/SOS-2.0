/**
 * API contract conformance tests (Work Order P2): EVERY route's success
 * path AND every typed error path — the typed error envelope vocabulary
 * (UNKNOWN, UNAVAILABLE, CONFLICT/stale-revision, DUPLICATE/replayed,
 * NOT_FOUND, INVALID) is exercised end-to-end over HTTP against the
 * reference live store. Provider failures are injected through typed
 * failing adapters (never fabricated success). Responses are
 * deterministic (byte-identical repeats).
 */

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { ApiErrorEnvelope, JsonValue, ProviderHealthRecord } from '@sos-2/api-contracts';
import { isApiErrorEnvelope, isRecordWriteResponse } from '@sos-2/api-contracts';
import {
  DeterministicClock,
  InMemoryPostgresStoreAdapter,
  ProviderUnavailableError,
  createInMemoryLiveStore,
  type LiveStore,
  type PostgresRow,
  type PostgresStoreAdapter,
} from '@sos-2/live-store';
import type { BodyLeaseRecord } from '@sos-2/live-store';
import type { MissionArtifact } from '@sos-2/mission';
import type { SystemStateArtifact } from '@sos-2/system-state';
import type { EvidenceRecordW3 } from '@sos-2/evidence';
import { startApiServer } from '../src/server.js';
import { createApiRouter } from '../src/router.js';
import { buildApiFixtures } from './helpers.js';

type RecordMap = Record<string, unknown>;

function asRecord(value: JsonValue): RecordMap {
  expect(value).toBeTypeOf('object');
  return value as RecordMap;
}

function asArray(value: JsonValue): JsonValue[] {
  expect(Array.isArray(value)).toBe(true);
  return value as JsonValue[];
}

let live: string;
let close: () => Promise<void>;
let store: LiveStore;
const fixtures = buildApiFixtures();

beforeAll(async () => {
  store = createInMemoryLiveStore({ clock: new DeterministicClock('2025-07-01T00:00:00Z', 1000) });
  // Seed through the store directly (the service is a boundary over it).
  await store.mission.put(fixtures.mission);
  await store.systemState.put(fixtures.systemState);
  await store.evidence.put(fixtures.evidence);
  await store.task.put(fixtures.task);
  await store.task.put(fixtures.taskV2);
  await store.bodyLease.put(fixtures.bodyLease);
  for (const event of fixtures.events) {
    await store.events.ingest(event);
  }

  const server = startApiServer({ store, clock: new DeterministicClock('2025-07-01T09:00:00Z', 1000), port: 0 });
  live = `http://127.0.0.1:${await server.ready}`;
  close = server.close;
});

afterAll(async () => {
  await close();
});

async function call(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; headers: Record<string, string>; body: string }> {
  const response = await fetch(`${live}${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });
  return { status: response.status, headers, body: await response.text() };
}

async function callJson(method: string, path: string, body?: unknown): Promise<{ status: number; headers: Record<string, string>; json: JsonValue }> {
  const result = await call(method, path, body);
  return { status: result.status, headers: result.headers, json: JSON.parse(result.body) as JsonValue };
}

function errorEnvelope(json: JsonValue): ApiErrorEnvelope {
  expect(isApiErrorEnvelope(json)).toBe(true);
  return json as unknown as ApiErrorEnvelope;
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

describe('GET /api/health', () => {
  test('success: typed per-provider availability, reference UP + unconfigured production targets typed UNKNOWN', async () => {
    const result = await callJson('GET', '/api/health');
    expect(result.status).toBe(200);
    const response = asRecord(result.json);
    const providers = response['providers'] as ProviderHealthRecord[];
    expect(providers).toHaveLength(6);

    const referencePostgres = providers.find((entry) => entry.provider === 'postgres:memory-reference');
    expect(referencePostgres?.availability).toBe('UP');
    expect(referencePostgres?.canonical).toBe(true);
    expect(referencePostgres?.target).toBe('Neon');

    const referenceRedis = providers.find((entry) => entry.provider === 'redis:memory-reference');
    expect(referenceRedis?.availability).toBe('UP');
    expect(referenceRedis?.canonical).toBe(false); // REDIS IS NEVER CANONICAL — typed in health

    // Unconfigured production targets: typed UNKNOWN/UNCONFIGURED, never fabricated UP.
    const neonUnconfigured = providers.find((entry) => entry.provider === 'postgres:neon');
    expect(neonUnconfigured?.availability).toBe('UNKNOWN');
    expect(neonUnconfigured?.code).toBe('UNCONFIGURED');
    expect(neonUnconfigured?.implementation).toBe('unconfigured');
    const upstashUnconfigured = providers.find((entry) => entry.provider === 'redis:upstash');
    expect(upstashUnconfigured?.availability).toBe('UNKNOWN');
    expect(upstashUnconfigured?.canonical).toBe(false);
    const r2Unconfigured = providers.find((entry) => entry.provider === 'object-store:r2');
    expect(r2Unconfigured?.availability).toBe('UNKNOWN');

    expect(response['status']).toBe('UP');
    expect(response['checked_at']).toBeTypeOf('string');
    expect(response['coordination']).toEqual([]);
  });

  test('health is deterministic (the provider section is stable across calls)', async () => {
    const first = asRecord(JSON.parse((await call('GET', '/api/health')).body) as JsonValue);
    const second = asRecord(JSON.parse((await call('GET', '/api/health')).body) as JsonValue);
    expect(second['providers']).toEqual(first['providers']);
    expect(second['status']).toEqual(first['status']);
  });

  test('wrong method answers a typed NOT_FOUND envelope (never an untyped 405/500)', async () => {
    const result = await callJson('POST', '/api/health');
    expect(result.status).toBe(404);
    const envelope = errorEnvelope(result.json);
    expect(envelope.error).toBe('NOT_FOUND');
    expect(envelope.code).toBe('NO_ROUTE');
  });
});

// ---------------------------------------------------------------------------
// Record resources (mission, system-state, evidence, task, body-lease)
// ---------------------------------------------------------------------------

interface ResourceCase {
  resource: string;
  record: () => unknown;
  idOf: (record: unknown) => string;
  revision: number;
}

const recordResources: ResourceCase[] = [
  { resource: 'mission', record: () => fixtures.mission, idOf: (record) => (record as MissionArtifact).envelope.id, revision: 1 },
  { resource: 'system-state', record: () => fixtures.systemState, idOf: (record) => (record as SystemStateArtifact).envelope.id, revision: 1 },
  { resource: 'evidence', record: () => fixtures.evidence, idOf: (record) => (record as EvidenceRecordW3).id, revision: 1 },
  { resource: 'body-lease', record: () => fixtures.bodyLease, idOf: (record) => (record as BodyLeaseRecord).lease_id, revision: 1 },
];

describe.each(recordResources)('resource $resource (reads+writes)', (resourceCase) => {
  const { resource, record, idOf, revision } = resourceCase;

  test('GET single: 200 with the verbatim record + revision headers', async () => {
    const value = record();
    const id = idOf(value);
    const result = await callJson('GET', `/api/${resource}?id=${encodeURIComponent(id)}`);
    expect(result.status).toBe(200);
    expect(result.headers['x-sos-record-id']).toBe(id);
    expect(result.headers['x-sos-revision']).toBe(String(revision));
    const response = asRecord(result.json);
    expect(response['record']).toEqual(value as JsonValue);
    expect(response['revision']).toBe(revision);
  });

  test('GET single missing: 404 typed NOT_FOUND envelope', async () => {
    const missing = resource === 'evidence' ? `sos://Evidence/${'0'.repeat(32)}` : 'does-not-exist';
    const result = await callJson('GET', `/api/${resource}?id=${encodeURIComponent(missing)}`);
    expect(result.status).toBe(404);
    const envelope = errorEnvelope(result.json);
    expect(envelope.error).toBe('NOT_FOUND');
    expect(envelope.code).toBe('RECORD_NOT_FOUND');
  });

  test('GET page: 200 with deterministic items + opaque cursor pagination', async () => {
    const page = await callJson('GET', `/api/${resource}?limit=1`);
    expect(page.status).toBe(200);
    expect(asArray(asRecord(page.json)['items'] as JsonValue)).toHaveLength(1);
    expect(asRecord(page.json)['next_cursor']).toBeNull(); // exactly one record per repo in the seed
    expect(page.headers['x-sos-total-count']).toBe('1');
  });

  test('GET page: invalid cursor answers 400 INVALID', async () => {
    const result = await callJson('GET', `/api/${resource}?cursor=%%%not-a-cursor%%%`);
    expect(result.status).toBe(400);
    const envelope = errorEnvelope(result.json);
    expect(envelope.error).toBe('INVALID');
    expect(envelope.code).toBe('INVALID_CURSOR');
  });

  test('GET page: invalid limit answers 400 INVALID', async () => {
    const result = await callJson('GET', `/api/${resource}?limit=-3`);
    expect(result.status).toBe(400);
    const envelope = errorEnvelope(result.json);
    expect(envelope.error).toBe('INVALID');
    expect(envelope.code).toBe('INVALID_QUERY');
  });

  test('PUT: 200 IDEMPOTENT_REPLAY (identical replay of the seeded record) + write-outcome header', async () => {
    const value = record();
    const id = idOf(value);
    const result = await callJson('PUT', `/api/${resource}`, value);
    expect(result.status).toBe(200);
    expect(isRecordWriteResponse(result.json)).toBe(true);
    const response = asRecord(result.json);
    expect(response['outcome']).toBe('IDEMPOTENT_REPLAY');
    expect(response['record']).toEqual(value as JsonValue);
    expect(response['revision']).toBe(revision);
    expect(result.headers['x-sos-record-id']).toBe(id);
    expect(result.headers['x-sos-write-outcome']).toBe('IDEMPOTENT_REPLAY');
  });

  test('PUT: invalid record answers 400 INVALID with the owning guard message', async () => {
    const broken = { ...(record() as RecordMap), provenance: [] };
    const result = await callJson('PUT', `/api/${resource}`, broken);
    expect(result.status).toBe(400);
    const envelope = errorEnvelope(result.json);
    expect(envelope.error).toBe('INVALID');
    expect(envelope.code).toBe('RECORD_VALIDATION_FAILED');
  });

  test('PUT: non-object body answers 400 INVALID', async () => {
    const result = await callJson('PUT', `/api/${resource}`, ['not', 'an', 'object']);
    expect(result.status).toBe(400);
    const envelope = errorEnvelope(result.json);
    expect(envelope.error).toBe('INVALID');
    expect(envelope.code).toBe('BODY_MUST_BE_JSON_OBJECT');
  });
});

describe('resource task (reads+writes, conflict surface)', () => {
  test('GET single: the latest revision (v2) with its exact revision', async () => {
    const result = await callJson('GET', `/api/task?id=${encodeURIComponent(fixtures.task.task_id)}`);
    expect(result.status).toBe(200);
    const response = asRecord(result.json);
    expect(response['record']).toEqual(fixtures.taskV2 as unknown as JsonValue);
    expect(response['revision']).toBe(2);
    expect(result.headers['x-sos-revision']).toBe('2');
  });

  test('PUT forward revision: 200 STORED', async () => {
    const result = await callJson('PUT', '/api/task', fixtures.taskV3);
    expect(result.status).toBe(200);
    const response = asRecord(result.json);
    expect(response['outcome']).toBe('STORED');
    expect(response['record']).toEqual(fixtures.taskV3 as unknown as JsonValue);
    expect(response['revision']).toBe(3);
  });

  test('PUT stale revision: 409 CONFLICT STALE_REVISION carrying the current revision', async () => {
    const result = await callJson('PUT', '/api/task', fixtures.task);
    expect(result.status).toBe(409);
    const envelope = errorEnvelope(result.json);
    expect(envelope.error).toBe('CONFLICT');
    expect(envelope.code).toBe('STALE_REVISION');
    const details = asRecord(envelope.details as JsonValue);
    expect(details['current_revision']).toBe(3);
    expect(details['attempted_revision']).toBe(1);
    expect(details['record_id']).toBe(fixtures.task.task_id);
  });

  test('PUT divergent same-revision write: 409 CONFLICT REVISION_DIVERGENCE', async () => {
    const divergent = { ...fixtures.taskV3, owned_revision: '4444444444444444444444444444444444444444' };
    const result = await callJson('PUT', '/api/task', divergent);
    expect(result.status).toBe(409);
    const envelope = errorEnvelope(result.json);
    expect(envelope.error).toBe('CONFLICT');
    expect(envelope.code).toBe('REVISION_DIVERGENCE');
  });

  test('PUT malformed JSON body: 400 INVALID BODY_NOT_JSON', async () => {
    const response = await fetch(`${live}/api/task`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    });
    expect(response.status).toBe(400);
    const envelope = errorEnvelope((await response.json()) as JsonValue);
    expect(envelope.error).toBe('INVALID');
    expect(envelope.code).toBe('BODY_NOT_JSON');
  });

  test('PUT with no body: 400 INVALID BODY_REQUIRED', async () => {
    const response = await fetch(`${live}/api/task`, { method: 'PUT' });
    expect(response.status).toBe(400);
    const envelope = errorEnvelope((await response.json()) as JsonValue);
    expect(envelope.error).toBe('INVALID');
    expect(envelope.code).toBe('BODY_REQUIRED');
  });
});

// ---------------------------------------------------------------------------
// Observation events (ingestion with replay protection)
// ---------------------------------------------------------------------------

describe('POST /api/observation/events', () => {
  test('success: 200 APPLIED with the stored event (injected ingested_at)', async () => {
    const event = {
      event_id: 'deploy-5001',
      source: 'deployment:vercel',
      event_kind: 'deployment',
      occurred_at: '2025-06-05T00:00:00Z',
      payload: { environment: 'production', revision: 'deploy:checkout-prod-2025-06-05' },
      subject_ref: null,
      provenance: ['deployment:webhook:delivery-5001'],
    };
    const result = await callJson('POST', '/api/observation/events', event);
    expect(result.status).toBe(200);
    const response = asRecord(result.json);
    expect(response['outcome']).toBe('APPLIED');
    const stored = asRecord(response['event'] as JsonValue);
    expect(stored['event_id']).toBe('deploy-5001');
    // The store's INJECTED deterministic clock stamps ingested_at (tick 10
    // of the suite-ordered store clock: 8 seed ticks + 1 forward task write).
    expect(stored['ingested_at']).toBe('2025-07-01T00:00:09.000Z');
  });

  test('replayed delivery: 409 DUPLICATE EVENT_REPLAYED — skipped, never double-applied', async () => {
    const replay = await callJson('POST', '/api/observation/events', fixtures.events[0]);
    expect(replay.status).toBe(409);
    const envelope = errorEnvelope(replay.json);
    expect(envelope.error).toBe('DUPLICATE');
    expect(envelope.code).toBe('EVENT_REPLAYED');
    const details = asRecord(envelope.details as JsonValue);
    expect(details['event_id']).toBe('gh-delivery-1001');
    expect(typeof details['first_ingested_at']).toBe('string');
    // never double-applied: the log still holds exactly the seeded 2 + 1 new.
    const page = await callJson('GET', '/api/observation/events?limit=100');
    expect(page.headers['x-sos-total-count']).toBe('3');
  });

  test('divergent redelivery (same id, different content): 409 CONFLICT EVENT_DIVERGENCE', async () => {
    const divergent = {
      ...fixtures.events[1]!,
      payload: { workflow: 'verify', conclusion: 'failure' },
    };
    const result = await callJson('POST', '/api/observation/events', divergent);
    expect(result.status).toBe(409);
    const envelope = errorEnvelope(result.json);
    expect(envelope.error).toBe('CONFLICT');
    expect(envelope.code).toBe('EVENT_DIVERGENCE');
  });

  test('invalid event (missing provenance / bad timestamp): 400 INVALID EVENT_VALIDATION_FAILED', async () => {
    const noProvenance = { ...fixtures.events[0]!, provenance: [] };
    const result = await callJson('POST', '/api/observation/events', noProvenance);
    expect(result.status).toBe(400);
    const envelope = errorEnvelope(result.json);
    expect(envelope.error).toBe('INVALID');
    expect(envelope.code).toBe('EVENT_VALIDATION_FAILED');

    const badTime = { ...fixtures.events[0]!, occurred_at: 'yesterday' };
    expect((await callJson('POST', '/api/observation/events', badTime)).status).toBe(400);
  });
});

describe('GET /api/observation/events', () => {
  test('page: 200 in (occurred_at, event_id) order with exhaustive cursor walk', async () => {
    const collected: string[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 10; guard += 1) {
      const path = cursor === null ? '/api/observation/events?limit=2' : `/api/observation/events?limit=2&cursor=${encodeURIComponent(cursor)}`;
      const page = await callJson('GET', path);
      expect(page.status).toBe(200);
      for (const item of asArray(asRecord(page.json)['items'] as JsonValue)) {
        collected.push(asRecord(item)['event_id'] as string);
      }
      const next = asRecord(page.json)['next_cursor'];
      if (next === null) {
        break;
      }
      cursor = next as string;
    }
    expect(collected).toEqual(['gh-delivery-1001', 'ci-run-8001', 'deploy-5001']);
  });

  test('single event by event_id: 200 with the verbatim record; missing: 404 typed', async () => {
    const found = await callJson('GET', `/api/observation/events?event_id=${encodeURIComponent('ci-run-8001')}`);
    expect(found.status).toBe(200);
    expect(asRecord(found.json)['event_id']).toBe('ci-run-8001');

    const missing = await callJson('GET', '/api/observation/events?event_id=no-such-event');
    expect(missing.status).toBe(404);
    const envelope = errorEnvelope(missing.json);
    expect(envelope.error).toBe('NOT_FOUND');
    expect(envelope.code).toBe('EVENT_NOT_FOUND');
  });
});

// ---------------------------------------------------------------------------
// Unknown routes + response determinism
// ---------------------------------------------------------------------------

describe('routing + determinism', () => {
  test('unknown path answers 404 NOT_FOUND NO_ROUTE', async () => {
    const result = await callJson('GET', '/api/unknown-resource');
    expect(result.status).toBe(404);
    const envelope = errorEnvelope(result.json);
    expect(envelope.error).toBe('NOT_FOUND');
    expect(envelope.code).toBe('NO_ROUTE');
  });

  test('repeated single-record GETs are byte-identical', async () => {
    const path = `/api/task?id=${encodeURIComponent(fixtures.task.task_id)}`;
    const first = await call('GET', path);
    const second = await call('GET', path);
    expect(second.body).toBe(first.body);
    expect(second.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Provider failures over HTTP (typed, never fabricated success)
// ---------------------------------------------------------------------------

class FailingPostgresAdapter implements PostgresStoreAdapter {
  readonly providerId = 'postgres:failing-double';
  readonly role = 'durable semantic state (Neon target) — test double';

  private readonly unavailable = new ProviderUnavailableError({
    error_kind: 'UNAVAILABLE',
    provider: this.providerId,
    code: 'CONNECTION_FAILED',
    detail: 'connection refused (test double)',
  });

  health(): ProviderHealthRecord {
    return {
      provider: this.providerId,
      role: this.role,
      target: 'Neon',
      implementation: 'test-double',
      availability: 'UNAVAILABLE',
      code: 'CONNECTION_FAILED',
      canonical: true,
      detail: 'connection refused (test double)',
    };
  }

  async getRow(): Promise<PostgresRow | undefined> {
    throw this.unavailable;
  }

  async putRow(): Promise<PostgresRow> {
    throw this.unavailable;
  }

  async listRows(): Promise<PostgresRow[]> {
    throw this.unavailable;
  }

  async listTables(): Promise<string[]> {
    return new InMemoryPostgresStoreAdapter({ clock: new DeterministicClock('2025-06-01T00:00:00Z') }).listTables();
  }
}

describe('provider failures surface as typed envelopes (never fabricated success)', () => {
  let failingLive: string;
  let failingClose: () => Promise<void>;

  beforeAll(async () => {
    const failingStore = createInMemoryLiveStore({
      clock: new DeterministicClock('2025-07-01T00:00:00Z', 1000),
      durable: new FailingPostgresAdapter(),
      coordination: null,
    });
    const server = startApiServer({ store: failingStore, clock: new DeterministicClock('2025-07-01T09:00:00Z', 1000), port: 0 });
    failingLive = `http://127.0.0.1:${await server.ready}`;
    failingClose = server.close;
  });

  afterAll(async () => {
    await failingClose();
  });

  test('PUT during a durable outage: 503 UNAVAILABLE envelope (the write was NOT performed)', async () => {
    const response = await fetch(`${failingLive}/api/mission`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(fixtures.mission),
    });
    expect(response.status).toBe(503);
    const envelope = errorEnvelope((await response.json()) as JsonValue);
    expect(envelope.error).toBe('UNAVAILABLE');
    expect(envelope.code).toBe('CONNECTION_FAILED');
    const details = asRecord(envelope.details as JsonValue);
    expect(details['provider']).toBe('postgres:failing-double');
  });

  test('GET during a durable outage: 503 UNAVAILABLE envelope (never fabricated data)', async () => {
    const response = await fetch(`${failingLive}/api/evidence?id=sos%3A%2F%2FEvidence%2F${'0'.repeat(32)}`);
    expect(response.status).toBe(503);
    const envelope = errorEnvelope((await response.json()) as JsonValue);
    expect(envelope.error).toBe('UNAVAILABLE');
  });

  test('event ingestion during a durable outage: 503 UNAVAILABLE (never a fake APPLIED)', async () => {
    const response = await fetch(`${failingLive}/api/observation/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(fixtures.events[0]),
    });
    expect(response.status).toBe(503);
    const envelope = errorEnvelope((await response.json()) as JsonValue);
    expect(envelope.error).toBe('UNAVAILABLE');
  });

  test('the failing provider is reported as typed UNAVAILABLE in health (status DEGRADED)', async () => {
    const response = await fetch(`${failingLive}/api/health`);
    const json = asRecord((await response.json()) as JsonValue);
    expect(json['status']).toBe('DEGRADED');
    const providers = json['providers'] as ProviderHealthRecord[];
    const failing = providers.find((entry) => entry.provider === 'postgres:failing-double');
    expect(failing?.availability).toBe('UNAVAILABLE');
  });
});

// ---------------------------------------------------------------------------
// The Vercel-hostable router shape (hosting without contract change)
// ---------------------------------------------------------------------------

describe('the router is hostable without the HTTP server (Vercel/worker boundary shape)', () => {
  test('route() maps a request context to a typed response directly', async () => {
    const router = createApiRouter({ store, clock: new DeterministicClock('2025-07-01T10:00:00Z', 1000) });
    const health = await router.route({ method: 'GET', pathname: '/api/health', query: new URLSearchParams() });
    expect(health.status).toBe(200);

    const task = await router.route({
      method: 'GET',
      pathname: '/api/task',
      query: new URLSearchParams([['id', fixtures.task.task_id]]),
    });
    expect(task.status).toBe(200);
    expect(task.headers['x-sos-record-id']).toBe(fixtures.task.task_id);

    const noRoute = await router.route({ method: 'DELETE', pathname: '/api/mission', query: new URLSearchParams() });
    expect(noRoute.status).toBe(404);
    expect(asRecord(noRoute.body)['error']).toBe('NOT_FOUND');
  });
});
