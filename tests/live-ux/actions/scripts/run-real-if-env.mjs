#!/usr/bin/env node
/**
 * The RUN_REAL gate (Work Order P18-B): `pnpm test` in this package runs
 * the DETERMINISTIC reference-mode suite always, and the REAL-integration
 * suite ONLY when RUN_REAL=1 is set in the environment (default OFF — the
 * P17/P18 lane discipline). Honest exit codes: the real suite's failures
 * FAIL the run (they are recorded as honest outcomes in the evidence, but
 * a broken suite is still a broken suite).
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
if (process.env['RUN_REAL'] === '1') {
  const result = spawnSync('pnpm', ['run', 'test:real'], { cwd: path.resolve(here, '..'), stdio: 'inherit', env: process.env });
  process.exit(result.status ?? 1);
}
console.log('RUN_REAL is not set — the real-integration suite stays OFF (deterministic reference-mode only).');
process.exit(0);
