/**
 * Injected clocks (Work Order P2 determinism rule).
 *
 * NO hidden clocks anywhere in this package: every timestamp is
 * caller-supplied or minted through an INJECTED clock (RFC3339 instants).
 * The reference deterministic clock advances in fixed steps from a fixed
 * origin; tests pin exact sequences; the composition root in apps/api
 * supplies the real clock. The spine's own discipline ("created_at is
 * always caller-supplied; never a hidden clock") is preserved here.
 */

import { LiveStoreError } from './errors.js';

/** A clock mints RFC3339 instants. Deterministic implementations are pure. */
export interface Clock {
  now(): string;
}

export class ClockError extends LiveStoreError {
  constructor(message: string) {
    super(message);
    this.name = 'ClockError';
  }
}

const RFC3339_PATTERN = /^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/;

/**
 * Deterministic sequence clock: starts at `origin` (RFC3339) and advances
 * by `stepMs` per call. Pure, total, offline — the store-side stamping
 * clock for tests and the reference fixture world.
 */
export class DeterministicClock implements Clock {
  private epochMs: number;

  constructor(
    private readonly origin: string,
    private readonly stepMs: number = 1000,
  ) {
    if (!RFC3339_PATTERN.test(origin)) {
      throw new ClockError(`clock origin must be RFC3339, received: ${JSON.stringify(origin)}`);
    }
    const parsed = Date.parse(origin);
    if (!Number.isFinite(parsed)) {
      throw new ClockError(`clock origin is not parseable: ${JSON.stringify(origin)}`);
    }
    this.epochMs = parsed;
  }

  now(): string {
    const stamp = new Date(this.epochMs).toISOString();
    this.epochMs += this.stepMs;
    return stamp;
  }
}

/** A clock frozen at one instant (returns the same RFC3339 stamp on every call). */
export class FrozenClock implements Clock {
  constructor(private readonly at: string) {
    if (!RFC3339_PATTERN.test(at)) {
      throw new ClockError(`frozen clock instant must be RFC3339, received: ${JSON.stringify(at)}`);
    }
  }

  now(): string {
    return this.at;
  }
}
