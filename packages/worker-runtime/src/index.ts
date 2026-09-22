/**
 * @sos-2/worker-runtime — the worker-side execution runtime (Work Order
 * P6).
 *
 * The contract a WORKER fulfils while executing an assigned task through
 * the P5 harness: §9 operations through the execution fabric's uniform
 * gates, body leases through @sos-2/body-broker, capability-checked
 * calls (typed UNSUPPORTED consumed from the contract's own binding
 * advertisement map — never a silent failure), durable checkpoint
 * discipline (a crashed worker resumes from checkpoint, not from zero —
 * the task graph records the chain), and typed WorkerResult emission
 * with evidence refs, the exact workspace revision, provenance and an
 * honest status (a completion report never certifies — section 10).
 *
 * Determinism: no Date.now / Math.random / fetch / process.env in this
 * package's src — everything is injected; simulated crashes are explicit
 * deterministic injections.
 */

export * from './errors.js';
export * from './steps.js';
export * from './result.js';
export * from './runtime.js';
