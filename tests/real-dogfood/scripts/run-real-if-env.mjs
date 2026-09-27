#!/usr/bin/env node
/**
 * The RUN_REAL gate of @sos-2/tests-real-dogfood (Work Order P19): the
 * deterministic suite ALWAYS runs through the package `test` script; the
 * REAL-provider dogfood suite runs ONLY when RUN_REAL=1 is set — the
 * honest exit-0 skip otherwise (missing credentials never fail the
 * default suite, and the real suite never runs uninvited).
 */

import { spawnSync } from 'node:child_process';

if (process.env.RUN_REAL !== '1') {
  console.log('RUN_REAL is not set — the real-dogfood suite stays OFF (deterministic integrated suite only).');
  process.exit(0);
}

console.log('[tests-real-dogfood] RUN_REAL=1 — running the REAL dogfood suite (run 1 + run 2 + reproducibility)');
const result = spawnSync('pnpm', ['run', 'test:real'], { stdio: 'inherit', env: { ...process.env } });
process.exit(result.status ?? 1);
