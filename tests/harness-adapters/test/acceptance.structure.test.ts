/**
 * ACCEPTANCE (Work Order P8): structural scans — zero new external
 * dependencies, offline determinism, the §4 tier vocabulary, and the
 * honest statuses.
 *
 *   - every dependency of the five owned packages is a workspace link
 *     (workspace:*) and every devDependency is the repository's EXISTING
 *     toolchain (@types/node, typescript, vitest — already resolved by
 *     the base lockfile for the existing suites) — ZERO new external
 *     packages (pnpm-lock.yaml and pnpm-workspace.yaml remain unchanged
 *     in the committed diff; the lockfile rule itself is verified by the
 *     Work Order's verification commands);
 *   - no owned package source reads Date.now / Math.random / fetch /
 *     process.env — clocks, secrets, stores and command sources are
 *     injected (offline determinism; the apps/worker-runtimes
 *     composition boundary — system-clock.ts and index.ts, the apps/api
 *     precedent — is the single documented impure exception);
 *   - every owned vitest config pins the repository's deterministic
 *     seed;
 *   - the owned packages never import the P3 package (structural
 *     isolation) and never import unmerged-sibling-only vocabulary.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { INTEGRATION_TIERS } from '@sos-2/runtime-contracts';
import { ADAPTER_CONNECTION_STATUSES } from '@sos-2/harness-adapters';

const OWNED_PACKAGES = [
  'packages/sandbox',
  'packages/body-runtimes',
  'packages/harness-adapters',
  'apps/worker-runtimes',
  'tests/harness-adapters',
] as const;

const REPO_ROOT = join(import.meta.dirname, '..', '..', '..');

const EXISTING_TOOLCHAIN = new Set(['@types/node', 'typescript', 'vitest']);

/** The apps/worker-runtimes composition boundary (the apps/api precedent: the only impure spot). */
const COMPOSITION_BOUNDARY = new Set(['apps/worker-runtimes/src/system-clock.ts', 'apps/worker-runtimes/src/index.ts']);

/** Strip /* block *\/ and // line comments so the scan tests CODE, not prose. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function walk(dir: string): string[] {
  const entries: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === 'dist' || name === 'node_modules') {
        continue;
      }
      entries.push(...walk(full));
    } else {
      entries.push(full);
    }
  }
  return entries;
}

function relative(file: string): string {
  return file.slice(join(REPO_ROOT).length + 1);
}

describe('acceptance: zero new external dependencies', () => {
  it('every runtime dependency of the owned packages is a workspace link', () => {
    for (const pkg of OWNED_PACKAGES) {
      const manifest = JSON.parse(readFileSync(join(REPO_ROOT, pkg, 'package.json'), 'utf8')) as {
        dependencies?: Record<string, string>;
      };
      for (const [name, spec] of Object.entries(manifest.dependencies ?? {})) {
        expect(
          spec,
          `${pkg} dependency ${name} must be a workspace link (workspace:*) — zero new external dependencies`,
        ).toBe('workspace:*');
        expect(name.startsWith('@sos-2/'), `${pkg} dependency ${name} must be a workspace package`).toBe(true);
      }
    }
  });

  it('every devDependency is the repository EXISTING toolchain (no new external dev deps)', () => {
    for (const pkg of OWNED_PACKAGES) {
      const manifest = JSON.parse(readFileSync(join(REPO_ROOT, pkg, 'package.json'), 'utf8')) as {
        devDependencies?: Record<string, string>;
      };
      const devDeps = Object.keys(manifest.devDependencies ?? {});
      expect(devDeps.length, `${pkg} devDependencies`).toBeGreaterThan(0);
      for (const name of devDeps) {
        expect(
          EXISTING_TOOLCHAIN.has(name),
          `${pkg} devDependency ${name} is NOT part of the repository's existing toolchain [${[...EXISTING_TOOLCHAIN].join(', ')}] — zero new external dependencies`,
        ).toBe(true);
      }
    }
  });

  it('the owned packages add no external packages the base lockfile did not already resolve', () => {
    const lockfile = readFileSync(join(REPO_ROOT, 'pnpm-lock.yaml'), 'utf8');
    for (const tool of EXISTING_TOOLCHAIN) {
      expect(lockfile, `the base lockfile already resolves ${tool}`).toContain(tool);
    }
    for (const pkg of OWNED_PACKAGES) {
      const manifest = JSON.parse(readFileSync(join(REPO_ROOT, pkg, 'package.json'), 'utf8')) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      for (const name of [...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.devDependencies ?? {})]) {
        if (name.startsWith('@sos-2/')) {
          continue;
        }
        expect(lockfile.includes(`'${name}'`) || lockfile.includes(`${name}@`), `${name} must already be resolved by the base lockfile`).toBe(true);
      }
    }
  });

  it('the new packages are covered by the EXISTING workspace globs (no pnpm-workspace.yaml change)', () => {
    const workspace = readFileSync(join(REPO_ROOT, 'pnpm-workspace.yaml'), 'utf8');
    expect(workspace).toContain('packages/*');
    expect(workspace).toContain('apps/*');
    expect(workspace).toContain('tests/*');
    for (const pkg of ['packages/sandbox', 'packages/body-runtimes', 'packages/harness-adapters', 'apps/worker-runtimes', 'tests/harness-adapters']) {
      const manifest = JSON.parse(readFileSync(join(REPO_ROOT, pkg, 'package.json'), 'utf8')) as { name: string };
      // The importer for each new package exists in the (locally refreshed)
      // lockfile — the COMMITTED lockfile stays byte-identical to base
      // (verified by the Work Order's git-diff gate; the P5 precedent).
      expect(manifest.name).toMatch(/^@sos-2\//);
    }
  });
});

describe('acceptance: offline determinism (no hidden time, randomness, network or environment)', () => {
  const FORBIDDEN_PATTERNS: [string, RegExp][] = [
    ['Date.now', /\bDate\.now\b/],
    ['Math.random', /\bMath\.random\b/],
    ['global fetch', /\bfetch\s*\(/],
    ['process.env', /\bprocess\.env\b/],
    ['ambient timers', /\b(setTimeout|setInterval)\s*\(/],
    ['real process spawning', /\b(child_process|spawnSync|execSync)\b/],
  ];

  it('no owned package SOURCE reads Date.now / Math.random / fetch / process.env / timers / spawns processes', () => {
    for (const pkg of ['packages/sandbox', 'packages/body-runtimes', 'packages/harness-adapters', 'apps/worker-runtimes'] as const) {
      for (const file of walk(join(REPO_ROOT, pkg, 'src'))) {
        if (!file.endsWith('.ts')) {
          continue;
        }
        // The composition boundary is the single documented impure
        // exception (the apps/api precedent: SystemClock + the main entry).
        if (COMPOSITION_BOUNDARY.has(relative(file))) {
          continue;
        }
        const code = stripComments(readFileSync(file, 'utf8'));
        for (const [label, pattern] of FORBIDDEN_PATTERNS) {
          expect(
            pattern.test(code),
            `${relative(file)} must not use ${label} — clocks, entropy, network, processes and inputs are injected (offline determinism)`,
          ).toBe(false);
        }
      }
    }
  });

  it('the acceptance helpers are clock-less and network-less too', () => {
    for (const file of walk(join(REPO_ROOT, 'tests/harness-adapters', 'test'))) {
      if (!file.endsWith('.ts') || file.endsWith('.test.ts')) {
        continue;
      }
      const code = stripComments(readFileSync(file, 'utf8'));
      for (const [label, pattern] of FORBIDDEN_PATTERNS) {
        expect(pattern.test(code), `${relative(file)} must not use ${label}`).toBe(false);
      }
    }
  });

  it('every owned vitest config pins the repository deterministic seed', () => {
    for (const pkg of OWNED_PACKAGES) {
      const config = readFileSync(join(REPO_ROOT, pkg, 'vitest.config.ts'), 'utf8');
      expect(config, `${pkg} vitest config pins the deterministic seed`).toContain('seed: 424242');
    }
  });
});

describe('acceptance: structural isolation and frozen vocabulary', () => {
  it('the owned packages never import the P3 package (body-provider configuration alignment is BY SPEC)', () => {
    for (const pkg of ['packages/sandbox', 'packages/body-runtimes', 'packages/harness-adapters', 'apps/worker-runtimes'] as const) {
      for (const file of walk(join(REPO_ROOT, pkg, 'src'))) {
        if (!file.endsWith('.ts')) {
          continue;
        }
        const code = stripComments(readFileSync(file, 'utf8'));
        const importSpecifiers = [...code.matchAll(/from\s+'([^']+)'|import\s+'([^']+)'/g)]
          .map((match) => match[1] ?? match[2])
          .filter((specifier): specifier is string => typeof specifier === 'string');
        expect(
          importSpecifiers.some((specifier) => specifier.startsWith('@sos-2/infra-deployment') || specifier.includes('infra/deployment')),
          `${relative(file)} must not import the P3 package — body-provider configuration alignment is BY SPEC (the P3/P5 structural-isolation precedent)`,
        ).toBe(false);
      }
    }
  });

  it('the owned packages import only merged workspace packages (no unmerged-sibling dependencies)', () => {
    const MERGED = new Set([
      '@sos-2/semantic-spine',
      '@sos-2/runtime-contracts',
      '@sos-2/harness',
      '@sos-2/body-broker',
      '@sos-2/execution-fabric',
      '@sos-2/live-store',
      '@sos-2/authority',
      '@sos-2/contracts',
      // P8-owned packages (internal cross-imports are the owned set itself).
      '@sos-2/sandbox',
      '@sos-2/body-runtimes',
      '@sos-2/harness-adapters',
    ]);
    for (const pkg of ['packages/sandbox', 'packages/body-runtimes', 'packages/harness-adapters', 'apps/worker-runtimes'] as const) {
      for (const file of walk(join(REPO_ROOT, pkg, 'src'))) {
        if (!file.endsWith('.ts')) {
          continue;
        }
        const code = stripComments(readFileSync(file, 'utf8'));
        const importSpecifiers = [...code.matchAll(/from\s+'([^']+)'|import\s+'([^']+)'/g)]
          .map((match) => match[1] ?? match[2])
          .filter((specifier): specifier is string => typeof specifier === 'string' && specifier.startsWith('@sos-2/'));
        for (const specifier of importSpecifiers) {
          expect(
            MERGED.has(specifier),
            `${relative(file)} imports ${specifier} — only merged packages and the P8-owned set are legal dependencies (unmerged siblings are never dependencies)`,
          ).toBe(true);
        }
      }
    }
  });

  it('the §4 tier vocabulary is the frozen five-tier ladder and the honest adapter statuses are pinned', () => {
    expect(INTEGRATION_TIERS).toEqual(['native-api', 'mcp-protocol', 'local-bridge', 'extension', 'ui-automation']);
    expect(ADAPTER_CONNECTION_STATUSES).toContain('NOT_YET_CONNECTED');
    expect(ADAPTER_CONNECTION_STATUSES).toContain('CONNECTED');
    expect(ADAPTER_CONNECTION_STATUSES).toContain('UNAVAILABLE');
    expect(ADAPTER_CONNECTION_STATUSES).toContain('UNKNOWN');
  });
});
