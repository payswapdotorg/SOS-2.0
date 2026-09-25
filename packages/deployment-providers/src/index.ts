/**
 * @sos-2/deployment-providers — the REAL deployment providers (Work
 * Order P17-A, persistence/deployment lane).
 *
 * The real Vercel deployment provider surface wired through the
 * existing deployment contracts:
 *
 *   - vercel-api.ts        the real Vercel REST client (user probe,
 *                          teams, projects, deployments from an exact
 *                          git ref, deployment reads) over the
 *                          injectable FetchPort seam
 *   - vercel-provider.ts   RealVercelDeploymentProvider — REAL
 *                          deployments bound to the exact
 *                          source_revision_sha, minting DeploymentRecord
 *                          (frozen createDeployment), the P3-shaped
 *                          DeploymentRevisionRecord (rollback pointers)
 *                          and truthful DeploymentOutcome records
 *   - provider-state.ts    the honest P17-A states
 *                          (CONNECTED/UNKNOWN/UNAVAILABLE/DEGRADED)
 *   - transcript.ts /
 *     redaction.ts         redacted transcripts; the lane corpus
 *   - environment.ts       env-only credential resolution (P3 registry
 *                          names; names only in every output)
 *   - infra-vocabulary.ts the P3 vercel + revision contracts carried
 *                          STRUCTURALLY (the frozen P8 body-runtimes
 *                          precedent; alignment pinned by test in
 *                          tests/real-persistence)
 *
 * Determinism discipline: no hidden clocks, no ambient env, no ambient
 * network in package src — the deterministic suites script the
 * FetchPort seam (with an instant sleep); network happens only in the
 * env-gated integration suite (RUN_REAL=1). Zero external dependencies
 * (workspace:* + toolchain). The frozen contracts are consumed
 * read-only.
 */

export * from './provider-state.js';
export * from './http.js';
export * from './redaction.js';
export * from './recording-fetch.js';
export * from './transcript.js';
export * from './environment.js';
export * from './infra-vocabulary.js';
export * from './vercel-api.js';
export * from './vercel-provider.js';
