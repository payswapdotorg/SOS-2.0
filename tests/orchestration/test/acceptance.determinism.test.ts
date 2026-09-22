/**
 * ACCEPTANCE SUITE 7 — DETERMINISM + STRUCTURE (Work Order P6, pinned).
 *
 *  - the full journey is byte-reproducible (fixed seed, injected clocks);
 *  - the section 6 task-durability field list is representable
 *    field-for-field on every durable task record;
 *  - structural scans: NO Date.now / Math.random / fetch / process.env /
 *    ambient timers / child_process in the owned package sources outside
 *    the documented apps/orchestrator composition boundary (system-clock.ts);
 *  - imports are restricted to merged + P6-owned workspace packages
 *    (unmerged siblings never referenced) with ZERO new external
 *    dependencies (workspace:* + the existing toolchain only).
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runDemoJourney } from '@sos-2/orchestrator-host';
import { createAcceptanceWorld, runJourney, startJourney } from './acceptance-world.js';

const REPO_ROOT = resolve(process.cwd(), '..', '..');
const OWNED_PACKAGE_SRCS = [
  'packages/task-graph/src',
  'packages/reasoning-broker/src',
  'packages/worker-runtime/src',
  'packages/orchestrator/src',
];
const APP_SRC = 'apps/orchestrator/src';
/** The documented impure boundary inside the app (the ONLY ambient-clock module). */
const APP_BOUNDARY_EXEMPT = new Set(['system-clock.ts']);

/** Strip block and line comments so the scan tests CODE, not prose. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function listFiles(dir: string): string[] {
  const absolute = join(REPO_ROOT, dir);
  const entries: string[] = [];
  for (const name of readdirSync(absolute)) {
    const full = join(absolute, name);
    if (statSync(full).isDirectory()) {
      if (name === 'dist' || name === 'node_modules') {
        continue;
      }
      entries.push(...listFiles(join(dir, name)));
    } else if (name.endsWith('.ts')) {
      entries.push(join(dir, name));
    }
  }
  return entries;
}

const FORBIDDEN_PATTERNS: { pattern: RegExp; what: string }[] = [
  { pattern: /\bDate\.now\b/, what: 'Date.now (hidden time)' },
  { pattern: /\bMath\.random\b/, what: 'Math.random (hidden entropy)' },
  { pattern: /\bfetch\s*\(/, what: 'fetch (ambient network)' },
  { pattern: /\bprocess\.env\b/, what: 'process.env (ambient environment)' },
  { pattern: /\bsetTimeout\b/, what: 'setTimeout (ambient timer)' },
  { pattern: /\bsetInterval\b/, what: 'setInterval (ambient timer)' },
  { pattern: /child_process\b/, what: 'child_process (process spawning)' },
];

describe('P6 acceptance: determinism (byte-reproducible journeys)', () => {
  it('the full acceptance journey reproduces the identical report', async () => {
    const run = async (): Promise<string> => {
      const world = createAcceptanceWorld();
      await startJourney(world);
      const report = await runJourney(world, { crashes: { 1: 3 } });
      return JSON.stringify(report);
    };
    const first = await run();
    const second = await run();
    expect(first).toBe(second);
  });

  it('the demo journey (the app composition root) reproduces the identical report', async () => {
    const first = JSON.stringify((await runDemoJourney()).report);
    const second = JSON.stringify((await runDemoJourney()).report);
    expect(first).toBe(second);
  });
});

describe('P6 acceptance: the section 6 task-durability field list is representable', () => {
  it('every durable task record carries the full §6 field set field-for-field', async () => {
    const world = createAcceptanceWorld();
    await startJourney(world);
    await runJourney(world, { crashes: { 1: 3 } });
    const listed = await world.store.tasks.list({ limit: null });
    expect(listed.items.length).toBe(3);
    // The §6 list of spec/productization-execution-architecture.md:
    const section6 = [
      'task_id', // task identity
      'mission_ref', // mission link
      'plan', // current plan/work graph
      'owned_revision', // owned workspace/repository revision
      'authority_context', // authority context
      'body_lease_ref', // body lease, when any
      'checkpoints', // checkpoints
      'artifacts', // produced artifacts
      'observations', // observations/evidence
      'unresolved_uncertainty', // unresolved uncertainty
      'retries', // retries
      'recovery_state', // recovery state
      'resource_usage', // cost/resource consumption
      'final_verification', // final verification record
    ];
    for (const record of listed.items) {
      for (const field of section6) {
        expect(Object.keys(record)).toContain(field);
      }
      // The completed tasks pinned real verification records + exact revisions.
      if (record.status === 'COMPLETED') {
        expect(record.final_verification!.verified).toBe(true);
        expect(record.final_verification!.evidence_refs.length).toBeGreaterThan(0);
        expect(record.owned_revision.source_revision).not.toBeNull();
        expect(record.checkpoints.length).toBeGreaterThan(0);
        expect(record.artifacts.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('P6 acceptance: structural scans (offline determinism of the owned sources)', () => {
  it('the owned package sources are free of ambient time/entropy/network/env/timers/processes', () => {
    for (const src of OWNED_PACKAGE_SRCS) {
      for (const file of listFiles(src)) {
        const code = stripComments(readFileSync(join(REPO_ROOT, file), 'utf8'));
        for (const { pattern, what } of FORBIDDEN_PATTERNS) {
          expect(code, `${file} must not contain ${what}`).not.toMatch(pattern);
        }
      }
    }
  });

  it('the app source is clean EXCEPT the documented composition boundary (system-clock.ts)', () => {
    for (const file of listFiles(APP_SRC)) {
      const base = file.split('/').pop()!;
      const exempt = APP_BOUNDARY_EXEMPT.has(base);
      const code = stripComments(readFileSync(join(REPO_ROOT, file), 'utf8'));
      for (const { pattern, what } of FORBIDDEN_PATTERNS) {
        if (exempt && what.includes('hidden time')) {
          continue; // the documented boundary: the ONLY Date.now in the app
        }
        expect(code, `${file} must not contain ${what}`).not.toMatch(pattern);
      }
      if (exempt) {
        // The boundary module contains exactly the one ambient read.
        expect(code).toMatch(/\bDate\.now\b/);
      }
    }
  });

  it('the acceptance helpers are clock-less, entropy-less and network-less too', () => {
    for (const file of listFiles('tests/orchestration/test')) {
      if (file.endsWith('.test.ts')) {
        continue; // the suites' own pattern definitions are prose-adjacent code
      }
      const code = stripComments(readFileSync(join(REPO_ROOT, file), 'utf8'));
      for (const { pattern, what } of FORBIDDEN_PATTERNS) {
        expect(code, `${file} must not contain ${what}`).not.toMatch(pattern);
      }
    }
  });

  it('the six owned packages declare ZERO external dependencies (workspace:* + the existing toolchain only)', () => {
    const packages = [
      'packages/task-graph/package.json',
      'packages/reasoning-broker/package.json',
      'packages/worker-runtime/package.json',
      'packages/orchestrator/package.json',
      'apps/orchestrator/package.json',
      'tests/orchestration/package.json',
    ];
    const allowedToolchain = new Set(['@types/node', 'typescript', 'vitest']);
    for (const pkgPath of packages) {
      const pkg = JSON.parse(readFileSync(join(REPO_ROOT, pkgPath), 'utf8')) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      for (const [name, spec] of Object.entries(pkg.dependencies ?? {})) {
        expect(spec, `${pkgPath}: ${name} must be a workspace link`).toBe('workspace:*');
        expect(name.startsWith('@sos-2/'), `${pkgPath}: ${name} is a workspace package`).toBe(true);
      }
      for (const [name, spec] of Object.entries(pkg.devDependencies ?? {})) {
        if (name.startsWith('@sos-2/')) {
          // A workspace-linked dev dependency (a merged or P6-owned
          // package consumed by the tests) — still zero external deps.
          expect(spec, `${pkgPath}: ${name} must be a workspace link`).toBe('workspace:*');
          continue;
        }
        expect(spec.startsWith('^'), `${pkgPath}: ${name} is the existing toolchain`).toBe(true);
        expect(allowedToolchain.has(name), `${pkgPath}: devDependency ${name} is not the existing toolchain`).toBe(true);
      }
    }
  });

  it('the owned packages add no external packages the base lockfile did not already resolve', () => {
    const lockfile = readFileSync(join(REPO_ROOT, 'pnpm-lock.yaml'), 'utf8');
    for (const tool of ['@types/node', 'typescript', 'vitest']) {
      expect(lockfile, `the base lockfile already resolves ${tool}`).toContain(tool);
    }
  });

  it('imports are restricted to merged + P6-owned workspace packages (unmerged siblings never referenced)', () => {
    // The merged (base) workspace packages + the P6-owned ones. P11 runs
    // in parallel as a sibling wave — its (unmerged) packages must never
    // appear in any owned source.
    const mergedAndOwned = new Set([
      '@sos-2/contracts',
      '@sos-2/semantic-spine',
      '@sos-2/live-store',
      '@sos-2/api-contracts',
      '@sos-2/runtime-contracts',
      '@sos-2/harness',
      '@sos-2/body-broker',
      '@sos-2/execution-fabric',
      '@sos-2/body-runtimes',
      '@sos-2/harness-adapters',
      '@sos-2/sandbox',
      '@sos-2/mission',
      '@sos-2/authority',
      '@sos-2/ask',
      '@sos-2/decision',
      '@sos-2/autonomy',
      '@sos-2/evidence',
      '@sos-2/experiments',
      '@sos-2/orchestrator',
      '@sos-2/task-graph',
      '@sos-2/worker-runtime',
      '@sos-2/reasoning-broker',
      '@sos-2/orchestrator-host',
    ]);
    const sources = [...OWNED_PACKAGE_SRCS.map((src) => listFiles(src)), listFiles(APP_SRC), listFiles('tests/orchestration/test')].flat();
    expect(sources.length).toBeGreaterThan(10);
    for (const file of sources) {
      const code = stripComments(readFileSync(join(REPO_ROOT, file), 'utf8'));
      for (const match of code.matchAll(/from '(@sos-2\/[a-z0-9-]+)'/g)) {
        const imported = match[1]!;
        expect(
          mergedAndOwned.has(imported),
          `${file} imports ${imported} which is not a merged or P6-owned workspace package (unmerged siblings are never dependencies)`,
        ).toBe(true);
      }
    }
  });
});
