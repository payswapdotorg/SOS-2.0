/**
 * @sos-2/telemetry-runtime — SOS 2.0 Telemetry Runtime (Work Order P7).
 *
 * Poll-driven RawObservation ingestion into the replay-protected event
 * store, capture-verbatim (truth states survive bit-exact). Typed poll
 * failures; deterministic event ids; everything injected.
 */

export * from './errors.js';
export * from './poll.js';
