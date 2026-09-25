/**
 * @sos-2/infra-production-connectivity — the production-connectivity
 * wiring harness/scripts (Work Order P17-A, following the
 * infra/deployment harness precedent).
 *
 *   - wiring.ts        the composition harness: env-only resolution ->
 *                      the REAL persistence stack + the REAL Vercel
 *                      deployment provider, startup probes with honest
 *                      outcomes, the frozen health report + P17-A
 *                      provider states
 *   - evidence.ts      machine-readable evidence record builders with
 *                      fail-closed dual-corpus redaction
 *   - secrets-audit.ts the lane secrets audit (pattern ids + positions
 *                      only — never matched text)
 *   - scripts/         check-zero-deps (workspace-only dependencies) +
 *                      secret-scan (the lane's owned paths)
 *
 * Determinism discipline: no ambient env, no hidden clocks, no ambient
 * network in src — inject a scripted FetchPort + ManualClock + instant
 * sleep and the harness runs offline (the deterministic wiring tests do
 * exactly that). The default fetch/sleep bindings are the documented
 * impure process boundary.
 */

export * from './wiring.js';
export * from './evidence.js';
export * from './secrets-audit.js';
