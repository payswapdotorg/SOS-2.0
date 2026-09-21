/**
 * @sos-2/execution-fabric — the provider-neutral orchestration surface
 * (Work Order P5).
 *
 * Composes the Harness Contract (@sos-2/harness) and the Body Broker
 * (@sos-2/body-broker) into bounded task execution with durable task
 * state (@sos-2/live-store, the §6 shape), the typed observation
 * boundary, and per-operation authority re-evaluation
 * (@sos-2/authority's evaluateGrant — the W12 ExecutionAdapter pattern).
 *
 * - Uniform gates on every consequential operation: task -> lease (fail
 *   closed) -> authority (current grant heads, re-evaluated) ->
 *   advertisement (explicit) -> dispatch through the §9 contract.
 * - A body can neither mint nor widen authority: exact-shape operation
 *   validation (smuggled authority keys are typed-rejected), grants
 *   resolve ONLY from the durable store, body outputs are
 *   non-authoritative observations, and a body completion report never
 *   completes a task (§10).
 * - Task identity is durable: body replacement preserves the task id and
 *   all durable state.
 *
 * Determinism: no Date.now / Math.random / fetch / process.env in this
 * package's src — stores, broker and clock are injected; observation ids
 * are deterministic sequences.
 */

export * from './errors.js';
export * from './denials.js';
export * from './authority-gate.js';
export * from './operations.js';
export * from './fabric.js';
