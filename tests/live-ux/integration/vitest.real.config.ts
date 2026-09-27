/**
 * The REAL-integration vitest configuration (Work Order P18-INT) —
 * RUN_REAL=1 ONLY (default OFF). The REAL seam with NO injection: one real
 * data-plane pass against the real providers (the credential set from the
 * environment; names only in evidence), the seam contract against the real
 * pass, and real consequential actions through the mounted endpoint against
 * the deployed preview URL — each step recording redacted HTTP transcripts
 * + typed receipts + honest provider states into
 * docs/evidence/production-connectivity/live-ux/integration. Selected by
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
      '@integration/producer': fileURLToPath(new URL('../../../apps/web/live-data/src/producer.ts', import.meta.url)),
      '@integration/data-plane': fileURLToPath(new URL('../../../apps/web/live-data/src/data-plane.ts', import.meta.url)),
      '@integration/seam': fileURLToPath(new URL('../../../apps/web/app/live-mission/data-seam.ts', import.meta.url)),
      '@integration/live-action-core': fileURLToPath(new URL('../../../apps/web/app/api/live-mission/actions/live-action-core.ts', import.meta.url)),
      '@integration/real-executor-bridge': fileURLToPath(new URL('../../../apps/web/app/api/live-mission/actions/real-executor-bridge.ts', import.meta.url)),
      '@live-mission/envelopes': fileURLToPath(new URL('../../../apps/web/live-mission/src/actions/envelopes.ts', import.meta.url)),
      '@live-mission/dto': fileURLToPath(new URL('../../../apps/web/live-mission/src/view-state/live-mission-dto.ts', import.meta.url)),
    },
  },
});
