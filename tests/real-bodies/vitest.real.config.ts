import { defineConfig } from 'vitest/config';

// The REAL-PROVIDER integration suite (Work Order P17-B): env-gated
// (RUN_REAL=1, default OFF) REAL OpenRouter-backed body execution
// end-to-end (lease, model calls, checkpoints, evidence, independent
// evaluation, Spirit-side completion). NEVER runs the deterministic
// files and NEVER runs without the gate.
export default defineConfig({
  test: {
    include: ['test/real/*.test.ts'],
    sequence: { seed: 424242 },
    testTimeout: 300_000,
    hookTimeout: 60_000,
  },
});
