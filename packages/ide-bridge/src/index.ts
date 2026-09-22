/**
 * @sos-2/ide-bridge — the OPTIONAL IDE bridge (Work Order P11): the §4
 * tier-4 ('extension') adapter contract bridging an IDE integration onto
 * the companion/harness surface, with the same adapter discipline as the
 * browser bridge.
 *
 * - Typed ports with injectable transports (the P8 LocalBridgeTransport
 *   command-dispatch precedent); reply-validated against exact typed
 *   shapes — a malformed reply is a truthful FAILED, never a silent
 *   success.
 * - THE SEAM CARRIES NO AUTHORITY: exact field sets on every marshaled
 *   request/reply — a smuggled grant/permission key is a typed violation
 *   naming the field (IDE extensions are adapters, never SOS
 *   authorities).
 * - Honest statuses: NOT_YET_CONNECTED while no real IDE integration
 *   exists (the P8 connection vocabulary, consumed); the explicit
 *   simulated marker when the deterministic reference transport backs the
 *   bridge.
 *
 * Determinism: no Date.now / Math.random / fetch / process.env in this
 * package's src — the transport is injected and the reference runtime is
 * a pure state machine.
 */

export * from './errors.js';
export * from './transport.js';
export * from './shapes.js';
export * from './simulated.js';
export * from './adapter.js';
