/**
 * THE STRUCTURAL ACCEPTANCE SUITE (Work Order P15, lane B) — the
 * discipline pins of the autonomous-build dogfood lane:
 *
 *   - offline determinism: no ambient time, randomness, environment,
 *     network, processes or timers in the owned sources;
 *   - zero new external dependencies: workspace:* + the existing toolchain;
 *   - import boundary: only relative (owned path + the ONE documented P4
 *     github source binding), node:, vitest, and merged workspace packages;
 *   - the fixed vitest seed (the repository convention);
 *   - the Architecture Delta record validates against the frozen schema;
 *   - every evidence record of the lane validates: exact base/head
 *     revisions, scenario test ids that EXIST in this suite, terminal
 *     states, retained uncertainty, simulated windows, reproducibility.
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const REPO_ROOT = new URL('../../../', import.meta.url).pathname;
const OWNED_DIR = 'tests/autonomous-build';
const EVIDENCE_DIR = 'docs/evidence/productization/b-autonomous-build';
const OWNED_PACKAGE_JSON = join(OWNED_DIR, 'package.json');
const THIS_FILE = 'tests/autonomous-build/test/structure.test.ts';
const BASE_SHA = '711cfd60b7eb90b338a8ce17cadcafb72a0d1e6e';

// The P4 reference github provider is ENTRY-POINT-LESS by design (the
// P3/P4 lockfile-byte-identity precedent) — it binds through its source
// entry, exactly the way the merged P4/P13 suites bind it. This is the ONE
// documented source binding outside the owned path.
const GITHUB_SOURCE_BINDING = 'packages/github/src/index.ts';

// The merged + lane-B-relevant workspace imports (nothing unmerged is referenced).
const ALLOWED_WORKSPACE_IMPORTS = new Set([
  '@sos-2/action-gateway',
  '@sos-2/authority',
  '@sos-2/autonomy-runtime',
  '@sos-2/body-broker',
  '@sos-2/body-runtimes',
  '@sos-2/evaluation-orchestration',
  '@sos-2/evaluator',
  '@sos-2/event-ingestion',
  '@sos-2/execution-fabric',
  '@sos-2/greenfield-runtime',
  '@sos-2/implementation-orchestrator',
  '@sos-2/live-store',
  '@sos-2/mission',
  '@sos-2/observation',
  '@sos-2/observation-host',
  '@sos-2/project-realization',
  '@sos-2/task-graph',
  '@sos-2/task-runner',
  '@sos-2/task-runtime',
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
  for (const full of listFiles(join(REPO_ROOT, OWNED_DIR))) {
    if (!full.endsWith('.ts') || full.endsWith('.d.ts')) continue;
    const rel = full.slice(REPO_ROOT.length);
    if (rel === THIS_FILE) continue; // the scanner is excluded from its own scan
    files.push({ rel, text: stripComments(readFileSync(full, 'utf8')) });
  }
  return files;
}

const EVIDENCE_RECORDS = [
  'flagship-journey.json',
  'no-body-observation.json',
  'anomaly-repair.json',
  'interruption-replacement-resume.json',
  'provider-outage.json',
  'user-offline-replay.json',
] as const;

interface EvidenceRecord {
  schema_version: string;
  lane: string;
  work_order: string;
  journey_id: string;
  journey: string;
  scenario: { package: string; test_file: string; test_name: string };
  revisions: { base: string; implementation_head: string; head_note: string };
  terminal_state: Record<string, unknown>;
  evidence_graph_links: string[];
  retained_uncertainty: string[];
  simulated_windows: { outage_windows: string[]; interruptions: string[]; user_offline: boolean };
  reproducibility: { seed: number; command: string; runs_identical: boolean };
}

describe('P15 lane-B structural scans', () => {
  it('offline determinism: no ambient time, randomness, environment, network, processes, or timers in owned sources', () => {
    for (const file of ownedSourceFiles()) {
      for (const token of BANNED_TOKENS) {
        expect(file.text.includes(token), `${file.rel} must not contain ${token}`).toBe(false);
      }
    }
  });

  it('zero new external dependencies: the owned manifest uses workspace:* only (existing-toolchain carve-out per the repository convention)', () => {
    const TOOLCHAIN: Record<string, string> = {
      typescript: '^5.5.0',
      vitest: '^3.0.0',
      '@types/node': '^22.10.0',
    };
    const manifest = JSON.parse(readFileSync(join(REPO_ROOT, OWNED_PACKAGE_JSON), 'utf8')) as Record<string, unknown>;
    for (const section of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
      const deps = manifest[section] as Record<string, string> | undefined;
      if (deps === undefined) continue;
      for (const [name, spec] of Object.entries(deps)) {
        expect(spec, `${OWNED_PACKAGE_JSON}: ${name}`).toBe('workspace:*');
        expect(ALLOWED_WORKSPACE_IMPORTS.has(name), `${OWNED_PACKAGE_JSON}: ${name} is not a merged workspace package`).toBe(true);
      }
    }
    const dev = manifest['devDependencies'] as Record<string, string> | undefined;
    expect(dev).toBeDefined();
    for (const [name, spec] of Object.entries(dev!)) {
      const allowed = spec === 'workspace:*' || TOOLCHAIN[name] === spec;
      expect(allowed, `${OWNED_PACKAGE_JSON}: ${name}@${spec}`).toBe(true);
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
    for (const line of lockfile.split('\n')) {
      if (!line.includes('@sos-2/tests-autonomous-build')) continue;
      expect(line.includes('resolution:') || line.includes('.tgz'), `unexpected registry resolution: ${line.trim()}`).toBe(false);
    }
  });

  it('import boundary: only relative (owned + the documented P4 source binding), node:, vitest, and merged workspace imports', () => {
    const importPattern = /(?:from|import)\s+['"]([^'"]+)['"]/g;
    for (const file of ownedSourceFiles()) {
      for (const match of file.text.matchAll(importPattern)) {
        const specifier = match[1] ?? '';
        if (specifier === 'vitest' || specifier === 'vitest/config' || specifier.startsWith('node:')) continue;
        if (specifier.startsWith('.')) {
          // Relative imports stay within the owned path — except the ONE
          // documented P4 source binding (the entry-point-less github package).
          const resolved = resolve(REPO_ROOT, join(REPO_ROOT, file.rel, '..'), specifier);
          const rel = resolved.slice(REPO_ROOT.length);
          const inOwned = rel === OWNED_DIR || rel.startsWith(`${OWNED_DIR}/`);
          const isGithubBinding = rel === GITHUB_SOURCE_BINDING || rel === `${GITHUB_SOURCE_BINDING}.ts`;
          expect(
            inOwned || isGithubBinding,
            `${file.rel} escapes the owned path via ${specifier} (resolved ${rel}; only the documented P4 github source binding may escape)`,
          ).toBe(true);
          continue;
        }
        expect(ALLOWED_WORKSPACE_IMPORTS.has(specifier), `${file.rel} imports ${specifier} — only merged workspace packages are allowed`).toBe(true);
      }
    }
  });

  it('the fixed vitest seed configuration is in place (the repository convention)', () => {
    const config = readFileSync(join(REPO_ROOT, 'tests/autonomous-build/vitest.config.ts'), 'utf8');
    expect(/seed\s*:\s*424242/.test(config), 'the lane-B vitest config must keep the fixed seed 424242').toBe(true);
  });

  it('the Architecture Delta record validates against the frozen schema and declares the P15 lane-B contract', () => {
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

    // The P15 lane-B contract: the two owned paths, the work order, the rationale.
    expect(delta['work_order']).toBe('P15');
    expect(delta['rationale_ref']).toBe('spec/productization-work-orders/P15-product-dogfood.md');
    expect(delta['affected_artifacts']).toEqual([OWNED_DIR, EVIDENCE_DIR]);
    // Test/evidence-only lane: no boundaries change.
    expect(delta['boundary_changes']).toEqual([]);
    // The preserved invariants pin the non-negotiable boundaries (and the lane).
    const invariants = (delta['preserved_invariants'] as string[]).join('\n');
    expect(invariants).toContain('lane B');
    expect(invariants).toContain('independent evaluation suite');
    expect(invariants).toContain('bodies never self-certify');
    expect(invariants).toContain('user device is optional');
    expect(invariants).toContain('honest outage');
    expect(invariants).toContain('pnpm-lock.yaml');
  });

  it('every evidence record validates: revisions, scenario ids that exist, uncertainty, windows, reproducibility', () => {
    for (const name of EVIDENCE_RECORDS) {
      const path = join(REPO_ROOT, EVIDENCE_DIR, name);
      const record = JSON.parse(readFileSync(path, 'utf8')) as EvidenceRecord;

      // Lane + work order + journey identity.
      expect(record.lane, `${name}: lane`).toBe('B');
      expect(record.work_order, `${name}: work_order`).toBe('P15');
      expect(record.journey_id.length, `${name}: journey_id`).toBeGreaterThan(0);
      expect(record.journey.length, `${name}: journey`).toBeGreaterThan(0);

      // Exact revisions: the pinned base and a 40-hex implementation head.
      expect(record.revisions.base, `${name}: base`).toBe(BASE_SHA);
      expect(record.revisions.implementation_head, `${name}: implementation_head`).toMatch(/^[0-9a-f]{40}$/);
      expect(typeof record.revisions.head_note).toBe('string');

      // The scenario test id exists: the file is part of THIS suite and the
      // exact test name is present in its source.
      const scenario = record.scenario;
      expect(scenario.package).toBe('@sos-2/tests-autonomous-build');
      const testFileRel = scenario.test_file;
      expect(testFileRel.startsWith('tests/autonomous-build/test/')).toBe(true);
      expect(testFileRel.endsWith('.test.ts')).toBe(true);
      const testFileSource = readFileSync(join(REPO_ROOT, testFileRel), 'utf8');
      expect(
        testFileSource.includes(scenario.test_name),
        `${name}: the recorded test name must exist in ${testFileRel}`,
      ).toBe(true);

      // Terminal state, evidence-graph links, retained uncertainty.
      expect(Object.keys(record.terminal_state).length).toBeGreaterThan(0);
      expect(record.evidence_graph_links.length).toBeGreaterThan(0);
      expect(record.retained_uncertainty.length).toBeGreaterThan(0);

      // Simulated windows (the deterministic seams — never real outages).
      expect(Array.isArray(record.simulated_windows.outage_windows)).toBe(true);
      expect(Array.isArray(record.simulated_windows.interruptions)).toBe(true);
      expect(typeof record.simulated_windows.user_offline).toBe('boolean');

      // Reproducibility: the fixed seed and the exact command.
      expect(record.reproducibility.seed).toBe(424242);
      expect(record.reproducibility.command).toBe('pnpm --filter @sos-2/tests-autonomous-build test');
      expect(record.reproducibility.runs_identical).toBe(true);
    }
  });

  it('the independence pin is recorded in the flagship evidence record', () => {
    const record = JSON.parse(readFileSync(join(REPO_ROOT, EVIDENCE_DIR, 'flagship-journey.json'), 'utf8')) as EvidenceRecord & {
      independence_pin: { test_file: string; test_name: string };
    };
    const pin = record.independence_pin;
    const source = readFileSync(join(REPO_ROOT, pin.test_file), 'utf8');
    expect(source.includes(pin.test_name), 'the recorded independence-pin test must exist').toBe(true);
  });
});
