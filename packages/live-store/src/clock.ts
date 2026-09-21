/**
 * The injected clock (Work Order P2 determinism rule).
 *
 * NO Date.now / Math.random / fetch / process.env appears in this package's
 * src: every timestamp is produced by an INJECTED clock. The in-memory
 * reference adapters (lease TTLs, event received_at, task updated_at)
 * consume this port; tests inject ManualClock; the apps/api boundary
 * injects a system clock at composition time.
 */

/** The clock port: the current instant as epoch milliseconds. */
export interface Clock {
  nowEpochMs(): number;
}

/**
 * A fully deterministic manual clock: starts at a caller-supplied instant
 * and moves ONLY when the test advances it.
 */
export class ManualClock implements Clock {
  private currentEpochMs: number;

  constructor(startEpochMs: number) {
    if (!Number.isFinite(startEpochMs)) {
      throw new TypeError(`ManualClock start must be finite, received: ${String(startEpochMs)}`);
    }
    this.currentEpochMs = Math.trunc(startEpochMs);
  }

  nowEpochMs(): number {
    return this.currentEpochMs;
  }

  /** Advance the clock by a (possibly negative) offset in milliseconds. */
  advance(offsetMs: number): void {
    if (!Number.isFinite(offsetMs)) {
      throw new TypeError(`ManualClock offset must be finite, received: ${String(offsetMs)}`);
    }
    this.currentEpochMs += Math.trunc(offsetMs);
  }

  /** Set the clock to an exact instant. */
  setTo(epochMs: number): void {
    if (!Number.isFinite(epochMs)) {
      throw new TypeError(`ManualClock instant must be finite, received: ${String(epochMs)}`);
    }
    this.currentEpochMs = Math.trunc(epochMs);
  }
}

/**
 * Deterministic RFC3339 rendering of a GIVEN instant (UTC, millisecond
 * precision). This is pure formatting of an injected value — never a hidden
 * clock read. Same instant -> same text, always.
 */
export function formatRfc3339(epochMs: number): string {
  if (!Number.isFinite(epochMs)) {
    throw new TypeError(`cannot format a non-finite instant: ${String(epochMs)}`);
  }
  return new Date(Math.trunc(epochMs)).toISOString();
}
