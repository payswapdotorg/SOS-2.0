import { defineConfig } from 'vitest/config';

// Run from the package root via `vitest run --config core/vitest.config.ts`
// (the config lives under core/ so the package root keeps the P1 skeleton:
// package.json + tsconfig only). Include patterns resolve from cwd, which
// the package test script always sets to this package's root.
export default defineConfig({
  test: {
    include: ['core/test/**/*.test.ts'],
    environment: 'node',
    sequence: { seed: 424242 },
  },
});
