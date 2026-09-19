/**
 * @sos-2/mission — the SOS 2.0 Mission model (Work Order W1).
 *
 * Versioned, authority-controlled mission artifacts with progressive
 * formalization, an explicit revision workflow and complete, queryable
 * revision history.
 *
 * All identities and envelopes come from @sos-2/semantic-spine (never
 * duplicated). Trace links use the 17 frozen spine types.
 */

export * from './artifact.js';
export * from './errors.js';
export * from './model.js';
export * from './revision.js';
