/**
 * @sos-2/runtime-contracts — the typed runtime vocabulary for
 * runtime/execution integration (Work Order P5).
 *
 * - The §4 harness integration priority order (native API/SDK/app-server
 *   -> MCP/equivalent protocol -> local companion/service bridge ->
 *   browser/IDE extension -> UI automation LAST) as a typed, frozen,
 *   deterministic selection model.
 * - Runtime capability envelopes + candidate integration surfaces.
 * - The bounded-environment description (filesystem scope, network egress
 *   policy, isolation level, resource limits, environment variable NAMES
 *   only — never secret values; no ambient process.env reads anywhere).
 * - The NON-SEMANTIC identifier discipline: runtime identifiers are never
 *   SOS semantic identities (spine-shaped ids are rejected loudly).
 *
 * Pure types + guards + pure functions. Deterministic: no Date.now, no
 * Math.random, no fetch, no process.env in this package's src. The P3
 * body-provider configuration vocabulary is aligned BY SPEC (both mirror
 * §3 of the execution architecture) and deliberately not imported.
 */

export * from './errors.js';
export * from './identifiers.js';
export * from './integration-tiers.js';
export * from './runtime-envelope.js';
export * from './selection.js';
