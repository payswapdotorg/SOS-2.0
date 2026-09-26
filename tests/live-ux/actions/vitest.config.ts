/**
 * The deterministic reference-mode vitest configuration (Work Order
 * P18-B): NO network, fixed seed 424242, run-to-run identical. The
 * env-gated real-integration suite is SEPARATE (vitest.real.config.ts,
 * RUN_REAL=1 only) — the P17 lane discipline: deterministic
 * reference-mode tests and real-provider integration tests are strictly
 * separated.
 *
 * COMPOSITION WIRING (the tests/real-observation precedent): the app
 * files under test are consumed through TEST-TIME ALIASES (the
 * @live-action/* and @live-mission/* paths) so no package.json
 * dependency edges are created by the tests; the app files' own imports
 * resolve from their app locations (apps/web declares them).
 */

import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    root: fileURLToPath(new URL('.', import.meta.url)),
    globals: true,
    include: ['test/**/*.test.{ts,tsx}'],
    exclude: ['test/real/**'],
    environment: 'node',
    sequence: { seed: 424242 },
  },
  resolve: {
    alias: {
      '@live-action/core': fileURLToPath(new URL('../../../apps/web/app/api/live-mission/actions/live-action-core.ts', import.meta.url)),
      '@live-action/deployed-host': fileURLToPath(new URL('../../../apps/web/app/api/live-mission/actions/deployed-host.ts', import.meta.url)),
      '@live-action/bridge': fileURLToPath(new URL('../../../apps/web/app/api/live-mission/actions/real-executor-bridge.ts', import.meta.url)),
      '@live-action/seam': fileURLToPath(new URL('../../../apps/web/app/live-mission/data-seam.ts', import.meta.url)),
      '@live-action/mission-route': fileURLToPath(new URL('../../../apps/web/app/mission/page.tsx', import.meta.url)),
      '@live-action/live-mission-route': fileURLToPath(new URL('../../../apps/web/app/live-mission/page.tsx', import.meta.url)),
      '@live-action/receipt-view': fileURLToPath(new URL('../../../apps/web/live-mission/src/components/action-receipt-view.tsx', import.meta.url)),
      '@live-action/receipt-page': fileURLToPath(new URL('../../../apps/web/app/mission/receipt/page.tsx', import.meta.url)),
      '@live-mission/envelopes': fileURLToPath(new URL('../../../apps/web/live-mission/src/actions/envelopes.ts', import.meta.url)),
      '@live-mission/dto': fileURLToPath(new URL('../../../apps/web/live-mission/src/view-state/live-mission-dto.ts', import.meta.url)),
    },
  },
  esbuild: { jsx: 'automatic' },
});
