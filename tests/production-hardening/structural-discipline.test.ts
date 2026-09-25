/**
 * PINNED (structural): zero new external deps; offline determinism
 * (no Date.now / Math.random / fetch / process.env / ambient timers /
 * child_process in owned sources outside the documented composition
 * boundary); fixed vitest seed; only merged + P14-owned workspace
 * imports; the lockfile and workspace manifest are untouched by the
 * committed tree.
 *
 * The P9 structural-scan discipline (tests/actions-and-evaluation/
 * structural.test.ts), adapted for the P14 owned paths.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OWNED_DIRS = [
  'packages/security',
  'packages/cost-policy',
  'infra/production-hardening',
  'tests/production-hardening',
  'docs/operations',
];
const OWNED_PACKAGE_JSONS = [
  'packages/security/package.json',
  'packages/cost-policy/package.json',
  'tests/production-hardening/package.json',
];
const THIS_FILE = 'tests/production-hardening/structural-discipline.test.ts';

// The lockfile identity rule: pnpm-lock.yaml and pnpm-workspace.yaml
// are NOT in the owned paths — the committed tree must not touch them.
const NOT_OWNED_BUT_PINNED = ['pnpm-lock.yaml', 'pnpm-workspace.yaml'];

// Tokens are assembled from fragments so this scanner never contains
// them itself (the P9 technique).
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
  for (const entry of readdirSync(dir).sort()) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '.pnpm-store') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listFiles(full));
    else out.push(full);
  }
  return out;
}

function ownedSourceFiles(): Array<{ rel: string; text: string }> {
  const files: Array<{ rel: string; text: string }> = [];
  for (const dir of OWNED_DIRS) {
    for (const full of listFiles(join(REPO_ROOT, dir))) {
      if (!full.endsWith('.ts') || full.endsWith('.d.ts')) continue;
      const rel = full.slice(REPO_ROOT.length);
      if (rel === THIS_FILE) continue; // the scanner is excluded from its own scan
      files.push({ rel, text: readFileSync(full, 'utf8') });
    }
  }
  return files;
}

describe('P14 structural scans', () => {
  it('offline determinism: no ambient time, randomness, environment, network, processes, or timers in owned sources', () => {
    const files = ownedSourceFiles();
    expect(files.length).toBeGreaterThan(20); // the scan covers a real tree
    for (const file of files) {
      for (const token of BANNED_TOKENS) {
        expect(file.text.includes(token), `${file.rel} must not contain ${token}`).toBe(false);
      }
    }
  });

  it('PINNED: zero new external deps — the three owned manifests declare NOTHING (lockfile identity rule)', () => {
    for (const manifestPath of OWNED_PACKAGE_JSONS) {
      const manifest = JSON.parse(readFileSync(join(REPO_ROOT, manifestPath), 'utf8')) as Record<string, unknown>;
      for (const section of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
        const deps = manifest[section] as Record<string, string> | undefined;
        expect(deps, `${manifestPath}: ${section} must be ABSENT (zero-dep package — the only construction that keeps pnpm-lock.yaml byte-identical at this base)`).toBeUndefined();
      }
    }
  });

  it('import boundary: only relative, node:, vitest, and merged + P14-owned workspace specifiers (via the documented test-time aliases)', () => {
    const allowedWorkspace = new Set([
      '@sos-2/security', // P14-owned
      '@sos-2/cost-policy', // P14-owned
      '@sos-2/action-gateway', // merged (P9) — composed through the test-time alias
    ]);
    const importPattern = /(?:from|import)\s+['"]([^'"]+)['"]/g;
    for (const file of ownedSourceFiles()) {
      for (const match of file.text.matchAll(importPattern)) {
        const specifier = match[1] ?? '';
        const allowed =
          specifier.startsWith('.') ||
          specifier.startsWith('node:') ||
          specifier === 'vitest' ||
          allowedWorkspace.has(specifier);
        expect(allowed, `${file.rel} imports ${specifier}`).toBe(true);
      }
    }
  });

  it('the vitest configuration pins the fixed repo seed (deterministic test runs)', () => {
    for (const configPath of [
      'packages/security/vitest.config.ts',
      'packages/cost-policy/vitest.config.ts',
      'tests/production-hardening/vitest.config.ts',
    ]) {
      const text = readFileSync(join(REPO_ROOT, configPath), 'utf8');
      expect(text).toContain('seed: 424242');
    }
  });

  it('PINNED: the committed tree does not modify the lockfile or the workspace manifest (they are outside the owned paths)', () => {
    for (const pinned of NOT_OWNED_BUT_PINNED) {
      const owned = OWNED_DIRS.some((dir) => dir === pinned || pinned.startsWith(`${dir}/`));
      expect(owned, `${pinned} must not be an owned path`).toBe(false);
    }
    // The three P14 package paths are covered by the EXISTING workspace
    // globs (packages/*, tests/*) — no manifest entry is needed or allowed:
    const workspaceManifest = readFileSync(join(REPO_ROOT, 'pnpm-workspace.yaml'), 'utf8');
    expect(workspaceManifest).not.toContain('packages/security');
    expect(workspaceManifest).not.toContain('packages/cost-policy');
    expect(workspaceManifest).not.toContain('tests/production-hardening');
    expect(workspaceManifest).not.toContain('infra/production-hardening');
  });

  it('honest statuses: NOT_YET_CONNECTED is declared for the real enforcement endpoints (never fabricated enforcement)', () => {
    const securityReadme = readFileSync(join(REPO_ROOT, 'packages/security/README.md'), 'utf8');
    expect(securityReadme).toContain('NOT_YET_CONNECTED');
    const costReadme = readFileSync(join(REPO_ROOT, 'packages/cost-policy/README.md'), 'utf8');
    expect(costReadme).toContain('NOT_YET_CONNECTED');
    const hardeningReadme = readFileSync(join(REPO_ROOT, 'infra/production-hardening/README.md'), 'utf8');
    expect(hardeningReadme).toContain('NOT_YET_CONNECTED');
  });
});
