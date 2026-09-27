/**
 * @sos-2/dogfood-live — the REAL-WORLD DOGFOOD HARNESS (Work Order
 * P19): the real-system composition that drives the P13 flagship
 * journey engine through REAL external systems (GitHub, Vercel,
 * OpenRouter), recording exact revisions at every stage.
 *
 * Composition (consumed, never re-implemented):
 *   - @sos-2/greenfield-runtime   the flagship journey engine (frozen)
 *   - @sos-2/real-github          the REAL GitHub provider (PAT-backed
 *                                 handshake, empty-repo detection, the
 *                                 contents-API/Git-Data-API commit paths)
 *   - @sos-2/real-bodies          the REAL hosted coding body (OpenRouter)
 *   - @sos-2/deployment-providers the reusable Vercel patterns (FetchPort,
 *                                 redaction, transcripts) + env names
 *   - @sos-2/evaluator + evaluation-orchestration + the CompletionCertifier
 *                                 the independent evaluation (the body
 *                                 never certifies itself)
 *   - @sos-2/packages + composition + ecology — the data-only learned records
 *
 * The sync frozen seams (ActionExecutor / TaskImplementationPort /
 * EvaluatorProbe) answer EXACTLY the real outcomes the harness operator
 * staged at the async composition boundary (the documented P8
 * discipline — staging.ts). Determinism: no ambient env/network/time in
 * src — every seam is injectable; the deterministic suites script them
 * offline (fixed seed 424242); the process boundary binds the real
 * fetch/clock only in the env-gated RUN_REAL suite (default OFF).
 */

export * from './environment.js';
export * from './journey-github.js';
export * from './vercel-rest.js';
export * from './provider-snapshot.js';
export * from './staging.js';
export * from './gateway-executors.js';
export * from './body-binding.js';
export * from './repair-binding.js';
export * from './evaluator-probes.js';
export * from './records.js';
export * from './harness.js';
