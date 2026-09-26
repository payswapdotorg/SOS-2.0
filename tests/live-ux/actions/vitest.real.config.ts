/**
 * The REAL-provider integration vitest configuration (Work Order P18-B)
 * — RUN_REAL=1 ONLY (default OFF). Real HTTP submissions against the
 * DEPLOYED preview URL (LIVE_MISSION_BASE_URL) with the credential set
 * from the environment (names only in evidence); long timeouts; honest
 * outcomes recorded as JSON evidence into
 * docs/evidence/production-connectivity/live-ux/actions-mission/.
 * Selected by scripts/run-real-if-env.mjs, never by
 * `pnpm -r --if-present test`.
 */

import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const here = (relative: string): string => fileURLToPath(new URL(relative, import.meta.url));

export default defineConfig({
  test: {
    root: here('.'),
    globals: true,
    include: ['test/real/**/*.real.test.ts'],
    environment: 'node',
    testTimeout: 300_000,
    hookTimeout: 300_000,
    sequence: { seed: 424242 },
  },
  resolve: {
    alias: {
      '@live-mission/submission': here('../../../apps/web/live-mission/src/actions/submission.ts'),
    },
  },
});
