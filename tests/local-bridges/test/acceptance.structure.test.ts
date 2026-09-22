/**
 * ACCEPTANCE (Work Order P11): STRUCTURAL SCANS — zero new external
 * dependencies, offline determinism, the repository's fixed vitest seed,
 * only merged + P11-owned workspace imports (unmerged siblings never
 * referenced), and the companion-absent import discipline of the
 * cloud-independence proof.
 *
 *   - every dependency of the six owned packages is a workspace link
 *     (workspace:*) and every devDependency is the repository's EXISTING
 *     toolchain (@types/node, typescript, vitest — already resolved by
 *     the base lockfile) — ZERO new external packages (pnpm-lock.yaml and
 *     pnpm-workspace.yaml remain byte-identical to base in the committed
 *     diff; the lockfile rule itself is verified by the Work Order's
 *     git-diff gate);
 *   - no owned package source reads Date.now / Math.random / fetch /
 *     process.env / ambient timers / child_process — clocks, authorities,
 *     stores, ports, transports and command sources are injected (offline
 *     determinism; the apps/companion composition boundary —
 *     system-clock.ts and index.ts, the apps/api + apps/worker-runtimes
 *     precedent — is the single documented impure exception);
 *   - every owned vitest config pins the repository's deterministic seed;
 *   - the owned sources import ONLY merged + P11-owned workspace packages
 *     (unmerged sibling waves P6/P7 are never referenced);
 *   - the cloud-independence proof file imports ZERO P11 packages (the
 *     companion-absent world is pinned structurally).
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const OWNED_PACKAGES = [
  'packages/local-companion',
  'packages/browser-bridge',
  'packages/ide-bridge',
  'apps/companion',
  'tests/local-bridges',
] as const;

const REPO_ROOT = join(import.meta.dirname, '..', '..', '..');

const EXISTING_TOOLCHAIN = new Set(['@types/node', 'typescript', 'vitest']);

/** The apps/companion composition boundary (the apps/api + apps/worker-runtimes precedent: the only impure spot). */
const COMPOSITION_BOUNDARY = new Set(['apps/companion/src/system-clock.ts', 'apps/companion/src/index.ts']);

/** The merged workspace packages the P11 sources may import (P11-owned ones are always allowed). */
const P11_OWNED = new Set(['@sos-2/local-companion', '@sos-2/browser-bridge', '@sos-2/ide-bridge', '@sos-2/companion', '@sos-2/local-bridge-contracts']);
const MERGED_IMPORTABLE = new Set([
  '@sos-2/authority',
  '@sos-2/body-broker',
  '@sos-2/body-runtimes',
  '@sos-2/execution-fabric',
  '@sos-2/harness',
  '@sos-2/harness-adapters',
  '@sos-2/live-store',
  '@sos-2/provenance',
  '@sos-2/runtime-contracts',
  '@sos-2/semantic-spine',
]);

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

function tsSourcesOf(pkg: string): string[] {
  return walk(join(REPO_ROOT, pkg, 'src')).filter((file) => file.endsWith('.ts'));
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
    for (const pkg of OWNED_PACKAGES) {
      const manifest = JSON.parse(readFileSync(join(REPO_ROOT, pkg, 'package.json'), 'utf8')) as { name: string };
      // The importer for each new package exists in the (locally refreshed)
      // lockfile — the COMMITTED lockfile stays byte-identical to base
      // (verified by the Work Order's git-diff gate; the P5/P8 precedent).
      expect(manifest.name).toMatch(/^@sos-2\//);
    }
  });
});

describe('acceptance: offline determinism (no hidden time, randomness, network, environment or processes)', () => {
  const FORBIDDEN_PATTERNS: [string, RegExp][] = [
    ['Date.now', /\bDate\.now\b/],
    ['Math.random', /\bMath\.random\b/],
    ['global fetch', /\bfetch\s*\(/],
    ['process.env', /\bprocess\.env\b/],
    ['ambient timers', /\b(setTimeout|setInterval)\s*\(/],
    ['real process spawning', /\b(child_process|spawnSync|execSync)\b/],
  ];

  it('no owned package SOURCE reads Date.now / Math.random / fetch / process.env / timers / spawns processes', () => {
    for (const pkg of ['packages/local-companion', 'packages/browser-bridge', 'packages/ide-bridge', 'apps/companion'] as const) {
      for (const file of tsSourcesOf(pkg)) {
        // The composition boundary is the single documented impure
        // exception (the apps/api + apps/worker-runtimes precedent:
        // SystemClock + the main entry).
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
    for (const file of walk(join(REPO_ROOT, 'tests/local-bridges', 'test'))) {
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
      expect(config, `${pkg} must pin the repository's fixed vitest seed`).toContain('seed: 424242');
    }
  });
});

describe('acceptance: only merged + P11-owned workspace imports (unmerged siblings never referenced)', () => {
  it('every workspace import of the owned sources is merged or P11-owned', () => {
    for (const pkg of ['packages/local-companion', 'packages/browser-bridge', 'packages/ide-bridge', 'apps/companion'] as const) {
      for (const file of tsSourcesOf(pkg)) {
        const code = readFileSync(file, 'utf8');
        const imports = [...code.matchAll(/from '(@sos-2\/[a-z0-9-]+)'/g)].map((match) => match[1]!);
        for (const name of imports) {
          expect(
            P11_OWNED.has(name) || MERGED_IMPORTABLE.has(name),
            `${relative(file)} imports ${name} — only MERGED workspace packages and P11-owned packages are importable (unmerged sibling waves P6/P7 are never dependencies)`,
          ).toBe(true);
        }
      }
    }
  });

  it('the cloud-independence proof file imports ZERO P11 packages (the companion-absent world)', () => {
    const file = join(REPO_ROOT, 'tests/local-bridges', 'test', 'acceptance.cloud-independence.test.ts');
    const code = readFileSync(file, 'utf8');
    const imports = [...code.matchAll(/from '(@sos-2\/[a-z0-9-]+)'/g)].map((match) => match[1]!);
    expect(imports.length).toBeGreaterThan(0);
    for (const name of imports) {
      expect(
        P11_OWNED.has(name),
        `the cloud-independence proof must not import ${name} — cloud tasks never require the companion (ZERO companion presence, pinned structurally)`,
      ).toBe(false);
      expect(MERGED_IMPORTABLE.has(name), `the cloud-independence proof imports only merged packages (found ${name})`).toBe(true);
    }
  });

  it('the frozen paths are untouched by the owned packages (no imports of spec/scripts/.github reach into sources)', () => {
    // The owned sources never import from the frozen trees — structural
    // isolation by construction (the owned packages import only workspace
    // packages, verified above); this scan pins that no relative import
    // escapes an owned package either.
    for (const pkg of ['packages/local-companion', 'packages/browser-bridge', 'packages/ide-bridge', 'apps/companion'] as const) {
      for (const file of tsSourcesOf(pkg)) {
        const code = readFileSync(file, 'utf8');
        const relativeImports = (code.match(/from '\.\./g) ?? []).length;
        expect(relativeImports, `${relative(file)} must not import outside its package (structural isolation)`).toBe(0);
      }
    }
  });
});
