/**
 * The REAL-integration vitest configuration (Work Order P18-B) —
 * RUN_REAL=1 ONLY (default OFF). Real network round-trips with the
 * credential set from the environment (names only in evidence): the
 * exact-branch-head Vercel deployment, then real action submissions
 * against the DEPLOYED preview URL (real HTTP), each recording HTTP
 * transcripts + typed receipts + honest provider states. Selected by
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
    testTimeout: 420_000,
    hookTimeout: 420_000,
    sequence: { seed: 424242 },
  },
  resolve: {
    alias: {
      '@live-action/core': fileURLToPath(new URL('../../../apps/web/app/api/live-mission/actions/live-action-core.ts', import.meta.url)),
      '@live-mission/envelopes': fileURLToPath(new URL('../../../apps/web/live-mission/src/actions/envelopes.ts', import.meta.url)),
    },
  },
});
