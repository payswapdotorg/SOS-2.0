/**
 * The live web-contracts vitest configuration (Work Order P18-A) — the
 * packages/web-contracts/onboarding precedent: a subpackage-local
 * deterministic suite (zero dependencies, offline, the repository's
 * fixed vitest seed). Runs as part of `pnpm -r --if-present test`
 * through the @sos-2/tests-live-ux-data-plane package's orchestrating
 * test script (the packages/github -> packages/web-contracts/onboarding
 * precedent — the subpackage itself is not a workspace importer).
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    root: new URL('.', import.meta.url).pathname,
    globals: true,
    include: ['test/**/*.test.ts'],
    environment: 'node',
    sequence: { seed: 424242 },
  },
});
