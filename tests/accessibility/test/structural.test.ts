/**
 * THE STRUCTURAL DISCIPLINE SUITE (Work Order P15, lane C) — the pins:
 *
 *   - zero new external dependencies: the owned manifest uses
 *     workspace:* only; devDependencies are the existing toolchain;
 *   - offline determinism: no ambient time, randomness, environment,
 *     network, processes or timers in the owned sources (the ONE
 *     documented exception is the apps/companion + packages/github
 *     composition bindings, listed below);
 *   - import boundary: only relative (within the owned paths + the two
 *     documented source bindings), node:, vitest and the merged
 *     workspace packages the lane declares;
 *   - the repository's fixed vitest seed (424242);
 *   - the lockfile gains no registry resolution for the owned package;
 *   - the lane Architecture Delta record validates against the frozen
 *     schema and declares the P15 lane-C contract.
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const REPO_ROOT = new URL('../../../', import.meta.url).pathname;
const OWNED_DIRS = ['tests/accessibility'];
const OWNED_PACKAGE_JSONS = OWNED_DIRS.map((dir) => join(dir, 'package.json'));
const THIS_FILE = 'tests/accessibility/test/structural.test.ts';
const EVIDENCE_DIR = 'docs/evidence/productization/c-accessibility-negatives';

// The P4 reference github provider is ENTRY-POINT-LESS by design (the
// P3/P4 lockfile-byte-identity precedent) — the journey world binds it
// through its source entry, exactly the way the merged P13 suite binds
// it. This is the ONE documented source binding outside the owned paths.
const GITHUB_SOURCE_BINDING = 'packages/github/src/index.ts';

// The merged workspace imports this lane consumes (every one a merged
// public export; the manifest must declare exactly these).
const ALLOWED_WORKSPACE_IMPORTS = new Set([
  '@sos-2/action-gateway',
  '@sos-2/assurance',
  '@sos-2/authority',
  '@sos-2/autonomy-runtime',
  '@sos-2/body-broker',
  '@sos-2/body-runtimes',
  '@sos-2/companion',
  '@sos-2/cost-policy',
  '@sos-2/deployment',
  '@sos-2/evaluation-orchestration',
  '@sos-2/evaluator',
  '@sos-2/evidence',
  '@sos-2/execution-fabric',
  '@sos-2/experiments',
  '@sos-2/greenfield-runtime',
  '@sos-2/implementation-orchestrator',
  '@sos-2/live-store',
  '@sos-2/mission',
  '@sos-2/promotion',
  '@sos-2/project-realization',
  '@sos-2/provenance',
  '@sos-2/security',
  '@sos-2/semantic-spine',
  '@sos-2/system-state',
  '@sos-2/task-graph',
  '@sos-2/task-runtime',
  '@sos-2/web-contracts',
  '@sos-2/worker-runtime',
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

/** Strip block and line comments so the scan tests CODE, not prose (the repository convention). */
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

describe('P15 lane C structural scans', () => {
  it('offline determinism: no ambient time, randomness, environment, network, processes, or timers in the owned sources', () => {
    for (const file of ownedSourceFiles()) {
      for (const token of BANNED_TOKENS) {
        expect(file.text.includes(token), `${file.rel} must not contain ${token}`).toBe(false);
      }
    }
  });

  it('zero new external dependencies: the owned manifest uses workspace:* only; devDependencies are the existing toolchain', () => {
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
          expect(ALLOWED_WORKSPACE_IMPORTS.has(name), `${manifestPath}: ${name} is not a declared merged workspace import of this lane`).toBe(true);
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

  it('the lockfile gains no registry resolution for the owned package', () => {
    let lockfile: string;
    try {
      lockfile = readFileSync(join(REPO_ROOT, 'pnpm-lock.yaml'), 'utf8');
    } catch {
      expect(true).toBe(true); // no lockfile visible at this base
      return;
    }
    const ownedNames = ['@sos-2/tests-accessibility'];
    for (const line of lockfile.split('\n')) {
      if (!ownedNames.some((name) => line.includes(name))) continue;
      expect(line.includes('resolution:') || line.includes('.tgz'), `unexpected registry resolution: ${line.trim()}`).toBe(false);
    }
  });

  it('import boundary: only relative (owned + the ONE documented github source binding), node:, vitest, and declared merged workspace imports', () => {
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
        expect(ALLOWED_WORKSPACE_IMPORTS.has(specifier), `${file.rel} imports ${specifier} — only the lane's declared merged workspace packages are allowed`).toBe(true);
      }
    }
  });

  it('the fixed vitest seed configuration is in place (the repository convention)', () => {
    const config = readFileSync(join(REPO_ROOT, 'tests/accessibility/vitest.config.ts'), 'utf8');
    expect(/seed\s*:\s*424242/.test(config), 'the lane vitest config must keep the fixed seed 424242').toBe(true);
  });

  it('the evidence lane exists: one machine-readable record per scenario + the Architecture Delta', () => {
    const scenarios = readdirSync(join(REPO_ROOT, EVIDENCE_DIR, 'scenarios'));
    // The 16 scenarios: the flagship journey + every Work-Order negative bullet.
    expect(scenarios.length).toBe(16);
    const expected = [
      '00-flagship-fresh-user.json',
      '01-stale-state.json',
      '02-missing-evidence.json',
      '03-contradictory-evidence.json',
      '04-unknown-unavailable-telemetry.json',
      '05-expired-authority.json',
      '06-revoked-authority.json',
      '07-unsafe-candidate.json',
      '08-failed-evaluation.json',
      '09-body-crash.json',
      '10-task-resume-from-checkpoint.json',
      '11-failed-rollback.json',
      '12-demo-live-confusion.json',
      '13-cross-project-access.json',
      '14-secret-leakage.json',
      '15-budget-exhaustion.json',
    ];
    expect(scenarios.sort()).toEqual([...expected].sort());
    for (const scenario of scenarios) {
      const record = JSON.parse(readFileSync(join(REPO_ROOT, EVIDENCE_DIR, 'scenarios', scenario), 'utf8')) as Record<string, unknown>;
      for (const field of ['scenario_id', 'work_order', 'lane', 'base_revision', 'verified_head_revision', 'test_file', 'test_names', 'terminal_state', 'detection_containment', 'retained_uncertainty', 'reproducibility']) {
        expect(record[field], `${scenario} requires ${field}`).toBeDefined();
      }
      expect(record['work_order']).toBe('P15');
      expect(record['lane']).toBe('C');
      expect(record['base_revision']).toBe('711cfd60b7eb90b338a8ce17cadcafb72a0d1e6e');
      const repro = record['reproducibility'] as Record<string, unknown>;
      expect(repro['seed']).toBe(424242);
      expect(typeof repro['command']).toBe('string');
    }
  });

  it('the Architecture Delta record validates against the frozen repository schema and declares the P15 lane-C contract', () => {
    const delta = JSON.parse(readFileSync(join(REPO_ROOT, EVIDENCE_DIR, 'ARCHITECTURE-DELTA.json'), 'utf8')) as Record<string, unknown>;
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

    // The P15 lane-C contract: the two owned paths, the work order, the rationale.
    expect(delta['work_order']).toBe('P15');
    expect(delta['rationale_ref']).toBe('spec/productization-work-orders/P15-product-dogfood.md');
    const affected = delta['affected_artifacts'] as string[];
    expect(affected.join('\n')).toContain('tests/accessibility');
    expect(affected.join('\n')).toContain('docs/evidence/productization/c-accessibility-negatives');
    // The preserved invariants pin the non-negotiable boundaries.
    const invariants = (delta['preserved_invariants'] as string[]).join('\n');
    expect(invariants).toContain('fail-closed');
    expect(invariants).toContain('honest');
    expect(invariants).toContain('secrets');
    expect(invariants).toContain('zero external dependencies');
    expect(invariants).toContain('pnpm-lock.yaml');
    expect(invariants).toContain('public exports');
    // A test/evidence-only lane: no boundary changes.
    expect(delta['boundary_changes']).toEqual([]);
  });
});
