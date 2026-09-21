/**
 * Vitest configuration for @sos-2/infra-deployment (Work Order P3).
 *
 * Runs as part of `pnpm -r --if-present test` via the package script
 * `pnpm --filter @sos-2/adversarial exec vitest run --config ../../infra/deployment/vitest.config.ts`
 * (toolchain borrowed at run time from the frozen W17 adversarial suite —
 * this package declares ZERO dependencies, so pnpm-lock.yaml stays
 * byte-identical).
 *
 *   - root is pinned to THIS directory (import.meta.url) so the run is
 *     independent of the invoking package's cwd;
 *   - globals: true — test files use injected describe/it/expect and
 *     therefore need NO vitest import (the package cannot resolve vitest
 *     as a dependency — by design);
 *   - fixed seed matches the repo convention (tests are deterministic:
 *     injected clocks/sources, no Date.now, no Math.random, no fetch).
 */
export default {
  test: {
    root: new URL('.', import.meta.url).pathname,
    globals: true,
    include: ['test/**/*.test.ts'],
    sequence: { seed: 424242 },
  },
};
