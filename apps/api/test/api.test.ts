/**
 * API contract conformance (Work Order P2): every route's success and
 * every typed error, exercised over REAL HTTP against a listening service
 * (the repo's console-test precedent). Deterministic: a ManualClock drives
 * all timestamps; assertions bind to exact typed envelopes.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMission } from '@sos-2/mission';
import { createEvidence, unquantifiedConfidence } from '@sos-2/evidence';
import type { EvidenceRecordW3 } from '@sos-2/evidence';
import {
  InMemoryLiveStore,
  ManualClock,
  ProviderUnavailableError,
  createInMemoryLiveStore,
  formatRfc3339,
} from '@sos-2/live-store';
import type { BodyLeaseRecord, LiveStore, ObservationEventRecord, TaskRecord } from '@sos-2/live-store';
import { createApiService } from '../src/index.js';

const T0 = '2026-01-01T00:00:00.000Z';
const T1 = '2026-01-02T00:00:00.000Z';
const CLOCK_START = Date.parse(T0);

const clock = new ManualClock(CLOCK_START);
const store = createInMemoryLiveStore({ clock });
const service = createApiService({ port: 0, store, clock, listen: true });
const basePromise = service.ready.then((port) => `http://127.0.0.1:${port}`);

beforeAll(async () => {
  await basePromise;
});

afterAll(async () => {
  await service.close();
});

async function request(
  method: string,
  path: string,
  body?: unknown,
  headers?: Record<string, string>,
): Promise<{ status: number; headers: Record<string, string>; body: string; json: unknown }> {
  const base = await basePromise;
  const response = await fetch(`${base}${path}`, {
    method,
    headers: body === undefined ? headers : { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json: unknown = null;
  if (text.length > 0) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  const responseHeaders: Record<string, string> = {};
  response.headers.forEach((value, name) => {
    responseHeaders[name.toLowerCase()] = value;
  });
  return { status: response.status, headers: responseHeaders, body: text, json };
}

function missionBody() {
  return createMission({
    content: {
      purpose: 'Ship the live persistence boundary.',
      goals: [],
      outcomes: [],
      stakeholders: [],
      measures: [],
      assumptions: [],
      ambiguities: [],
      constraints: [],
    },
    provenance: ['P2:api-test'],
    created_at: T0,
  });
}

function evidenceBody(availability: EvidenceRecordW3['availability'] = 'UNAVAILABLE'): EvidenceRecordW3 {
  return createEvidence({
    kind: 'telemetry',
    subject_ref: `sos://SystemState/${'a'.repeat(32)}`,
    availability,
    evidence_class: 'OBSERVATIONAL',
    method: 'telemetry:capture-availability',
    provenance: ['observation:sha256:' + 'a'.repeat(64)],
    source_revision: 'git-sha:' + 'f'.repeat(40),
    deployment_revision: 'deploy-2026-01-01',
    window: { start: T0, end: T1 },
    subject_revision: 'system-state:r1',
    confidence: unquantifiedConfidence(),
    producer: { tool: 'p2-api-tests', tool_version: '0.1.0', model: null, model_version: null, command: 'vitest', environment: 'ci:local' },
  });
}

function taskBody(): TaskRecord {
  return {
    task_id: 'task-api-0001',
    mission_ref: null,
    status: 'QUEUED',
    plan: { steps: [] },
    owned_revision: { source_revision: null, deployment_revision: null },
    authority_context: { grant_refs: [], notes: null },
    body_lease_ref: null,
    checkpoints: [],
    artifacts: [],
    observations: [],
    unresolved_uncertainty: [],
    retries: 0,
    recovery_state: null,
    resource_usage: null,
    final_verification: null,
    revision: 1,
    created_at: T0,
    updated_at: T0,
  };
}

function leaseBody(): BodyLeaseRecord {
  return {
    lease_id: 'lease-api-0001',
    task_ref: 'task-api-0001',
    body_id: 'cloud-runner-1',
    holder: 'body:cloud-runner-1',
    state: 'ACTIVE',
    acquired_at: T0,
    expires_at: null,
    released_at: null,
    release_reason: null,
    revision: 1,
  };
}

describe('GET /health (typed failure model)', () => {
  it('reports per-provider availability as typed UNKNOWN when unconfigured', async () => {
    const response = await request('GET', '/health');
    expect(response.status).toBe(200);
    const report = response.json as {
      providers: { provider: string; role: string; status: string; detail: string | null }[];
      generated_at: string;
    };
    expect(report.providers.map((entry) => entry.provider).sort()).toEqual(['object-store', 'postgres', 'redis']);
    for (const entry of report.providers) {
      expect(entry.status).toBe('UNKNOWN'); // unconfigured — never fabricated AVAILABLE
      expect(entry.role.length).toBeGreaterThan(0);
    }
    const redis = report.providers.find((entry) => entry.provider === 'redis')!;
    expect(redis.role).toBe('coordination-only-never-canonical');
    expect(redis.detail).toContain('never canonical');
    expect(report.generated_at).toBe(formatRfc3339(CLOCK_START)); // injected clock
  });
});

describe('mission resource (reads+writes)', () => {
  const mission = missionBody();

  it('PUT stores a valid record with revision headers', async () => {
    const response = await request('PUT', '/mission', mission);
    expect(response.status).toBe(200);
    expect(response.json).toEqual({ kind: 'STORED', record: mission });
    expect(response.headers['x-sos-artifact-id']).toBe(mission.envelope.id);
    expect(response.headers['x-sos-revision']).toBe('1');
  });

  it('GET :id returns the record verbatim with headers', async () => {
    const response = await request('GET', `/mission/${encodeURIComponent(mission.envelope.id)}`);
    expect(response.status).toBe(200);
    expect(response.json).toEqual(mission);
    expect(response.headers['x-sos-artifact-id']).toBe(mission.envelope.id);
    expect(response.headers['x-sos-revision']).toBe('1');
  });

  it('replaying an identical PUT is an idempotent no-op (IDENTICAL)', async () => {
    const response = await request('PUT', '/mission', mission);
    expect(response.status).toBe(200);
    expect(response.json).toEqual({ kind: 'IDENTICAL', record: mission });
  });

  it('an expected-revision mismatch answers 409 CONFLICT with the current revision', async () => {
    const response = await request('PUT', '/mission', { ...mission, envelope: { ...mission.envelope, version: 2 } }, {
      'x-sos-expected-revision': '5',
    });
    expect(response.status).toBe(409);
    const envelope = response.json as { error: { code: string; details: { current_revision: number; reason: string } } };
    expect(envelope.error.code).toBe('CONFLICT');
    expect(envelope.error.details.current_revision).toBe(1);
    expect(envelope.error.details.reason).toBe('REVISION_MISMATCH');
  });

  it('a stale revision answers 409 CONFLICT (STALE_REVISION) with the current revision', async () => {
    // Bump the stored record to version 3 first.
    await request('PUT', '/mission', { ...mission, envelope: { ...mission.envelope, version: 3 } });
    const stale = await request('PUT', '/mission', { ...mission, envelope: { ...mission.envelope, version: 2 } });
    expect(stale.status).toBe(409);
    const envelope = stale.json as { error: { code: string; details: { current_revision: number; reason: string } } };
    expect(envelope.error.code).toBe('CONFLICT');
    expect(envelope.error.details.current_revision).toBe(3);
    expect(envelope.error.details.reason).toBe('STALE_REVISION');
  });

  it('GET :id unknown answers 404 NOT_FOUND', async () => {
    const response = await request('GET', `/mission/${encodeURIComponent('sos://Mission/' + '0'.repeat(32))}`);
    expect(response.status).toBe(404);
    expect((response.json as { error: { code: string } }).error.code).toBe('NOT_FOUND');
  });

  it('PUT with an invalid record answers 400 INVALID (owning-package validation)', async () => {
    const broken = { ...mission, content: { ...mission.content, purpose: '' } };
    const response = await request('PUT', '/mission', broken);
    expect(response.status).toBe(400);
    expect((response.json as { error: { code: string } }).error.code).toBe('INVALID');
  });

  it('PUT with malformed JSON answers 400 INVALID', async () => {
    const base = await basePromise;
    const raw = await fetch(`${base}/mission`, { method: 'PUT', body: '{not-json' });
    expect(raw.status).toBe(400);
    expect(((await raw.json()) as { error: { code: string } }).error.code).toBe('INVALID');
  });

  it('lists with seek pagination and cursor round-trips', async () => {
    // A second, distinct mission so pagination has two rows.
    const secondMission = createMission({
      content: {
        purpose: 'A second distinct mission for pagination.',
        goals: [],
        outcomes: [],
        stakeholders: [],
        measures: [],
        assumptions: [],
        ambiguities: [],
        constraints: [],
      },
      provenance: ['P2:api-test:pagination'],
      created_at: T1,
    });
    await request('PUT', '/mission', secondMission);
    const page = await request('GET', '/mission?limit=1');
    expect(page.status).toBe(200);
    const first = page.json as { items: unknown[]; next_cursor: string | null };
    expect(first.items).toHaveLength(1);
    expect(first.next_cursor).not.toBeNull();
    const second = await request('GET', `/mission?limit=5&cursor=${encodeURIComponent(first.next_cursor!)}`);
    expect(second.status).toBe(200);
    const rest = second.json as { items: unknown[]; next_cursor: string | null };
    expect(rest.items).toHaveLength(1);
    expect(rest.next_cursor).toBeNull();
    const all = [...(first.items as Record<string, never>[]), ...(rest.items as Record<string, never>[])];
    expect(all.length).toBe(2);
    // Malformed cursor -> typed INVALID, never a silent reset.
    const bad = await request('GET', `/mission?cursor=${encodeURIComponent('garbage!!!')}`);
    expect(bad.status).toBe(400);
    expect((bad.json as { error: { code: string } }).error.code).toBe('INVALID');
    const badLimit = await request('GET', '/mission?limit=0');
    expect(badLimit.status).toBe(400);
  });
});

describe('evidence resource (immutable, truth states preserved)', () => {
  it('stores and returns evidence with the truth state verbatim (UNAVAILABLE)', async () => {
    const evidence = evidenceBody('UNAVAILABLE');
    const put = await request('PUT', '/evidence', evidence);
    expect(put.status).toBe(200);
    expect(put.json).toEqual({ kind: 'STORED', record: evidence });
    expect(put.headers['x-sos-artifact-id']).toBe(evidence.id);
    expect(put.headers['x-sos-revision']).toBeUndefined(); // immutable: no revision header
    const get = await request('GET', `/evidence/${encodeURIComponent(evidence.id)}`);
    expect(get.json).toEqual(evidence);
    expect((get.json as EvidenceRecordW3).availability).toBe('UNAVAILABLE');
  });

  it('different content under a stored evidence id answers 409 CONFLICT (IMMUTABLE_COLLISION)', async () => {
    const evidence = evidenceBody('UNAVAILABLE');
    await request('PUT', '/evidence', evidence);
    const tampered = { ...evidence, provenance: ['tampered'] };
    const response = await request('PUT', '/evidence', tampered);
    expect(response.status).toBe(409);
    const envelope = response.json as { error: { code: string; details: { reason: string; current_revision: number | null } } };
    expect(envelope.error.code).toBe('CONFLICT');
    expect(envelope.error.details.reason).toBe('IMMUTABLE_COLLISION');
    expect(envelope.error.details.current_revision).toBeNull();
  });
});

describe('task + body-lease resources (the §6 shape over HTTP)', () => {
  it('round-trips a durable task record with revision headers', async () => {
    const put = await request('PUT', '/task', taskBody());
    expect(put.status).toBe(200);
    expect(put.headers['x-sos-revision']).toBe('1');
    const get = await request('GET', '/task/task-api-0001');
    expect(get.status).toBe(200);
    expect(get.json).toEqual(taskBody());
    // Bump the stored revision to 2, then a revision-1 write is STALE -> typed conflict.
    await request('PUT', '/task', { ...taskBody(), status: 'RUNNING', revision: 2 });
    const stale = await request('PUT', '/task', taskBody());
    expect(stale.status).toBe(409);
    const envelope = stale.json as { error: { code: string; details: { current_revision: number; reason: string } } };
    expect(envelope.error.code).toBe('CONFLICT');
    expect(envelope.error.details.current_revision).toBe(2);
    expect(envelope.error.details.reason).toBe('STALE_REVISION');
  });

  it('round-trips a body lease record', async () => {
    const put = await request('PUT', '/body-lease', leaseBody());
    expect(put.status).toBe(200);
    const get = await request('GET', '/body-lease/lease-api-0001');
    expect(get.status).toBe(200);
    expect(get.json).toEqual(leaseBody());
    expect(get.headers['x-sos-revision']).toBe('1');
  });
});

describe('observation resource + POST /events (replay-protected ingestion)', () => {
  const event = {
    id: 'evt-api-0001',
    source: 'github:webhook:payswapdotorg/SOS-2.0',
    kind: 'ci.run',
    occurred_at: T1,
    payload: { conclusion: 'success', run_id: 42 },
    provenance: ['github:delivery:1'],
  };

  it('POST /events applies a first delivery (201, clock-stamped receipt)', async () => {
    const response = await request('POST', '/events', event);
    expect(response.status).toBe(201);
    expect(response.json).toEqual({
      status: 'APPLIED',
      event_id: 'evt-api-0001',
      source: 'github:webhook:payswapdotorg/SOS-2.0',
      kind: 'ci.run',
      received_at: formatRfc3339(CLOCK_START),
    });
  });

  it('duplicate delivery answers 409 DUPLICATE with the first receipt (never double-applied)', async () => {
    const response = await request('POST', '/events', { ...event, payload: { conclusion: 'failure' } });
    expect(response.status).toBe(409);
    const envelope = response.json as { error: { code: string; details: { event_id: string; first_received_at: string } } };
    expect(envelope.error.code).toBe('DUPLICATE');
    expect(envelope.error.details.event_id).toBe('evt-api-0001');
    expect(envelope.error.details.first_received_at).toBe(formatRfc3339(CLOCK_START));
    const list = await request('GET', '/observation?limit=100');
    expect(((list.json as { items: unknown[] }).items)).toHaveLength(1);
  });

  it('an event without an id answers 400 INVALID', async () => {
    const response = await request('POST', '/events', { ...event, id: '' });
    expect(response.status).toBe(400);
    expect((response.json as { error: { code: string } }).error.code).toBe('INVALID');
  });

  it('GET /observation/:id returns the stored event; PUT /observation writes directly', async () => {
    const get = await request('GET', '/observation/evt-api-0001');
    expect(get.status).toBe(200);
    const record = get.json as ObservationEventRecord;
    expect(record.payload).toEqual(event.payload);
    expect(record.received_at).toBe(formatRfc3339(CLOCK_START));
    // The direct durable write of the identical stored record is idempotent.
    const put = await request('PUT', '/observation', record);
    expect(put.status).toBe(200);
    expect((put.json as { kind: string }).kind).toBe('IDENTICAL');
  });
});

describe('typed route errors', () => {
  it('unknown resource answers 404 NOT_FOUND', async () => {
    const response = await request('GET', '/unicorn');
    expect(response.status).toBe(404);
    expect((response.json as { error: { code: string } }).error.code).toBe('NOT_FOUND');
  });

  it('unsupported method answers 400 INVALID', async () => {
    const response = await request('DELETE', '/mission');
    expect(response.status).toBe(400);
    expect((response.json as { error: { code: string } }).error.code).toBe('INVALID');
  });

  it('missing body on PUT answers 400 INVALID', async () => {
    const response = await request('PUT', '/evidence');
    expect(response.status).toBe(400);
    expect((response.json as { error: { code: string } }).error.code).toBe('INVALID');
  });
});

describe('provider failures surface typed (never fabricated success)', () => {
  function failingStore(part: 'evidence' | 'missions'): LiveStore {
    // Prototype delegation keeps every working member; only the targeted
    // repository is shadowed with a failing one.
    const real = createInMemoryLiveStore({ clock });
    const failing = Object.create(real) as LiveStore;
    const shadow = failing as unknown as Record<string, unknown>;
    if (part === 'evidence') {
      shadow['evidence'] = Object.create(real.evidence, {
        get: {
          value: async () => {
            throw new ProviderUnavailableError('postgres', 'connection refused (test)');
          },
        },
        put: {
          value: async () => {
            throw new ProviderUnavailableError('postgres', 'connection refused (test)');
          },
        },
      });
    } else {
      shadow['missions'] = Object.create(real.missions, {
        get: {
          value: async () => {
            throw new Error('unexpected internal condition (test)');
          },
        },
      });
    }
    return failing;
  }

  it('a failing durable provider answers 503 UNAVAILABLE', async () => {
    const failing = createApiService({ port: 0, store: failingStore('evidence'), clock });
    const base = `http://127.0.0.1:${await failing.ready}`;
    try {
      const response = await fetch(`${base}/evidence/${encodeURIComponent('sos://Evidence/' + 'a'.repeat(32))}`);
      expect(response.status).toBe(503);
      const envelope = (await response.json()) as { error: { code: string; message: string } };
      expect(envelope.error.code).toBe('UNAVAILABLE');
      expect(envelope.error.message).toContain('postgres');
    } finally {
      await failing.close();
    }
  });

  it('an unexpected internal condition answers 500 UNKNOWN', async () => {
    const failing = createApiService({ port: 0, store: failingStore('missions'), clock });
    const base = `http://127.0.0.1:${await failing.ready}`;
    try {
      const response = await fetch(`${base}/mission/${encodeURIComponent('sos://Mission/' + 'a'.repeat(32))}`);
      expect(response.status).toBe(500);
      expect(((await response.json()) as { error: { code: string } }).error.code).toBe('UNKNOWN');
    } finally {
      await failing.close();
    }
  });
});

describe('determinism (byte-identical responses)', () => {
  it('the same requests produce byte-identical responses', async () => {
    const first = await request('GET', `/mission/${encodeURIComponent(missionBody().envelope.id)}`);
    const second = await request('GET', `/mission/${encodeURIComponent(missionBody().envelope.id)}`);
    expect(second.body).toBe(first.body);
    const healthA = await request('GET', '/health');
    const healthB = await request('GET', '/health');
    expect(healthB.body).toBe(healthA.body);
  });
});
