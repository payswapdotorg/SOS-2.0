#!/usr/bin/env node
/**
 * The test-runner dispatch of @sos-2/tests-real-github (Work Order
 * P17-B): the deterministic reference-mode suite runs by default
 * (offline, fixed seed); the REAL-provider integration suite runs ONLY
 * when RUN_REAL=1 is set (the work order's env gate). The two suites
 * are STRICTLY SEPARATED — each config includes only its own files.
 */

import { spawnSync } from 'node:child_process';

const real = process.env.RUN_REAL === '1';
const config = real ? 'vitest.real.config.ts' : 'vitest.config.ts';
const label = real ? 'REAL-PROVIDER INTEGRATION (RUN_REAL=1)' : 'deterministic reference-mode';

console.log(`[tests-real-github] running the ${label} suite (${config})`);
const result = spawnSync('pnpm', ['exec', 'vitest', 'run', '--config', config], {
  stdio: 'inherit',
  env: { ...process.env },
});
process.exit(result.status ?? 1);
