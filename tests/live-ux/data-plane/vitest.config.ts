import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// The DETERMINISTIC reference-mode suite (Work Order P18-A): offline —
// a scripted router FetchPort for every provider seam, NO network —
// fixed seed 424242, run-to-run identical. The real-provider
// integration suite is STRICTLY SEPARATED (vitest.real.config.ts,
// env-gated RUN_REAL=1) and is NEVER included here.
//
// COMPOSITION WIRING (the tests/real-observation precedent): the
// source-consumed modules (the P17-C live-mission DTO, the P18-A
// live-data plane, the web-contracts/live subpackage) are wired through
// TEST-TIME ALIASES to their source entries; every merged package is
// imported through its normal workspace entry.
export default defineConfig({
  test: {
    root: fileURLToPath(new URL('.', import.meta.url)),
    include: ['test/*.test.ts'],
    exclude: ['test/real/**'],
    environment: 'node',
    sequence: { seed: 424242 },
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
