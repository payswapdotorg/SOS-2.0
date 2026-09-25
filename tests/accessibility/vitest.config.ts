import { defineConfig } from 'vitest/config';

// COMPOSITION WIRING (Work Order P15 lane C, the P14 suite precedent):
// the two entry-point-less P14 packages (@sos-2/security,
// @sos-2/cost-policy — zero-dependency, source-consumed, the P3/P4
// lockfile-byte-identity precedent) are wired through TEST-TIME ALIASES
// to their SOURCE entry points (vitest compiles them directly). Every
// other merged package is imported through its normal workspace entry
// (the P13 suite precedent). The fixed seed matches the repository
// convention (deterministic tests).
const here = new URL('.', import.meta.url);

export default defineConfig({
  test: {
    root: here.pathname,
    include: ['test/**/*.test.ts'],
    sequence: { seed: 424242 },
  },
  resolve: {
    alias: {
      '@sos-2/security': new URL('../../packages/security/src/index.ts', import.meta.url).pathname,
      '@sos-2/cost-policy': new URL('../../packages/cost-policy/src/index.ts', import.meta.url).pathname,
    },
  },
});
