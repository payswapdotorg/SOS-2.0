/**
 * The deterministic reference-mode vitest configuration (Work Order
 * P17-C): NO network, fixed seed, run-to-run identical. The real-provider
 * integration suite is SEPARATE (vitest.real.config.ts, RUN_REAL=1 only)
 * — the P17 lane discipline: deterministic reference-mode tests and
 * real-provider integration tests are strictly separated.
 *
 * COMPOSITION WIRING (the tests/accessibility precedent): the
 * entry-point-less merged @sos-2/security package (zero-dependency,
 * source-consumed) is wired through a TEST-TIME ALIAS to its source
 * entry (the redaction-corpus alignment suite imports it); every other
 * merged package is imported through its normal workspace entry.
 */

import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    root: fileURLToPath(new URL('.', import.meta.url)),
    globals: true,
    include: ['test/**/*.test.ts'],
    exclude: ['test/real/**'],
    environment: 'node',
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
