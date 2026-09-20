/**
 * Server smoke tests — the console is a RUNNABLE app: pages respond 200,
 * POST journeys work end-to-end (mission creation via the domain types,
 * system import with truthful failures), and rendering stays deterministic
 * over HTTP.
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, test } from 'vitest';
import { startConsole } from '../src/server.js';
import type { DemoWorld } from '../src/demo/build-demo.js';

const here = dirname(fileURLToPath(import.meta.url));
const world = JSON.parse(readFileSync(join(here, '..', 'fixtures', 'demo.json'), 'utf8')) as DemoWorld;

const listening = startConsole({ port: 0, world });
const livePromise = listening.ready.then((port) => `http://127.0.0.1:${port}`);

afterAll(async () => {
  await listening.close();
});

async function get(path: string): Promise<{ status: number; body: string }> {
  const live = await livePromise;
  const response = await fetch(`${live}${path}`);
  return { status: response.status, body: await response.text() };
}

async function post(path: string, form: Record<string, string>): Promise<{ status: number; body: string }> {
  const live = await livePromise;
  const response = await fetch(`${live}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
  });
  return { status: response.status, body: await response.text() };
}

describe('the console server', () => {
  test('serves the overview and all journey pages with 200', async () => {
    for (const path of [
      '/',
      '/mission',
      '/import',
      '/reconciliation',
      '/evidence',
      '/candidates',
      '/assurance',
      '/experiments',
      '/ask',
      '/rollback',
      '/packages',
      '/history',
      '/evolution',
    ]) {
      const page = await get(path);
      expect(page.status, path).toBe(200);
      expect(page.body).toContain('SOS 2.0 — Human Console');
    }
  });

  test('serves rationale chain pages for known subjects and 404s unknown ones', async () => {
    const evidence = await get('/evidence');
    const match = /\/rationale\?id=(sos%3A%2F%2F[A-Za-z]+%2F[0-9a-f]{32})/.exec(evidence.body);
    expect(match).not.toBeNull();
    const known = await get(`/rationale?id=${match![1]}`);
    expect(known.status).toBe(200);
    expect(known.body).toContain('Rationale chain');
    const unknown = await get('/rationale?id=sos%3A%2F%2FMission%2F00000000000000000000000000000000');
    expect(unknown.status).toBe(404);
    expect(unknown.body).toContain('No typed trace links mention this artifact');
  });

  test('creates a mission through the domain types (POST /mission)', async () => {
    const result = await post('/mission', {
      purpose: 'Smoke test mission',
      goal: 'Smoke test goal',
      measure_description: 'Smoke measure',
      measure_target: '<= 42',
      constraint: 'Smoke constraint',
      provenance: 'W11:console:smoke-test',
      created_at: '2025-06-15T12:00:00Z',
    });
    expect(result.status).toBe(200);
    expect(result.body).toContain('Created mission');
    expect(result.body).toContain('Smoke test mission');
    expect(result.body).toContain('Rationale chain');
  });

  test('rejects an invalid mission truthfully (POST /mission)', async () => {
    const result = await post('/mission', {
      purpose: '', // purpose is the mandatory semantic anchor
      goal: 'x',
      measure_description: 'x',
      measure_target: '',
      constraint: '',
      provenance: 'W11:console:smoke-test',
      created_at: '2025-06-15T12:00:00Z',
    });
    expect(result.status).toBe(200);
    expect(result.body).toContain('Creation rejected');
  });

  test('imports a pasted ImplementationModel and reconciles it (POST /import)', async () => {
    const result = await post('/import', { model: JSON.stringify(world.observed_model) });
    expect(result.status).toBe(200);
    expect(result.body).toContain('Imported model — System State view');
    expect(result.body).toContain('Reconciliation against the declared architecture');
  });

  test('rejects invalid pasted models truthfully (POST /import)', async () => {
    const result = await post('/import', { model: 'not json at all' });
    expect(result.status).toBe(200);
    expect(result.body).toContain('Import rejected');
    const result2 = await post('/import', { model: '{"id": 42}' });
    expect(result2.body).toContain('Import rejected');
  });

  test('renders byte-identical pages for repeated requests', async () => {
    const first = await get('/ask');
    const second = await get('/ask');
    expect(second.body).toBe(first.body);
  });

  test('404s unknown journeys', async () => {
    const result = await get('/no-such-journey');
    expect(result.status).toBe(404);
    expect(result.body).toContain('404');
  });
});
