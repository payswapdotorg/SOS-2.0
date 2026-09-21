import { defineConfig } from 'vitest/config';

// Run from the package root via `vitest run --config ecology/vitest.config.ts`
// (mirrors core/vitest.config.ts: the config lives under ecology/ so the
// package root keeps the P1 skeleton; include patterns resolve from cwd,
// which the package test script always sets to this package's root).
export default defineConfig({
  test: {
    include: ['ecology/test/**/*.test.ts'],
    environment: 'node',
    sequence: { seed: 424242 },
  },
});
