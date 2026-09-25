#!/usr/bin/env node
/**
 * The P17-A lane secret scan (the infra/deployment secret-scan
 * precedent): scans the lane's OWNED deliverable files for
 * secret-shaped values using the combined lane corpora
 * (persistence + deployment pattern ids). On any finding it fails
 * listing file, line, column and pattern id — NEVER the matched
 * value. Exit code 1 on findings, 0 on a clean tree.
 *
 * Scan scope (the P17-A owned paths):
 *   - packages/real-persistence (src — excluding test/, whose fixtures
 *     may carry SYNTHETIC secret-shaped strings to prove redaction)
 *   - packages/deployment-providers (src — excluding test/)
 *   - infra/production-connectivity (src + scripts — excluding test/)
 *   - tests/real-persistence (scripts + vitest configs only — the
 *     deterministic test corpus intentionally contains SYNTHETIC
 *     secret-shaped fixtures to prove detection/redaction, and the
 *     env-gated real suite reads credentials from the ENVIRONMENT,
 *     never from files)
 *   - docs/evidence/production-connectivity/persistence-deployment
 *     (the evidence package itself — MUST be clean)
 *
 * Usage: node infra/production-connectivity/scripts/secret-scan.mjs
 * (from the repo root or the package directory).
 */

import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanTextWithLaneCorpora } from '../src/secrets-audit.ts';

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
  const owned = [
    { root: join(repoRoot, 'packages', 'real-persistence'), label: 'packages/real-persistence', exclude: (rel) => rel.startsWith('test') },
    { root: join(repoRoot, 'packages', 'deployment-providers'), label: 'packages/deployment-providers', exclude: (rel) => rel.startsWith('test') },
    { root: packageRoot, label: 'infra/production-connectivity', exclude: (rel) => rel.startsWith('test') },
    {
      root: join(repoRoot, 'tests', 'real-persistence'),
      label: 'tests/real-persistence',
      exclude: (rel) => rel.startsWith('test/'),
    },
    {
      root: join(repoRoot, 'docs', 'evidence', 'production-connectivity', 'persistence-deployment'),
      label: 'docs/evidence/production-connectivity/persistence-deployment',
      exclude: () => false,
    },
  ];
  for (const ownedDir of owned) {
    try {
      for (const rel of walk(ownedDir.root)) {
        if (ownedDir.exclude(rel)) continue;
        targets.set(`${ownedDir.label}/${rel}`, join(ownedDir.root, rel));
      }
    } catch {
      // Directory absent (not yet created) — scan runs fine without it.
    }
  }
  return targets;
}

const targets = scanTargets();
const findings = [];
for (const [label, path] of [...targets.entries()].sort(([a], [b]) => a.localeCompare(b))) {
  const text = readFileSync(path, 'utf8');
  findings.push(...scanTextWithLaneCorpora(label, text));
}

// The machine-readable audit record (the committed audit OUTPUT the
// evidence package carries): scan scope, finding count and pattern ids
// only — never matched text.
const jsonOutIndex = process.argv.indexOf('--json-out');
if (jsonOutIndex !== -1) {
  const outPath = process.argv[jsonOutIndex + 1];
  if (typeof outPath !== 'string' || outPath.length === 0) {
    console.error('--json-out requires a path argument');
    process.exit(2);
  }
  const audit = {
    schema: 'sos-2/p17a/secrets-audit',
    work_order: 'P17-A',
    produced_at: new Date().toISOString(),
    scanner: 'infra/production-connectivity/scripts/secret-scan.mjs (the combined lane source-scan corpus)',
    scan_scope: [...targets.keys()].sort(),
    files_scanned: targets.size,
    findings: findings.map((finding) => ({ label: finding.label, line: finding.line, column: finding.column, patternId: finding.patternId })),
    finding_count: findings.length,
    pass: findings.length === 0,
    note: 'Proves no credential VALUE appears in any committed file of the lane\'s owned paths (names only). Findings carry pattern ids + positions only — never matched text.',
  };
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(audit, null, 2)}\n`);
}

if (findings.length > 0) {
  console.error('SECRET POLICY FAIL: secret-shaped values found in P17-A-owned deliverable files.');
  console.error('Findings carry file, line, column and pattern id ONLY — matched values are never printed.');
  for (const finding of findings) {
    console.error(`  ${finding.label}:${finding.line}:${finding.column} (${finding.patternId})`);
  }
  console.error(`Scanned ${targets.size} files; ${findings.length} finding(s). Remove the secret-shaped material — do not commit real credentials; synthetic redaction fixtures live under test/ only.`);
  process.exit(1);
}

console.log(`secret policy scan: PASS (${targets.size} files scanned, 0 secret-shaped findings; names never values)`);
