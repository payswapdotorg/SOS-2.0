#!/usr/bin/env node
/**
 * The P18-A lane secret scan (the P17-A infra/production-connectivity
 * secret-scan precedent): scans the lane's OWNED deliverable files for
 * secret-shaped values using the merged lane corpora (the P17-A
 * source-scan patterns — persistence + deployment shapes). On any
 * finding it fails listing file, line, column and pattern id — NEVER
 * the matched value. Exit code 1 on findings, 0 on a clean tree.
 *
 * Scan scope (the P18-A owned paths):
 *   - apps/web/live-data (src — the server module; the producer's
 *     ambient-env default NEVER reads values here)
 *   - packages/web-contracts/live (src + test — the pure projections
 *     carry no fixtures with secret-shaped values, so the whole
 *     subpackage is scanned)
 *   - infra/production-connectivity (src + scripts — excluding test/,
 *     whose fixtures may carry SYNTHETIC secret-shaped strings to prove
 *     detection/redaction; the P17-A scan covers the same src too —
 *     double coverage is free)
 *   - tests/live-ux/data-plane (scripts + vitest configs only — the
 *     deterministic test corpus intentionally contains SYNTHETIC
 *     secret-shaped fixtures (the scripted connection strings) to
 *     exercise the real adapters, and the env-gated real suite reads
 *     credentials from the ENVIRONMENT, never from files)
 *   - docs/evidence/production-connectivity/live-ux/data-plane
 *     (the evidence package itself — MUST be clean)
 *
 * Usage: node tests/live-ux/data-plane/scripts/secret-scan-live-ux.mjs
 *        [--json-out docs/evidence/production-connectivity/live-ux/data-plane/secrets-audit.json]
 * (from the repo root or the package directory).
 */

import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanTextWithLaneCorpora } from '../../../../infra/production-connectivity/src/secrets-audit.ts';

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(here, '..');
const repoRoot = join(packageRoot, '..', '..', '..');

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
    { root: join(repoRoot, 'apps', 'web', 'live-data'), label: 'apps/web/live-data', exclude: () => false },
    { root: join(repoRoot, 'packages', 'web-contracts', 'live'), label: 'packages/web-contracts/live', exclude: () => false },
    { root: join(repoRoot, 'infra', 'production-connectivity'), label: 'infra/production-connectivity', exclude: (rel) => rel.startsWith('test') },
    {
      root: packageRoot,
      label: 'tests/live-ux/data-plane',
      // the deterministic test corpus intentionally carries SYNTHETIC secret-shaped fixtures; the real suite reads the ENVIRONMENT
      exclude: (rel) => rel.startsWith('test/'),
    },
    {
      root: join(repoRoot, 'docs', 'evidence', 'production-connectivity', 'live-ux', 'data-plane'),
      label: 'docs/evidence/production-connectivity/live-ux/data-plane',
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

const jsonOutIndex = process.argv.indexOf('--json-out');
const jsonOut = jsonOutIndex !== -1 ? process.argv[jsonOutIndex + 1] : null;

const targets = scanTargets();
const findings = [];
for (const [label, absolute] of [...targets.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
  const text = readFileSync(absolute, 'utf8');
  findings.push(...scanTextWithLaneCorpora(label, text));
}
findings.sort((a, b) => a.label.localeCompare(b.label) || a.line - b.line || a.column - b.column || a.patternId.localeCompare(b.patternId));

const summary = {
  schema: 'sos-2/p18a/secrets-audit',
  work_order: 'P18-A',
  produced_at: new Date().toISOString(),
  scan: 'the merged P17-A source-scan corpus over the P18-A owned paths (names/positions only — never matched text)',
  files_scanned: targets.size,
  finding_count: findings.length,
  findings,
  note:
    findings.length === 0
      ? 'No credential VALUE appears in any committed file of the lane (credentials are env-only; evidence references env NAMES).'
      : 'SECRET-SHAPED FINDINGS — redact before delivery (pattern ids + positions only, values suppressed).',
};

if (jsonOut !== null) {
  mkdirSync(dirname(jsonOut), { recursive: true });
  writeFileSync(jsonOut, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
}

console.log(`[secret-scan-live-ux] scanned ${String(targets.size)} files across the P18-A owned paths`);
console.log(`[secret-scan-live-ux] findings: ${String(findings.length)}`);
for (const finding of findings) {
  console.log(`  ${finding.label}:${String(finding.line)}:${String(finding.column)} [${finding.patternId}]`);
}
process.exit(findings.length === 0 ? 0 : 1);
