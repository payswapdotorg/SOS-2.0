import { defineConfig } from 'vitest/config';

// The DETERMINISTIC package-local suite of the dogfood-live harness:
// offline structure pins only (the full deterministic journey suite —
// the scripted-seam flagship drives — lives in tests/real-dogfood,
// fixed seed 424242). No network, no ambient time, run-to-run identical.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    sequence: { seed: 424242 },
  },
});
