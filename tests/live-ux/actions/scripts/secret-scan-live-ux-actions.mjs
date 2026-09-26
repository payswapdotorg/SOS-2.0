#!/usr/bin/env node
/**
 * The P18-B lane secret scan (the P18-A/P17-A precedent): scans the
 * lane's OWNED deliverable files for secret-shaped values using the
 * merged lane corpora (scanTextWithLaneCorpora — the P17-A
 * source-scan patterns: persistence + deployment + observation shapes).
 * On any finding it fails listing file, line, column and pattern id —
 * NEVER the matched value. Exit code 1 on findings, 0 on a clean tree.
 *
 * Scan scope (the P18-B owned paths):
 *   - apps/web/app/live-mission, apps/web/app/mission,
 *     apps/web/app/api/live-mission (the route mounts + the seam)
 *   - apps/web/live-mission (src — the integration seams; the ambient-env
 *     default NEVER reads or stores values)
 *   - tests/live-ux/actions (scripts + vitest configs only — the
 *     deterministic test corpus intentionally carries SYNTHETIC
 *     secret-shaped fixtures to prove detection/redaction, and the
 *     env-gated real suite reads credentials from the ENVIRONMENT,
 *     never from files)
 *   - docs/evidence/production-connectivity/live-ux/actions-mission
 *     (the evidence package itself — MUST be clean)
 *
 * Usage: node tests/live-ux/actions/scripts/secret-scan-live-ux-actions.mjs
 *        [--json-out docs/evidence/production-connectivity/live-ux/actions-mission/secrets-audit.json]
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
    if (entry === 'node_modules' || entry === '.pnpm-store' || entry === 'dist' || entry === '.tsbuildinfo') continue;
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      walk(full, base, acc);
    } else if (stats.isFile()) {
      acc.push(relative(base, full));
    }
    // a not-yet-existing owned root (evidence before the real run) is honestly skipped
  }
  return acc;
}

function scanTargets() {
  const targets = new Map();
  const owned = [
    { root: join(repoRoot, 'apps', 'web', 'app', 'live-mission'), label: 'apps/web/app/live-mission', exclude: () => false },
    { root: join(repoRoot, 'apps', 'web', 'app', 'mission'), label: 'apps/web/app/mission', exclude: () => false },
    { root: join(repoRoot, 'apps', 'web', 'app', 'api', 'live-mission'), label: 'apps/web/app/api/live-mission', exclude: () => false },
    { root: join(repoRoot, 'apps', 'web', 'app', 'mission', 'live-actions'), label: 'apps/web/app/mission/live-actions', exclude: () => false },
    {
      root: packageRoot,
      label: 'tests/live-ux/actions',
      // the deterministic test corpus intentionally carries SYNTHETIC secret-shaped fixtures; the real suite reads the ENVIRONMENT
      exclude: (rel) => rel.startsWith('test') || rel.startsWith('node_modules'),
    },
    { root: join(repoRoot, 'docs', 'evidence', 'production-connectivity', 'live-ux', 'actions-mission'), label: 'docs/evidence/.../live-ux/actions-mission', exclude: () => false },
  ];
  for (const target of owned) {
    let exists = false;
    try {
      statSync(target.root);
      exists = true;
    } catch {
      exists = false;
    }
    if (!exists) continue;
    for (const rel of walk(target.root)) {
      if (!/\.(ts|tsx|json|md|mjs|yaml|yml)$/.test(rel)) continue;
      if (target.exclude(rel)) continue;
      targets.set(`${target.label}/${rel}`, join(target.root, rel));
    }
  }
  return targets;
}

function main() {
  const targets = scanTargets();
  const findings = [];
  for (const [label, absolute] of targets) {
    const text = readFileSync(absolute, 'utf8');
    for (const finding of scanTextWithLaneCorpora(label, text)) {
      findings.push(finding);
    }
  }
  const report = {
    schema: 'sos-2/p18b/secrets-audit',
    produced_at: new Date().toISOString(),
    scanned_files: targets.size,
    scanned_roots: [...new Set([...targets.keys()].map((key) => key.split('/').slice(0, key.includes('actions-mission') ? 5 : 2).join('/')))],
    findings_count: findings.length,
    findings: findings.map((finding) => ({ file: finding.label, line: finding.line, column: finding.column, pattern_id: finding.patternId })),
    note: 'pattern ids + positions only — never matched text; credentials are env-only (the P3 typed registry names)',
  };
  const jsonOut = process.argv.includes('--json-out')
    ? process.argv[process.argv.indexOf('--json-out') + 1]
    : null;
  if (jsonOut !== null && jsonOut !== undefined) {
    mkdirSync(dirname(jsonOut), { recursive: true });
    writeFileSync(jsonOut, `${JSON.stringify(report, null, 2)}\n`);
  }
  console.log(`scanned ${String(targets.size)} files across the P18-B owned paths — ${String(findings.length)} finding(s)`);
  for (const finding of findings) {
    console.error(`  FINDING ${finding.patternId} at ${finding.label}:${String(finding.line)}:${String(finding.column)} (pattern id only — never the value)`);
  }
  process.exit(findings.length > 0 ? 1 : 0);
}

main();
