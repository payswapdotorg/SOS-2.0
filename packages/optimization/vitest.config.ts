import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    sequence: { seed: 424242 },
    testTimeout: 30000, // property tests: ~1.1s isolated, >5s under full-suite parallel load (flake fix, not logic)
  },
});
