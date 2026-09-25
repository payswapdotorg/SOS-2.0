import { defineConfig } from 'vitest/config';

// The DETERMINISTIC reference-mode suite of the real GitHub adapter's
// package-local tests: offline (a scripted request port), fixed seed,
// run-to-run identical. The real-provider integration suite lives in
// tests/real-github (env-gated RUN_REAL=1) and is NEVER included here.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['test/real/**'],
    sequence: { seed: 424242 },
  },
});
