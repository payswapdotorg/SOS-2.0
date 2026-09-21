import { defineConfig } from 'vitest/config';

// Run from the app root via `vitest run --config ecology/vitest.config.ts`
// (mirrors shell/vitest.config.ts: the config lives under ecology/ so the
// app root keeps the P1 skeleton; include patterns resolve from cwd, which
// the app test script always sets to apps/web).
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: {
    include: ['ecology/test/**/*.test.{ts,tsx}'],
    environment: 'node',
    sequence: { seed: 424242 },
  },
});
