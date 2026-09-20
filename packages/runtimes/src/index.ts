/**
 * @sos-2/runtimes — SOS 2.0 Runtimes (Work Order W12, parallel slot C).
 *
 * The runtime contract: typed runtime descriptors (kind, version,
 * capabilities, constraints) + a RuntimeHost that executes DECLARED
 * operations against DECLARED runtimes.
 *
 *   - EXECUTION IS AUTHORITY CHECKED: every request carries a grant
 *     reference validated through @sos-2/authority grant evaluation before
 *     running; expired/revoked/missing/unknown -> EXECUTION_DENIED with a
 *     structured reason.
 *   - RUNTIME FEEDS SYSTEM STATE AND EVIDENCE: every execution emits a
 *     typed, evidence-shaped observation record with truthful availability,
 *     linked to the SystemState revision it observed (OBSERVES/VERIFIES
 *     trace links minted through the spine). Observations NEVER mutate
 *     System State directly — they are input to reconciliation.
 *   - PLATFORM BEHAVIOR IS CONTEXT/ADAPTER DATA: runtime/platform
 *     specifics live in typed context dimensions consumed from
 *     @sos-2/context (runtimeMatchesContext); the execution path never
 *     reads context — no semantic branch on platform exists anywhere.
 */

export * from './errors.js';
export * from './descriptor.js';
export * from './observation.js';
export * from './host.js';
