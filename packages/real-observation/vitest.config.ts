/**
 * The real-observation vitest configuration (Work Order P17-C).
 *
 * DETERMINISTIC REFERENCE-MODE SUITE ONLY: every test in test/** runs
 * against scripted FetchPort implementations — zero network, zero
 * ambient time (ManualClock), run-to-run identical with the repository's
 * fixed seed. The REAL-provider integration suite lives in
 * tests/real-observation (@sos-2/tests-real-observation, gated behind
 * RUN_REAL=1) — the P17 lane discipline: deterministic reference-mode
 * tests and real-provider integration tests are STRICTLY separated.
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    root: new URL('.', import.meta.url).pathname,
    globals: true,
    include: ['test/**/*.test.ts'],
    environment: 'node',
    sequence: { seed: 424242 },
  },
});
