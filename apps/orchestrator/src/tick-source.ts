/**
 * THE INJECTED TICK SOURCE (Work Order P6) — the orchestrator loop runs
 * on ticks from THIS port; no ambient timers exist anywhere in the
 * P6-owned sources.
 *
 * The bounded deterministic reference (FiniteTickSource) yields a fixed
 * number of ticks and reports drained — the demo main and the tests use
 * it; a real host (HTTP command poll, queue poll, scheduler) implements
 * the same port without contract change.
 */

/** The tick source port: is there another tick to run? */
export interface TickSource {
  /** Returns true while more ticks are due (never blocks — poll-driven). */
  next(): boolean;
}

/** A bounded finite tick source: exactly `ticks` ticks, then drained. */
export class FiniteTickSource implements TickSource {
  private remaining: number;

  constructor(ticks: number) {
    if (!Number.isInteger(ticks) || ticks < 0) {
      throw new Error(`FiniteTickSource requires a non-negative integer tick count, received: ${String(ticks)}`);
    }
    this.remaining = ticks;
  }

  next(): boolean {
    if (this.remaining > 0) {
      this.remaining -= 1;
      return true;
    }
    return false;
  }

  get drained(): boolean {
    return this.remaining === 0;
  }
}
