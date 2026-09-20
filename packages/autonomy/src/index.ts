/**
 * @sos-2/autonomy — SOS 2.0 Autonomy Policy (Work Order W10).
 *
 * The frozen autonomy level ladder (SUPERVUSED -> BOUNDED ->
 * AUTONOMOUS_LOW_RISK) scoped per action kind x blast radius; scoped
 * authority enforcement through @sos-2/authority's grant evaluation; the
 * risk x irreversibility escalation matrix; and governed autonomy raises.
 *
 * All identities, envelopes and the kind registry come from
 * @sos-2/semantic-spine; grant semantics, the permission vocabulary, risk
 * severities and uncertainty classes are CONSUMED from @sos-2/authority —
 * never redefined. Invalid autonomy operations always fail loudly.
 */

export * from './escalation.js';
export * from './errors.js';
export * from './enforcement.js';
export * from './levels.js';
export * from './policy.js';
export * from './raise.js';
