/**
 * @sos-2/provenance — SOS 2.0 Provenance (Work Order W3).
 *
 * Producer records (tool, model+version if LLM-involved, command,
 * environment), exact source/deployment revisions, time windows and context,
 * verifiable provenance chains (broken chains reported as UNKNOWN, never
 * silently truncated), preservation of the underlying source availability
 * (all 6 distinct truth states), and non-authoritative LLM provenance.
 *
 * All identities and canonical serialization come from
 * @sos-2/semantic-spine; invalid provenance always fails loudly.
 */

export * from './chain.js';
export * from './errors.js';
export * from './producer.js';
export * from './record.js';
export * from './store.js';
export * from './window.js';
