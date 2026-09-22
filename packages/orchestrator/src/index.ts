/**
 * @sos-2/orchestrator — the Spirit Orchestrator (Work Order P6): the
 * governed control loop of the persistent Spirit over the merged P2
 * live-store records and the P5 Harness Contract / Body Broker /
 * Execution Fabric.
 *
 *  - mission-aware decomposition (typed decomposition records; the
 *    reasoning broker as NON-AUTHORITATIVE input; deterministic,
 *    authoritative task-graph structure);
 *  - up to three concurrent worker lanes on DISJOINT owned-path scopes
 *    (typed assignment denial on collision — never silent overlap);
 *  - typed assignment + handoff records; pause/resume/cancel as
 *    first-class §9 operations with durable transitions;
 *  - ASK escalation through @sos-2/ask's AskQueue (first-class, a
 *    success state — never an exception class, never a silent bypass);
 *  - worker result ingestion routed to INDEPENDENT VERIFICATION — a
 *    worker reporting completion never certifies mission success (no
 *    self-approval); the verification record gates COMPLETED;
 *  - the ARCHITECT ROLE as a governed control function (typed
 *    ArchitectGate records for merge/promote/deploy-class transitions,
 *    carrying the authority acted under — recorded, bounded, unable to
 *    mint authority; every bypass attempt is a typed violation naming
 *    the field and the rule).
 *
 * Determinism: no Date.now / Math.random / fetch / process.env in this
 * package's src — every port is injected.
 */

export * from './errors.js';
export * from './decomposition.js';
export * from './verification.js';
export * from './escalation.js';
export * from './architect-gate.js';
export * from './orchestrator.js';
