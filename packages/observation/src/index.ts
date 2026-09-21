/**
 * @sos-2/observation — SOS 2.0 Observation Plane core (Work Order P7).
 *
 * The no-body observation loop: event ingestion summaries in, live
 * projections out, System State reconciliation, shortfall/opportunity
 * detection. Observation NEVER mutates semantic truth — the System
 * State is a read-only claims port; projections are derived views.
 * Stale/unavailable is always distinguishable from success. Everything
 * is injected (clock, repositories, claims, wiring): zero ambient
 * network/process/time in package src.
 */

export * from './errors.js';
export * from './projection.js';
export * from './reconcile.js';
export * from './detection.js';
export * from './loop.js';
