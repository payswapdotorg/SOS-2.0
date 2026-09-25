/**
 * THE STRUCTURAL ACCEPTANCE SUITE (Work Order P13) — the discipline
 * pins: zero new external dependencies (workspace:* + the existing
 * toolchain only), offline determinism (no ambient time, randomness,
 * environment, network, processes or timers in the owned sources),
 * fixed vitest seed, only merged + P13-owned workspace imports, and the
 * Architecture Delta record validating against the repository schema.
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const REPO_ROOT = new URL('../../../', import.meta.url).pathname;
const OWNED_DIRS = [
  'packages/implementation-orchestrator',
  'packages/greenfield-runtime',
  'packages/project-realization',
  'tests/mission-to-repo',
];
const OWNED_PACKAGE_JSONS = OWNED_DIRS.map((dir) => join(dir, 'package.json'));
const THIS_FILE = 'tests/mission-to-repo/test/structural.test.ts';

// The P4 reference github provider is ENTRY-POINT-LESS by design (the
// P3/P4 lockfile-byte-identity precedent) — it binds through its source
// entry, exactly the way the merged P4 suites bind it. This is the ONE
// documented source binding outside the owned paths.
const GITHUB_SOURCE_BINDING = 'packages/github/src/index.ts';

// The merged + P13-owned workspace imports (nothing unmerged is referenced).
const ALLOWED_WORKSPACE_IMPORTS = new Set([
  '@sos-2/action-gateway',
  '@sos-2/authority',
  '@sos-2/body-broker',
  '@sos-2/body-runtimes',
  '@sos-2/evaluation-orchestration',
  '@sos-2/evaluator',
  '@sos-2/execution-fabric',
  '@sos-2/greenfield-runtime',
  '@sos-2/harness',
  '@sos-2/implementation-orchestrator',
  '@sos-2/live-store',
  '@sos-2/mission',
  '@sos-2/project-realization',
  '@sos-2/semantic-spine',
  '@sos-2/task-graph',
]);

// Tokens are assembled from fragments so this scanner never contains them itself.
const BANNED_TOKENS: readonly string[] = [
  ['Date', '.now'].join(''),
  ['Math', '.random'].join(''),
  ['proc', 'ess.env'].join(''),
  ['child', '_process'].join(''),
  ['set', 'Timeout'].join(''),
  ['set', 'Interval'].join(''),
  ['clear', 'Interval'].join(''),
  ['fetch', '('].join(''),
];

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listFiles(full));
    else out.push(full);
  }
  return out;
}

/** Strip block and line comments so the scan tests CODE, not prose (the P6 convention). */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function ownedSourceFiles(): Array<{ rel: string; text: string }> {
  const files: Array<{ rel: string; text: string }> = [];
  for (const dir of OWNED_DIRS) {
    for (const full of listFiles(join(REPO_ROOT, dir))) {
      if (!full.endsWith('.ts') || full.endsWith('.d.ts')) continue;
      const rel = full.slice(REPO_ROOT.length);
      if (rel === THIS_FILE) continue; // the scanner is excluded from its own scan
      files.push({ rel, text: stripComments(readFileSync(full, 'utf8')) });
    }
  }
  return files;
}

describe('P13 structural scans', () => {
  it('offline determinism: no ambient time, randomness, environment, network, processes, or timers in owned sources', () => {
    for (const file of ownedSourceFiles()) {
      for (const token of BANNED_TOKENS) {
        expect(file.text.includes(token), `${file.rel} must not contain ${token}`).toBe(false);
      }
    }
  });

  it('zero new external dependencies: owned manifests use workspace:* only (existing-toolchain carve-out per the P6/P9 convention)', () => {
    const TOOLCHAIN: Record<string, string> = {
      typescript: '^5.5.0',
      vitest: '^3.0.0',
      '@types/node': '^22.10.0',
    };
    for (const manifestPath of OWNED_PACKAGE_JSONS) {
      const manifest = JSON.parse(readFileSync(join(REPO_ROOT, manifestPath), 'utf8')) as Record<string, unknown>;
      for (const section of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
        const deps = manifest[section] as Record<string, string> | undefined;
        if (deps === undefined) continue;
        for (const [name, spec] of Object.entries(deps)) {
          expect(spec, `${manifestPath}: ${name}`).toBe('workspace:*');
          expect(ALLOWED_WORKSPACE_IMPORTS.has(name), `${manifestPath}: ${name} is not a merged + P13-owned workspace package`).toBe(true);
        }
      }
      const dev = manifest['devDependencies'] as Record<string, string> | undefined;
      if (dev === undefined) continue;
      for (const [name, spec] of Object.entries(dev)) {
        const allowed = spec === 'workspace:*' || TOOLCHAIN[name] === spec;
        expect(allowed, `${manifestPath}: ${name}@${spec}`).toBe(true);
      }
    }
  });

  it('the lockfile gains no registry resolution for owned packages', () => {
    let lockfile: string;
    try {
      lockfile = readFileSync(join(REPO_ROOT, 'pnpm-lock.yaml'), 'utf8');
    } catch {
      expect(true).toBe(true); // no lockfile visible at this base
      return;
    }
    const ownedNames = [
      '@sos-2/implementation-orchestrator',
      '@sos-2/greenfield-runtime',
      '@sos-2/project-realization',
      '@sos-2/tests-mission-to-repo',
    ];
    for (const line of lockfile.split('\n')) {
      if (!ownedNames.some((name) => line.includes(name))) continue;
      expect(line.includes('resolution:') || line.includes('.tgz'), `unexpected registry resolution: ${line.trim()}`).toBe(false);
    }
  });

  it('import boundary: only relative, node:, vitest, and merged + P13-owned workspace imports', () => {
    const importPattern = /(?:from|import)\s+['"]([^'"]+)['"]/g;
    for (const file of ownedSourceFiles()) {
      for (const match of file.text.matchAll(importPattern)) {
        const specifier = match[1] ?? '';
        if (specifier === 'vitest' || specifier === 'vitest/config' || specifier.startsWith('node:')) continue;
        if (specifier.startsWith('.')) {
          // Relative imports stay within the owned paths — except the ONE
          // documented P4 source binding (the entry-point-less github package).
          const resolved = resolve(REPO_ROOT, join(REPO_ROOT, file.rel, '..'), specifier);
          const rel = resolved.slice(REPO_ROOT.length);
          const inOwned = OWNED_DIRS.some((dir) => rel === dir || rel.startsWith(`${dir}/`));
          const isGithubBinding = rel === GITHUB_SOURCE_BINDING || rel === `${GITHUB_SOURCE_BINDING}.ts`;
          expect(
            inOwned || isGithubBinding,
            `${file.rel} escapes the owned paths via ${specifier} (resolved ${rel}; only the documented P4 github source binding may escape)`,
          ).toBe(true);
          continue;
        }
        expect(ALLOWED_WORKSPACE_IMPORTS.has(specifier), `${file.rel} imports ${specifier} — only merged + P13-owned workspace packages are allowed`).toBe(true);
      }
    }
  });

  it('the fixed vitest seed configuration is in place (the repository convention)', () => {
    const config = readFileSync(join(REPO_ROOT, 'tests/mission-to-repo/vitest.config.ts'), 'utf8');
    expect(/seed\s*:\s*424242/.test(config), 'the P13 vitest config must keep the fixed seed 424242').toBe(true);
  });

  it('the Architecture Delta record validates against the repository schema and declares the P13 contract', () => {
    const delta = JSON.parse(readFileSync(join(REPO_ROOT, 'packages/implementation-orchestrator/ARCHITECTURE-DELTA.json'), 'utf8')) as Record<string, unknown>;
    const schema = JSON.parse(readFileSync(join(REPO_ROOT, 'spec/contracts/architecture-delta.schema.json'), 'utf8')) as {
      required: string[];
      properties: Record<string, { type: string }>;
      additionalProperties: boolean;
    };

    // required fields present
    for (const field of schema.required) {
      expect(delta[field], `the delta record requires ${field}`).toBeDefined();
    }
    // additionalProperties: false — no unknown keys
    const knownKeys = new Set(Object.keys(schema.properties));
    for (const key of Object.keys(delta)) {
      expect(knownKeys.has(key), `the delta record carries the unknown key ${key} (additionalProperties: false)`).toBe(true);
    }
    // types
    for (const [key, property] of Object.entries(schema.properties)) {
      const value = delta[key];
      if (value === undefined) continue;
      if (property.type === 'array') {
        expect(Array.isArray(value), `delta.${key} must be an array`).toBe(true);
        for (const entry of value as unknown[]) {
          expect(typeof entry, `delta.${key} entries must be strings`).toBe('string');
        }
      } else if (property.type === 'string') {
        expect(typeof value, `delta.${key} must be a string`).toBe('string');
      }
    }
    if (delta['rationale_ref'] !== null && delta['rationale_ref'] !== undefined) {
      expect(typeof delta['rationale_ref']).toBe('string');
    }

    // The P13 contract: the four owned paths, the work order, the rationale.
    expect(delta['work_order']).toBe('P13');
    expect(delta['rationale_ref']).toBe('spec/productization-work-orders/P13-mission-to-implementation.md');
    const affected = delta['affected_artifacts'] as string[];
    expect(affected).toEqual([
      'packages/implementation-orchestrator',
      'packages/greenfield-runtime',
      'packages/project-realization',
      'tests/mission-to-repo',
    ]);
    // The preserved invariants pin the non-negotiable boundaries.
    const invariants = (delta['preserved_invariants'] as string[]).join('\n');
    expect(invariants).toContain('P9 action-gateway');
    expect(invariants).toContain('independent P9 evaluation suite');
    expect(invariants).toContain('ASK is first-class');
    expect(invariants).toContain('user device is optional');
    expect(invariants).toContain('pnpm-lock.yaml');
  });
});
