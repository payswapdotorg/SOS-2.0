/**
 * ACCEPTANCE: zero new external dependencies; all tests offline and
 * deterministic (Work Order P5).
 *
 * Structural scans over the five owned paths:
 *
 *   - every dependency of the new packages is a workspace link
 *     (workspace:*) and every devDependency is the repository's EXISTING
 *     toolchain (@types/node, typescript, vitest — resolved in the base
 *     lockfile for the existing suites) — ZERO new external packages;
 *   - no package source reads Date.now / Math.random / fetch /
 *     process.env (clocks and inputs are injected — offline determinism,
 *     the P2/P3 discipline);
 *   - the vitest configurations pin the repository's deterministic seed;
 *   - the P5 vocabulary alignment: the harness capability vocabulary and
 *     the P3 body-provider capability vocabulary both mirror the §1/§3
 *     spec surfaces (documented alignment — each pinned to the spec
 *     independently, import deliberately absent, following the P3
 *     structural-isolation precedent).
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HARNESS_CAPABILITIES } from '@sos-2/harness';
import { INTEGRATION_TIERS } from '@sos-2/runtime-contracts';

const OWNED_PACKAGES = [
  'packages/runtime-contracts',
  'packages/harness',
  'packages/body-broker',
  'packages/execution-fabric',
  'tests/harness-contracts',
] as const;

const REPO_ROOT = join(import.meta.dirname, '..', '..', '..');

const EXISTING_TOOLCHAIN = new Set(['@types/node', 'typescript', 'vitest']);

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
    // Every external dependency NAME the owned packages could introduce
    // (@types/node, typescript, vitest) is already resolved by the base
    // pnpm-lock.yaml for the existing suites — the new packages add no
    // new resolution entries. (The lockfile itself stays byte-identical;
    // this scan pins the DEPENDENCY DISCIPLINE the lockfile rule encodes.)
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
});

describe('acceptance: offline determinism (no hidden time, randomness, network or environment)', () => {
  const FORBIDDEN_PATTERNS: [string, RegExp][] = [
    ['Date.now', /\bDate\.now\b/],
    ['Math.random', /\bMath\.random\b/],
    ['global fetch', /\bfetch\s*\(/],
    ['process.env', /\bprocess\.env\b/],
  ];

  it('no package SOURCE reads Date.now / Math.random / fetch / process.env', () => {
    for (const pkg of ['packages/runtime-contracts', 'packages/harness', 'packages/body-broker', 'packages/execution-fabric'] as const) {
      for (const file of walk(join(REPO_ROOT, pkg, 'src'))) {
        if (!file.endsWith('.ts')) {
          continue;
        }
        const code = stripComments(readFileSync(file, 'utf8'));
        for (const [label, pattern] of FORBIDDEN_PATTERNS) {
          expect(
            pattern.test(code),
            `${file} must not use ${label} — clocks, entropy and inputs are injected (offline determinism)`,
          ).toBe(false);
        }
      }
    }
  });

  it('the acceptance bodies and helpers are clock-less and network-less too', () => {
    for (const file of walk(join(REPO_ROOT, 'tests/harness-contracts', 'test'))) {
      if (!file.endsWith('.ts') || file.endsWith('.test.ts')) {
        continue;
      }
      const code = stripComments(readFileSync(file, 'utf8'));
      for (const [label, pattern] of FORBIDDEN_PATTERNS) {
        expect(pattern.test(code), `${file} must not use ${label}`).toBe(false);
      }
    }
  });

  it('every owned vitest config pins the repository deterministic seed', () => {
    for (const pkg of OWNED_PACKAGES) {
      const config = readFileSync(join(REPO_ROOT, pkg, 'vitest.config.ts'), 'utf8');
      expect(config, `${pkg} vitest config pins the deterministic seed`).toContain('seed: 424242');
    }
  });

  it('the harness capability vocabulary mirrors the §1/§3 surfaces (documented alignment with P3, import deliberately absent)', () => {
    // spec/productization-execution-architecture.md §1 body surfaces:
    // terminal and filesystem access, repository operations, browser/UI
    // interaction, runtime/cloud APIs, IDE or desktop interaction,
    // deployment operations. The P3 body-provider vocabulary mirrors the
    // same surfaces; alignment is BY SPEC (import forbidden by the P3
    // structural-isolation design — and by the frozen-against-me rule:
    // infra/deployment is P3's owned path).
    for (const surface of [
      'terminal',
      'filesystem',
      'repository-operations',
      'browser-ui',
      'runtime-cloud-apis',
      'ide-desktop',
      'deployment-operations',
    ]) {
      expect((HARNESS_CAPABILITIES as readonly string[]).includes(surface)).toBe(true);
    }
    // The §4 integration priority order is the frozen five-tier ladder.
    expect(INTEGRATION_TIERS).toEqual(['native-api', 'mcp-protocol', 'local-bridge', 'extension', 'ui-automation']);
    // The P5 packages never import the P3 package (structural isolation,
    // by design): scan the sources.
    for (const pkg of ['packages/runtime-contracts', 'packages/harness', 'packages/body-broker', 'packages/execution-fabric'] as const) {
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
          `${file} must not import the P3 package — body-provider configuration alignment is BY SPEC (the P3 structural-isolation precedent)`,
        ).toBe(false);
      }
    }
  });
});
