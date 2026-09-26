/**
 * The tests-live-ux vitest configuration (Work Order P18-C) — the P4/P17-C
 * render-suite precedent: server render to string with next/link stubbed to
 * a plain anchor (per spec file, the repository's established vi.mock), the
 * fixed repository seed, node environment. The app surfaces under test are
 * wired through TEST-TIME ALIASES (the tests/real-observation precedent)
 * to their real source files — no package dependency edges are created from
 * apps/web to this suite or vice versa.
 */

import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const here = (relative: string): string => fileURLToPath(new URL(relative, import.meta.url));

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: {
    root: here('.'),
    globals: true,
    include: ['journeys/**/*.test.{ts,tsx}'],
    environment: 'node',
    sequence: { seed: 424242 },
  },
  resolve: {
    alias: {
      '@web-app/root-page': here('../../apps/web/app/page.tsx'),
      '@live-mission/page': here('../../apps/web/live-mission/src/components/live-mission-page.tsx'),
      '@live-mission/dto': here('../../apps/web/live-mission/src/view-state/live-mission-dto.ts'),
      '@live-mission/view': here('../../apps/web/live-mission/src/view-state/live-mission-view.ts'),
      '@live-mission/envelopes': here('../../apps/web/live-mission/src/actions/envelopes.ts'),
      '@web-onboarding/hub': here('../../apps/web/onboarding/src/components/onboarding-hub.tsx'),
      '@web-onboarding/greenfield': here('../../apps/web/onboarding/src/components/greenfield-wizard.tsx'),
      '@web-onboarding/brownfield': here('../../apps/web/onboarding/src/components/brownfield-flow.tsx'),
      '@web-onboarding/views': here('../../apps/web/onboarding/src/view-state/onboarding-views.ts'),
      '@web-shell/history-page': here('../../apps/web/shell/components/pages/history-page.tsx'),
      '@web-shell/packages-page': here('../../apps/web/shell/components/pages/packages-page.tsx'),
      '@web-shell/overview-page': here('../../apps/web/shell/components/pages/overview-page.tsx'),
      '@web-shell/ask-page': here('../../apps/web/shell/components/pages/ask-page.tsx'),
    },
  },
});
