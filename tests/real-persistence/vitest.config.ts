import { defineConfig } from 'vitest/config';

// The DETERMINISTIC reference-mode suite (Work Order P17-A): offline —
// a scripted FetchPort for every provider seam, NO network — fixed seed
// 424242, run-to-run identical. The real-provider integration suite is
// STRICTLY SEPARATED (vitest.real.config.ts, env-gated RUN_REAL=1) and
// is NEVER included here.
export default defineConfig({
  test: {
    include: ['test/*.test.ts'],
    sequence: { seed: 424242 },
  },
});
