/**
 * @sos-2/sandbox — bounded execution environments (Work Order P8).
 *
 * - The bounded-environment CONTRACT: filesystem scope, network egress
 *   policy (allow/deny by host, no ambient network), secrets isolation
 *   (injected credentials live only inside the sandbox closure; values
 *   never echoed — NAMES only) and resource envelopes as injected
 *   deterministic budgets (the in-process realization of cpu/memory/time
 *   limits).
 * - Boundary violations are TYPED DENIALS (filesystem out-of-scope,
 *   denied egress, budget overrun, unavailable credential, ended
 *   sandbox) — never silent, never a crash.
 * - The reference LOCAL SANDBOX: a deterministic, in-process bounded
 *   environment used by tests and local development; describe() answers
 *   the merged P5 BoundedEnvironmentDescription (consumed vocabulary).
 *
 * Determinism: no Date.now / Math.random / fetch / process.env in this
 * package's src — policies, secrets and budgets are injected data.
 */

export * from './errors.js';
export * from './policy.js';
export * from './denials.js';
export * from './contract.js';
export * from './local-sandbox.js';
