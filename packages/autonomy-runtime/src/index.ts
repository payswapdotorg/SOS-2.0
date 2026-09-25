/**
 * @sos-2/autonomy-runtime — the body-lease supervision + recovery layer
 * (Work Order P12). Public surface:
 *
 *   - BeatSource / ManualBeatSource            — injectable worker heartbeats
 *   - FailureVerificationSource / Manual*      — the only path to LOST
 *   - classifyLease / LeaseSupervisionView     — HEALTHY/SUSPECTED/LOST/NOT_HELD
 *   - LeaseSupervisor                          — durable observation emission
 *   - LeaseActionService + LeaseLifecycleExecutor — leases THROUGH the P9 gateway
 *   - RecoveryPlanner / RecoveryPlan           — what the replacement inherits + what is UNKNOWN
 *   - OutageRegistry / providerStatusOf        — truthful outage windows
 *   - BackoffRetryController / AskSink         — bounded retries, then ASK
 *   - CostLedger                               — evidence-only cost accounting
 *
 * Determinism: no Date.now / Math.random / fetch / process.env in this
 * package's src — the clock, stores, beat source and sinks are injected.
 */

export * from './errors.js';
export * from './beat.js';
export * from './verification.js';
export * from './lease-view.js';
export * from './supervisor.js';
export * from './lease-actions.js';
export * from './recovery.js';
export * from './outage.js';
export * from './cost.js';
