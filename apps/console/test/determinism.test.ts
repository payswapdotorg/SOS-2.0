/**
 * Determinism tests — the W11 discipline: "same fixtures -> byte-identical
 * rendered output (test via snapshot or hash of the rendered view-model
 * projections)".
 *
 *   1. The golden fixture is reproducible: building the demo world again
 *      yields EXACTLY the committed fixtures/demo.json (string equality —
 *      key order included).
 *   2. Projections are deterministic: two independent assemblies produce
 *      byte-identical pages for every route.
 *   3. Rendered pages match the committed golden hash snapshot.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { buildDemoWorld } from '../src/demo/build-demo.js';
import { assembleViews } from '../src/views.js';
import { renderAllPages } from '../src/render/pages.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(here, '..', 'fixtures', 'demo.json');
const goldenHashesPath = join(here, 'golden', 'render-hashes.json');

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

describe('golden fixture discipline', () => {
  test('rebuilding the demo world reproduces the committed fixture byte-for-byte', () => {
    const committed = readFileSync(fixturePath, 'utf8');
    const rebuilt = `${JSON.stringify(buildDemoWorld(), null, 2)}\n`;
    expect(rebuilt).toBe(committed);
  });
});

describe('projection + rendering determinism', () => {
  const world = JSON.parse(readFileSync(fixturePath, 'utf8')) as ReturnType<typeof buildDemoWorld>;

  test('two independent assemblies render byte-identical pages for every route', () => {
    const first = renderAllPages(assembleViews(world));
    const second = renderAllPages(assembleViews(world));
    expect(second.size).toBe(first.size);
    for (const [route, html] of first) {
      expect(second.get(route)).toBe(html);
    }
  });

  test('every rendered page matches the committed golden hash snapshot', () => {
    const pages = renderAllPages(assembleViews(world));
    const golden = JSON.parse(readFileSync(goldenHashesPath, 'utf8')) as Record<string, string>;
    const actual: Record<string, string> = {};
    for (const [route, html] of [...pages.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
      actual[route] = sha256(html);
    }
    expect(Object.keys(actual).sort()).toEqual(Object.keys(golden).sort());
    for (const route of Object.keys(golden)) {
      expect(actual[route]).toBe(golden[route]);
    }
  });

  test('the full journey set is rendered (13 pages + rationale pages)', () => {
    const pages = renderAllPages(assembleViews(world));
    for (const route of [
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
      expect(pages.has(route)).toBe(true);
    }
    const rationalePages = [...pages.keys()].filter((route) => route.startsWith('/rationale'));
    expect(rationalePages.length).toBeGreaterThan(0);
  });
});
