import { defineConfig } from 'vitest/config';

// The REAL-PROVIDER integration suite (Work Order P17-A): env-gated
// (RUN_REAL=1, default OFF) REAL authenticated journeys against Neon,
// Upstash, Cloudflare R2 and Vercel — recording honest outcomes
// (including failures) as machine-readable evidence into
// docs/evidence/production-connectivity/persistence-deployment.
// NEVER runs the deterministic files and NEVER runs without the gate.
export default defineConfig({
  test: {
    include: ['test/real/*.real.test.ts'],
    sequence: { seed: 424242 },
    testTimeout: 600_000,
    hookTimeout: 120_000,
  },
});
