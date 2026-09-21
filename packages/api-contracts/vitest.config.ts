import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Pinned seed: deterministic, reproducible test order across runs (the
    // repo-wide discipline — `pnpm -r test` twice must produce identical
    // results).
    sequence: { seed: 424242 },
  },
});
