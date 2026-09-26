/**
 * The DETERMINISTIC reference-mode vitest configuration (Work Order
 * P18-B): NO network, fixed seed 424242, run-to-run identical. The
 * real-provider integration suite is STRICTLY SEPARATED
 * (vitest.real.config.ts, env-gated RUN_REAL=1) and is NEVER included
 * here — the P17 lane discipline.
 *
 * COMPOSITION WIRING (the tests/real-observation precedent): the
 * app-module sources under test (the route mounts, the live-mission
 * integration seams) are wired through TEST-TIME ALIASES to their real
 * source files; every merged package is imported through its normal
 * workspace entry.
 */

import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const here = (relative: string): string => fileURLToPath(new URL(relative, import.meta.url));

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: {
    root: here('.'),
    globals: true,
    include: ['test/**/*.test.{ts,tsx}'],
    exclude: ['test/real/**'],
    environment: 'node',
    sequence: { seed: 424242 },
  },
  resolve: {
    alias: {
      // The app-module sources under test (the P18-B mounts + integration seams).
      '@web-app/live-mission-route': here('../../../apps/web/app/live-mission/page.tsx'),
      '@web-app/mission-route': here('../../../apps/web/app/mission/page.tsx'),
      '@web-app/data-seam': here('../../../apps/web/app/live-mission/data-seam.ts'),
      '@web-app/action-endpoint': here('../../../apps/web/app/api/live-mission/actions/route.ts'),
      '@live-mission/host': here('../../../apps/web/app/mission/live-actions/host.ts'),
      '@live-mission/console-ask-queue': here('../../../apps/web/app/mission/live-actions/console-ask-queue.ts'),
      '@live-mission/console-authority': here('../../../apps/web/app/mission/live-actions/console-authority.ts'),
      '@live-mission/live-executors': here('../../../apps/web/app/mission/live-actions/live-executors.ts'),
      '@live-mission/submission': here('../../../apps/web/app/mission/live-actions/submission.ts'),
      '@live-mission/openrouter-probe': here('../../../apps/web/app/mission/live-actions/adapters/openrouter-probe.ts'),
      '@live-mission/vercel-records': here('../../../apps/web/app/mission/live-actions/adapters/vercel-records.ts'),
      '@live-mission/receipt-html': here('../../../apps/web/app/mission/live-actions/receipts/receipt-html.ts'),
      '@live-mission/receipt-view': here('../../../apps/web/app/mission/live-actions/receipt-view.ts'),
      // The frozen P17-C surfaces (consumed read-only).
      '@live-mission/envelopes': here('../../../apps/web/live-mission/src/actions/envelopes.ts'),
      '@live-mission/dto': here('../../../apps/web/live-mission/src/view-state/live-mission-dto.ts'),
    },
  },
});
