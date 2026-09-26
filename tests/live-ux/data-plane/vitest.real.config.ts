import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// The REAL-PROVIDER integration suite (Work Order P18-A): env-gated
// (RUN_REAL=1, default OFF) REAL journeys — the live data plane against
// the real providers (GitHub repo/CI observation, Vercel deployment
// state + source_revision_sha, R2 connectivity, Neon/Upstash honest
// unavailability) — recording honest outcomes (including failures) as
// redacted machine-readable evidence into
// docs/evidence/production-connectivity/live-ux/data-plane.
// NEVER runs the deterministic files and NEVER runs without the gate.
export default defineConfig({
  test: {
    root: fileURLToPath(new URL('.', import.meta.url)),
    include: ['test/real/*.real.test.ts'],
    environment: 'node',
    sequence: { seed: 424242 },
    testTimeout: 600_000,
    hookTimeout: 120_000,
  },
  resolve: {
    alias: {
      '@live-mission/dto': fileURLToPath(new URL('../../../apps/web/live-mission/src/view-state/live-mission-dto.ts', import.meta.url)),
      '@live-data/data-plane': fileURLToPath(new URL('../../../apps/web/live-data/src/data-plane.ts', import.meta.url)),
      '@live-data/producer': fileURLToPath(new URL('../../../apps/web/live-data/src/producer.ts', import.meta.url)),
      '@web-contracts/live': fileURLToPath(new URL('../../../packages/web-contracts/live/src/index.ts', import.meta.url)),
    },
  },
});
