/**
 * @sos-2/cost-policy — cost + reliability policy contracts (Work Order
 * P14).
 *
 * - Task concurrency/cost budgets: typed ALLOW / BUDGET_EXCEEDED /
 *   ACCOUNTING_UNKNOWN — incomplete accounting is honest UNKNOWN,
 *   never a silently guessed allowance (./budgets/budgets.ts).
 * - Rate limiting: typed limit policies over action/executor
 *   invocations with a deterministic reference limiter and computed
 *   retry-after hints (./rate-limit/limiter.ts).
 * - Provider health: the four honest statuses with UNKNOWN during
 *   outage windows; statuses change only through observed probes
 *   (./health/provider-health.ts).
 * - Dead-letter/retry handling: bounded retry/backoff then ASK —
 *   never silent drop, never infinite retry (./dead-letter/dead-letter.ts).
 * - Abuse containment: a task exhibiting abuse signatures is suspended
 *   pending ASK — observed evidence, never silent termination
 *   (./abuse/containment.ts).
 *
 * Everything is a provider-neutral contract + deterministic reference
 * implementation with injectable seams. Real billing systems, rate-limit
 * infrastructure and provider status feeds attach later as adapters
 * WITHOUT contract change. Honest statuses throughout: a policy that
 * cannot be evaluated honestly reports UNKNOWN — never fabricated.
 *
 * ZERO dependencies (the lockfile identity rule). No ambient time,
 * randomness, environment, network, processes or timers in src.
 */

export * from './types.js';
export * from './errors.js';
export * from './budgets/budgets.js';
export * from './rate-limit/limiter.js';
export * from './health/provider-health.js';
export * from './dead-letter/dead-letter.js';
export * from './abuse/containment.js';
