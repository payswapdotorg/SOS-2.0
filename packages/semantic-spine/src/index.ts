/**
 * @sos-2/semantic-spine — the operational core of the SOS 2.0 Semantic Spine.
 *
 * EXPORT DISCIPLINE (binding for all downstream Work Orders W1-W18):
 * this package (re-exporting the normative types from @sos-2/contracts) is
 * the ONLY sanctioned way downstream code obtains core identifiers and spine
 * vocabulary. Downstream code must either mint ids through the exported
 * minters (random or deterministic) or consume the golden contract fixtures
 * in ./fixtures — never invent identifiers.
 */

// Normative contract surface (single semantic registry — no second registry).
export * from '@sos-2/contracts';

// Spine operations.
export * from './canonical.js';
export * from './conformance-classifier.js';
export * from './delta.js';
export * from './errors.js';
export * from './identity.js';
export * from './lifecycle.js';
export * from './trace-store.js';
