/**
 * @sos-2/ask — SOS 2.0 Structured ASK (Work Order W10).
 *
 * The routing/presentation layer on top of @sos-2/authority's first-class
 * AskRequest contract (consumed, never redefined): ask content composition
 * (deterministic defaults from an ASK decision record), the escalation
 * context a decider needs to see, the ordered/deduplicated AskQueue, and
 * resolution handling through @sos-2/decision's record machinery.
 *
 * ASK IS A SUCCESS STATE (R16): an AskRequest is a valid first-class
 * outcome — never an exception class.
 */

export * from './compose.js';
export * from './context.js';
export * from './errors.js';
export * from './queue.js';
