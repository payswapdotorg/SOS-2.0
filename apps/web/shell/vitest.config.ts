import { defineConfig } from 'vitest/config';

// Run from the app root via `vitest run --config shell/vitest.config.ts`
// (the config lives under shell/ so apps/web keeps the P1 skeleton at its
// root: package.json, next.config.ts, tsconfig.json, .gitignore,
// postcss.config.mjs and the thin route wrappers under app/). Include
// patterns resolve from cwd, which the app test script always sets to
// apps/web.
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: {
    include: ['shell/test/**/*.test.{ts,tsx}'],
    environment: 'node',
    sequence: { seed: 424242 },
  },
});
