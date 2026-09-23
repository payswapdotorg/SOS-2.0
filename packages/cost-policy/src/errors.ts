/**
 * Typed errors for the P14 cost + reliability contracts. A budget
 * exhaustion, a rate limit or a containment suspension is a TYPED
 * record/decision — never a silent pass and never an untyped crash.
 */

/** Base class carrying the P14 cost-policy namespace. */
export class CostPolicyError extends Error {
  constructor(
    readonly surface: string,
    message: string,
  ) {
    super(`[${surface}] ${message}`);
    this.name = 'CostPolicyError';
  }
}

/** Budget record violations (malformed limits/ledger). */
export class BudgetPolicyError extends CostPolicyError {
  constructor(message: string) {
    super('budget', message);
    this.name = 'BudgetPolicyError';
  }
}

/** Rate-limit policy violations. */
export class RateLimitPolicyError extends CostPolicyError {
  constructor(message: string) {
    super('rate-limit', message);
    this.name = 'RateLimitPolicyError';
  }
}

/** Retry/backoff policy violations (unbounded policies are rejected). */
export class RetryPolicyError extends CostPolicyError {
  constructor(message: string) {
    super('dead-letter', message);
    this.name = 'RetryPolicyError';
  }
}

/** Abuse-containment policy violations. */
export class AbusePolicyError extends CostPolicyError {
  constructor(message: string) {
    super('abuse-containment', message);
    this.name = 'AbusePolicyError';
  }
}
