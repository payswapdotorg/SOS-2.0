/**
 * @sos-2/value — the SOS 2.0 Value Model (Work Order W1).
 *
 * Economic objectives, budgets, incentives, opportunities and typed
 * constraints — as a versioned artifact DETERMINISTICALLY SUBORDINATE to
 * Mission (value can never outrank mission).
 *
 * All identities and envelopes come from @sos-2/semantic-spine; trace links
 * use the 17 frozen types (CONFLICTS_WITH for mission conflicts).
 */

export * from './artifact.js';
export * from './constraints.js';
export * from './errors.js';
export * from './model.js';
export * from './precedence.js';
export * from './subordination.js';
