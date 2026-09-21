/**
 * @sos-2/live-store — SOS 2.0 Live Persistence (Work Order P2).
 *
 * Durable, provider-neutral repositories for the live product state plus
 * the three provider PORTS with complete in-memory reference
 * implementations. Semantic discipline is pinned by tests: verbatim
 * preservation (ids + exact revisions, canonical round-trip equality),
 * idempotent writes, typed stale-revision conflicts, durable
 * task/checkpoint records, event ingestion with replay protection,
 * Redis-never-canonical and the explicit typed UNKNOWN/UNAVAILABLE
 * provider failure model.
 *
 * The frozen domain packages are CONSUMED (guards verbatim, records
 * verbatim); domain packages never import provider specifics; the Semantic
 * Spine remains the only identity authority.
 */

export * from './errors.js';
export * from './clock.js';
export * from './state-records.js';
export * from './record-adapters.js';
export * from './provider-ports.js';
export * from './in-memory-providers.js';
export * from './repositories.js';
export * from './event-log.js';
export * from './artifacts.js';
export * from './facade.js';
