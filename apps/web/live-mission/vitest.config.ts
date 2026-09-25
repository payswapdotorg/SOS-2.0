/**
 * The live-mission vitest configuration (Work Order P17-C) — the P4
 * onboarding precedent: server render to string with next/link stubbed
 * (the Next router is not mounted outside the app), same-input renders
 * byte-identical, the repository's fixed vitest seed. Runs as part of
 * `pnpm -r --if-present test` through the @sos-2/real-observation
 * package's orchestrating test script (the packages/github ->
 * apps/web/onboarding precedent — apps/web's own frozen test script
 * covers only shell/ and ecology/).
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    root: new URL('.', import.meta.url).pathname,
    globals: true,
    include: ['test/**/*.test.{ts,tsx}'],
    environment: 'node',
    sequence: { seed: 424242 },
    esbuild: { jsx: 'automatic' },
  },
});
