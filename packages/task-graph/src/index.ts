/**
 * @sos-2/task-graph — the durable task graph (Work Order P6).
 *
 * The mission-linked, authority-pinned durable work graph of the Spirit
 * Orchestrator:
 *
 *  - TaskNode records with MISSION + AUTHORITY references on EVERY task
 *    (pinned), owned-path scopes (disjoint concurrent assignment — typed
 *    denial on collision, never silent overlap), validated acyclic
 *    dependencies, a typed six-state machine (PENDING/RUNNING/PAUSED/
 *    CANCELLED/COMPLETED/FAILED — typed transitions only, completion is
 *    verification-gated), assignment + handoff records, workspace
 *    revision pinning, the checkpoint chain, typed failures with explicit
 *    recovery (RETRYABLE, never silently done), unresolved uncertainty,
 *    the cost envelope and the final verification record ref.
 *  - The full section 6 task-durability field list of
 *    spec/productization-execution-architecture.md is representable
 *    field-for-field (pinned by tests).
 *  - Crash safety as a STRUCTURAL property: invariant scans + property
 *    tests pin no orphaned references, no partial writes, no lost tasks;
 *    worker crashes / provider outages / body loss produce TYPED task
 *    failures and recovery marks the task retryable.
 *  - Persistence is append-only through the P2 live-store task records
 *    VERBATIM (the node snapshot lives in the record's plan field; every
 *    section 6 field maps natively; the store never redefines the
 *    graph's shapes).
 *
 * Determinism: no Date.now / Math.random / fetch / process.env in this
 * package's src — the clock and the stores are injected.
 */

export * from './errors.js';
export * from './scope.js';
export * from './node.js';
export * from './invariants.js';
export * from './graph.js';
