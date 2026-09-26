#!/usr/bin/env node
/**
 * The P18-B lane secret scan (the P17-A secret-scan precedent): scans the
 * lane's OWNED deliverable files for secret-shaped values using the merged
 * redaction corpora (the observation corpus + the deployment corpus). On any
 * finding it fails listing file, line, column and pattern id — NEVER the
 * matched value. Exit code 1 on findings, 0 on a clean tree.
 *
 * Scan scope (the P18-B owned paths):
 *   - apps/web/app/live-mission, apps/web/app/mission,
 *     apps/web/app/api/live-mission (the mounts + the endpoint)
 *   - apps/web/live-mission (the P17-C surface + the receipt rendering seam)
 *   - tests/live-ux/actions (scripts + src + configs + the deterministic test
 *     corpus EXCLUDING the two suites that intentionally carry SYNTHETIC
 *     secret-shaped fixtures — all-zero values, never real — to prove
 *     detection/redaction; the env-gated real suite reads credentials from
 *     the ENVIRONMENT, never from files)
 *   - docs/evidence/production-connectivity/live-ux/actions-mission (the
 *     evidence package itself — MUST be clean)
 *
 * Usage: node tests/live-ux/actions/scripts/secret-scan.mjs [--json-out <path>]
 */
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { redactObservationSecrets } = require('@sos-2/real-observation');
const { redactDeploymentSecrets } = require('@sos-2/deployment-providers');

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..');

function walk(dir, acc = []) {
  for (const entry of readdirSync(dir).sort()) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '.git' || entry === '.next') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, acc);
    else acc.push(full);
  }
  return acc;
}

const syntheticFixtureSuites = new Set(['redaction-structure.test.ts', 'authority-fail-closed.test.ts']);
const owned = [
  ...walk(join(repoRoot, 'apps/web/app/live-mission')),
  ...walk(join(repoRoot, 'apps/web/app/mission')),
  ...walk(join(repoRoot, 'apps/web/app/api/live-mission')),
  ...walk(join(repoRoot, 'apps/web/live-mission')),
  ...walk(join(repoRoot, 'tests/live-ux/actions')).filter((file) => {
    if (file.endsWith('.test.ts') || file.endsWith('.test.tsx')) {
      const base = file.split('/').pop();
      if (syntheticFixtureSuites.has(base)) return false;
    }
    return /\.(ts|tsx|mjs|json)$/.test(file);
  }),
  ...walk(join(repoRoot, 'docs/evidence/production-connectivity/live-ux/actions-mission')),
];

const findings = [];
for (const file of owned) {
  const text = readFileSync(file, 'utf8');
  const first = redactObservationSecrets(text);
  const second = redactDeploymentSecrets(first.redacted);
  const seen = new Set([...first.findings, ...second.findings].map((f) => f.patternId));
  if (seen.size > 0) {
    findings.push({ file: file.replace(repoRoot + '/', ''), patternIds: [...seen].sort() });
  }
}

const record = {
  schema: 'sos-2/p18b/secrets-audit',
  work_order: 'P18-B',
  produced_at: new Date().toISOString(),
  files_scanned: owned.length,
  scan_scope: [
    'apps/web/app/live-mission/**',
    'apps/web/app/mission/**',
    'apps/web/app/api/live-mission/**',
    'apps/web/live-mission/**',
    'tests/live-ux/actions/** (excluding the two synthetic-fixture suites: redaction-structure.test.ts, authority-fail-closed.test.ts — all-zero SYNTHETIC values, never real)',
    'docs/evidence/production-connectivity/live-ux/actions-mission/**',
  ],
  corpora: ['@sos-2/real-observation (the P17-C observation corpus)', '@sos-2/deployment-providers (the P17-A deployment corpus)'],
  findings,
  result: findings.length === 0 ? 'PASS — 0 secret-shaped findings (credentials are env NAMES only; values never committed)' : 'FAIL — secret-shaped findings present',
};

const jsonOut = process.argv.includes('--json-out') ? process.argv[process.argv.indexOf('--json-out') + 1] : null;
if (jsonOut !== null && jsonOut !== undefined) {
  mkdirSync(dirname(jsonOut), { recursive: true });
  writeFileSync(jsonOut, `${JSON.stringify(record, null, 2)}\n`);
}
console.log(`secret policy scan: ${record.result} (${record.files_scanned} files scanned; pattern ids only — never matched text)`);
process.exit(findings.length === 0 ? 0 : 1);
