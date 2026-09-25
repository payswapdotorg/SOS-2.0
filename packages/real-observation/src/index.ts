/**
 * @sos-2/real-observation — SOS 2.0 Real Observation Sources (Work Order
 * P17-C, observation/UX lane of the Production Connectivity wave).
 *
 * REAL provider adapters feeding the EXISTING merged P7 Observation
 * Plane — the plane runs WITHOUT a permanent body (§5):
 *
 *   - GitHub repository events: the webhook-shaped receiver (HMAC
 *     fail-closed) + the REST events-API polling fallback (PAT) — one
 *     envelope contract, two delivery shapes, replay-protected through
 *     the merged pipeline.
 *   - CI results: GitHub Actions runs per commit (REST runs API).
 *   - Deployment events: the Vercel deployments API read directly (no
 *     sibling-lane dependency).
 *   - Runtime telemetry: real W3 TelemetrySource adapters (GitHub
 *     rate-limit budget, Upstash Redis runtime, generic JSON metrics).
 *   - Scheduled probes: real fallback probes behind the merged
 *     ProbeScheduler (only where organic coverage is insufficient).
 *   - Provider health: real per-provider probes + the aggregate honest
 *     state.
 *
 * Honest-state discipline (program-defining): every source reports
 * CONNECTED / UNKNOWN / UNAVAILABLE / DEGRADED from REAL probes — an
 * unprobed source is UNKNOWN (never health), a down provider is
 * UNAVAILABLE with the real error recorded (never silence), a throttled
 * provider is DEGRADED. Nothing is ever fabricated.
 *
 * Zero ambient network/time/env in package src: all HTTP goes through
 * the injected FetchPort (bindGlobalFetch at the process boundary
 * only), all time through the injected Clock (SystemClock at the
 * process boundary only), all config through explicit values
 * (configFromEnv is a PURE function over a caller-supplied env record).
 * The single inbound exception is the node:http bind adapter of the
 * webhook receiver (documented; zero outbound network).
 */

export * from './errors.js';
export * from './honest-state.js';
export * from './http.js';
export * from './redaction.js';
export * from './transcript.js';
export * from './github-events.js';
export * from './github-webhook.js';
export * from './github-ci.js';
export * from './vercel-deployments.js';
export * from './runtime-telemetry.js';
export * from './scheduled-probes.js';
export * from './provider-health.js';
export * from './composition.js';
export * from './system-clock.js';
