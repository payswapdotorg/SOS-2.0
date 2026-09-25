/**
 * ACCEPTANCE SUITE 8 — STRUCTURAL PINS (Work Order P12, pinned).
 *
 * "Structural: zero new external dependencies (workspace:* + the
 * existing toolchain, checked against the base lockfile conventions),
 * offline determinism (no Date.now/Math.random/fetch/process.env/
 * ambient timers in owned sources outside the documented
 * apps/task-runner composition boundary), fixed vitest seed, only
 * merged + P12-owned workspace imports (unmerged siblings never
 * referenced)."
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** The station root (tests run with cwd = tests/autonomy). */
const ROOT = join(process.cwd(), '..', '..');

/** The P12-owned package sources (the offline-determinism scan scope). */
const OWNED_PACKAGE_SOURCES = ['packages/autonomy-runtime/src', 'packages/task-runtime/src'];

/** The DOCUMENTED ambient boundary (the only place ambient time is legal). */
const COMPOSITION_BOUNDARY = 'apps/task-runner/src';

/** The merged-at-base workspace members + the P12-owned ones (the import allowlist). */
const IMPORTABLE = new Set([
  '@sos-2/action-gateway',
  '@sos-2/autonomy-runtime',
  '@sos-2/body-broker',
  '@sos-2/body-runtimes',
  '@sos-2/execution-fabric',
  '@sos-2/live-store',
  '@sos-2/mission',
  '@sos-2/authority',
  '@sos-2/semantic-spine',
  '@sos-2/task-graph',
  '@sos-2/task-runtime',
  '@sos-2/worker-runtime',
  '@sos-2/orchestrator',
]);

/** Strip line + block comments (doc text names the banned APIs; only code is scanned). */
function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|\s)\/\/[^\n]*/g, ' ');
}

function walk(dir: string): string[] {
  const entries: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      entries.push(...walk(full));
    } else if (name.endsWith('.ts')) {
      entries.push(full);
    }
  }
  return entries;
}

describe('P12 structural pins', () => {
  it('offline determinism: no Date.now / Math.random / fetch / process.env / ambient timers in owned package sources', () => {
    const banned = [/Date\.now/, /Math\.random/, /\bfetch\(/, /process\.env/, /setInterval/, /setTimeout/];
    for (const sourceDir of OWNED_PACKAGE_SOURCES) {
      const files = walk(join(ROOT, sourceDir));
      expect(files.length).toBeGreaterThan(3);
      for (const file of files) {
        const code = stripComments(readFileSync(file, 'utf8'));
        for (const pattern of banned) {
          expect(code.match(pattern), `${file} must not match ${pattern}`).toBeNull();
        }
      }
    }
  });

  it('the ambient boundary is EXACTLY apps/task-runner/src (clock + main only)', () => {
    const boundary = walk(join(ROOT, COMPOSITION_BOUNDARY));
    expect(boundary.map((file) => file.split('/').pop()).sort()).toEqual(['clock.ts', 'composition.ts', 'index.ts', 'main.ts'].map((name) => name).sort());
    // clock.ts is the documented SystemClock boundary (Date.now allowed ONLY there).
    const clockText = readFileSync(join(ROOT, COMPOSITION_BOUNDARY, 'clock.ts'), 'utf8');
    expect(clockText).toContain('COMPOSITION BOUNDARY');
    // composition.ts + main.ts + index.ts stay deterministic (no ambient APIs).
    for (const name of ['composition.ts', 'index.ts', 'main.ts']) {
      const text = readFileSync(join(ROOT, COMPOSITION_BOUNDARY, name), 'utf8');
      expect(text.match(/Date\.now/), `${name} must not call Date.now directly (inject the clock)`).toBeNull();
    }
  });

  it('imports discipline: only merged + P12-owned workspace members (unmerged siblings never referenced)', () => {
    const scopes = [...OWNED_PACKAGE_SOURCES, join(ROOT, COMPOSITION_BOUNDARY), 'tests/autonomy/test'];
    for (const scope of scopes) {
      const base = scope.startsWith('/') ? scope : join(ROOT, scope);
      for (const file of walk(base)) {
        const text = readFileSync(file, 'utf8');
        const imports = [...text.matchAll(/from '(@sos-2\/[a-z0-9-]+)'/g)].map((match) => match[1]!);
        for (const name of imports) {
          expect(IMPORTABLE.has(name), `${file} imports unmerged/unknown workspace member ${name}`).toBe(true);
        }
      }
    }
  });

  it('zero new external dependencies: every @sos-2 dependency is workspace:*, toolchain versions match the base specs', () => {
    const specs = [
      'packages/autonomy-runtime/package.json',
      'packages/task-runtime/package.json',
      'apps/task-runner/package.json',
      'tests/autonomy/package.json',
    ];
    for (const spec of specs) {
      const pkg = JSON.parse(readFileSync(join(ROOT, spec), 'utf8'));
      const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
      for (const [name, version] of Object.entries(deps)) {
        if (name.startsWith('@sos-2/')) {
          expect(version).toBe('workspace:*');
          expect(IMPORTABLE.has(name), `${spec} depends on unmerged member ${name}`).toBe(true);
        } else {
          // The existing toolchain, same version specs as the base packages.
          expect(['@types/node', 'typescript', 'vitest']).toContain(name);
          expect(['^22.10.0', '^5.5.0', '^3.0.0']).toContain(version);
        }
      }
    }
  });

  it('the vitest seed is fixed (424242 — the repository convention)', () => {
    const config = readFileSync(join(process.cwd(), 'vitest.config.ts'), 'utf8');
    expect(config).toContain('seed: 424242');
  });

  it('the Architecture Delta record exists and satisfies the delta schema contract', () => {
    const delta = JSON.parse(readFileSync(join(ROOT, 'packages/autonomy-runtime/ARCHITECTURE-DELTA.json'), 'utf8'));
    const schema = JSON.parse(readFileSync(join(ROOT, 'spec/contracts/architecture-delta.schema.json'), 'utf8'));
    const allowed = new Set(Object.keys(schema.properties));
    for (const key of Object.keys(delta)) {
      expect(allowed.has(key), `delta property ${key} is not in the schema (additionalProperties: false)`).toBe(true);
    }
    for (const required of schema.required) {
      expect(delta[required]).toBeDefined();
    }
    expect(delta.work_order).toBe('P12');
    expect(delta.affected_artifacts).toEqual(['packages/autonomy-runtime', 'packages/task-runtime', 'apps/task-runner', 'tests/autonomy']);
  });
});
