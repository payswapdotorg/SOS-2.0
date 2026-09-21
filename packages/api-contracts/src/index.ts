/**
 * @sos-2/api-contracts — the typed API boundary of SOS 2.0 (Work Order P2).
 *
 * PURE TYPES + GUARDS, ZERO runtime dependencies. This package is the ONE
 * shared home of the P2 boundary vocabulary (typed error envelopes, write
 * outcomes, revision-conflict records, pagination cursors, revision
 * headers, observation event ingestion payloads, provider-health payloads,
 * coordination-degradation records) consumed by @sos-2/live-store (the
 * durable, provider-neutral repositories) and apps/api (the service).
 *
 * EXPORT DISCIPLINE: semantic record types (Mission, SystemState, Evidence,
 * Task, BodyLease, ...) are NOT redefined here — they remain owned by the
 * frozen domain packages / @sos-2/live-store and cross this boundary as
 * validated JSON preserved verbatim. This package defines no second
 * semantic registry (AGENTS.md section 4); the Semantic Spine remains the
 * only identity authority.
 */

export * from './json.js';
export * from './errors.js';
export * from './pagination.js';
export * from './headers.js';
export * from './responses.js';
export * from './events.js';
export * from './health.js';
