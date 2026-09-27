import { defineConfig } from 'vitest/config';

// The REAL-PROVIDER dogfood suite (Work Order P19): env-gated
// (RUN_REAL=1, default OFF) REAL journeys against GitHub, Vercel and
// OpenRouter — RUN 1 on payswapdotorg/sos-dogfood-r1, RUN 2 on
// payswapdotorg/sos-dogfood-r2 with a FRESH harness + fresh stores plus
// the reproducibility equivalence record — recording honest outcomes
// (including failures) as machine-readable, redacted evidence into
// docs/evidence/production-connectivity/dogfood. NEVER runs the
// deterministic files and NEVER runs without the gate. The runs share
// real-provider rate limits — file parallelism is OFF (sequential).
export default defineConfig({
  test: {
    include: ['test/real/*.real.test.ts'],
    sequence: { seed: 424242 },
    testTimeout: 420_000,
    hookTimeout: 420_000,
    fileParallelism: false,
  },
});
