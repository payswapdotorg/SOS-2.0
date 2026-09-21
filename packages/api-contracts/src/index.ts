/**
 * @sos-2/api-contracts — the typed API boundary of the SOS 2.0 live API
 * (Work Order P2).
 *
 * Pure types + guards over the API surface: transport-agnostic request and
 * response envelopes, typed error envelopes, opaque pagination cursors,
 * revision headers, event ingestion payloads and provider-health payloads.
 *
 * DOMAIN TYPES ARE NEVER RE-DECLARED HERE: record bodies crossing this
 * boundary are the verbatim shapes of the owning @sos-2/* packages (the
 * spine remains the single identity/serialization authority; the frozen
 * truth-state vocabulary is consumed from @sos-2/semantic-spine, not
 * duplicated). The only dependency is the workspace spine.
 */

export * from './errors.js';
export * from './events.js';
export * from './health.js';
export * from './pagination.js';
export * from './revisions.js';
export * from './routes.js';
