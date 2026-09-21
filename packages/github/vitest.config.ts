/**
 * Vitest configuration for @sos-2/github (Work Order P4).
 *
 * Runs as part of `pnpm -r --if-present test` via the package script
 * `pnpm --filter @sos-2/adversarial exec vitest run --config ../../packages/github/vitest.config.ts`
 * (toolchain borrowed at run time from the frozen W17 adversarial suite —
 * this package declares ZERO dependencies, following the P3 precedent, so
 * pnpm-lock.yaml stays byte-identical). The package test script also runs
 * the two sibling P4 suites (the onboarding view-model contracts under
 * packages/web-contracts/onboarding and the onboarding product-surface
 * render smoke tests under apps/web/onboarding) through their own
 * P4-owned configs, after building @sos-2/web-contracts' dist (the
 * onboarding subpath consumes the P1 core contracts through the package's
 * self-referencing export).
 *
 *   - root is pinned to THIS directory (import.meta.url) so the run is
 *     independent of the invoking package's cwd;
 *   - globals: true — test files use injected describe/it/expect and
 *     therefore need NO vitest import (the package cannot resolve vitest
 *     as a dependency — by design);
 *   - fixed seed matches the repo convention (tests are deterministic:
 *     injected literals, no Date.now, no Math.random, no fetch).
 */
export default {
  test: {
    root: new URL('.', import.meta.url).pathname,
    globals: true,
    include: ['test/**/*.test.ts'],
    sequence: { seed: 424242 },
  },
};
