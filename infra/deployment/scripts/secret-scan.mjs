/**
 * CI-wired secret scan (Work Order P3).
 *
 * Scans the P3-owned deliverable files for secret-shaped values using the
 * secrets policy module (imported through Node's native TypeScript type
 * stripping — no build step, no new dependencies). On any finding it
 * fails listing file, line, column and pattern id — NEVER the matched
 * value. Exit code 1 on findings, 0 on a clean tree.
 *
 * Scan scope: infra/deployment source/scripts/config/docs (excluding
 * test/ — the test corpus intentionally CONTAINS synthetic secret-shaped
 * fixtures to prove detection; they are marked synthetic and never valid
 * credentials), plus the deployment workflow definitions and the thin
 * top-level caller.
 *
 * Usage: node infra/deployment/scripts/secret-scan.mjs (from repo root or
 * the package directory; the script locates the repo root itself).
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanTextForSecrets } from '../src/secrets/policy.ts';

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(here, '..');
const repoRoot = join(packageRoot, '..', '..');

/** Deterministic walk (sorted) of a directory tree, returning relative paths. */
function walk(dir, base = dir, acc = []) {
  for (const entry of readdirSync(dir).sort()) {
    if (entry === 'node_modules' || entry === '.pnpm-store' || entry === 'dist') continue;
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      walk(full, base, acc);
    } else if (stats.isFile()) {
      acc.push(relative(base, full));
    }
  }
  return acc;
}

/** Collect the scan targets: label -> absolute path. */
function scanTargets() {
  const targets = new Map();
  // infra/deployment deliverables (excluding test/ — the synthetic fixture corpus).
  for (const rel of walk(packageRoot)) {
    if (rel.startsWith('test') || rel.startsWith('node_modules')) continue;
    targets.set(`infra/deployment/${rel}`, join(packageRoot, rel));
  }
  // Deployment workflow definitions + thin top-level caller.
  const workflowRoot = join(repoRoot, '.github', 'workflows', 'deployment');
  try {
    for (const rel of walk(workflowRoot)) {
      targets.set(`.github/workflows/deployment/${rel}`, join(workflowRoot, rel));
    }
  } catch {
    // Deployment workflow definitions absent (base repo) — scan runs fine without them.
  }
  const thinCaller = join(repoRoot, '.github', 'workflows', 'deploy-contract.yml');
  try {
    statSync(thinCaller);
    targets.set('.github/workflows/deploy-contract.yml', thinCaller);
  } catch {
    // Thin caller absent (not yet added) — scan runs fine without it.
  }
  // Runtime docs.
  const runtimeDocs = join(repoRoot, 'docs', 'deployment', 'runtime');
  try {
    for (const rel of walk(runtimeDocs)) {
      targets.set(`docs/deployment/runtime/${rel}`, join(runtimeDocs, rel));
    }
  } catch {
    // Runtime docs absent on base repo — scan runs fine without them.
  }
  return targets;
}

const targets = scanTargets();
const findings = [];
for (const [label, path] of [...targets.entries()].sort(([a], [b]) => a.localeCompare(b))) {
  const text = readFileSync(path, 'utf8');
  findings.push(...scanTextForSecrets(label, text));
}

if (findings.length > 0) {
  console.error('SECRET POLICY FAIL: secret-shaped values found in P3-owned deliverable files.');
  console.error('Findings carry file, line, column and pattern id ONLY — matched values are never printed.');
  for (const finding of findings) {
    console.error(`  ${finding.label}:${finding.line}:${finding.column} (${finding.patternId})`);
  }
  console.error(`Scanned ${targets.size} files; ${findings.length} finding(s). Remove the secret-shaped material — do not commit real credentials, and keep synthetic fixtures inside test/ only.`);
  process.exit(1);
}

console.log(`secret policy scan: PASS (${targets.size} files scanned, 0 secret-shaped findings; names never values)`);
