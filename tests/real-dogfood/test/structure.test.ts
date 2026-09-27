/**
 * THE LANE STRUCTURE (Work Order P19, deterministic suite) — the
 * discipline pins: the two strictly separated suites (the seed 424242
 * in BOTH configs; the real files NEVER included in the default
 * config), the honest gate script, workspace importer coverage by the
 * existing globs (NO lane-specific pnpm-workspace.yaml entry), the
 * lockfile importer-addition-only discipline, and the frozen
 * architecture-delta schema conformance of the committed evidence.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = join(import.meta.dirname, '..', '..', '..');
const LANE_ROOT = join(REPO_ROOT, 'tests', 'real-dogfood');

describe('P19 lane structure (tests/real-dogfood + packages/dogfood-live)', () => {
  it('the two suites are strictly separated: the default config never loads the real files; both pin seed 424242', () => {
    const defaultConfig = readFileSync(join(LANE_ROOT, 'vitest.config.ts'), 'utf8');
    expect(defaultConfig.includes("include: ['test/*.test.ts']")).toBe(true);
    expect(defaultConfig.includes("test/real")).toBe(false); // the real files are NEVER included
    expect(defaultConfig.includes('seed: 424242')).toBe(true);

    const realConfig = readFileSync(join(LANE_ROOT, 'vitest.real.config.ts'), 'utf8');
    expect(realConfig.includes("include: ['test/real/*.real.test.ts']")).toBe(true);
    expect(realConfig.includes('seed: 424242')).toBe(true);
    expect(realConfig.includes('testTimeout: 420_000')).toBe(true);
    expect(realConfig.includes('fileParallelism: false')).toBe(true);
  });

  it('the honest gate: run-real-if-env.mjs exits 0 without RUN_REAL (missing credentials never fail the default suite)', () => {
    const gate = readFileSync(join(LANE_ROOT, 'scripts', 'run-real-if-env.mjs'), 'utf8');
    expect(gate.includes("process.env.RUN_REAL !== '1'")).toBe(true);
    expect(gate.includes('process.exit(0)')).toBe(true);
  });

  it('the workspace importer coverage: the existing packages/* and tests/* globs cover both lane packages (NO lane-specific entry added)', () => {
    const workspace = readFileSync(join(REPO_ROOT, 'pnpm-workspace.yaml'), 'utf8');
    expect(workspace.includes('- packages/*')).toBe(true);
    expect(workspace.includes('- tests/*')).toBe(true);
    // The lane adds NO lane-specific importer entry (the globs cover it):
    // no '- packages/dogfood-live' / '- tests/real-dogfood' ENTRY lines exist.
    for (const line of workspace.split('\n')) {
      const trimmed = line.trim();
      expect(trimmed.startsWith('- ') && trimmed.includes('dogfood'), `no lane-specific importer entry expected: ${trimmed}`).toBe(false);
    }
  });

  it('the lockfile carries the lane importers with workspace resolutions only (importer addition only — no registry resolutions)', () => {
    const lockfile = readFileSync(join(REPO_ROOT, 'pnpm-lock.yaml'), 'utf8');
    for (const importer of ['packages/dogfood-live', 'tests/real-dogfood']) {
      expect(lockfile.includes(importer), `the lockfile must carry the ${importer} importer`).toBe(true);
    }
    for (const line of lockfile.split('\n')) {
      if (!line.includes('dogfood')) {
        continue;
      }
      expect(line.includes('.tgz') || line.includes('resolution: {integrity'), `unexpected registry resolution: ${line.trim()}`).toBe(false);
    }
  });

  it('the committed architecture delta validates against the frozen 8-key schema (P19 adds NO semantic changes)', () => {
    const delta = JSON.parse(readFileSync(join(REPO_ROOT, 'docs', 'evidence', 'production-connectivity', 'dogfood', 'ARCHITECTURE-DELTA.json'), 'utf8')) as Record<string, unknown>;
    const allowed = ['affected_artifacts', 'added', 'removed', 'modified', 'preserved_invariants', 'boundary_changes', 'rationale_ref', 'work_order'];
    for (const key of Object.keys(delta)) {
      expect(allowed.includes(key), `unexpected delta key: ${key}`).toBe(true);
    }
    expect(Array.isArray(delta['affected_artifacts'])).toBe(true);
    expect(Array.isArray(delta['preserved_invariants'])).toBe(true);
    expect(delta['work_order']).toBe('P19');
    expect(delta['rationale_ref']).toBe('spec/productization-work-orders/P19-real-world-dogfood.md');
    // P19 adds NO semantic changes: mechanism adapters + harness only.
    const serialized = JSON.stringify(delta);
    expect(serialized.includes('mechanism adapters + harness only')).toBe(true);
  });

  it('no ambient environment reads in the owned test sources (credentials arrive via the injected source record)', () => {
    const owned = [
      join(LANE_ROOT, 'src', 'evidence.ts'),
      join(LANE_ROOT, 'test', 'scripted-world.ts'),
    ];
    for (const file of owned) {
      const text = readFileSync(file, 'utf8');
      expect(text.includes('process.env'), `${file}: process.env`).toBe(false);
    }
    // The real suites (env-gated) MAY read the ambient environment — that is
    // the documented impure process boundary (the P17-A/P18-INT precedent).
    const realWorld = readFileSync(join(LANE_ROOT, 'test', 'real', 'real-world.ts'), 'utf8');
    expect(realWorld.includes("process.env['RUN_REAL']")).toBe(true);
  });
});
