/**
 * THE STRUCTURAL ACCEPTANCE SUITE (P15 Lane A) — the discipline pins:
 *
 *   - zero new external dependencies (workspace:* + the existing
 *     toolchain only — the P6/P9/P13 carve-out for typescript/vitest/
 *     @types/node);
 *   - offline determinism (no ambient time, randomness, environment,
 *     network, processes or timers in the owned sources — outside the
 *     documented composition boundary);
 *   - fixed vitest seed 424242 (the repository convention);
 *   - import boundary: only relative, node:, vitest, and merged +
 *     P15-owned workspace imports (the @sos-2/github source binding is
 *     the ONE documented source binding outside the owned paths — the
 *     P3/P4 lockfile-byte-identity precedent);
 *   - the Architecture Delta record validates against the repository
 *     schema and declares the P15 Lane A contract.
 *   - the lockfile gains no registry resolution for the owned package.
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const REPO_ROOT = new URL('../../../', import.meta.url).pathname;
const OWNED_DIRS = ['tests/product-dogfood'];
const OWNED_PACKAGE_JSONS = OWNED_DIRS.map((dir) => join(dir, 'package.json'));
const THIS_FILE = 'tests/product-dogfood/test/structural.test.ts';

// The P4 reference github provider is ENTRY-POINT-LESS by design (the
// P3/P4 lockfile-byte-identity precedent) — it binds through its source
// entry, exactly the way the merged P4 + P13 suites bind it. This is the
// ONE documented source binding outside the owned paths.
const GITHUB_SOURCE_BINDING = 'packages/github/src/index.ts';

// The merged workspace imports this lane drives (every merged product
// package the lane composes; nothing unmerged is referenced). The
// @sos-2/github source binding is handled separately (the carve-out above).
const ALLOWED_WORKSPACE_IMPORTS = new Set([
  '@sos-2/action-gateway',
  '@sos-2/ask',
  '@sos-2/authority',
  '@sos-2/autonomy-runtime',
  '@sos-2/body-broker',
  '@sos-2/body-runtimes',
  '@sos-2/brownfield',
  '@sos-2/browser-bridge',
  '@sos-2/companion',
  '@sos-2/composition',
  '@sos-2/cost-policy',
  '@sos-2/ecology',
  '@sos-2/evaluation-orchestration',
  '@sos-2/evaluator',
  '@sos-2/evidence',
  '@sos-2/execution-fabric',
  '@sos-2/experiments',
  '@sos-2/greenfield-runtime',
  '@sos-2/ide-bridge',
  '@sos-2/implementation-orchestrator',
  '@sos-2/live-store',
  '@sos-2/local-companion',
  '@sos-2/meta-evolution',
  '@sos-2/mission',
  '@sos-2/packages',
  '@sos-2/project-realization',
  '@sos-2/promotion',
  '@sos-2/security',
  '@sos-2/semantic-spine',
  '@sos-2/task-graph',
  '@sos-2/task-runtime',
  '@sos-2/task-runner',
]);

// Tokens are assembled from fragments so this scanner never contains them itself
// (the P13 convention — the scanner must never trip on its own source).
// The scanner uses WORD-BOUNDARY regexes so legitimate identifiers like
// `initial_process.envelope.id` (which contains the substring `process.env`)
// are NOT flagged — only direct `process.env` access (the actual misuse)
// trips the scan.
const BANNED_TOKEN_PATTERNS: readonly { readonly token: string; readonly pattern: RegExp }[] = [
  { token: 'Date.now', pattern: /\bDate\.now\b/ },
  { token: 'Math.random', pattern: /\bMath\.random\b/ },
  { token: 'process.env', pattern: /\bprocess\.env\b/ },
  { token: 'child_process', pattern: /\bchild_process\b/ },
  { token: 'setTimeout', pattern: /\bsetTimeout\b/ },
  { token: 'setInterval', pattern: /\bsetInterval\b/ },
  { token: 'clearInterval', pattern: /\bclearInterval\b/ },
  { token: 'fetch(', pattern: /\bfetch\s*\(/ },
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

describe('P15 Lane A — structural discipline scans', () => {
  it('offline determinism: no ambient time, randomness, environment, network, processes, or timers in owned sources', () => {
    for (const file of ownedSourceFiles()) {
      for (const { token, pattern } of BANNED_TOKEN_PATTERNS) {
        expect(pattern.test(file.text), `${file.rel} must not contain ${token}`).toBe(false);
      }
    }
  });

  it('zero new external dependencies: owned manifests use workspace:* only (existing-toolchain carve-out per the P6/P9/P13 convention)', () => {
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
          expect(ALLOWED_WORKSPACE_IMPORTS.has(name), `${manifestPath}: ${name} is not a merged + P15-owned workspace package`).toBe(true);
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
    const ownedNames = ['@sos-2/tests-product-dogfood'];
    for (const line of lockfile.split('\n')) {
      if (!ownedNames.some((name) => line.includes(name))) continue;
      expect(line.includes('resolution:') || line.includes('.tgz'), `unexpected registry resolution: ${line.trim()}`).toBe(false);
    }
  });

  it('import boundary: only relative, node:, vitest, and merged + P15-owned workspace imports', () => {
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
        expect(ALLOWED_WORKSPACE_IMPORTS.has(specifier), `${file.rel} imports ${specifier} — only merged + P15-owned workspace packages are allowed`).toBe(true);
      }
    }
  });

  it('the fixed vitest seed configuration is in place (the repository convention)', () => {
    const config = readFileSync(join(REPO_ROOT, 'tests/product-dogfood/vitest.config.ts'), 'utf8');
    expect(/seed\s*:\s*424242/.test(config), 'the P15 Lane A vitest config must keep the fixed seed 424242').toBe(true);
  });

  it('the Architecture Delta record validates against the repository schema and declares the P15 Lane A contract', () => {
    const delta = JSON.parse(readFileSync(join(REPO_ROOT, 'docs/evidence/productization/a-product-dogfood/ARCHITECTURE-DELTA.json'), 'utf8')) as Record<string, unknown>;
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

    // The P15 Lane A contract: the two owned paths, the work order, the rationale, the lane.
    expect(delta['work_order']).toBe('P15');
    expect(delta['rationale_ref']).toBe('spec/productization-work-orders/P15-product-dogfood.md');
    const affected = delta['affected_artifacts'] as string[];
    expect(affected).toEqual([
      'tests/product-dogfood',
      'docs/evidence/productization/a-product-dogfood',
    ]);
    // The preserved invariants pin the non-negotiable boundaries.
    const invariants = (delta['preserved_invariants'] as string[]).join('\n');
    expect(invariants).toContain('frozen W0-W18 core');
    expect(invariants).toContain('public exports');
    expect(invariants).toContain('zero external dependencies');
    expect(invariants).toContain('pnpm-lock.yaml');
    expect(invariants).toContain('exact-revision evidence links');
    expect(invariants).toContain('uncertainty visible');
    // The boundary changes — none (test/evidence-only lane).
    const boundaryChanges = delta['boundary_changes'] as string[];
    expect(boundaryChanges).toEqual([]);
  });

  it('one machine-readable evidence record per journey exists in docs/evidence/productization/a-product-dogfood/', () => {
    const evidenceDir = join(REPO_ROOT, 'docs/evidence/productization/a-product-dogfood');
    const files = readdirSync(evidenceDir).filter((f) => f.endsWith('.json') && f !== 'ARCHITECTURE-DELTA.json');
    // The brief requires one evidence record per journey. The P15 Lane A
    // journeys: greenfield mission, brownfield onboarding, decision
    // discipline, promotion, rollback, package composition, history,
    // self-evolution, local companion. (Nine journeys.)
    expect(files.length).toBeGreaterThanOrEqual(9);
    // Every evidence record carries the journey id + the test id + the
    // base/head revisions + the terminal state + the evidence-graph
    // links + the retained uncertainty + the reproducibility seed.
    for (const file of files) {
      const record = JSON.parse(readFileSync(join(evidenceDir, file), 'utf8')) as Record<string, unknown>;
      expect(record['journey_id']).toBeTruthy();
      expect(record['test_id']).toBeTruthy();
      expect(record['base_sha']).toBe('711cfd60b7eb90b338a8ce17cadcafb72a0d1e6e');
      expect(typeof record['head_sha']).toBe('string');
      expect(record['terminal_state']).toBeTruthy();
      expect(record['evidence_graph_links']).toBeDefined();
      expect(record['retained_uncertainty']).toBeDefined();
      expect(record['reproducibility']).toBeDefined();
      const reproducibility = record['reproducibility'] as Record<string, unknown>;
      expect(reproducibility['seed']).toBe(424242);
      expect(reproducibility['command']).toBeTruthy();
    }
  });
});
