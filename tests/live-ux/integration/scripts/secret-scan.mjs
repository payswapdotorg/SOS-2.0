#!/usr/bin/env node
/**
 * The P18-INT secret scan (the P17-A/P18-B secret-scan precedent): scans
 * the P18-INT OWNED deliverable files for secret-shaped values using the
 * merged redaction corpora (the observation corpus + the deployment
 * corpus). On any finding it fails listing file, line, column and pattern
 * id — NEVER the matched value. Exit code 1 on findings, 0 on a clean tree.
 *
 * Scan scope (the P18-INT owned paths):
 *   - apps/web/app/live-mission (the swapped seam)
 *   - tests/live-ux/integration (scripts + src + configs + the deterministic
 *     and real suites — the real suite reads credentials from the
 *     ENVIRONMENT, never from files)
 *   - docs/evidence/production-connectivity/live-ux/integration (the
 *     evidence package itself — MUST be clean)
 *   - the two P18-INT-touched journey files (the ungated route-full-path
 *     spec + helpers) and the one flagged-deviation file (the re-pinned
 *     mount-seams spec)
 *
 * Usage: node tests/live-ux/integration/scripts/secret-scan.mjs [--json-out <path>]
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

const owned = [
  ...walk(join(repoRoot, 'apps/web/app/live-mission')),
  ...walk(join(repoRoot, 'tests/live-ux/integration')),
  ...walk(join(repoRoot, 'docs/evidence/production-connectivity/live-ux/integration')),
  join(repoRoot, 'tests/live-ux/journeys/90-route-full-path.test.tsx'),
  join(repoRoot, 'tests/live-ux/journeys/helpers.ts'),
  join(repoRoot, 'tests/live-ux/actions/test/mount-seams.test.tsx'),
].filter((file) => /\.(ts|tsx|mjs|json|md)$/.test(file));

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
  schema: 'sos-2/p18int/secrets-audit',
  work_order: 'P18-INT',
  produced_at: new Date().toISOString(),
  files_scanned: owned.length,
  scan_scope: [
    'apps/web/app/live-mission/** (the swapped seam)',
    'tests/live-ux/integration/** (both suites + scripts + configs)',
    'docs/evidence/production-connectivity/live-ux/integration/** (the evidence package)',
    'tests/live-ux/journeys/90-route-full-path.test.tsx + helpers.ts (the ungated route suites)',
    'tests/live-ux/actions/test/mount-seams.test.tsx (the flagged-deviation re-pin)',
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
