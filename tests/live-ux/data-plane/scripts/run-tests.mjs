#!/usr/bin/env node
/**
 * The test-runner dispatch of @sos-2/tests-live-ux-data-plane (Work
 * Order P18-A): `pnpm test` in this package runs the DETERMINISTIC
 * reference-mode suite always (plus the web-contracts/live subpackage
 * suite and the @sos-2/web-live-data typecheck — the
 * packages/github -> web-contracts/onboarding orchestration precedent),
 * and the REAL-provider integration suite ONLY when RUN_REAL=1 is set
 * in the environment (the P17 lane discipline; default OFF). Honest
 * exit codes: the real suite's failures FAIL the run (they are
 * recorded as honest outcomes in the evidence, but a broken suite is
 * still a broken suite).
 */

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, '..');

function run(command, args, label) {
  console.log(`[tests-live-ux-data-plane] ${label}`);
  const result = spawnSync(command, args, { cwd: packageRoot, stdio: 'inherit', env: process.env });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

if (process.env.RUN_REAL === '1') {
  run('pnpm', ['run', 'test:real'], 'running the REAL-PROVIDER INTEGRATION suite (RUN_REAL=1)');
  process.exit(0);
}

console.log('[tests-live-ux-data-plane] running the deterministic reference-mode suite (RUN_REAL not set — the real suite stays OFF)');
run('pnpm', ['run', 'test:reference'], 'deterministic reference-mode: web-live-data typecheck + the data-plane suite + the web-contracts/live suite');
process.exit(0);
