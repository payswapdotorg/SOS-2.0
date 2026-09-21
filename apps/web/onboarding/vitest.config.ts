/**
 * The onboarding vitest configuration (Work Order P4) — the render
 * smoke suite for the onboarding product surfaces.
 *
 * Runs as part of `pnpm -r --if-present test` via the @sos-2/github
 * package's orchestrating test script (the borrowed-toolchain P3
 * precedent — apps/web's own frozen test script only includes
 * shell/test/**). Root is pinned to THIS directory; the suite mirrors
 * the P1 render-smoke technique (renderToStaticMarkup + a stubbed
 * next/link) so same-input renders are byte-identical.
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
