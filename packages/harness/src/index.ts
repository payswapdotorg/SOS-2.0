/**
 * @sos-2/harness — the Harness Contract (Work Order P5).
 *
 * The provider-neutral execution contract of
 * spec/productization-execution-architecture.md §9 as typed interfaces,
 * plus the §3 capability advertisement model mirrored field-for-field.
 *
 * - Unsupported capabilities are EXPLICIT: the advertisement is binding
 *   (isOperationAdvertised) and unadvertised operations answer typed
 *   UNSUPPORTED results — never silent failure.
 * - Harness/provider identity is NEVER SOS semantic identity (the runtime
 *   identifier discipline consumed from @sos-2/runtime-contracts).
 * - The contract surface carries NO authority fields: bodies cannot mint,
 *   carry or widen authority.
 * - Determinism: no Date.now / Math.random / fetch / process.env in this
 *   package's src; bodies are clock-less (the fabric stamps instants).
 */

export * from './errors.js';
export * from './identity.js';
export * from './operations.js';
export * from './capabilities.js';
export * from './results.js';
export * from './requests.js';
export * from './contract.js';
