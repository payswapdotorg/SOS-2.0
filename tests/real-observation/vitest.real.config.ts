/**
 * The REAL-provider integration vitest configuration (Work Order P17-C)
 * — RUN_REAL=1 ONLY (default OFF). Real network round-trips with the
 * PAT/credential set from the environment (names only in evidence);
 * long timeouts; honest outcomes recorded as JSON evidence. Selected by
 * scripts/run-real-if-env.mjs, never by `pnpm -r --if-present test`.
 */

import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    root: fileURLToPath(new URL('.', import.meta.url)),
    globals: true,
    include: ['test/real/**/*.real.test.ts'],
    environment: 'node',
    testTimeout: 60_000,
    hookTimeout: 60_000,
    sequence: { seed: 424242 },
  },
  resolve: {
    alias: {
      '@sos-2/security': fileURLToPath(new URL('../../packages/security/src/index.ts', import.meta.url)),
      '@live-mission/envelopes': fileURLToPath(new URL('../../apps/web/live-mission/src/actions/envelopes.ts', import.meta.url)),
      '@live-mission/dto': fileURLToPath(new URL('../../apps/web/live-mission/src/view-state/live-mission-dto.ts', import.meta.url)),
      '@live-mission/view': fileURLToPath(new URL('../../apps/web/live-mission/src/view-state/live-mission-view.ts', import.meta.url)),
    },
  },
});
