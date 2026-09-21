/**
 * Determinism + zero-dependency discipline tests (Work Order P4, the
 * P1/P3 discipline pins): no Date.now / Math.random / fetch / ambient
 * process.env anywhere in this package's source; the package declares
 * ZERO dependencies of any kind (the lockfile byte-identity root
 * cause); the Architecture Delta record validates against the frozen
 * schema and pins its Work Order.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInMemoryGitHubProvider } from '../src/index.ts';

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(here, '..');

const FORBIDDEN_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /Date\.now\s*\(/, label: 'Date.now' },
  { pattern: /Math\.random\s*\(/, label: 'Math.random' },
  { pattern: /\bfetch\s*\(/, label: 'fetch' },
  { pattern: /process\.env/, label: 'ambient process.env' },
];

function listSourceFiles(directory: string, collected: string[] = []): string[] {
  for (const entry of readdirSync(directory)) {
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist') {
        continue;
      }
      listSourceFiles(full, collected);
    } else if (entry.endsWith('.ts')) {
      collected.push(full);
    }
  }
  return collected;
}

/** Strip comments (line + block) so documentation mentions never trip the scan — only CODE is scanned. */
function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/^\s*\/\/.*$/, ''))
    .join('\n');
}

describe('determinism discipline (no hidden time, randomness, network or ambient env)', () => {
  test('no forbidden calls appear anywhere in the package source', () => {
    const sources = listSourceFiles(join(packageRoot, 'src'));
    expect(sources.length).toBeGreaterThan(0);
    const offenders: string[] = [];
    for (const file of sources) {
      const text = stripComments(readFileSync(file, 'utf8'));
      for (const { pattern, label } of FORBIDDEN_PATTERNS) {
        if (pattern.test(text)) {
          offenders.push(`${file}: ${label}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test('two fresh reference providers behave identically over the same operations (fixture determinism)', async () => {
    const run = async () => {
      const provider = createInMemoryGitHubProvider();
      const discovery = await provider.discoverRepositories();
      const branches = await provider.listBranches({ owner: 'acme', name: 'legacy-checkout' });
      const snapshot = await provider.getRepositorySnapshot({ owner: 'acme', name: 'legacy-checkout' }, {}, '2025-06-15T12:00:00Z');
      return JSON.stringify({ discovery, branches, snapshot });
    };
    expect(await run()).toBe(await run());
  });
});

describe('zero-dependency declaration (the lockfile byte-identity root cause)', () => {
  test('packages/github declares ZERO dependencies of any kind', () => {
    const pkg = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as Record<string, unknown>;
    for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
      const value = pkg[field];
      expect(value === undefined || Object.keys(value as Record<string, unknown>).length === 0).toBe(true);
    }
  });
});

describe('the Architecture Delta record (Work Order P4)', () => {
  const deltaPath = join(packageRoot, '..', '..', 'apps', 'web', 'onboarding', 'ARCHITECTURE-DELTA.json');

  test('the delta record exists and validates against the frozen schema requirements', () => {
    const delta = JSON.parse(readFileSync(deltaPath, 'utf8')) as Record<string, unknown>;
    expect(Array.isArray(delta['affected_artifacts'])).toBe(true);
    expect((delta['affected_artifacts'] as string[]).length).toBeGreaterThan(0);
    expect(Array.isArray(delta['preserved_invariants'])).toBe(true);
    expect((delta['preserved_invariants'] as string[]).length).toBeGreaterThan(0);
    for (const optionalArray of ['added', 'removed', 'modified', 'boundary_changes']) {
      const value = delta[optionalArray];
      expect(value === undefined || Array.isArray(value)).toBe(true);
    }
    expect(delta['work_order']).toBe('P4');
    expect(delta['rationale_ref']).toBe('spec/productization-work-orders/P4-onboarding.md');
    const allowedKeys = new Set([
      'affected_artifacts',
      'added',
      'removed',
      'modified',
      'preserved_invariants',
      'boundary_changes',
      'rationale_ref',
      'work_order',
    ]);
    for (const key of Object.keys(delta)) {
      expect(allowedKeys.has(key)).toBe(true);
    }
  });

  test('the delta declares every P4-owned path in affected_artifacts', () => {
    const delta = JSON.parse(readFileSync(deltaPath, 'utf8')) as { affected_artifacts: string[] };
    for (const owned of ['apps/web', 'packages/web-contracts', 'packages/github']) {
      expect(delta.affected_artifacts).toContain(owned);
    }
  });
});
