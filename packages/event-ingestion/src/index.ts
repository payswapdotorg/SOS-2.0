/**
 * @sos-2/event-ingestion — SOS 2.0 Event Ingestion (Work Order P7).
 *
 * The Observation Plane ingestion boundary: §5 input families → P2
 * replay-protected observation events. Telemetry captures are carried
 * verbatim (truth states survive bit-exact). Scheduled probes are the
 * honest fallback, run only where the coverage ledger reports organic
 * coverage insufficient. Everything is injected (clock, repositories,
 * source ports): zero ambient network/process/time in package src.
 */

export * from './errors.js';
export * from './sources.js';
export * from './normalize.js';
export * from './ingest.js';
export * from './probes.js';
export * from './coverage.js';
