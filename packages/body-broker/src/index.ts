/**
 * @sos-2/body-broker — the Body Broker (Work Order P5).
 *
 * - Body identity: harness/provider identity is NEVER SOS semantic
 *   identity (typed separation; spine-shaped body ids rejected loudly;
 *   the provider block is provenance metadata only).
 * - Body health lifecycle: AVAILABLE -> SUSPENDED -> AVAILABLE;
 *   AVAILABLE|SUSPENDED -> RELEASED (terminal).
 * - Capability-based selection from declared §3 advertisements — never
 *   vendor identity.
 * - Body leases over the durable P2 BodyLeaseRepository: acquire / renew
 *   / release / revoke, single-use deterministic lease ids, and FAIL
 *   CLOSED authorization — an expired, revoked or released lease
 *   authorizes nothing (typed LeaseDenial).
 * - Suspend/replace/release without losing the task:
 *   replaceBodyLease ends the current lease and acquires a new one for
 *   the SAME task — task identity lives in the durable TaskRecord, never
 *   in a body.
 *
 * Determinism: no Date.now / Math.random / fetch / process.env in this
 * package's src; the clock is injected; lease truth is recomputed from
 * durable records (isLeaseExpiredAt consumed from @sos-2/live-store).
 */

export * from './errors.js';
export * from './body-identity.js';
export * from './body-health.js';
export * from './selection.js';
export * from './lease-gate.js';
export * from './broker.js';
