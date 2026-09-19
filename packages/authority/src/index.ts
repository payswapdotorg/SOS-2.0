/**
 * @sos-2/authority — SOS 2.0 Authority (Work Order W1).
 *
 * Scoped AuthorityGrants with expiry (time or revision-bound) and explicit
 * revocation; deterministic grant evaluation; loud authorization and
 * anti-escalation delegation; and the first-class ASK contract.
 *
 * All identities and envelopes come from @sos-2/semantic-spine; invalid
 * authority transitions always fail loudly.
 */

export * from './ask.js';
export * from './authorize.js';
export * from './decisions.js';
export * from './delegate.js';
export * from './errors.js';
export * from './grant.js';
export * from './permissions.js';
export * from './store.js';
