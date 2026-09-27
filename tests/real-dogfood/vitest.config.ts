import { defineConfig } from 'vitest/config';

// The DETERMINISTIC suite (Work Order P19): offline — the REAL adapters'
// SEAMS scripted at the dogfood adapter boundaries (a scripted
// GitHubRequestPort, a scripted Vercel FetchPort, the ScriptedHostedModelPort,
// a scripted runtime fetch, scripted DNS/key probes) — NO network, fixed
// seed 424242, run-to-run identical. The REAL suite is STRICTLY SEPARATED
// (vitest.real.config.ts, env-gated RUN_REAL=1, default OFF) and is NEVER
// included here.
export default defineConfig({
  test: {
    include: ['test/*.test.ts'],
    sequence: { seed: 424242 },
  },
});
