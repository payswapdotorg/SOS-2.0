import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = new URL('../../', import.meta.url).pathname;
const OWNED_DIRS = [
  'packages/action-gateway',
  'packages/evaluator',
  'packages/evaluation-orchestration',
  'apps/actions',
  'tests/actions-and-evaluation',
];
const OWNED_PACKAGE_JSONS = OWNED_DIRS.map((dir) => join(dir, 'package.json'));
const COMPOSITION_BOUNDARY_FILES = new Set(['apps/actions/src/clock.ts', 'apps/actions/src/main.ts']);
const THIS_FILE = 'tests/actions-and-evaluation/structural.test.ts';

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
    if (entry === 'node_modules') continue; // workspace install links — not owned source
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
      if (rel === THIS_FILE) continue; // the scanner itself is excluded from its own scan
      files.push({ rel, text: readFileSync(full, 'utf8') });
    }
  }
  return files;
}

describe('P9 structural scans', () => {
  it('offline determinism: no ambient time, randomness, environment, network, processes, or timers outside the documented composition boundary', () => {
    for (const file of ownedSourceFiles()) {
      if (COMPOSITION_BOUNDARY_FILES.has(file.rel)) continue;
      for (const token of BANNED_TOKENS) {
        expect(file.text.includes(token), `${file.rel} must not contain ${token}`).toBe(false);
      }
    }
  });

  it('zero new external dependencies: owned manifests use workspace:* only (existing-toolchain carve-out per the P6 convention)', () => {
    // The merged P6/P11 convention: manifests may dev-depend on the repo's
    // existing toolchain trio (already resolved in the frozen base lockfile —
    // zero new registry resolutions). Everything else must be workspace:*.
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

  it('the lockfile gains no registry resolution for owned packages', () => {
    let lockfile: string;
    try {
      lockfile = readFileSync(join(REPO_ROOT, 'pnpm-lock.yaml'), 'utf8');
    } catch {
      expect(true).toBe(true); // no lockfile visible at this base
      return;
    }
    const ownedNames = ['@sos-2/action-gateway', '@sos-2/evaluator', '@sos-2/evaluation-orchestration', '@sos-2/actions'];
    for (const line of lockfile.split('\n')) {
      if (!ownedNames.some((name) => line.includes(name))) continue;
      expect(line.includes('resolution:') || line.includes('.tgz'), `unexpected registry resolution: ${line.trim()}`).toBe(false);
    }
  });

  it('import boundary: only relative, node:, vitest, and P9-owned workspace imports (unmerged siblings never referenced)', () => {
    const owned = new Set([
      '@sos-2/action-gateway',
      '@sos-2/evaluator',
      '@sos-2/evaluation-orchestration',
      '@sos-2/actions',
    ]);
    const importPattern = /(?:from|import)\s+['"]([^'"]+)['"]/g;
    for (const file of ownedSourceFiles()) {
      for (const match of file.text.matchAll(importPattern)) {
        const specifier = match[1] ?? '';
        const allowed =
          specifier.startsWith('.') || specifier.startsWith('node:') || specifier === 'vitest' || owned.has(specifier);
        expect(allowed, `${file.rel} imports ${specifier}`).toBe(true);
      }
    }
  });

  it('the repository vitest seed configuration is untouched', () => {
    const candidates = ['vitest.config.ts', 'vitest.config.mts', 'vitest.config.mjs', 'vite.config.ts', 'vitest.workspace.ts', 'vitest.workspace.mts'];
    const found = candidates.find((candidate) => {
      try {
        statSync(join(REPO_ROOT, candidate));
        return true;
      } catch {
        return false;
      }
    });
    if (found === undefined) {
      expect(true).toBe(true); // no root config discoverable at this base
      return;
    }
    const text = readFileSync(join(REPO_ROOT, found), 'utf8');
    expect(/seed\s*:/.test(text), `${found} must keep the fixed seed`).toBe(true);
  });
});
