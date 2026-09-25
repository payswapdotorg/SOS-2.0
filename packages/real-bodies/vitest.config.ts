import { defineConfig } from 'vitest/config';

// The DETERMINISTIC reference-mode suite of the real bodies package's
// package-local tests: offline (the scripted model port), fixed seed,
// run-to-run identical. The real-provider integration suite lives in
// tests/real-bodies (env-gated RUN_REAL=1) and is NEVER included here.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['test/real/**'],
    sequence: { seed: 424242 },
  },
});
